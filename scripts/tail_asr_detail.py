# -*- coding: utf-8 -*-
"""对指定几篇的尾段做带时间戳的精细转录,定位广告边界/真实内容边界。"""
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

TARGETS = {
    "jill_bolte_taylor_s_powerful_stroke_of_insight",
    "malala-yousafzai-commencement",
    "sheryl_sandberg_why_we_have_too_few_women_leaders",
    "michael_shermer_on_believing_strange_things",
    "ken_robinson_says_schools_kill_creativity",
    "malcolm_gladwell_on_spaghetti_sauce",
    "helen_fisher_tells_us_why_we_love_cheat",
    "seth_godin_on_sliced_bread",
}


def extract_tail(slug: str, start: float) -> str:
    src = os.path.join(AUDIO_DIR, slug + ".m4a")
    fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="tail-")
    os.close(fd)
    cmd = [FFMPEG, "-y", "-ss", str(max(0, start - 5)), "-i", src,
           "-ac", "1", "-ar", "16000", tmp]
    subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return tmp


def main():
    cases = [c for c in json.load(open(GAP_LIST, encoding="utf-8")) if c["slug"] in TARGETS]
    model = WhisperModel("small", device="cpu", compute_type="int8")

    for c in cases:
        slug = c["slug"]
        base = max(0, c["last_end"] - 5)
        tmp = extract_tail(slug, c["last_end"])
        try:
            segments, info = model.transcribe(
                tmp, language="en", vad_filter=True, condition_on_previous_text=False,
                word_timestamps=False,
            )
            print(f"\n=== {slug} (base={base:.1f}s abs) ===")
            for s in segments:
                if s.text.strip():
                    print(f"  [{base + s.start:8.1f} - {base + s.end:8.1f}] {s.text.strip()}")
        finally:
            os.unlink(tmp)


if __name__ == "__main__":
    main()
