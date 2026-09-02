# -*- coding: utf-8 -*-
"""修复缺字幕条目：gawande 用 en-US 轨道；其余 5 篇换有字幕的镜像版本"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
CORPUS = os.path.join(HERE, "corpus")
SUBS = os.path.join(ROOT, "public", "subs")
# 归档到 oneoff/ 后仍要能 import 上层 scripts/ 里的模块
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from resolve import search, make_result, RESOLVED

YT = [sys.executable, "-m", "yt_dlp", "--no-warnings"]
state_path = os.path.join(CORPUS, "fetch_state.json")
state = json.load(open(state_path, encoding="utf-8"))


def has_en(slug):
    return any(f.startswith(slug + ".") and ".en" in f and f.endswith(".json3")
               for f in os.listdir(SUBS))


def download_subs(slug, url, langs):
    prefix = os.path.join(SUBS, slug)
    cmd = YT + ["--skip-download", "--write-subs", "--write-auto-subs",
                "--sub-langs", langs, "--sub-format", "json3",
                "--sleep-requests", "2", "--sleep-subtitles", "1.5",
                "-o", prefix, "--no-playlist", url]
    subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    return has_en(slug)


def main():
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    by_slug = {r["slug"]: i for i, r in enumerate(resolved)}

    # 1) gawande：直接补 en-US 轨道
    g = resolved[by_slug["atul-gawande-commencement"]]
    if download_subs("atul-gawande-commencement", g["url"], "en-US,en"):
        state["atul-gawande-commencement"] = {"audio": True, "subs": True, "ts": int(time.time())}
        print("atul-gawande-commencement OK (en-US)")
    time.sleep(5)

    # 2) 其余 5 篇：搜索带字幕的替代版本
    ALT = {
        "barack-obama-rutgers-2016": "Obama Rutgers commencement speech 2016",
        "chadwick-boseman-howard-2018": "Chadwick Boseman Howard commencement speech 2018",
        "will-ferrell-usc-2017": "Will Ferrell USC commencement speech 2017",
        "john-waters-risd-2015": "John Waters RISD commencement speech 2015",
        "beyonce-commencement": "Beyonce commencement speech Dear Class of 2020",
    }
    for slug, query in ALT.items():
        cur = resolved[by_slug[slug]]
        cands = search(query, 10)
        ok = False
        for e in cands:
            if not e.get("url") or e["url"] == cur["url"]:
                continue
            if (e.get("duration") or 0) < 120:
                continue
            # 逐个检查该视频是否有英文字幕轨道
            r = subprocess.run([sys.executable, "-m", "yt_dlp", "-J", "--skip-download",
                                "--no-warnings", e["url"]],
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=120)
            if r.returncode != 0:
                continue
            try:
                info = json.loads(r.stdout)
            except Exception:
                continue
            langs = [k for k in info.get("subtitles", {}) if k.startswith("en")] or \
                    [k for k in info.get("automatic_captions", {}) if k.startswith("en") and len(k) <= 6]
            if not langs:
                continue
            if download_subs(slug, e["url"], ",".join(langs[:3] + ["en"])):
                resolved[by_slug[slug]] = make_result(cur, e, 0.85)
                # 字幕源换了视频，音频必须同步重下，保证音源/文字稿一致
                old_audio = os.path.join(ROOT, "public", "audio", slug + ".m4a")
                if os.path.exists(old_audio):
                    os.remove(old_audio)
                state[slug] = {"audio": False, "subs": True, "ts": int(time.time())}
                print(f"{slug} REPLACED -> {e.get('title', '')[:55]} | {e.get('channel')}（待重下音频）")
                ok = True
                break
            time.sleep(5)
        if not ok:
            print(f"{slug} NO-SUB-ALT（保留音频，无文字稿则不入库）")
        time.sleep(5)

    json.dump(resolved, open(RESOLVED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("saved")


if __name__ == "__main__":
    main()
