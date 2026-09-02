# -*- coding: utf-8 -*-
"""扫描 resolved 中 TED 条目与 ted_main.csv 时长差异，差异>12% 的用严格时长门限重新搜索
（TED-Ed 是动画摘要版，一律排除）"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from resolve import search, make_result, CORPUS, RESOLVED


def candidate_ok(e, want):
    ch = (e.get("channel") or "").lower()
    if "ted" not in ch or "ted-ed" in ch or "teded" in ch:
        return False
    dur = e.get("duration") or 0
    if want and dur and abs(dur - want) / want > 0.12:
        return False
    return True


def main():
    ted_meta = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))}
    data = json.load(open(RESOLVED, encoding="utf-8"))

    problems = []
    for i, r in enumerate(data):
        if r["category"] != "ted":
            continue
        meta = ted_meta.get(r["slug"])
        if not meta:
            continue
        want = meta.get("duration") or 0
        got = r.get("duration") or 0
        ch = (r.get("channel") or "").lower()
        bad_channel = "ted-ed" in ch or "teded" in ch
        if want and got and (abs(got - want) / want > 0.12 or bad_channel):
            problems.append((i, r["slug"], want, got, r.get("channel")))

    print(f"problematic TED entries: {len(problems)}")
    for i, slug, want, got, ch in problems:
        print(f"  {slug} want={want}s got={got}s ch={ch}", flush=True)

    fixed, failed = 0, 0
    for i, slug, want, got, ch in problems:
        meta = dict(ted_meta[slug])
        meta["category"] = "ted"
        q = f'"{meta["title"]}" {meta["speaker"]} TED'
        best = None
        for e in search(q, 10):
            if candidate_ok(e, want):
                best = e
                break
        if best:
            data[i] = make_result(meta, best, 0.95)
            fixed += 1
            print(f"  FIX {slug} -> {best.get('title')[:50]} ({best.get('duration')}s)", flush=True)
        else:
            # 再宽松搜一次（去掉引号）
            for e in search(f'{meta["title"]} {meta["speaker"]} TED talk', 10):
                if candidate_ok(e, want):
                    data[i] = make_result(meta, best := e, 0.9)
                    fixed += 1
                    print(f"  FIX2 {slug} -> {e.get('title')[:50]} ({e.get('duration')}s)", flush=True)
                    break
            else:
                failed += 1
                print(f"  KEEP {slug} (no better match)", flush=True)

    json.dump(data, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nfixed={fixed} kept={failed}")


if __name__ == "__main__":
    main()
