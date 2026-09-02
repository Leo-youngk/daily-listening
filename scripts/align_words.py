# -*- coding: utf-8 -*-
"""给 public/data/*.json 的每句补词级时间轴 w[]，并用真实首尾词时间修正 start/end。

为什么需要：字幕 cue 是按阅读节奏切的块（实测 p50 7.2s），播放器只能按句内时间比例
线性推算当前词，而真人语速 p10~p90 相差 2.5 倍，7 秒的块里最坏偏 2~3 秒。同时 cue 之间
有 19% 的时间重叠，二分查找"最后一个 start <= t"会让高亮抢跑。

原理：拿到一份词级时间戳的词序列（来源见下），与官方文本按 difflib LCS 对齐，把时间戳
移植给官方词；未匹配的词在相邻锚点之间线性插值。官方文本的用词与标点保持原样。

时间戳来源，按成本从低到高：
  1. yt   —— public/subs/<slug>.en-orig.json3 里 YouTube ASR 自带的每词 tOffsetMs，零算力
  2. asr  —— faster-whisper word_timestamps，CPU 上较慢，作为 1 不可用或匹配率不足时的兜底

关键约束：w[] 的下标必须与前端 app/src/lib/lookup.ts 的 tokenizeSentence 一一对应，
所以这里的分词必须精确复刻它的 /[A-Za-z][A-Za-z'’-]*/g，不能用 ASR 自己的切法。

用法:
    python align_words.py                      # 全量，缺 w 的才处理
    python align_words.py --slugs a,b --force
    python align_words.py --limit 5 --jobs 4
"""
import argparse
import difflib
import json
import os
import re
import sys
import time
from multiprocessing import Pool
from data_io import write_talk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus", "align_words_report.json")

# 必须与 app/src/lib/lookup.ts 的 WORD_RE 完全一致
JS_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
# LCS 匹配用的归一化子词：连字符拆开，弯引号拉直
SUB_RE = re.compile(r"[a-z0-9']+")

MIN_RATIO = 0.60
_MODEL = None


def js_tokens(text):
    """与前端 tokenizeSentence 同构的分词，返回表层词形列表。"""
    return JS_WORD_RE.findall(text)


def units(token):
    """把一个词打散成用于匹配的归一化子词。well-known -> [well, known]"""
    return SUB_RE.findall(token.lower().replace("’", "'").replace("-", " "))


# ---------------------------------------------------------------- 时间戳来源

def yt_words(slug):
    """YouTube ASR 自动字幕的每词时间戳。无该文件或无 tOffsetMs 时返回 None。"""
    path = os.path.join(SUBS_DIR, slug + ".en-orig.json3")
    if not os.path.exists(path):
        return None
    try:
        data = json.load(open(path, encoding="utf-8"))
    except Exception:
        return None

    raw = []
    for event in data.get("events", []):
        segs = event.get("segs")
        if not segs:
            continue
        base = event.get("tStartMs", 0)
        for seg in segs:
            text = seg.get("utf8", "")
            if not text.strip():
                continue
            raw.append((base + seg.get("tOffsetMs", 0), text))
    if len(raw) < 20:
        return None
    if not any(seg.get("tOffsetMs") for e in data.get("events", []) for seg in e.get("segs", [])):
        return None

    raw.sort(key=lambda x: x[0])
    out = []
    for i, (start_ms, text) in enumerate(raw):
        next_ms = raw[i + 1][0] if i + 1 < len(raw) else start_ms + 400
        end_ms = max(start_ms + 60, min(next_ms, start_ms + 2000))
        for unit in units(text):
            out.append((unit, start_ms / 1000.0, end_ms / 1000.0))
    return out or None


def get_model(name, threads):
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel
        _MODEL = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)
    return _MODEL


def asr_words(slug, model_name, threads):
    path = os.path.join(AUDIO_DIR, slug + ".m4a")
    if not os.path.exists(path):
        return None
    segments, _ = get_model(model_name, threads).transcribe(
        path, word_timestamps=True, vad_filter=True, language="en",
    )
    out = []
    for segment in segments:
        for word in (segment.words or []):
            parts = units(word.word)
            if not parts:
                continue
            span = max(0.01, word.end - word.start) / len(parts)
            for k, unit in enumerate(parts):
                out.append((unit, word.start + span * k, word.start + span * (k + 1)))
    return out or None


# ---------------------------------------------------------------- 对齐

def transplant(sentences, source_words):
    """把 source_words 的时间移植到 sentences 的词上。

    返回 (per_sentence_word_times, match_ratio)；per_sentence_word_times[i] 是
    第 i 句每个 js_token 的 (start, end)。
    """
    ref_units, ref_owner, token_counts = [], [], []
    for si, sentence in enumerate(sentences):
        tokens = js_tokens(sentence["en"])
        token_counts.append(len(tokens))
        for ti, token in enumerate(tokens):
            for unit in units(token):
                ref_units.append(unit)
                ref_owner.append((si, ti))

    src_units = [w[0] for w in source_words]
    if not ref_units or not src_units:
        return None, 0.0

    matcher = difflib.SequenceMatcher(None, src_units, ref_units, autojunk=False)
    unit_time = [None] * len(ref_units)
    matched = 0
    for tag, i1, i2, j1, _j2 in matcher.get_opcodes():
        if tag != "equal":
            continue
        matched += i2 - i1
        for k in range(i2 - i1):
            unit_time[j1 + k] = (source_words[i1 + k][1], source_words[i1 + k][2])

    ratio = matched / len(ref_units)
    if ratio < MIN_RATIO:
        return None, ratio

    # 未匹配段：在相邻锚点之间线性插值
    total = len(unit_time)
    i = 0
    while i < total:
        if unit_time[i] is not None:
            i += 1
            continue
        j = i
        while j < total and unit_time[j] is None:
            j += 1
        prev_end = unit_time[i - 1][1] if i > 0 else source_words[0][1]
        next_start = unit_time[j][0] if j < total else source_words[-1][2]
        span = max(0.01, next_start - prev_end)
        gap = j - i
        for k in range(i, j):
            unit_time[k] = (prev_end + span * (k - i) / gap, prev_end + span * (k - i + 1) / gap)
        i = j

    # 子词聚合回词
    per_sentence = [[None] * count for count in token_counts]
    for idx, (si, ti) in enumerate(ref_owner):
        start, end = unit_time[idx]
        current = per_sentence[si][ti]
        per_sentence[si][ti] = (start, end) if current is None else (min(current[0], start), max(current[1], end))

    return per_sentence, ratio


def enforce_monotonic(per_sentence):
    """时间轴必须单调不减，且每个词有正时长。插值边界偶尔会倒挂。"""
    last = 0.0
    for tokens in per_sentence:
        for i, slot in enumerate(tokens):
            if slot is None:
                tokens[i] = (last, last + 0.05)
                last += 0.05
                continue
            start = max(slot[0], last)
            end = max(slot[1], start + 0.05)
            tokens[i] = (start, end)
            last = start


def build(slug, model_name, threads, force):
    path = os.path.join(DATA_DIR, slug + ".json")
    talk = json.load(open(path, encoding="utf-8"))
    sentences = talk.get("sentences") or []
    if not sentences:
        return {"slug": slug, "ok": False, "why": "no sentences"}
    if not force and all("w" in s for s in sentences):
        return {"slug": slug, "ok": True, "skipped": True, "source": talk.get("wSource")}

    source = "yt"
    words = yt_words(slug)
    result, ratio = (transplant(sentences, words) if words else (None, 0.0))

    if result is None:
        source = "asr"
        words = asr_words(slug, model_name, threads)
        if not words:
            return {"slug": slug, "ok": False, "why": "no timing source", "ytRatio": round(ratio, 3)}
        result, ratio = transplant(sentences, words)
        if result is None:
            return {"slug": slug, "ok": False, "why": "low match", "ratio": round(ratio, 3)}

    enforce_monotonic(result)

    duration = talk.get("duration") or 0

    for sentence, tokens in zip(sentences, result):
        if not tokens:
            continue
        flat = []
        for start, end in tokens:
            flat.append(round(start, 2))
            flat.append(round(end, 2))
        # 尾部 cue（多半是 (Applause)）可能比音频本身还长，截到音频末尾。
        # 不截的话最后一句在播放器里永远走不完，进度条也对不上。
        # 整句都在音频之外时不动，截了只会变成零长句，交给 validate_data.py 报错。
        if duration and flat[0] < duration:
            flat = [min(value, duration) for value in flat]
        sentence["w"] = flat
        sentence["start"] = flat[0]
        sentence["end"] = flat[-1]

    talk["wSource"] = source
    write_talk(path, talk)

    return {"slug": slug, "ok": True, "source": source, "ratio": round(ratio, 3), "cues": len(sentences)}


def worker(args):
    slug, model_name, threads, force = args
    started = time.time()
    try:
        out = build(slug, model_name, threads, force)
    except Exception as exc:
        out = {"slug": slug, "ok": False, "why": f"{type(exc).__name__}: {exc}"}
    out["sec"] = round(time.time() - started, 1)
    tag = out.get("source") or out.get("why", "")
    state = "skip" if out.get("skipped") else ("ok" if out["ok"] else "FAIL")
    print(f"  [{state}] {slug} {tag} ratio={out.get('ratio','-')} {out['sec']}s", flush=True)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--slugs", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--jobs", type=int, default=1)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--yt-only", action="store_true", help="只跑零算力的 YouTube 词级时间戳")
    args = parser.parse_args()

    if args.slugs:
        slugs = [s.strip() for s in args.slugs.split(",") if s.strip()]
    else:
        slugs = sorted(
            os.path.splitext(f)[0] for f in os.listdir(DATA_DIR)
            if f.endswith(".json") and f != "manifest.json"
        )
    if args.limit:
        slugs = slugs[:args.limit]

    if args.yt_only:
        globals()["asr_words"] = lambda *a, **k: None

    threads = max(1, (os.cpu_count() or 4) // max(1, args.jobs))
    tasks = [(s, args.model, threads, args.force) for s in slugs]

    print(f"待处理 {len(slugs)} 篇 | model={args.model} jobs={args.jobs} threads/job={threads}", flush=True)
    started = time.time()
    if args.jobs > 1:
        with Pool(args.jobs) as pool:
            results = pool.map(worker, tasks, chunksize=1)
    else:
        results = [worker(t) for t in tasks]

    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    ok = [r for r in results if r["ok"] and not r.get("skipped")]
    skipped = [r for r in results if r.get("skipped")]
    failed = [r for r in results if not r["ok"]]
    by_yt = sum(1 for r in ok if r.get("source") == "yt")
    print(f"\n完成 {len(ok)} (yt={by_yt} asr={len(ok)-by_yt}) | 跳过 {len(skipped)} | 失败 {len(failed)}"
          f" | 用时 {round(time.time()-started)}s")
    for r in failed[:20]:
        print(f"  FAIL {r['slug']}: {r.get('why')} {r.get('ratio','')}")
    return 1 if failed and not ok else 0


if __name__ == "__main__":
    sys.exit(main())
