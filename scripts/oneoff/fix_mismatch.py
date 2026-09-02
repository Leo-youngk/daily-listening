# -*- coding: utf-8 -*-
"""找出因音源/字幕不一致被跳过的条目，用严格时长门限重新搜索并替换"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from resolve import search, make_result, CORPUS, RESOLVED


def main():
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    state = json.load(open(os.path.join(CORPUS, "fetch_state.json"), encoding="utf-8"))
    ted_meta = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))}
    data_slugs = {f[:-5] for f in os.listdir(os.path.join(ROOT, "public", "data"))
                  if f.endswith(".json") and f != "manifest.json"}
    missing = [s for s in state if state[s].get("subs") and s not in data_slugs]
    print("skipped:", len(missing))
    by_slug = {r["slug"]: i for i, r in enumerate(resolved)}

    for slug in missing:
        r = next(x for x in resolved if x["slug"] == slug)
        want = r.get("duration") or ted_meta.get(slug, {}).get("duration") or 0
        print(f"  {slug} | {r['category']} | dur={want} | ch={r.get('channel')} | {r.get('video_title','')[:60]}")
        # 重新搜索：时长必须在 ±8% 以内（字幕与音频严格一致）
        queries = []
        if slug in ted_meta:
            m = ted_meta[slug]
            queries.append(f'"{m["title"]}" {m["speaker"]}')
            queries.append(f'{m["title"]} {m["speaker"]} TED')
        else:
            q = f"{r['speaker']} commencement speech"
            if r.get("school") and r["school"] != "—":
                q = f"{r['speaker']} {r['school']} commencement speech"
            queries.append(q + " full")
            queries.append(q)

        best = None
        for q in queries:
            for e in search(q, 10):
                dur = e.get("duration") or 0
                if want and dur and abs(dur - want) / want <= 0.08 and "ted-ed" not in (e.get("channel") or "").lower():
                    best = e
                    break
            if best:
                break
        if best:
            entry = dict(ted_meta.get(slug) or {
                "slug": slug, "title": r.get("title", slug), "speaker": r.get("speaker", ""),
                "school": r.get("school"), "year": r.get("year"), "duration": want,
            })
            entry["category"] = r["category"]
            resolved[by_slug[slug]] = make_result(entry, best, 0.9)
            state.pop(slug, None)  # 让 fetch 重新下载
            # 删除旧字幕文件
            subs_dir = os.path.join(ROOT, "public", "subs")
            for f in os.listdir(subs_dir):
                if f.startswith(slug + "."):
                    os.remove(os.path.join(subs_dir, f))
            print(f"    REPLACED -> {best.get('title','')[:60]} | {best.get('channel')} | {best.get('duration')}s")
        else:
            print("    NO-ALT（保持跳过，不入清单）")

    json.dump(resolved, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(state, open(os.path.join(CORPUS, "fetch_state.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\n下一步: python fetch.py 然后重新运行 vtt2json 增量生成")


if __name__ == "__main__":
    main()
