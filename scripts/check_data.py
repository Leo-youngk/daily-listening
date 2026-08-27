# -*- coding: utf-8 -*-
"""抽查生成的逐句 JSON 质量"""
import json, os

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data")
SAMPLES = [
    ("david-foster-wallace-kenyon-2005", "官方中文"),
    ("steve-jobs-stanford-2005", "机译"),
    ("ken_robinson_says_schools_kill_creativity", "官方字幕(官方中文字幕可能缺失)"),
]
for slug, label in SAMPLES:
    d = json.load(open(os.path.join(DATA, slug + ".json"), encoding="utf-8"))
    s = d["sentences"]
    zh_ok = sum(1 for x in s if x["zh"])
    print(f"=== [{label}] {slug}")
    print(f"    句数={len(s)} 中文覆盖={zh_ok}/{len(s)} zhSource={d['zhSource']} 时长={d['duration']}s")
    for x in s[3:6]:
        print(f"    [{x['start']:7.1f}-{x['end']:7.1f}] {x['en'][:72]}")
        print(f"      zh: {x['zh'][:64]}")
    print()
