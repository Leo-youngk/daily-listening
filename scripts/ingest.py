# -*- coding: utf-8 -*-
"""节目抓取驱动：列表 -> 正文/音频 -> 转码 m4a -> 强制对齐（json3 + ASR 词序列）-> 封面。

三档节目，各取最新的 N 期（某期对齐失败就顺延取下一期，直到凑满 N 期）：
    bbc       BBC 6 Minute English                       默认 100
    curious   English Learning for Curious Minds          默认 50
    thinking  Thinking in English                         默认 50

下载/转码走线程池（纯 I/O），对齐在主线程串行跑（GPU 只有一块）。
断点续抓：corpus/ingest_state.json 记录每期进度，重跑只补缺的。

用法：
    python ingest.py                         # 三档按默认数量
    python ingest.py --bbc 2 --curious 1 --thinking 1   # 冒烟
    python build_talks.py                    # 下一步：切句、翻译、写 data
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from align import align_to_file  # noqa: E402
from sources import bbc6min, curious, thinking  # noqa: E402
from sources.common import fetch_bytes  # noqa: E402

CORPUS = os.path.join(HERE, "corpus")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
COVERS_DIR = os.path.join(ROOT, "public", "covers")
EPISODES = os.path.join(CORPUS, "episodes.json")
STATE = os.path.join(CORPUS, "ingest_state.json")
# 抓到的官方文稿原样留底：改进对齐算法后可以 --realign 重跑，不必再联网
TRANSCRIPTS = os.path.join(CORPUS, "transcripts")

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
MAX_DURATION = 45 * 60
MIN_MATCH_RATIO = 0.85
# 候选比目标多取一些，给对齐失败的期数留顺延余量
CANDIDATE_SLACK = 20


def load_json(path, default):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def probe_duration(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=60)
    m = DURATION_RE.search(r.stderr)
    if not m:
        return None
    h, mi, s = m.groups()
    return round(int(h) * 3600 + int(mi) * 60 + float(s), 2)


def ffmpeg(args):
    r = subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "ffmpeg failed")[-300:])


def download_audio(url, dest):
    """mp3 -> AAC 128k m4a（faststart，seek 友好）。deploy_audio_r2.py 会再转一份 72k 单声道标准音质。"""
    fd, tmp = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            f.write(fetch_bytes(url, timeout=180))
        # 先转到 .part 再改名：中途断电/被杀不会留下半截文件被下次当成已下载
        part = dest + ".part.m4a"
        ffmpeg(["-i", tmp, "-vn", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", part])
        os.replace(part, dest)
    finally:
        os.unlink(tmp)


def download_cover(url, dest):
    """封面统一转成 640 宽的 JPEG，控制仓库体积。"""
    fd, tmp = tempfile.mkstemp(suffix=".img")
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            f.write(fetch_bytes(url))
        part = dest + ".part.jpg"
        ffmpeg(["-i", tmp, "-vf", "scale='min(640,iw)':-2", "-q:v", "4", "-frames:v", "1", part])
        os.replace(part, dest)
    finally:
        os.unlink(tmp)


def candidates(series, target):
    """返回待抓取的 (slug, 取正文函数) 列表，最新在前。"""
    n = target + CANDIDATE_SLACK
    if series == "bbc":
        return [(f"bbc6min_{e['code']}", lambda e=e: bbc6min.fetch_episode(e["url"], e["code"]))
                for e in bbc6min.list_episodes(n)]
    module = {"curious": curious, "thinking": thinking}[series]
    return [(f"{series}_{e['code']}", lambda e=e, m=module: m.fetch_episode(e)) for e in module.list_episodes(n)]


def prepare(slug, fetch):
    """I/O 阶段：取正文、下载转码音频、封面。返回 (slug, 元信息 或 None, 说明)。"""
    try:
        meta = fetch()
    except Exception as exc:
        return slug, None, f"取正文失败: {exc}"
    if not meta:
        return slug, None, "页面没有正文或音频"
    audio = os.path.join(AUDIO_DIR, slug + ".m4a")
    try:
        if not (os.path.exists(audio) and os.path.getsize(audio) > 50_000):
            download_audio(meta["mp3_url"], audio)
    except Exception as exc:
        return slug, None, f"音频失败: {exc}"
    cover = os.path.join(COVERS_DIR, slug + ".jpg")
    if meta.get("cover") and not os.path.exists(cover):
        try:
            download_cover(meta["cover"], cover)
        except Exception as exc:
            print(f"    !! {slug} 封面失败（列表会显示占位色块）: {exc}", flush=True)
    return slug, meta, "ok"


def run_series(series, target, episodes, state):
    done = [s for s, v in state.items() if v.get("series") == series and v.get("ok")]
    if len(done) >= target:
        print(f"== {series}: 已有 {len(done)} 期，跳过", flush=True)
        return
    # 对齐不达标、时长异常、页面无正文都是确定性失败，重跑也一样，不再重试；网络类失败会重试
    deterministic = ("align", "duration", "页面")
    todo = [(slug, fetch) for slug, fetch in candidates(series, target)
            if not state.get(slug, {}).get("ok")
            and not str(state.get(slug, {}).get("why", "")).startswith(deterministic)]
    need = target - len(done)
    print(f"== {series}: 已有 {len(done)} 期，还需 {need} 期，候选 {len(todo)} 期", flush=True)
    ok = 0
    with ThreadPoolExecutor(3) as pool:
        # 下载最多领先对齐 3 期，凑满目标后不再多下
        pending = iter(todo)
        window = deque()

        def refill():
            while len(window) < 3:
                nxt = next(pending, None)
                if nxt is None:
                    return
                window.append(pool.submit(prepare, *nxt))

        refill()
        while window and ok < need:
            fut = window.popleft()
            refill()
            slug, meta, why = fut.result()
            if not meta:
                print(f"  [skip] {slug}: {why}", flush=True)
                state[slug] = {"series": series, "ok": False, "why": why}
                save_json(STATE, state)
                continue
            audio = os.path.join(AUDIO_DIR, slug + ".m4a")
            duration = probe_duration(audio)
            if not duration or duration > MAX_DURATION:
                print(f"  [skip] {slug}: 时长异常 {duration}", flush=True)
                state[slug] = {"series": series, "ok": False, "why": f"duration {duration}"}
                save_json(STATE, state)
                continue
            with open(os.path.join(TRANSCRIPTS, slug + ".txt"), "w", encoding="utf-8", newline="\n") as f:
                f.write(meta["transcript"] + "\n")
            started = time.time()
            json3 = os.path.join(SUBS_DIR, slug + ".en.json3")
            words = os.path.join(SUBS_DIR, slug + ".words.json")
            try:
                aligned, ratio = align_to_file(audio, meta["transcript"], json3, words, min_match_ratio=MIN_MATCH_RATIO)
            except Exception as exc:
                # 内存不足、显卡异常这类是临时故障，不记成确定性失败，下次重跑会再试
                print(f"  [skip] {slug}: 对齐异常 {exc}", flush=True)
                state[slug] = {"series": series, "ok": False, "why": f"对齐异常 {exc}"}
                save_json(STATE, state)
                continue
            if not aligned:
                print(f"  [skip] {slug}: 对齐匹配率不足 {ratio:.3f}", flush=True)
                state[slug] = {"series": series, "ok": False, "why": f"align {ratio:.3f}"}
                save_json(STATE, state)
                continue
            episodes[slug] = {
                "slug": slug,
                "series": series,
                "title": meta["title"],
                "date": meta.get("date"),
                "sourceUrl": meta["source_url"],
                "coverUrl": meta.get("cover"),
                "keywords": meta.get("keywords") or [],
                "duration": duration,
                "matchScore": round(ratio, 3),
            }
            state[slug] = {"series": series, "ok": True, "ts": int(time.time())}
            save_json(EPISODES, episodes)
            save_json(STATE, state)
            ok += 1
            print(f"  [ok {len(done) + ok}/{target}] {slug} {meta['title'][:50]} "
                  f"match={ratio:.3f} {duration / 60:.1f}min 对齐 {time.time() - started:.0f}s", flush=True)
        for fut in window:
            fut.cancel()
    print(f"== {series}: 本轮新增 {ok} 期", flush=True)


def realign(episodes):
    """用留底的文稿和缓存的 ASR 词序列重跑对齐（不联网、不再识别）。"""
    for slug, ep in episodes.items():
        text = open(os.path.join(TRANSCRIPTS, slug + ".txt"), encoding="utf-8").read()
        ok, ratio = align_to_file(os.path.join(AUDIO_DIR, slug + ".m4a"), text,
                                  os.path.join(SUBS_DIR, slug + ".en.json3"),
                                  os.path.join(SUBS_DIR, slug + ".words.json"), min_match_ratio=MIN_MATCH_RATIO)
        if not ok:
            raise SystemExit(f"{slug} 重新对齐失败：{ratio:.3f}")
        ep["matchScore"] = round(ratio, 3)
        print(f"  [realign] {slug} match={ratio:.3f}", flush=True)
    save_json(EPISODES, episodes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbc", type=int, default=100)
    ap.add_argument("--curious", type=int, default=50)
    ap.add_argument("--thinking", type=int, default=50)
    ap.add_argument("--realign", action="store_true", help="只用留底文稿重跑已入库各期的对齐")
    args = ap.parse_args()

    for d in (CORPUS, AUDIO_DIR, SUBS_DIR, COVERS_DIR, TRANSCRIPTS):
        os.makedirs(d, exist_ok=True)
    # 上次中途被杀留下的半截转码文件
    for d in (AUDIO_DIR, COVERS_DIR):
        for name in os.listdir(d):
            if ".part." in name:
                os.remove(os.path.join(d, name))
    episodes = load_json(EPISODES, {})
    state = load_json(STATE, {})
    if args.realign:
        realign(episodes)
        return
    for series, target in (("bbc", args.bbc), ("curious", args.curious), ("thinking", args.thinking)):
        if target > 0:
            run_series(series, target, episodes, state)
    print("\n全部完成，下一步：python build_talks.py", flush=True)


if __name__ == "__main__":
    main()
