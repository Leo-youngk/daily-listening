# -*- coding: utf-8 -*-
"""检查指定视频可用的字幕轨道"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")
SLUGS = ["barack-obama-rutgers-2016", "chadwick-boseman-howard-2018", "will-ferrell-usc-2017",
         "john-waters-risd-2015", "beyonce-commencement", "atul-gawande-commencement"]

resolved = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}

for slug in SLUGS:
    url = resolved[slug]["url"]
    r = subprocess.run([sys.executable, "-m", "yt_dlp", "-J", "--skip-download", "--no-warnings", url],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if r.returncode != 0:
        print(slug, "ERR", (r.stderr or "")[-120:])
        continue
    d = json.loads(r.stdout)
    subs = sorted(d.get("subtitles", {}).keys())
    autos = sorted(d.get("automatic_captions", {}).keys())
    en_auto = [a for a in autos if a.startswith("en")]
    print(f"{slug}\n  manual: {subs[:12]}\n  auto-en: {en_auto[:8]}\n  url: {url}")
