# -*- coding: utf-8 -*-
"""补齐最后 3 个缺口：
1. vtt2json.find_file 支持 en-US 变体（修复 gawande 增量漏检）
2. 搜索 pattie_maes / reggie_watts 的可用版本
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from resolve import search, make_result, CORPUS, RESOLVED

# ---- 1) gawande 已在 resolved，字幕在盘上，等 find_file 修复后直接跑增量即可 ----

# ---- 2) 缺失的两篇 TED ----
ADD = [
    {"slug": "pattie_maes_demos_the_sixth_sense", "queries": [
        '"Demos the Sixth Sense" Pattie Maes', 'Pattie Maes Sixth Sense TED demo']},
    {"slug": "reggie_watts_disorients_you_in_the_most_entertaining_way", "queries": [
        'Reggie Watts disorients you TED', 'Reggie Watts TED beatbox talk']},
]

ted_meta = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))}
resolved = json.load(open(RESOLVED, encoding="utf-8"))
existing = {r["slug"] for r in resolved}

for item in ADD:
    slug = item["slug"]
    meta = ted_meta.get(slug)
    if not meta or slug in existing:
        print(f"skip {slug}")
        continue
    want = meta.get("duration") or 0
    best = None
    for q in item["queries"]:
        for e in search(q, 10):
            ch = (e.get("channel") or "").lower()
            dur = e.get("duration") or 0
            if not dur or dur < 60:
                continue
            # 官方频道优先；无官方时接受镜像但时长需接近
            if "ted" in ch and "ted-ed" not in ch:
                if not want or abs(dur - want) / want <= 0.15:
                    best = e
                    break
            elif want and abs(dur - want) / want <= 0.08:
                best = best or e
        if best and "ted" in (best.get("channel") or "").lower():
            break
    if best:
        entry = dict(meta)
        entry["category"] = "ted"
        resolved.append(make_result(entry, best, 0.9))
        print(f"ADDED {slug} -> {best.get('title')} | {best.get('channel')} | {best.get('duration')}s")
    else:
        print(f"NOT-FOUND {slug}")

json.dump(resolved, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
n_ted = sum(1 for r in resolved if r["category"] == "ted")
print(f"resolved now: {len(resolved)} ({n_ted} TED / {len(resolved)-n_ted} commencement)")
