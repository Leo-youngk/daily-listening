# -*- coding: utf-8 -*-
"""抓取新补入的 2 篇 TED（音频+字幕）"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORPUS = os.path.join(HERE, "corpus")
AUDIO = os.path.join(ROOT, "public", "audio")
SUBS = os.path.join(ROOT, "public", "subs")
YT = [sys.executable, "-m", "yt_dlp", "--no-warnings"]

SLUGS = ["pattie_maes_demos_the_sixth_sense", "reggie_watts_disorients_you_in_the_most_entertaining_way"]
resolved = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}
state_path = os.path.join(CORPUS, "fetch_state.json")
state = json.load(open(state_path, encoding="utf-8"))

for slug in SLUGS:
    url = resolved[slug]["url"]
    print(f"== {slug}", flush=True)
    # 音频
    out = os.path.join(AUDIO, slug + ".m4a")
    if not (os.path.exists(out) and os.path.getsize(out) > 100_000):
        r = subprocess.run(YT + ["-f", "bestaudio[ext=m4a]/bestaudio", "-o",
                                 os.path.join(AUDIO, slug + ".%(ext)s"),
                                 "--no-playlist", "--retries", "3", url],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
        print("  audio:", "OK" if os.path.exists(out) else "FAIL " + (r.stderr or "")[-150:], flush=True)
    else:
        print("  audio: cached", flush=True)
    time.sleep(4)
    # 字幕
    has_en = any(f.startswith(slug + ".") and f.endswith(".json3") and ".en" in f for f in os.listdir(SUBS))
    if not has_en:
        for attempt in range(3):
            subprocess.run(YT + ["--skip-download", "--write-subs", "--write-auto-subs",
                                 "--sub-langs", "en,en-orig,en-US,zh-Hans,zh-CN,zh-Hant",
                                 "--sub-format", "json3",
                                 "--sleep-requests", "2", "--sleep-subtitles", "1.5",
                                 "--extractor-retries", "3", "--retry-sleep", "10",
                                 "-o", os.path.join(SUBS, slug), "--no-playlist", url],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            has_en = any(f.startswith(slug + ".") and f.endswith(".json3") and ".en" in f for f in os.listdir(SUBS))
            if has_en:
                break
            time.sleep(15)
        print("  subs:", "OK" if has_en else "FAIL", flush=True)
    else:
        print("  subs: cached", flush=True)
    st = state.get(slug, {})
    st.update({"audio": os.path.exists(out), "subs": has_en, "ts": int(time.time())})
    state[slug] = st
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    time.sleep(5)
print("done")
