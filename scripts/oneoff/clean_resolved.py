# -*- coding: utf-8 -*-
"""清洗 resolved.json：剔除错误匹配与重复项；对漏掉的 TED 篇目用替代查询重试"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from resolve import search, make_result, load_existing, CORPUS, RESOLVED

# 经审查确认的错误匹配 / 重复项
BLACKLIST = {
    "mel-robbins-commencement",        # TEDx，非毕业演讲
    "simon-sinek-commencement",          # 励志混剪
    "kobe-bryant-commencement",          # 励志混剪
    "terry-pratchett-commencement",      # 剧集片段
    "martin-luther-king-morehouse",      # I Have a Dream，非毕业演讲
    "brene-brown-smu-2017",              # 与 brene-brown-houston 重复（同一视频）
    "stephen-colbert-northwestern-2006", # 与 uva-2012 重复（同一视频）
    "condoleezza-rice-rutgers-2014",     # 抗议报道，非演讲
    "lady-gaga-berklee-2017",            # 错误视频
    "nora-ephron-wellesley-1996",        # 演讲点评，非演讲
    "david-mccullough-wellesley-high-2012",  # 电台评论
    "rfk-dayton-1962",                   # MLK 遇刺演讲，非毕业演讲
    "james-cameron-commencement",        # 另一个 James Cameron
    "drew-brees-purdue-2021",            # 球队讲话，非毕业典礼
    "billie-eilish-commencement",        # 颁奖礼发言
    "greta-thunberg-commencement",       # COP25，非毕业演讲
    "ariana-grande-commencement",        # 来源不明
    "bob-dylan-commencement",            # 来源不明
    "bryan-cranston-commencement",       # 表演建议片段
    "lebron-james-commencement",         # 卡片博主转述视频
    "snoop-dogg-commencement",           # 励志混剪
    "stephen-hawking-commencement",      # 物理奖致辞
    "ursula-leguin-commencement",        # PBS 纪录片片段
    "salman-rushdie-commencement",       # 朗读频道，质量存疑
    "hillary-clinton-wellesley-1969",    # 旧录音无字幕价值低
}

# 漏掉的 TED：替代查询
TED_RETRY = {
    "steve_jobs_how_to_live_before_you_die": "Steve Jobs How to live before you die TED talk",
    "arthur_benjamin_does_mathemagic": "Arthur Benjamin mathemagic TED",
    "hugh_herr_the_new_bionics_that_let_us_run_climb_and_dance": "Hugh Herr bionics TED talk",
    "elon_musk_the_future_we_re_building_and_boring": "Elon Musk TED interview the future",
    "johnny_lee_demos_wii_remote_hacks": "Johnny Lee Wii Remote hacks TED",
    "guy_winch_the_case_for_emotional_hygiene": "Guy Winch emotional first aid TED",
}


def main():
    ted_meta = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))}
    resolved = load_existing(RESOLVED)

    removed = [s for s in list(resolved) if s in BLACKLIST]
    for s in removed:
        del resolved[s]
    print(f"removed {len(removed)} bad entries")

    # TED 重试
    for slug, query in TED_RETRY.items():
        if slug in resolved:
            continue
        cands = search(query, 8)
        meta = ted_meta.get(slug, {"slug": slug, "title": slug, "speaker": "", "duration": 0})
        best, best_score = None, -1.0
        for e in cands:
            ch = (e.get("channel") or "").lower()
            if "ted" not in ch:
                continue
            score = 1.0
            if meta.get("duration") and e.get("duration"):
                diff = abs(e["duration"] - meta["duration"]) / meta["duration"]
                if diff > 0.3:
                    continue
                score = 1.0 - diff
            if score > best_score:
                best_score, best = score, e
        if best:
            entry = dict(meta)
            entry["category"] = "ted"
            resolved[slug] = make_result(entry, best, best_score)
            print(f"retry OK: {slug} -> {best.get('title')}")
        else:
            print(f"retry MISS: {slug}")

    with open(RESOLVED, "w", encoding="utf-8") as f:
        json.dump(list(resolved.values()), f, ensure_ascii=False, indent=2)
    n_ted = sum(1 for e in resolved.values() if e["category"] == "ted")
    print(f"\nfinal: {len(resolved)} entries ({n_ted} TED / {len(resolved) - n_ted} commencement)")


if __name__ == "__main__":
    main()
