# -*- coding: utf-8 -*-
"""把 ingest.py 的对齐结果切成逐句双语数据，写 public/data/<slug>.json 与 manifest。

流程：json3 按句 cue -> 合并过短的句子 -> Gemini 整篇翻译（有缓存）-> data_io.write_talk。
不在本批节目里的旧数据文件与封面会被清掉（打印清单）。
词级时间轴由下一步 align_words.py 补齐（复用 ingest 存下的 ASR 词序列，不再识别第二遍）。

用法：
    python build_talks.py
    python build_talks.py --slugs bbc6min_260924,curious_634
"""
import argparse
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

import imageio_ffmpeg

from data_io import write_manifest, write_talk
from ingest import download_cover
from translate import translate_episode

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "public", "data")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
COVERS_DIR = os.path.join(ROOT, "public", "covers")
EPISODES = os.path.join(HERE, "corpus", "episodes.json")
# 音频与页面同源：Pages Functions 的 /audio/* 直接读 R2（app/functions/audio），省掉单独一个域名的 TLS 握手
MEDIA_BASE = "/audio"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")

SERIES_ORDER = ("bbc", "curious", "thinking")
SPEAKER = {"bbc": "BBC Learning English", "curious": "Alastair Budge", "thinking": "Tom Wilkinson"}
MANIFEST_FIELDS = ("slug", "title", "speaker", "category", "date", "duration", "cover", "audioUrls", "zhSource")
SENT_END = re.compile(r"[.!?]\s*[\"'”’)\]]*\s*$")


def parse_json3(path):
    d = json.load(open(path, encoding="utf-8"))
    cues = []
    for ev in d.get("events", []):
        text = "".join(s.get("utf8", "") for s in ev.get("segs", []))
        text = re.sub(r"\s+", " ", text).strip()
        # 网页里行内标签（加粗、链接）拆开时会在标点前留空格："booming ," -> "booming,"
        text = re.sub(r"\s+([,.;:!?%)\]”’])", r"\1", text)
        text = re.sub(r"([(\[“])\s+", r"\1", text)
        if not text:
            continue
        start = ev.get("tStartMs", 0) / 1000.0
        cues.append({"start": round(start, 2), "end": round(start + ev.get("dDurationMs", 2000) / 1000.0, 2), "text": text})
    return cues


# 相邻两句之间隔了这么久（通常是文稿外的口播或片花），不再合并
MERGE_MAX_GAP = 1.5


def merge_sentences(cues):
    """把过短的句子并进下一句：满 40 字符且以句末标点结束才断；单句超过 220 字符或 12 秒也断。"""
    out, cur = [], []
    for c in cues:
        if cur and c["start"] - cur[-1]["end"] > MERGE_MAX_GAP:
            out.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": " ".join(x["text"] for x in cur)})
            cur = []
        cur.append(c)
        text = " ".join(x["text"] for x in cur)
        done = SENT_END.search(c["text"]) and len(text) >= 40
        too_long = len(text) >= 220 or c["end"] - cur[0]["start"] >= 12
        if done or too_long:
            out.append({"start": cur[0]["start"], "end": c["end"], "text": text})
            cur = []
    if cur:
        out.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": " ".join(x["text"] for x in cur)})
    return out


def probe_duration(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=60)
    m = DURATION_RE.search(r.stderr)
    if not m:
        raise RuntimeError(f"无法读取音频时长：{path}")
    h, mi, s = m.groups()
    return round(int(h) * 3600 + int(mi) * 60 + float(s), 2)


def build(ep):
    slug, series = ep["slug"], ep["series"]
    sents = merge_sentences(parse_json3(os.path.join(SUBS_DIR, slug + ".en.json3")))
    if not sents:
        raise RuntimeError("没有句子")
    duration = probe_duration(os.path.join(AUDIO_DIR, slug + ".m4a"))
    if sents[-1]["end"] < duration * 0.85:
        print(f"    !! 字幕只覆盖到 {sents[-1]['end']:.0f}s / {duration:.0f}s，请核对结尾是否为片尾音乐", flush=True)
    zh, model = translate_episode(slug, series, ep["title"], [s["text"] for s in sents])
    cover_path = os.path.join(COVERS_DIR, slug + ".jpg")
    if not os.path.exists(cover_path) and ep.get("coverUrl"):
        try:
            download_cover(ep["coverUrl"], cover_path)
        except Exception as exc:
            print(f"    !! 封面补下载失败：{exc}", flush=True)
    if not os.path.exists(cover_path):
        raise RuntimeError("缺封面")
    cover = f"/covers/{slug}.jpg"
    talk = {
        "slug": slug,
        "title": ep["title"],
        "speaker": SPEAKER[series],
        "category": series,
        "date": ep.get("date"),
        "duration": duration,
        "cover": cover,
        "sourceUrl": ep.get("sourceUrl"),
        "audioUrls": {
            "standard": f"{MEDIA_BASE}/v1/standard/{slug}.mp3",
            "high": f"{MEDIA_BASE}/v1/high/{slug}.m4a",
        },
        "zhSource": "mt",
        "zhModel": model,
        "keywords": ep.get("keywords") or [],
        "sentences": [{"i": i, "start": s["start"], "end": s["end"], "en": s["text"], "zh": zh[i]}
                      for i, s in enumerate(sents)],
    }
    write_talk(os.path.join(DATA_DIR, slug + ".json"), talk)
    return {k: talk[k] for k in MANIFEST_FIELDS}


def translate_only(episodes, workers):
    """只填翻译缓存（corpus/zh），不写 data：可以和 ingest.py 同时跑，最后 build 时全部命中缓存。"""
    def one(ep):
        sents = merge_sentences(parse_json3(os.path.join(SUBS_DIR, ep["slug"] + ".en.json3")))
        translate_episode(ep["slug"], ep["series"], ep["title"], [s["text"] for s in sents])
        return ep["slug"]

    with ThreadPoolExecutor(workers) as pool:
        for k, slug in enumerate(pool.map(one, episodes.values()), 1):
            print(f"  [zh {k}/{len(episodes)}] {slug}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slugs", default="")
    ap.add_argument("--translate-only", action="store_true", help="只并行填翻译缓存")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    episodes = json.load(open(EPISODES, encoding="utf-8"))
    if args.translate_only:
        translate_only(episodes, args.workers)
        return
    wanted = [s.strip() for s in args.slugs.split(",") if s.strip()] or list(episodes)
    os.makedirs(DATA_DIR, exist_ok=True)

    failures = []
    for i, slug in enumerate(wanted, 1):
        print(f"[{i}/{len(wanted)}] {slug}", flush=True)
        try:
            build(episodes[slug])
        except Exception as exc:
            failures.append((slug, str(exc)))
            print(f"    FAILED: {exc}", flush=True)
    if failures:
        print("\n构建失败，manifest 未更新：")
        for slug, why in failures:
            print(f"  {slug}: {why}")
        raise SystemExit(1)

    # manifest 以磁盘上的全部单篇为准（--slugs 只重建部分时也不丢其他篇）
    keep = set(episodes)
    manifest = []
    for name in sorted(os.listdir(DATA_DIR)):
        if not name.endswith(".json") or name == "manifest.json":
            continue
        slug = name[:-5]
        if slug not in keep:
            os.remove(os.path.join(DATA_DIR, name))
            cover = os.path.join(COVERS_DIR, slug + ".jpg")
            if os.path.exists(cover):
                os.remove(cover)
            print(f"    清理旧数据：{slug}", flush=True)
            continue
        talk = json.load(open(os.path.join(DATA_DIR, name), encoding="utf-8"))
        manifest.append({k: talk.get(k) for k in MANIFEST_FIELDS})
    manifest.sort(key=lambda e: (SERIES_ORDER.index(e["category"]), -int((e.get("date") or "0").replace("-", "") or 0)))
    write_manifest(os.path.join(DATA_DIR, "manifest.json"), manifest)
    counts = {s: sum(1 for e in manifest if e["category"] == s) for s in SERIES_ORDER}
    print(f"\nmanifest: {len(manifest)} 篇 {counts}")


if __name__ == "__main__":
    main()
