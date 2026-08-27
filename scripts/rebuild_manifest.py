# -*- coding: utf-8 -*-
"""清理孤儿数据文件（已从 resolved 移除但数据还在），重建 manifest"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "public", "data")
AUDIO = os.path.join(ROOT, "public", "audio")

resolved = {e["slug"] for e in json.load(open(os.path.join(HERE, "corpus", "resolved.json"), encoding="utf-8"))}

kept, removed = [], 0
for f in sorted(os.listdir(DATA)):
    if not f.endswith(".json") or f == "manifest.json":
        continue
    slug = f[:-5]
    path = os.path.join(DATA, f)
    if slug not in resolved or not os.path.exists(os.path.join(AUDIO, slug + ".m4a")):
        os.remove(path)
        removed += 1
        print(f"removed orphan: {slug}")
        continue
    d = json.load(open(path, encoding="utf-8"))
    kept.append({k: d.get(k) for k in
                 ("slug", "title", "speaker", "category", "school", "year",
                  "duration", "cover", "views", "audioUrl", "zhSource")})

kept.sort(key=lambda e: (0 if e["category"] == "ted" else 1, -(e.get("views") or 0)))
with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(kept, f, ensure_ascii=False)

n_ted = sum(1 for e in kept if e["category"] == "ted")
print(f"\nmanifest rebuilt: {len(kept)} ({n_ted} TED / {len(kept) - n_ted} commencement), removed {removed} orphans")
