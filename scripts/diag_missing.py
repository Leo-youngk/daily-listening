# -*- coding: utf-8 -*-
"""找出 resolved 中有、但数据缺失的条目及原因"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from vtt2json import find_file

DATA = os.path.join(ROOT, "public", "data")
AUDIO = os.path.join(ROOT, "public", "audio")
resolved = json.load(open(os.path.join(HERE, "corpus", "resolved.json"), encoding="utf-8"))
state = json.load(open(os.path.join(HERE, "corpus", "fetch_state.json"), encoding="utf-8"))
data_slugs = {f[:-5] for f in os.listdir(DATA) if f.endswith(".json") and f != "manifest.json"}

for r in resolved:
    s = r["slug"]
    if s in data_slugs:
        continue
    st = state.get(s, {})
    audio_ok = os.path.exists(os.path.join(AUDIO, s + ".m4a"))
    en_ok = bool(find_file(s, "en"))
    print(f"{s} | {r['category']} | state={st} | audio_file={audio_ok} | en_subs={en_ok}")
