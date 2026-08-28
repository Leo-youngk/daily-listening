# -*- coding: utf-8 -*-
"""VOA / BBC 6 Minute English 统一抓取驱动：下载音频 -> 转码 m4a -> 强制对齐出 json3 字幕
-> 写入 resolved.json / fetch_state.json，供 vtt2json.py 原样复用生成 data/manifest。

用法:
  python ingest.py --source bbc --limit 10          # 冒烟：BBC 前 10 期
  python ingest.py --source voa --voa-limit 5        # 冒烟：VOA 每栏目 5 篇
  python ingest.py --source all                       # 全量（按默认上限）
"""
import argparse, json, os, re, subprocess, sys, tempfile, time, urllib.request

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from align import align_to_file
from sources import bbc6min, voa

CORPUS = os.path.join(HERE, "corpus")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
COVERS_DIR = os.path.join(ROOT, "public", "covers")
RESOLVED = os.path.join(CORPUS, "resolved.json")
STATE = os.path.join(CORPUS, "fetch_state.json")

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
MAX_DURATION = 20 * 60
MIN_MATCH_RATIO = 0.85
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

CHANNEL_NAME = {"voa": "VOA Learning English", "bbc": "BBC Learning English"}


def load_json(path, default):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else default


def save_json(path, data, indent=2):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)


def download(url, dest, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
        f.write(r.read())


def retry_call(fn, *args, attempts=3, **kwargs):
    for attempt in range(attempts):
        try:
            return fn(*args, **kwargs)
        except Exception as ex:
            print(f"    !! {fn.__module__}.{fn.__name__} 异常（第{attempt + 1}次）: {ex}", flush=True)
            if attempt == attempts - 1:
                raise
            time.sleep(3)


def probe_duration(path):
    result = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=30)
    m = DURATION_RE.search(result.stderr)
    if not m:
        return None
    h, mi, s = m.groups()
    return round(int(h) * 3600 + int(mi) * 60 + float(s), 2)


def to_m4a(src_path, dest_path):
    cmd = [FFMPEG, "-y", "-i", src_path, "-vn", "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
           "-movflags", "+faststart", dest_path]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(f"    ffmpeg: {(r.stderr or '')[-300:]}", flush=True)
    return r.returncode == 0 and os.path.exists(dest_path) and os.path.getsize(dest_path) > 0


def process_item(item, category, resolved_map, state):
    slug = item["slug"]
    channel = CHANNEL_NAME[category]
    audio_out = os.path.join(AUDIO_DIR, f"{slug}.m4a")
    subs_out = os.path.join(SUBS_DIR, f"{slug}.en.json3")
    info_out = os.path.join(SUBS_DIR, f"{slug}.info.json")
    cover_out = os.path.join(COVERS_DIR, f"{slug}.jpg")

    if not (os.path.exists(audio_out) and os.path.getsize(audio_out) > 50_000):
        tmp_mp3 = None
        try:
            fd, tmp_mp3 = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            download(item["mp3_url"], tmp_mp3)
            if not to_m4a(tmp_mp3, audio_out):
                print("    !! 转码失败", flush=True)
                return "fail"
        finally:
            if tmp_mp3 and os.path.exists(tmp_mp3):
                os.unlink(tmp_mp3)

    duration = probe_duration(audio_out)
    if duration and duration > MAX_DURATION:
        print(f"    !! 超过20分钟上限 ({duration/60:.1f}min)，跳过", flush=True)
        os.unlink(audio_out)
        return "skip_long"

    if not os.path.exists(subs_out):
        ok, ratio = align_to_file(audio_out, item["transcript"], subs_out, min_match_ratio=MIN_MATCH_RATIO)
        if not ok:
            print(f"    !! 对齐匹配率不足 ratio={ratio:.3f}", flush=True)
            if os.path.exists(subs_out):
                os.unlink(subs_out)
            return "fail_align"
    else:
        ratio = resolved_map.get(slug, {}).get("match_score", 1.0)

    if not os.path.exists(info_out):
        save_json(info_out, {"title": item["title"], "thumbnail": item.get("cover") or ""})

    if item.get("cover") and not os.path.exists(cover_out):
        try:
            download(item["cover"], cover_out)
        except Exception as e:
            print(f"    封面下载失败（不影响主流程）: {e}", flush=True)

    resolved_map[slug] = {
        "slug": slug,
        "category": category,
        "title": item["title"],
        "speaker": channel,
        "school": None,
        "year": int(item["date"][:4]) if item.get("date") else None,
        "views": None,
        "url": item["source_url"],
        "video_title": item["title"],
        "channel": channel,
        "duration": duration,
        "match_score": round(ratio, 3),
    }
    state[slug] = {"audio": True, "subs": True, "ts": int(time.time())}
    return "ok"


def run_source(category, items, resolved_map, state, resolved_path, state_path):
    counts = {}
    total = len(items)
    for i, item in enumerate(items, 1):
        slug = item["slug"]
        if state.get(slug, {}).get("audio") and state.get(slug, {}).get("subs"):
            counts["skip_done"] = counts.get("skip_done", 0) + 1
            continue
        print(f"[{category} {i}/{total}] {slug} - {item['title']}", flush=True)
        try:
            result = process_item(item, category, resolved_map, state)
        except Exception as ex:
            print(f"    !! 处理异常: {ex}", flush=True)
            result = "fail_exception"
        counts[result] = counts.get(result, 0) + 1
        save_json(resolved_path, list(resolved_map.values()))
        save_json(state_path, state)
        time.sleep(1)
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["voa", "bbc", "all"], default="all")
    ap.add_argument("--limit", type=int, default=110, help="BBC 期数上限")
    ap.add_argument("--voa-limit", type=int, default=25, help="VOA 每个栏目篇数上限")
    ap.add_argument("--voa-section", choices=list(voa.SECTIONS), default=None, help="只跑 VOA 单个栏目（用于并行）")
    ap.add_argument("--resolved-out", default=None, help="resolved.json 输出路径覆盖（用于并行隔离）")
    ap.add_argument("--state-out", default=None, help="fetch_state.json 输出路径覆盖（用于并行隔离）")
    args = ap.parse_args()

    resolved_path = args.resolved_out or RESOLVED
    state_path = args.state_out or STATE

    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(SUBS_DIR, exist_ok=True)
    os.makedirs(COVERS_DIR, exist_ok=True)

    resolved = load_json(resolved_path, [])
    resolved_map = {e["slug"]: e for e in resolved}
    state = load_json(state_path, {})

    if args.source in ("bbc", "all"):
        print("== 抓取 BBC 6 Minute English 列表 ==", flush=True)
        eps = retry_call(bbc6min.list_episodes, args.limit)
        items = []
        for e in eps:
            slug = f"bbc6min_{e['code']}"
            if state.get(slug, {}).get("audio") and state.get(slug, {}).get("subs"):
                items.append({"slug": slug})  # 占位，process 前会被跳过
                continue
            data = None
            for attempt in range(2):
                try:
                    data = bbc6min.fetch_episode(e["url"], e["code"])
                    break
                except Exception as ex:
                    print(f"    !! 抓取异常（第{attempt + 1}次）: {e['url']} - {ex}", flush=True)
                    time.sleep(3)
            if data:
                items.append(data)
            else:
                print(f"    !! 抓取失败（无字幕/音频）: {e['url']}", flush=True)
            time.sleep(1)
        counts = run_source("bbc", items, resolved_map, state, resolved_path, state_path)
        print(f"BBC 完成: {counts}", flush=True)

    if args.source in ("voa", "all"):
        sections = [args.voa_section] if args.voa_section else list(voa.SECTIONS)
        for section in sections:
            print(f"== 抓取 VOA {section} 列表 ==", flush=True)
            arts = retry_call(voa.list_articles, section, args.voa_limit)
            items = []
            for a in arts:
                slug = f"voa_{a['id']}"
                if state.get(slug, {}).get("audio") and state.get(slug, {}).get("subs"):
                    items.append({"slug": slug})
                    continue
                data = None
                for attempt in range(2):
                    try:
                        data = voa.fetch_article(a["url"], a["id"])
                        break
                    except Exception as ex:
                        print(f"    !! 抓取异常（第{attempt + 1}次）: {a['url']} - {ex}", flush=True)
                        time.sleep(3)
                if data:
                    items.append(data)
                else:
                    print(f"    !! 抓取失败（无正文/音频）: {a['url']}", flush=True)
                time.sleep(1)
            counts = run_source("voa", items, resolved_map, state, resolved_path, state_path)
            print(f"VOA {section} 完成: {counts}", flush=True)

    print("\n全部完成，运行 `python vtt2json.py` 生成 data/manifest。", flush=True)


if __name__ == "__main__":
    main()
