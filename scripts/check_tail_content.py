# -*- coding: utf-8 -*-
"""对 tail_gap_list.json 里每篇的字幕缺口尾段做本地 ASR，判断尾部到底是掌声/静音还是真实讲话内容。
只对尾段（缺口前 5s 到音频结尾）转录，不跑全篇，节省时间。
"""
import json
import os
import subprocess
import tempfile

import imageio_ffmpeg
from faster_whisper import WhisperModel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
GAP_LIST = os.path.join(HERE, "corpus", "tail_gap_list.json")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def extract_tail(slug: str, start: float) -> str:
    src = os.path.join(AUDIO_DIR, slug + ".m4a")
    fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="tail-")
    os.close(fd)
    cmd = [FFMPEG, "-y", "-ss", str(max(0, start - 5)), "-i", src,
           "-ac", "1", "-ar", "16000", tmp]
    subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return tmp


def main():
    cases = json.load(open(GAP_LIST, encoding="utf-8"))
    model = WhisperModel("small", device="cpu", compute_type="int8")

    results = []
    for i, c in enumerate(cases, 1):
        slug = c["slug"]
        tmp = extract_tail(slug, c["last_end"])
        try:
            segments, info = model.transcribe(
                tmp, language="en", vad_filter=True, condition_on_previous_text=False,
            )
            texts = [s.text.strip() for s in segments if s.text.strip()]
            joined = " ".join(texts)
            print(f"[{i}/{len(cases)}] {slug} (gap {c['gap']:.0f}s): {joined[:200]!r}")
            results.append({"slug": slug, "gap": c["gap"], "tail_text": joined})
        finally:
            os.unlink(tmp)

    with open(os.path.join(HERE, "corpus", "tail_asr_result.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\nsaved to scripts/corpus/tail_asr_result.json")


if __name__ == "__main__":
    main()
