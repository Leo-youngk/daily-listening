# -*- coding: utf-8 -*-
"""从 TED 官网抓取人工翻译的中文字幕，替换机器翻译。

用法：
    python scripts/fetch_ted_zh_subs.py                 # 处理所有 TED 演讲
    python scripts/fetch_ted_zh_subs.py --dry-run       # 只报告偏移量和覆盖率，不写入
    python scripts/fetch_ted_zh_subs.py --slug xxx

为什么不能直接按时间重叠对齐：
    TED.com 的 cue 时间是 TED 自己那版视频的时间轴，我们的音频取自 YouTube 上传版，
    片头多一段 TED 动画。实测 markus_fischer 那篇差 15.3 秒，整体错位约 2 句。
    所以先抓同一页的英文 transcript，把它的 cue 文本和我们已有的句子做 LCS 得到锚点对，
    据此建立 TED 时间轴 -> 我们时间轴的分段线性映射，再把中文 cue 映射过来。
    分段而不是常数偏移，是为了兼容中途剪掉掌声的上传版。
"""
from __future__ import annotations

import argparse
import difflib
import io
import json
import re
import sys
import time
from bisect import bisect_left
from pathlib import Path
from statistics import median
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from align_words import js_tokens, units  # noqa: E402  分词必须和前端 tokenizeSentence 同构
from data_io import write_talk

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
BASE_REV = "a84730a~1"  # 引入错位的那次提交之前，zh 还是逐句机器翻译，天然对齐

# Windows 控制台默认非 UTF-8，强制 stdout 用 UTF-8 避免乱码
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"

MIN_ANCHORS = 8
MIN_MATCH_RATIO = 0.45
MIN_COVERAGE = 0.30


# ---------------------------------------------------------------- 抓取

def _get(url: str) -> str:
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def resolve_canonical_slug(slug: str) -> str | None:
    """请求项目 slug 对应的 talk 页，跟随重定向拿到 TED 规范 slug。"""
    try:
        req = Request("https://www.ted.com/talks/" + quote(slug, safe=""),
                      headers={"User-Agent": UA, "Accept": "text/html"})
        with urlopen(req, timeout=30) as resp:
            final = resp.geturl()
    except Exception:
        return None
    m = re.search(r"/talks/([^/?#]+)", final)
    return m.group(1) if m and m.group(1) else None


def fetch_cues(canonical_slug: str, language: str) -> list[dict] | None:
    """抓 transcript 并解析为 [{start, end, text}]，时间在 TED 自己的时间轴上。"""
    url = f"https://www.ted.com/talks/{quote(canonical_slug, safe='')}/transcript?language={language}"
    try:
        html = _get(url)
    except Exception:
        return None
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    translation = (data.get("props", {}).get("pageProps", {})
                   .get("transcriptData", {}).get("translation"))
    if not translation:
        return None

    raw = []
    for para in translation.get("paragraphs") or []:
        for cue in para.get("cues", []):
            text = (cue.get("text") or "").replace("\n", " ").strip()
            if text:
                raw.append({"start": cue.get("time", 0) / 1000.0, "text": text})
    if not raw:
        return None

    raw.sort(key=lambda c: c["start"])
    cues = []
    for i, c in enumerate(raw):
        end = raw[i + 1]["start"] if i + 1 < len(raw) else c["start"] + 8.0
        cues.append({"start": c["start"], "end": max(end, c["start"] + 0.2), "text": c["text"]})
    return cues


# ---------------------------------------------------------------- 时间轴映射

def our_word_timeline(sentences: list[dict]) -> list[tuple[str, float]]:
    """我们这侧的 (归一化子词, 时间)。有词级时间轴就用它，没有就在句内线性插值。"""
    out = []
    for s in sentences:
        tokens = js_tokens(s["en"])
        if not tokens:
            continue
        w = s.get("w")
        span = max(0.01, s["end"] - s["start"])
        for i, token in enumerate(tokens):
            if w and len(w) >= (i + 1) * 2:
                t = w[i * 2]
            else:
                t = s["start"] + span * i / len(tokens)
            for unit in units(token):
                out.append((unit, t))
    return out


def ted_word_timeline(cues: list[dict]) -> list[tuple[str, float]]:
    out = []
    for cue in cues:
        tokens = js_tokens(cue["text"])
        if not tokens:
            continue
        span = max(0.01, cue["end"] - cue["start"])
        for i, token in enumerate(tokens):
            t = cue["start"] + span * i / len(tokens)
            for unit in units(token):
                out.append((unit, t))
    return out


def build_time_map(ted_cues: list[dict], sentences: list[dict]):
    """返回 (映射函数, 匹配率, 锚点数, 偏移量中位数)；锚点不足时映射函数为 None。"""
    src = ted_word_timeline(ted_cues)
    ref = our_word_timeline(sentences)
    if not src or not ref:
        return None, 0.0, 0, 0.0

    matcher = difflib.SequenceMatcher(None, [u for u, _ in src], [u for u, _ in ref], autojunk=False)
    pairs = []
    matched = 0
    for tag, i1, i2, j1, _j2 in matcher.get_opcodes():
        if tag != "equal":
            continue
        matched += i2 - i1
        for k in range(i2 - i1):
            pairs.append((src[i1 + k][1], ref[j1 + k][1]))
    ratio = matched / len(src)
    if len(pairs) < MIN_ANCHORS or ratio < MIN_MATCH_RATIO:
        return None, ratio, len(pairs), 0.0

    # 每 40 个锚点压成一个，取中位数抗离群；再强制单调
    pairs.sort()
    step = max(1, len(pairs) // 60)
    xs, ys = [], []
    for i in range(0, len(pairs), step):
        chunk = pairs[i:i + step]
        x = median(p[0] for p in chunk)
        y = median(p[1] for p in chunk)
        if xs and x <= xs[-1]:
            continue
        xs.append(x)
        ys.append(max(y, ys[-1]) if ys else y)
    if len(xs) < 2:
        return None, ratio, len(pairs), 0.0

    offsets = [y - x for x, y in zip(xs, ys)]

    def mapper(t: float) -> float:
        if t <= xs[0]:
            return t + (ys[0] - xs[0])
        if t >= xs[-1]:
            return t + (ys[-1] - xs[-1])
        i = bisect_left(xs, t)
        x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
        k = (t - x0) / (x1 - x0) if x1 > x0 else 0.0
        return y0 + (y1 - y0) * k

    return mapper, ratio, len(pairs), median(offsets)


# ---------------------------------------------------------------- 对齐与写入

def assign_cues(sentences: list[dict], zh_cues: list[dict], mapper) -> list[str]:
    """每条中文 cue 只归属重叠最多的那一句，避免相邻句重复同一段译文。"""
    buckets: list[list[str]] = [[] for _ in sentences]
    for cue in zh_cues:
        start, end = mapper(cue["start"]), mapper(cue["end"])
        if end <= start:
            end = start + 0.2
        best_i, best_overlap = -1, 0.0
        for i, s in enumerate(sentences):
            overlap = min(end, s["end"]) - max(start, s["start"])
            if overlap > best_overlap:
                best_i, best_overlap = i, overlap
        if best_i >= 0:
            buckets[best_i].append(cue["text"])
    return ["".join(b).strip() for b in buckets]


def git_base_zh(slug: str, count: int) -> list[str] | None:
    """错位提交之前的逐句机器翻译，作为没有官方译文时的兜底。"""
    import subprocess
    try:
        raw = subprocess.run(["git", "show", f"{BASE_REV}:public/data/{slug}.json"],
                             cwd=ROOT, capture_output=True, check=True).stdout
        old = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    zh = [s.get("zh", "") for s in old.get("sentences", [])]
    return zh if len(zh) == count else None


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_talk(slug: str, data: dict) -> None:
    write_talk(DATA_DIR / f"{slug}.json", data)


def process_slug(slug: str, dry_run: bool) -> tuple[bool, str]:
    path = DATA_DIR / f"{slug}.json"
    if not path.exists():
        return False, "数据文件不存在"
    talk = load_json(path)
    sentences = talk.get("sentences") or []
    if not sentences:
        return False, "无句子数据"

    canonical = resolve_canonical_slug(slug)
    if not canonical:
        return False, "无法解析 TED 规范链接"
    time.sleep(0.3)

    en_cues = fetch_cues(canonical, "en")
    if not en_cues:
        return False, "无英文 transcript，无法定标"
    time.sleep(0.3)

    mapper, ratio, anchors, offset = build_time_map(en_cues, sentences)
    if mapper is None:
        return False, f"时间轴定标失败 (匹配率 {ratio:.2f}, 锚点 {anchors})"

    zh_cues = fetch_cues(canonical, "zh-cn")
    if not zh_cues:
        return False, f"无官方中文翻译 (偏移 {offset:+.1f}s)"

    aligned = assign_cues(sentences, zh_cues, mapper)
    covered = sum(1 for z in aligned if z)
    coverage = covered / len(sentences)
    if coverage < MIN_COVERAGE:
        return False, f"覆盖率过低 {coverage:.0%} (偏移 {offset:+.1f}s)"

    note = f"偏移 {offset:+.1f}s, 匹配率 {ratio:.2f}, 锚点 {anchors}, 覆盖 {coverage:.0%}"
    if dry_run:
        return True, "✓ " + note

    base = git_base_zh(slug, len(sentences))
    for i, s in enumerate(sentences):
        if aligned[i]:
            s["zh"] = aligned[i]
        elif base is not None:
            s["zh"] = base[i]

    talk["zhSource"] = "official" if coverage >= 0.95 else "mixed"
    save_talk(slug, talk)

    manifest = load_json(MANIFEST_PATH)
    for item in manifest:
        if item["slug"] == slug:
            item["zhSource"] = talk["zhSource"]
            break
    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    return True, f"✓ {talk['zhSource']} | " + note


def main():
    parser = argparse.ArgumentParser(description="抓取并正确对齐 TED 官方中文字幕")
    parser.add_argument("--slug", help="只处理指定 slug，逗号分隔")
    parser.add_argument("--category", default="ted")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    manifest = load_json(MANIFEST_PATH)
    if args.slug:
        targets = [s.strip() for s in args.slug.split(",") if s.strip()]
    else:
        targets = [item["slug"] for item in manifest if item.get("category") == args.category]

    print(f"共 {len(targets)} 篇待处理 (category={args.category}, dry_run={args.dry_run})\n", flush=True)
    ok, failed = 0, []
    for i, slug in enumerate(targets, 1):
        try:
            success, status = process_slug(slug, args.dry_run)
        except Exception as exc:
            success, status = False, f"{type(exc).__name__}: {exc}"
        print(f"[{i}/{len(targets)}] {slug}: {status}", flush=True)
        if success:
            ok += 1
        else:
            failed.append((slug, status))
        time.sleep(0.5)

    print(f"\n完成 {ok} / {len(targets)}，未处理 {len(failed)}")
    for slug, status in failed:
        print(f"  {slug}: {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
