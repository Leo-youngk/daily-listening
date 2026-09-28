# -*- coding: utf-8 -*-
"""强制对齐：把无时间轴的官方文字稿对齐到音频，产出与 yt-dlp json3 字幕同构的文件。

原理：faster-whisper 出词级时间戳 -> 官方文本分词后与 ASR 词序列做最长公共子序列匹配
(difflib) -> 把时间戳"移植"给匹配上的官方词 -> 未匹配的词按相邻锚点线性插值 -> 按句聚合。
官方文本的用词/标点保留原样（比 ASR 自己的转写准），只借 ASR 要时间戳。

两处兜底：
- 文字稿里有、音频里没读的句子（博客导语、页面残留）按句剔除，不给它编时间轴；
  被剔除的词超过 25% 视为稿子与音频不匹配，整篇拒收。
- ASR 词序列另存为 <slug>.words.json，align_words.py 直接复用，不再对同一段音频识别第二遍。

GPU：CUDA 运行库用 pip 装在 scripts/.vendor/cuda（已 gitignore），找不到时退回 CPU 并打印提示。

用法（库）：
    from align import align_to_file
    ok, ratio = align_to_file(audio_path, ref_text, out_json3_path, words_out_path)
"""
import argparse
import difflib
import json
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CUDA_DIR = HERE / ".vendor" / "cuda" / "nvidia"
WORD_RE = re.compile(r"[a-z0-9']+")
SENT_SPLIT_RE = re.compile(r'(?<=[.!?…])\s+(?=[A-Z0-9"\'“‘])')
# 句子里匹配上的词低于这个比例，判定为音频里没读
SPOKEN_MIN = 0.4
# 被剔除的词超过这个比例，判定为稿子与音频不匹配
MAX_DROPPED = 0.25

_MODEL = None


def enable_cuda():
    """把项目本地的 cuBLAS / cuDNN 加进 DLL 搜索路径；返回 GPU 是否可用。"""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() < 1:
            return False
    except Exception:
        return False
    dirs = [CUDA_DIR / "cublas" / "bin", CUDA_DIR / "cudnn" / "bin"]
    if not all(d.is_dir() for d in dirs):
        return False
    for d in dirs:
        os.add_dll_directory(str(d))
        os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")
    return True


def get_model(name="small.en"):
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel
        if enable_cuda():
            device, compute_type = "cuda", "float16"
        else:
            device, compute_type = "cpu", "int8"
            print("    [align] !! 未找到 CUDA 运行库（scripts/.vendor/cuda），退回 CPU，约 1 倍实时速度", flush=True)
        print(f"    [align] loading {name} on {device}/{compute_type}", flush=True)
        _MODEL = WhisperModel(name, device=device, compute_type=compute_type)
    return _MODEL


# 文稿与 ASR 常见的写法差异，归一后再比
EQUIV = {"ok": "okay"}
# 插值出来的词每个最多给这么长；再长说明两个锚点之间夹着文稿里没有的口播（推广、闲聊）
MAX_WORD = 0.6


def norm_words(text):
    return [EQUIV.get(w, w) for w in WORD_RE.findall(text.lower().replace("’", "'").replace("-", " "))]


def interpolate(times, sentence_start, first_time, last_time):
    """给 times 里为 None 的连续段补时间（原地修改）。

    sentence_start[k] 为 True 表示第 k 个词是句首。每个补出来的词最长 MAX_WORD 秒：
    空档比这长时，句首起的段贴着后一个锚点放（口播在它前面），其余贴着前一个锚点放（口播在它后面）。
    """
    n = len(times)
    i = 0
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        prev_end = times[i - 1][1] if i > 0 else first_time
        next_start = times[j][0] if j < n else last_time
        gap = max(0.01, next_start - prev_end)
        count = j - i
        per = min(gap / count, MAX_WORD)
        if per * count < gap and sentence_start[i] and j < n:
            base = next_start - per * count
        else:
            base = prev_end
        for k in range(i, j):
            times[k] = (base + per * (k - i), base + per * (k - i + 1))
        i = j


SAMPLE_RATE = 16000
# 整集一次送进 whisper 时特征提取要 400-500MB 连续内存，机器内存紧时会分配失败；
# 按约 4 分钟一段在停顿处切开，峰值降到 1/6 左右
CHUNK_SEC = 240
CUT_SEARCH_SEC = 8


def chunk_bounds(audio):
    """返回 [(起点样本, 终点样本), ...]，切点取每段末尾 8 秒内能量最低的 0.1 秒。"""
    import numpy as np
    total, step, frame = len(audio), CHUNK_SEC * SAMPLE_RATE, SAMPLE_RATE // 10
    bounds, start = [], 0
    while total - start > step + CUT_SEARCH_SEC * SAMPLE_RATE:
        lo = start + step - CUT_SEARCH_SEC * SAMPLE_RATE
        window = audio[lo:start + step]
        energy = np.square(window[:len(window) // frame * frame].reshape(-1, frame)).mean(axis=1)
        cut = lo + int(energy.argmin()) * frame + frame // 2
        bounds.append((start, cut))
        start = cut
    bounds.append((start, total))
    return bounds


def transcribe_words(audio_path, model=None):
    """返回 [(word_lower, start, end), ...]；一个 ASR 词含多个子词时平分时长。"""
    from faster_whisper import decode_audio
    model = model or get_model()
    audio = decode_audio(audio_path, sampling_rate=SAMPLE_RATE)
    words = []
    for a, b in chunk_bounds(audio):
        offset = a / SAMPLE_RATE
        segments, _ = model.transcribe(audio[a:b], word_timestamps=True, vad_filter=True, language="en")
        for seg in segments:
            for w in (seg.words or []):
                parts = norm_words(w.word)
                if not parts:
                    continue
                span = max(0.01, w.end - w.start) / len(parts)
                for k, part in enumerate(parts):
                    words.append((part, round(offset + w.start + span * k, 3), round(offset + w.start + span * (k + 1), 3)))
    return words


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


def align(audio_path, ref_text, model=None, min_match_ratio=0.85, asr_words=None):
    """返回 (cues, match_ratio, asr_words)；不达标时 cues=None。
    cues: [{"start": float, "end": float, "text": str}]（按句，已剔除未朗读的句子）
    """
    if asr_words is None:
        asr_words = transcribe_words(audio_path, model)
    asr_norm = [w[0] for w in asr_words]

    sentences = split_sentences(ref_text)
    counts = [len(norm_words(s)) for s in sentences]
    ref_norm = [w for s in sentences for w in norm_words(s)]
    if not ref_norm or not asr_norm:
        return None, 0.0, asr_words

    sm = difflib.SequenceMatcher(None, asr_norm, ref_norm, autojunk=False)
    ref_time = [None] * len(ref_norm)
    for tag, i1, i2, j1, _j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                ref_time[j1 + k] = (asr_words[i1 + k][1], asr_words[i1 + k][2])

    # 按句判断是否真的读了
    spans, keep, dropped_words, cursor = [], [], 0, 0
    for s, n in zip(sentences, counts):
        span = (cursor, cursor + n)
        cursor += n
        if n == 0:
            continue
        hit = sum(1 for t in ref_time[span[0]:span[1]] if t is not None)
        if n >= 4 and hit / n < SPOKEN_MIN:
            dropped_words += n
            for k in range(span[0], span[1]):
                ref_time[k] = None  # 零星误配不能留下来当插值锚点
            continue
        spans.append(span)
        keep.append(s)

    kept_words = sum(b - a for a, b in spans)
    if not kept_words or dropped_words / len(ref_norm) > MAX_DROPPED:
        return None, 0.0, asr_words
    matched = sum(1 for a, b in spans for t in ref_time[a:b] if t is not None)
    match_ratio = matched / kept_words
    if match_ratio < min_match_ratio:
        return None, match_ratio, asr_words

    # 只在保留的句子里插值：把它们的词时间摊平成一条序列
    flat_idx = [k for a, b in spans for k in range(a, b)]
    seq = [ref_time[k] for k in flat_idx]
    starts = {a for a, _b in spans}
    interpolate(seq, [k in starts for k in flat_idx], asr_words[0][1], asr_words[-1][2])

    cues = []
    pos = 0
    for (a, b), s in zip(spans, keep):
        times = seq[pos:pos + (b - a)]
        pos += b - a
        cues.append({"start": round(min(t[0] for t in times), 2), "end": round(max(t[1] for t in times), 2), "text": s})

    # 修正偶发的时间倒挂（插值边界可能与前一句轻微重叠）
    for i in range(1, len(cues)):
        if cues[i]["start"] < cues[i - 1]["end"]:
            cues[i]["start"] = cues[i - 1]["end"]
        if cues[i]["end"] < cues[i]["start"]:
            cues[i]["end"] = cues[i]["start"] + 0.5

    if dropped_words:
        print(f"    [align] 剔除未朗读的文字 {dropped_words} 词（{len(sentences) - len(keep)} 句）", flush=True)
    return cues, match_ratio, asr_words


def cues_to_json3(cues):
    """转成与 yt-dlp json3 字幕相同的 events 结构，供 build_talks.py 复用。"""
    events = [{
        "tStartMs": int(round(c["start"] * 1000)),
        "dDurationMs": max(1, int(round((c["end"] - c["start"]) * 1000))),
        "segs": [{"utf8": c["text"]}],
    } for c in cues]
    return {"events": events}


def align_to_file(audio_path, ref_text, out_json3_path, words_out_path, model=None, min_match_ratio=0.85):
    asr_words = None
    if os.path.exists(words_out_path):
        asr_words = [tuple(w) for w in json.load(open(words_out_path, encoding="utf-8"))]
    cues, ratio, asr_words = align(audio_path, ref_text, model=model, min_match_ratio=min_match_ratio,
                                   asr_words=asr_words)
    with open(words_out_path, "w", encoding="utf-8") as f:
        json.dump(asr_words, f, separators=(",", ":"))
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
    ap.add_argument("--words-out", required=True)
    ap.add_argument("--min-match", type=float, default=0.85)
    args = ap.parse_args()
    ref_text = open(args.text, encoding="utf-8").read()
    ok, ratio = align_to_file(args.audio, ref_text, args.out, args.words_out, min_match_ratio=args.min_match)
    print(f"match_ratio={ratio:.3f} ok={ok}")


if __name__ == "__main__":
    main()
