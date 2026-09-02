# -*- coding: utf-8 -*-
"""尾段缺口处置：对每个尾部空白 > 阈值的素材重跑带时间戳的 ASR，判定空白性质，
只对"确认缺失的讲话"补字幕。

绝不按 duration - lastEnd 直接凭空补句：先转录，再和已有末尾三句对齐去重，
分类为 speech / applause-music / silence / ad / unknown，只有 speech 才写回。

用法：
    python scripts/tail_gap_remediate.py                   # 只出报告，不改数据
    python scripts/tail_gap_remediate.py --apply           # 写回确认缺失的讲话
    python scripts/tail_gap_remediate.py --slug xxx --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "public", "data")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
REPORT_PATH = os.path.join(HERE, "corpus", "tail_gap_report.json")

GAP_THRESHOLD = 20.0
MODEL_SIZE = os.environ.get("DAILY_ASR_MODEL", "small.en")
# 转录片段里这些内容不算讲话，只是现场声音标注
NON_SPEECH_RE = re.compile(
    r"^[\s\W]*(\(|\[)?\s*(applause|laughter|music|cheers|cheering|applaud|silence|"
    r"inaudible|blank[_ ]?audio|foreign)\s*(\)|\])?[\s\W]*$",
    re.I,
)
# 明显的赞助/订阅口播，按方案只做音频裁剪，不补字幕
AD_RE = re.compile(
    r"(subscribe|sponsored by|this episode is brought to you|"
    r"download the .{0,20}app|visit .{0,30}\.com|bbc learning english dot com|"
    # 老 TED 音频尾部统一挂的赞助商口播，逐字相同
    r"what if great ideas weren't cherished|artistic vision is protected|"
    r"ultimate driving machines)",
    re.I,
)
WORD_RE = re.compile(r"[a-z0-9']+")


def normalize(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def similarity(a: str, b: str) -> float:
    """两句话的词集合重合度，用来和已有末尾句去重"""
    wa, wb = set(normalize(a)), set(normalize(b))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / min(len(wa), len(wb))


def find_gaps(slugs: set[str] | None) -> list[dict]:
    manifest = json.load(open(os.path.join(DATA_DIR, "manifest.json"), encoding="utf-8"))
    out = []
    for item in manifest:
        slug = item["slug"]
        if slugs and slug not in slugs:
            continue
        talk = json.load(open(os.path.join(DATA_DIR, slug + ".json"), encoding="utf-8"))
        sentences = talk.get("sentences") or []
        duration = float(talk.get("duration") or 0)
        if not sentences or duration <= 0:
            continue
        gap = duration - float(sentences[-1]["end"])
        if gap > GAP_THRESHOLD:
            out.append({
                "slug": slug,
                "duration": duration,
                "lastEnd": float(sentences[-1]["end"]),
                "gap": gap,
            })
    out.sort(key=lambda c: -c["gap"])
    return out


def transcribe_tail(model, slug: str, start: float) -> list[dict]:
    """从末句前 5 秒开始转录到结尾，返回带时间戳的分段"""
    import imageio_ffmpeg

    src = os.path.join(AUDIO_DIR, slug + ".m4a")
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    offset = max(0.0, start - 5.0)
    fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="tail-")
    os.close(fd)
    try:
        subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-ss", str(offset), "-i", src,
             "-ac", "1", "-ar", "16000", tmp],
            capture_output=True, check=True,
        )
        segments, _ = model.transcribe(tmp, language="en", vad_filter=True,
                                       condition_on_previous_text=False)
        return [
            {"start": seg.start + offset, "end": seg.end + offset, "text": seg.text.strip()}
            for seg in segments
        ]
    finally:
        os.unlink(tmp)


def classify(segments: list[dict], tail_sentences: list[dict], last_end: float) -> tuple[str, list[dict]]:
    """返回 (结论, 确认缺失的讲话分段)"""
    fresh = []
    for seg in segments:
        if seg["end"] <= last_end + 0.5:
            continue
        text = seg["text"]
        if not text or NON_SPEECH_RE.match(text):
            continue
        if AD_RE.search(text):
            return "ad", []
        # 和已有末尾三句比对，ASR 常会把已收录的句子重转一遍
        if any(similarity(text, s["en"]) >= 0.6 for s in tail_sentences):
            continue
        fresh.append(seg)

    if fresh:
        return "speech", fresh
    if any(NON_SPEECH_RE.match(s["text"]) for s in segments if s["end"] > last_end):
        return "applause-music", []
    if not [s for s in segments if s["end"] > last_end]:
        return "silence", []
    return "unknown", []


def apply_fix(slug: str, fresh: list[dict], translator) -> int:
    path = os.path.join(DATA_DIR, slug + ".json")
    talk = json.load(open(path, encoding="utf-8"))
    sentences = talk["sentences"]
    duration = float(talk.get("duration") or 0)

    added = 0
    for seg in fresh:
        en = seg["text"].strip()
        zh = translator.translate_one(en) if translator else ""
        if not zh.strip():
            print(f"    ! 译文为空，跳过：{en[:50]}")
            continue
        sentences.append({
            "i": 0,
            "start": round(max(seg["start"], sentences[-1]["end"]), 2),
            "end": round(min(seg["end"], duration), 2),
            "en": en,
            "zh": zh.strip(),
        })
        added += 1

    if not added:
        return 0

    sentences.sort(key=lambda s: s["start"])
    for n, s in enumerate(sentences):
        s["i"] = n
    talk["sentences"] = sentences
    talk["zhSource"] = "opus-mt-offline"
    json.dump(talk, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return added


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", action="append", help="只处理指定素材，可重复")
    parser.add_argument("--apply", action="store_true", help="写回确认缺失的讲话（默认只出报告）")
    args = parser.parse_args()

    cases = find_gaps(set(args.slug) if args.slug else None)
    print(f"尾部空白 > {GAP_THRESHOLD:.0f}s 的素材：{len(cases)} 篇\n")
    if not cases:
        return 0

    from faster_whisper import WhisperModel
    print(f"加载 ASR 模型 {MODEL_SIZE} …")
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

    translator = None
    report = []
    for case in cases:
        slug = case["slug"]
        print(f"[{case['gap']:6.1f}s] {slug}")
        talk = json.load(open(os.path.join(DATA_DIR, slug + ".json"), encoding="utf-8"))
        tail_sentences = talk["sentences"][-3:]
        try:
            segments = transcribe_tail(model, slug, case["lastEnd"])
        except Exception as exc:
            print(f"    转录失败：{exc}")
            report.append({**case, "verdict": "asr-failed", "error": str(exc)})
            continue

        verdict, fresh = classify(segments, tail_sentences, case["lastEnd"])
        print(f"    结论：{verdict}" + (f"（{len(fresh)} 句待补）" if fresh else ""))
        for seg in fresh:
            print(f"      {seg['start']:.1f}-{seg['end']:.1f}  {seg['text'][:80]}")

        added = 0
        if verdict == "speech" and args.apply:
            if translator is None:
                from offline_translate import OfflineTranslator
                translator = OfflineTranslator()
            added = apply_fix(slug, fresh, translator)
            print(f"    已补入 {added} 句")

        report.append({
            **case,
            "verdict": verdict,
            "candidates": fresh,
            "added": added,
            "tailSegments": [s for s in segments if s["end"] > case["lastEnd"]][:10],
        })

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    json.dump(report, open(REPORT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n报告写入 {REPORT_PATH}")

    summary: dict[str, int] = {}
    for r in report:
        summary[r["verdict"]] = summary.get(r["verdict"], 0) + 1
    print("分类汇总:", ", ".join(f"{k}={v}" for k, v in sorted(summary.items())))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    sys.exit(main())
