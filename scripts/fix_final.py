# -*- coding: utf-8 -*-
"""移除错误补救项（hugh-jackman → Bono 视频、maya-angelou → 诗歌朗诵），
补入两篇确凿的著名毕业演讲，保持毕业演讲 100 篇"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from resolve import search, make_result, CORPUS, RESOLVED

REMOVE = ["hugh-jackman-commencement", "maya-angelou-commencement",
          "sheryl-sandberg-mit-2012", "jimmy-fallon-georgetown-2015"]

NEW_ENTRIES = [
    {"slug": "sheryl-sandberg-harvard-2014", "title": "Lean In Before You Leave",
     "speaker": "Sheryl Sandberg", "school": "Harvard University", "year": 2014,
     "query": "Sheryl Sandberg Harvard commencement speech 2014", "category": "commencement"},
    {"slug": "bill-clinton-yale-2001", "title": "The Interdependent World",
     "speaker": "Bill Clinton", "school": "Yale University", "year": 2001,
     "query": "Bill Clinton Yale commencement address 2001", "category": "commencement"},
]


def purge(slug):
    # resolved
    data = json.load(open(RESOLVED, encoding="utf-8"))
    data = [d for d in data if d["slug"] != slug]
    json.dump(data, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    # fetch_state
    state_path = os.path.join(CORPUS, "fetch_state.json")
    state = json.load(open(state_path, encoding="utf-8"))
    state.pop(slug, None)
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    # 磁盘文件
    audio = os.path.join(ROOT, "public", "audio", slug + ".m4a")
    if os.path.exists(audio):
        os.remove(audio)
    subs_dir = os.path.join(ROOT, "public", "subs")
    for f in os.listdir(subs_dir):
        if f.startswith(slug + "."):
            os.remove(os.path.join(subs_dir, f))
    print(f"purged {slug}")


def main():
    for s in REMOVE:
        purge(s)

    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    existing = {d["slug"] for d in resolved}
    for entry in NEW_ENTRIES:
        if entry["slug"] in existing:
            continue
        best = None
        for e in search(entry["query"], 8):
            if e.get("duration", 0) and e["duration"] >= 180:
                best = e
                break
        if best:
            resolved.append(make_result(entry, best, 0.85))
            print(f"added {entry['slug']} -> {best.get('title')} | {best.get('channel')}")
        else:
            print(f"NOT FOUND {entry['slug']}")
    json.dump(resolved, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    n_ted = sum(1 for e in resolved if e["category"] == "ted")
    print(f"\nfinal: {len(resolved)} ({n_ted} TED / {len(resolved) - n_ted} commencement)")


if __name__ == "__main__":
    main()
