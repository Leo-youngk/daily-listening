# -*- coding: utf-8 -*-
"""从 TED 官网抓取人工翻译的中文字幕，替换现有机器翻译。

用法：
    python scripts/fetch_ted_zh_subs.py              # 处理所有 zhSource=mt 的 TED 演讲
    python scripts/fetch_ted_zh_subs.py --dry-run     # 只检查哪些有官方中文，不写入
    python scripts/fetch_ted_zh_subs.py --slug xxx    # 只处理指定 slug

工作原理：
    1. 读取 manifest.json 找到 category=ted & zhSource=mt 的条目
    2. 用项目 slug 请求 TED talk 页，跟随 301 重定向拿到规范 slug
    3. 请求规范 slug 的中文翻译字幕页，解析 __NEXT_DATA__ 里的 cue
    4. 将字幕按时间戳对齐到现有句子结构
    5. 更新 data/<slug>.json 的 zh 字段和 zhSource
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"

# Windows 控制台默认非 UTF-8，强制 stdout 用 UTF-8 避免乱码
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"


def load_manifest() -> list[dict]:
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_manifest(manifest: list[dict]) -> None:
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))


def load_talk(slug: str) -> dict | None:
    path = DATA_DIR / f"{slug}.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_talk(slug: str, data: dict) -> None:
    path = DATA_DIR / f"{slug}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _get(url: str, accept: str = "text/html") -> str:
    req = Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


def resolve_canonical_slug(slug: str) -> str | None:
    """请求项目 slug 对应的 talk 页，跟随重定向拿到 TED 规范 slug。"""
    url = "https://www.ted.com/talks/" + quote(slug, safe="")
    try:
        req = Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urlopen(req, timeout=25) as resp:
            final = resp.geturl()
    except Exception:
        return None
    m = re.search(r"/talks/([^/?#]+)", final)
    if not m:
        return None
    canon = m.group(1)
    return canon if canon else None


def fetch_zh_cues(canonical_slug: str) -> list[dict] | None:
    """抓取中文翻译字幕并解析为 [{start, end, text}]。"""
    url = f"https://www.ted.com/talks/{quote(canonical_slug, safe='')}/transcript?language=zh-cn"
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
    translation = (
        data.get("props", {})
        .get("pageProps", {})
        .get("transcriptData", {})
        .get("translation")
    )
    if not translation:
        return None
    paragraphs = translation.get("paragraphs") or []

    raw = []
    for para in paragraphs:
        for cue in para.get("cues", []):
            text = (cue.get("text") or "").strip()
            if text:
                raw.append({"start": cue.get("time", 0) / 1000.0, "text": text})
    if not raw:
        return None

    # cue 只有起始时间，用下一条的起始作为本条结束
    cues = []
    for i, c in enumerate(raw):
        end = raw[i + 1]["start"] if i + 1 < len(raw) else c["start"] + 8.0
        cues.append({"start": c["start"], "end": end, "text": c["text"]})
    return cues


def align_zh_to_sentences(sentences: list[dict], zh_cues: list[dict]) -> list[str]:
    result = []
    for sent in sentences:
        s_start, s_end = sent["start"], sent["end"]
        matched = []
        for cue in zh_cues:
            if min(s_end, cue["end"]) > max(s_start, cue["start"]):
                matched.append(cue["text"])
        result.append("".join(matched))
    return result


def process_slug(slug: str, dry_run: bool = False) -> str:
    talk = load_talk(slug)
    if not talk:
        return "数据文件不存在"
    sentences = talk.get("sentences", [])
    if not sentences:
        return "无句子数据"

    canonical = resolve_canonical_slug(slug)
    if not canonical:
        return "无法解析 TED 规范链接"
    time.sleep(0.4)

    zh_cues = fetch_zh_cues(canonical)
    if not zh_cues:
        return "无官方中文翻译"

    aligned = align_zh_to_sentences(sentences, zh_cues)
    covered = sum(1 for z in aligned if z.strip())
    total = len(aligned)
    coverage = covered / total * 100 if total else 0

    if coverage < 30:
        return f"覆盖率过低 ({coverage:.0f}%)"
    if dry_run:
        return f"✓ 有官方中文 (覆盖 {coverage:.0f}%, {covered}/{total} 句)"

    for i, zh in enumerate(aligned):
        if zh.strip():
            sentences[i]["zh"] = zh.strip()

    old_source = talk.get("zhSource", "mt")
    talk["zhSource"] = "official" if coverage >= 95 else "mixed"
    save_talk(slug, talk)

    manifest = load_manifest()
    for item in manifest:
        if item["slug"] == slug:
            item["zhSource"] = talk["zhSource"]
            break
    save_manifest(manifest)
    return f"✓ 已更新 ({old_source} → {talk['zhSource']}, 覆盖 {coverage:.0f}%)"


def main():
    parser = argparse.ArgumentParser(description="抓取 TED 官方中文字幕")
    parser.add_argument("--slug", help="只处理指定 slug")
    parser.add_argument("--category", default="ted", help="目标品类（默认 ted）")
    parser.add_argument("--dry-run", action="store_true", help="只检查不写入")
    args = parser.parse_args()

    manifest = load_manifest()
    if args.slug:
        targets = [args.slug]
    else:
        targets = [
            item["slug"]
            for item in manifest
            if item.get("category") == args.category and item.get("zhSource") == "mt"
        ]

    print(f"共 {len(targets)} 篇待处理 (category={args.category})\n")

    stats = {"success": 0, "skip": 0, "fail": 0}
    failed = []
    for i, slug in enumerate(targets, 1):
        status = process_slug(slug, dry_run=args.dry_run)
        print(f"[{i}/{len(targets)}] {slug}: {status}")
        if "✓" in status:
            stats["success"] += 1
        elif "覆盖率" in status or "无官方" in status:
            stats["skip"] += 1
            failed.append((slug, status))
        else:
            stats["fail"] += 1
            failed.append((slug, status))
        if not args.dry_run:
            time.sleep(1)

    print(f"\n完成: 成功 {stats['success']}, 跳过 {stats['skip']}, 失败 {stats['fail']}")
    if failed:
        print("\n未处理清单:")
        for slug, status in failed:
            print(f"  {slug}: {status}")


if __name__ == "__main__":
    main()
