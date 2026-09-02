# -*- coding: utf-8 -*-
"""最终完整性检查"""
import json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
m = json.load(open(os.path.join(ROOT, "public", "data", "manifest.json"), encoding="utf-8"))
missing_audio = [x["slug"] for x in m if not os.path.exists(os.path.join(ROOT, "public", x["audioUrl"]))]
missing_cover = [x["slug"] for x in m if not x.get("cover")]
ted = [x for x in m if x["category"] == "ted"]
comm = [x for x in m if x["category"] == "commencement"]
print(f"manifest={len(m)} (ted {len(ted)} / commencement {len(comm)})")
print("missing_audio:", missing_audio or "NONE")
print("missing_cover:", missing_cover or "NONE")
# 新补 3 篇抽查
for s in ["pattie_maes_demos_the_sixth_sense", "reggie_watts_disorients_you_in_the_most_entertaining_way", "atul-gawande-commencement"]:
    d = json.load(open(os.path.join(ROOT, "public", "data", s + ".json"), encoding="utf-8"))
    zh = sum(1 for x in d["sentences"] if x["zh"])
    print(f"{s}: {len(d['sentences'])}句, 中文覆盖 {zh}/{len(d['sentences'])}, zhSource={d['zhSource']}, {d['duration']}s")
