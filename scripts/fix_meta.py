# -*- coding: utf-8 -*-
"""修复 5 篇 TED 重试条目的元数据（标题/讲者/播放量），来源 ted_main.csv"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "public", "data")

rows = list(csv.DictReader(open(os.path.join(HERE, "corpus", "ted_main.csv"), encoding="utf-8")))
by_slug = {}
for r in rows:
    slug = r["url"].rstrip("/").split("/")[-1].strip()
    by_slug[slug] = r

resolved_path = os.path.join(HERE, "corpus", "resolved.json")
resolved = json.load(open(resolved_path, encoding="utf-8"))

fixed = 0
for entry in resolved:
    if entry["category"] != "ted":
        continue
    src = by_slug.get(entry["slug"])
    if not src:
        continue
    changed = False
    if not entry.get("speaker"):
        entry["speaker"] = src["main_speaker"].strip()
        changed = True
    if not entry.get("views"):
        entry["views"] = int(src["views"])
        changed = True
    # 标题用 ted.com 官方标题（保留，不改视频标题）
    if not entry.get("title") or entry["title"] == entry["slug"]:
        entry["title"] = src["title"].strip()
        changed = True
    else:
        entry.setdefault("title", src["title"].strip())
    # 同步数据文件
    dj = os.path.join(DATA, entry["slug"] + ".json")
    if os.path.exists(dj):
        d = json.load(open(dj, encoding="utf-8"))
        d["title"] = src["title"].strip()
        d["speaker"] = src["main_speaker"].strip()
        d["views"] = int(src["views"])
        with open(dj, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        changed = True
    if changed:
        fixed += 1

json.dump(resolved, open(resolved_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"fixed {fixed} entries")
