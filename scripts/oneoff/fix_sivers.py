# -*- coding: utf-8 -*-
"""补救 derek_sivers：换一个字幕覆盖完整的版本"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from resolve import search, make_result, CORPUS, RESOLVED

SLUG = "derek_sivers_how_to_start_a_movement"


def main():
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    idx = next(i for i, r in enumerate(resolved) if r["slug"] == SLUG)
    cur = resolved[idx]
    best = None
    for e in search("Derek Sivers How to start a movement TED", 10):
        ch = (e.get("channel") or "").lower()
        dur = e.get("duration") or 0
        if "ted" in ch and "ted-ed" not in ch and dur and abs(dur - 189) <= 20:
            if e.get("url") != cur.get("url"):
                best = e
                break
    if best:
        meta = {"slug": SLUG, "title": cur["title"], "speaker": cur["speaker"],
                "duration": 189, "views": cur.get("views"), "category": "ted"}
        resolved[idx] = make_result(meta, best, 0.9)
        json.dump(resolved, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        # 清旧字幕与状态，让 fetch 重新下载
        state_path = os.path.join(CORPUS, "fetch_state.json")
        state = json.load(open(state_path, encoding="utf-8"))
        state.pop(SLUG, None)
        json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        subs_dir = os.path.join(ROOT, "public", "subs")
        for f in os.listdir(subs_dir):
            if f.startswith(SLUG + "."):
                os.remove(os.path.join(subs_dir, f))
        print(f"REPLACED -> {best.get('title')} | {best.get('channel')} | {best.get('duration')}s")
    else:
        print("NO-ALT")


if __name__ == "__main__":
    main()
