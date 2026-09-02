# -*- coding: utf-8 -*-
"""诊断被跳过条目：字幕覆盖率 vs 预期时长"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from vtt2json import parse_json3, merge_sentences, find_file, SUBS_DIR, CORPUS


def main():
    resolved = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}
    ted_meta = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))}
    state = json.load(open(os.path.join(CORPUS, "fetch_state.json"), encoding="utf-8"))
    data_slugs = {f[:-5] for f in os.listdir(os.path.join(ROOT, "public", "data"))
                  if f.endswith(".json") and f != "manifest.json"}
    missing = [s for s in state if state[s].get("subs") and s not in data_slugs]

    for slug in missing:
        en_path = find_file(slug, "en")
        if not en_path:
            print(f"{slug}: 无英文字幕文件\n")
            continue
        sents = merge_sentences(parse_json3(en_path))
        subs_end = sents[-1]["end"] if sents else 0
        r = resolved.get(slug, {})
        expect = r.get("duration") or ted_meta.get(slug, {}).get("duration") or 0
        cov = subs_end / expect if expect else 0
        print(f"{slug}")
        print(f"  {r.get('category')} | ch={r.get('channel')} | {r.get('video_title','')[:70]}")
        print(f"  expect={expect:.0f}s subs_end={subs_end:.0f}s coverage={cov:.1%}")
        print()


if __name__ == "__main__":
    main()
