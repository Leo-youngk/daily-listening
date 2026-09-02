# -*- coding: utf-8 -*-
"""把 Steve Jobs TED2005 指向镜像上传（TED 官方频道无此视频）"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from resolve import search, make_result, CORPUS

p = os.path.join(CORPUS, "resolved.json")
data = json.load(open(p, encoding="utf-8"))
ted_meta = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))}
slug = "steve_jobs_how_to_live_before_you_die"
meta = dict(ted_meta[slug])
meta["category"] = "ted"

best = None
for e in search("Steve Jobs TED How To Live Before You Die", 8):
    if e.get("title") == "Steve Jobs - TED - How To Live Before You Die":
        best = e
        break

if best:
    data = [d for d in data if d["slug"] != slug]
    data.append(make_result(meta, best, 0.9))
    json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("fixed ->", best.get("title"), "|", best.get("channel"), "|", best.get("duration"))
else:
    print("not found")
