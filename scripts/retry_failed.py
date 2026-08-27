# -*- coding: utf-8 -*-
"""补救抓取失败项：重新搜索替代视频 → 更新 resolved → 重跑抓取
用法: python retry_failed.py          # 修复 resolved 并列出
      python fetch.py                 # 再跑一次即可续抓失败项
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from resolve import search, make_result, CORPUS, RESOLVED

# 手工指定的替代查询（已知失效项）
OVERRIDE_QUERY = {
    "barack-obama-howard-2016": "Obama Howard University commencement speech 2016 full",
    "maya-angelou-commencement": "Maya Angelou commencement address full speech",
    "hugh-jackman-commencement": "Hugh Jackman commencement speech honorary doctorate",
    "kurt-vonnegut-commencement": "Kurt Vonnegut commencement speech Agnes Scott full",
}


def main():
    state_path = os.path.join(CORPUS, "fetch_state.json")
    state = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    by_slug = {r["slug"]: (i, r) for i, r in enumerate(resolved)}
    # 原始候选清单（含 query）
    cands_path = os.path.join(CORPUS, "commencement_candidates.json")
    cand_map = {}
    if os.path.exists(cands_path):
        cand_map = {c["slug"]: c for c in json.load(open(cands_path, encoding="utf-8"))}

    failed = [s for s, v in state.items() if not (v.get("audio") and v.get("subs"))]
    print(f"failed entries: {len(failed)}")

    changed = False
    for slug in failed:
        if slug not in by_slug:
            print(f"  {slug}: 不在 resolved 中，跳过")
            continue
        i, entry = by_slug[slug]
        queries = []
        if slug in OVERRIDE_QUERY:
            queries.append(OVERRIDE_QUERY[slug])
        c = cand_map.get(slug)
        if c:
            queries.append(c["query"] + " full")
            queries.append(c["query"])
        if entry.get("category") == "ted":
            queries.append(f'"{entry["title"]}" {entry["speaker"]}')

        found = None
        for q in queries:
            for e in search(q, 8):
                if not e.get("url"):
                    continue
                if e["url"] == entry.get("url"):
                    continue  # 跳过已知失效的同一个视频
                dur = e.get("duration") or 0
                if dur and dur < 120:
                    continue
                found = e
                break
            if found:
                break
        if found:
            new_entry = make_result(entry, found, 0.8)
            resolved[i] = new_entry
            changed = True
            # 清除失败状态，让 fetch 重试
            state.pop(slug, None)
            print(f"  REPLACED {slug} -> {found.get('title', '')[:60]} | {found.get('channel')}")
        else:
            print(f"  NO-ALT {slug}（建议从清单移除）")

    if changed:
        json.dump(resolved, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("\nresolved/state 已更新，请重新运行: python fetch.py")


if __name__ == "__main__":
    main()
