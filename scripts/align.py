# -*- coding: utf-8 -*-
"""强制对齐：把无时间轴的官方文字稿对齐到音频，产出与 yt-dlp json3 字幕同构的文件。

原理：faster-whisper 出词级时间戳 -> 官方文本分词后与 ASR 词序列做最长公共子序列匹配
(difflib) -> 把时间戳"移植"给匹配上的官方词 -> 未匹配的词按相邻锚点线性插值 -> 按句聚合。
官方文本的用词/标点保留原样（比 ASR 自己的转写准），只借 ASR 要时间戳。

用法（库）：
    from align import align_to_file
    ok, ratio = align_to_file(audio_path, ref_text, out_json3_path)

用法（单独测试）：
    python align.py --audio a.m4a --text a.txt --out a.en.json3
"""
import argparse, difflib, json, re

_MODEL = None


def get_model(name="small.en"):
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel
        device, compute_type = "cpu", "int8"
        try:
            import torch
            if torch.cuda.is_available():
                device, compute_type = "cuda", "float16"
        except Exception:
            pass
        print(f"    [align] loading {name} on {device}/{compute_type}", flush=True)
        _MODEL = WhisperModel(name, device=device, compute_type=compute_type)
    return _MODEL


WORD_RE = re.compile(r"[a-z0-9']+")


def norm_words(text):
    return WORD_RE.findall(text.lower())


def transcribe_words(audio_path, model=None):
    """返回 [(word_lower, start, end), ...]"""
    model = model or get_model()
    segments, _ = model.transcribe(audio_path, word_timestamps=True, vad_filter=True, language="en")
    words = []
    for seg in segments:
        for w in (seg.words or []):
            token = WORD_RE.findall(w.word.lower())
            if token:
                words.append((token[0], w.start, w.end))
    return words


SENT_SPLIT_RE = re.compile(r'(?<=[.!?…])\s+(?=[A-Z0-9"\'])')


def split_sentences(text):
    """按行（对话换行/段落）先切，行内再按句末标点切；过滤空行。"""
    sentences = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        for part in SENT_SPLIT_RE.split(line):
            part = part.strip()
            if part:
                sentences.append(part)
    return sentences


def align(audio_path, ref_text, model=None, min_match_ratio=0.85):
    """返回 (cues, match_ratio)；匹配率不达标时 cues=None。
    cues: [{"start": float, "end": float, "text": str}]（按句）
    """
    asr_words = transcribe_words(audio_path, model)
    asr_norm = [w[0] for w in asr_words]

    sentences = split_sentences(ref_text)
    ref_word_tokens = [(w, si) for si, s in enumerate(sentences) for w in norm_words(s)]
    ref_norm = [w for w, _ in ref_word_tokens]

    if not ref_norm or not asr_norm:
        return None, 0.0

    sm = difflib.SequenceMatcher(None, asr_norm, ref_norm, autojunk=False)
    ref_time = [None] * len(ref_norm)
    matched = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            matched += i2 - i1
            for k in range(i2 - i1):
                ref_time[j1 + k] = (asr_words[i1 + k][1], asr_words[i1 + k][2])

    match_ratio = matched / len(ref_norm)
    if match_ratio < min_match_ratio:
        return None, match_ratio

    # 未匹配词：在相邻已知锚点之间线性插值
    n = len(ref_time)
    idx = 0
    while idx < n:
        if ref_time[idx] is not None:
            idx += 1
            continue
        j = idx
        while j < n and ref_time[j] is None:
            j += 1
        prev_end = ref_time[idx - 1][1] if idx > 0 else asr_words[0][1]
        next_start = ref_time[j][0] if j < n else asr_words[-1][2]
        span = max(0.01, next_start - prev_end)
        gap = j - idx
        for k in range(idx, j):
            f0, f1 = (k - idx) / gap, (k - idx + 1) / gap
            ref_time[k] = (prev_end + span * f0, prev_end + span * f1)
        idx = j

    # 按句聚合成 cue
    cues = []
    wi = 0
    for s in sentences:
        wc = len(norm_words(s))
        if wc == 0:
            continue
        seg_times = ref_time[wi:wi + wc]
        wi += wc
        starts = [t[0] for t in seg_times if t]
        ends = [t[1] for t in seg_times if t]
        if starts:
            cues.append({"start": round(min(starts), 2), "end": round(max(ends), 2), "text": s})

    # 修正偶发的时间倒挂（插值边界可能与前一句轻微重叠）
    for i in range(1, len(cues)):
        if cues[i]["start"] < cues[i - 1]["end"]:
            cues[i]["start"] = cues[i - 1]["end"]
        if cues[i]["end"] < cues[i]["start"]:
            cues[i]["end"] = cues[i]["start"] + 0.5

    return cues, match_ratio


def cues_to_json3(cues):
    """转成与 yt-dlp json3 字幕相同的 events 结构，供 vtt2json.py 原样复用。"""
    events = [{
        "tStartMs": int(round(c["start"] * 1000)),
        "dDurationMs": max(1, int(round((c["end"] - c["start"]) * 1000))),
        "segs": [{"utf8": c["text"]}],
    } for c in cues]
    return {"events": events}


def align_to_file(audio_path, ref_text, out_json3_path, model=None, min_match_ratio=0.85):
    cues, ratio = align(audio_path, ref_text, model=model, min_match_ratio=min_match_ratio)
    if cues is None:
        return False, ratio
    with open(out_json3_path, "w", encoding="utf-8") as f:
        json.dump(cues_to_json3(cues), f, ensure_ascii=False)
    return True, ratio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-match", type=float, default=0.85)
    args = ap.parse_args()
    ref_text = open(args.text, encoding="utf-8").read()
    ok, ratio = align_to_file(args.audio, ref_text, args.out, min_match_ratio=args.min_match)
    print(f"match_ratio={ratio:.3f} ok={ok}")


if __name__ == "__main__":
    main()
