# -*- coding: utf-8 -*-
"""给 public/data/*.json 的每句补词级时间轴 w[]，并用真实首尾词时间修正 start/end。

为什么需要：句子是按阅读节奏切的块，播放器若只按句内时间比例线性推算当前词，真人语速
p10~p90 相差 2.5 倍，7 秒的块里最坏偏 2~3 秒。

原理：拿到一份带词级时间戳的 ASR 词序列，与官方文本按 difflib LCS 对齐，把时间戳移植给
官方词；未匹配的词在相邻锚点之间线性插值。官方文本的用词与标点保持原样。

时间戳来源：
  1. ingest.py 对齐时存下的 public/subs/<slug>.words.json（零额外算力）
  2. 没有缓存时现场跑 faster-whisper（align.get_model，优先 GPU）

关键约束：w[] 的下标必须与前端 app/src/lib/lookup.ts 的 tokenizeSentence 一一对应，
所以这里的分词必须精确复刻它的 /[A-Za-z][A-Za-z'’-]*/g，不能用 ASR 自己的切法。

用法:
    python align_words.py                      # 全量，缺 w 的才处理
    python align_words.py --slugs a,b --force
"""
import argparse
import difflib
import json
import os
import re
import sys
import time

from align import get_model, interpolate, norm_words, transcribe_words
from data_io import write_talk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus", "align_words_report.json")

# 必须与 app/src/lib/lookup.ts 的 WORD_RE 完全一致
JS_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")

MIN_RATIO = 0.60


def js_tokens(text):
    """与前端 tokenizeSentence 同构的分词，返回表层词形列表。"""
    return JS_WORD_RE.findall(text)


def source_words(slug, model_name):
    cached = os.path.join(SUBS_DIR, slug + ".words.json")
    if os.path.exists(cached):
        return [tuple(w) for w in json.load(open(cached, encoding="utf-8"))]
    audio = os.path.join(AUDIO_DIR, slug + ".m4a")
    if not os.path.exists(audio):
        return None
    words = transcribe_words(audio, get_model(model_name))
    with open(cached, "w", encoding="utf-8") as f:
        json.dump(words, f, separators=(",", ":"))
    return words


def transplant(sentences, words):
    """把 words 的时间移植到 sentences 的词上。

    返回 (per_sentence_word_times, match_ratio)；per_sentence_word_times[i] 是
    第 i 句每个 js_token 的 (start, end)。
    """
    ref_units, ref_owner, token_counts = [], [], []
    for si, sentence in enumerate(sentences):
        tokens = js_tokens(sentence["en"])
        token_counts.append(len(tokens))
        for ti, token in enumerate(tokens):
            for unit in norm_words(token):
                ref_units.append(unit)
                ref_owner.append((si, ti))

    src_units = [w[0] for w in words]
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
            unit_time[j1 + k] = (words[i1 + k][1], words[i1 + k][2])

    ratio = matched / len(ref_units)
    if ratio < MIN_RATIO:
        return None, ratio

    # 未匹配段：在相邻锚点之间插值（空档里夹着文稿外口播时不把词摊进去）
    interpolate(unit_time, [ti == 0 and (k == 0 or ref_owner[k - 1][0] != si) for k, (si, ti) in enumerate(ref_owner)],
                words[0][1], words[-1][2])

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


def build(slug, model_name, force):
    path = os.path.join(DATA_DIR, slug + ".json")
    talk = json.load(open(path, encoding="utf-8"))
    sentences = talk.get("sentences") or []
    if not sentences:
        return {"slug": slug, "ok": False, "why": "no sentences"}
    if not force and all("w" in s for s in sentences):
        return {"slug": slug, "ok": True, "skipped": True}

    words = source_words(slug, model_name)
    if not words:
        return {"slug": slug, "ok": False, "why": "no timing source"}
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
        # 尾句可能被插值拉到音频末尾之外，截到音频末尾；整句都在音频之外时不动，交给 validate_data.py 报错
        if duration and flat[0] < duration:
            flat = [min(value, duration) for value in flat]
        sentence["w"] = flat
        sentence["start"] = flat[0]
        sentence["end"] = flat[-1]

    talk["wSource"] = "asr"
    write_talk(path, talk)
    return {"slug": slug, "ok": True, "ratio": round(ratio, 3), "cues": len(sentences)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--slugs", default="")
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.slugs:
        slugs = [s.strip() for s in args.slugs.split(",") if s.strip()]
    else:
        slugs = sorted(os.path.splitext(f)[0] for f in os.listdir(DATA_DIR)
                       if f.endswith(".json") and f != "manifest.json")

    started = time.time()
    results = []
    for slug in slugs:
        t0 = time.time()
        try:
            out = build(slug, args.model, args.force)
        except Exception as exc:
            out = {"slug": slug, "ok": False, "why": f"{type(exc).__name__}: {exc}"}
        state = "skip" if out.get("skipped") else ("ok" if out["ok"] else "FAIL")
        print(f"  [{state}] {slug} ratio={out.get('ratio', '-')} {time.time() - t0:.1f}s", flush=True)
        results.append(out)

    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    ok = [r for r in results if r["ok"] and not r.get("skipped")]
    failed = [r for r in results if not r["ok"]]
    print(f"\n完成 {len(ok)} | 跳过 {len(results) - len(ok) - len(failed)} | 失败 {len(failed)} | 用时 {round(time.time() - started)}s")
    for r in failed[:20]:
        print(f"  FAIL {r['slug']}: {r.get('why')} {r.get('ratio', '')}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
