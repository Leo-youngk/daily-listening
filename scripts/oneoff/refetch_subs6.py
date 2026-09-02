# -*- coding: utf-8 -*-
"""重新抓取 6 个缺字幕条目（逐个执行，避开 429）"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORPUS = os.path.join(HERE, "corpus")
SUBS = os.path.join(ROOT, "public", "subs")
YT = [sys.executable, "-m", "yt_dlp", "--no-warnings"]

SLUGS = ["barack-obama-rutgers-2016", "chadwick-boseman-howard-2018", "will-ferrell-usc-2017",
         "john-waters-risd-2015", "beyonce-commencement", "atul-gawande-commencement"]

resolved = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}
state_path = os.path.join(CORPUS, "fetch_state.json")
state = json.load(open(state_path, encoding="utf-8"))

for slug in SLUGS:
    url = resolved[slug]["url"]
    prefix = os.path.join(SUBS, slug)
    print(f"== {slug}", flush=True)
    for attempt in range(3):
        cmd = YT + ["--skip-download", "--write-subs", "--write-auto-subs",
                    "--sub-langs", "en,en-orig,zh-Hans,zh-CN,zh-Hant,zh-TW",
                    "--sub-format", "json3",
                    "--sleep-requests", "2", "--sleep-subtitles", "1.5",
                    "--extractor-retries", "3", "--retry-sleep", "10",
                    "-o", prefix, "--no-playlist", url]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        has_en = any(f.startswith(slug + ".") and ".en" in f and f.endswith(".json3")
                     for f in os.listdir(SUBS))
        if has_en:
            state[slug] = {"audio": True, "subs": True, "ts": int(time.time())}
            json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            print("   OK", flush=True)
            break
        print(f"   retry {attempt + 1}: {(r.stderr or '')[-200:]}", flush=True)
        time.sleep(20)
    time.sleep(8)
print("done")
