# -*- coding: utf-8 -*-
"""按当前 resolved URL 重下 5 篇音频，确保音源与字幕一对一匹配"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORPUS = os.path.join(HERE, "corpus")
AUDIO = os.path.join(ROOT, "public", "audio")
YT = [sys.executable, "-m", "yt_dlp", "--no-warnings"]

SLUGS = ["barack-obama-rutgers-2016", "chadwick-boseman-howard-2018", "will-ferrell-usc-2017",
         "john-waters-risd-2015", "beyonce-commencement"]

resolved = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}
state_path = os.path.join(CORPUS, "fetch_state.json")
state = json.load(open(state_path, encoding="utf-8"))

for slug in SLUGS:
    out = os.path.join(AUDIO, slug + ".m4a")
    if os.path.exists(out):
        os.remove(out)
    tmp = os.path.join(AUDIO, slug + ".%(ext)s")
    cmd = YT + ["-f", "bestaudio[ext=m4a]/bestaudio", "-o", tmp, "--no-playlist",
                "--retries", "3", "--sleep-requests", "2", resolved[slug]["url"]]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    ok = os.path.exists(out) and os.path.getsize(out) > 100_000
    st = state.get(slug, {})
    st["audio"] = ok
    state[slug] = st
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{slug} audio={'OK' if ok else 'FAIL: ' + (r.stderr or '')[-150:]}", flush=True)
    time.sleep(5)
print("done")
