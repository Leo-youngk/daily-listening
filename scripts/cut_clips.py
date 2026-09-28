# -*- coding: utf-8 -*-
"""把每一句切成独立小音频，上传 R2，供背词卡与单词详情播放"原声例句"。

为什么切句而不是在整集音频里 seek：复习卡要点开就响、要能离线缓存；iOS 在大文件之间切源也慢。
全部句子都切（不只词表例句）：查词时记下的任意一句，复习时也能放原声。

命名：v1/clips/<slug>/<句子下标>-<起点厘秒>.m4a（前端 wordbook.clipUrl 同一规则）。
句子重切后起点变了，地址自然变，不会被一年期的 immutable 缓存卡住旧音频。

AAC 48kbps 单声道；句首提前 0.12 秒、句尾延后 0.25 秒，避免吞掉首尾辅音。
本地产物放 media-build/clips（已 gitignore），已上传的按 R2 列表跳过，可断点续传。

用法：
    python cut_clips.py              # 全部节目
    python cut_clips.py --slugs a,b
"""
import argparse
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

import boto3
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "public", "data")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
OUT_DIR = os.path.join(ROOT, "media-build", "clips")
ENV_FILE = os.path.join(ROOT, ".env.cloudflare.local")
BUCKET = "daily-listening-audio"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
LEAD, TAIL = 0.12, 0.25


def load_env(path):
    values = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def clip_name(sentence):
    return f"{sentence['i']}-{round(sentence['start'] * 100)}.m4a"


def cut(src, sentence, duration, dest):
    start = max(0.0, sentence["start"] - LEAD)
    end = min(duration, sentence["end"] + TAIL)
    r = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", src,
         "-t", f"{max(0.3, end - start):.3f}", "-vn", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "48k",
         "-movflags", "+faststart", dest],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 500:
        raise RuntimeError(f"{dest}: {(r.stderr or 'ffmpeg failed')[-200:]}")


def remote_keys(client, prefix):
    keys = set()
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
        keys.update(obj["Key"] for obj in page.get("Contents", []))
    return keys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slugs", default="")
    ap.add_argument("--jobs", type=int, default=8)
    args = ap.parse_args()

    env = load_env(ENV_FILE)
    client = boto3.client("s3", endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["AWS_ACCESS_KEY_ID"],
                          aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"], region_name="auto")
    manifest = json.load(open(os.path.join(DATA_DIR, "manifest.json"), encoding="utf-8"))
    wanted = {s.strip() for s in args.slugs.split(",") if s.strip()}
    items = [m for m in manifest if not wanted or m["slug"] in wanted]

    total_cut = total_up = 0
    for n, item in enumerate(items, 1):
        slug = item["slug"]
        talk = json.load(open(os.path.join(DATA_DIR, slug + ".json"), encoding="utf-8"))
        src = os.path.join(AUDIO_DIR, slug + ".m4a")
        out = os.path.join(OUT_DIR, slug)
        os.makedirs(out, exist_ok=True)
        prefix = f"v1/clips/{slug}/"
        existing = remote_keys(client, prefix)
        todo = [s for s in talk["sentences"] if prefix + clip_name(s) not in existing]
        if not todo:
            print(f"[{n}/{len(items)}] {slug}: 已全部上传", flush=True)
            continue

        def job(sentence):
            dest = os.path.join(out, clip_name(sentence))
            made = 0
            if not os.path.exists(dest):
                cut(src, sentence, talk["duration"], dest)
                made = 1
            client.upload_file(dest, BUCKET, prefix + clip_name(sentence), ExtraArgs={"ContentType": "audio/mp4"})
            return made

        with ThreadPoolExecutor(args.jobs) as pool:
            made = sum(pool.map(job, todo))
        total_cut += made
        total_up += len(todo)
        print(f"[{n}/{len(items)}] {slug}: 切 {made} 句，上传 {len(todo)} 句", flush=True)

        # 本集旧的切句（句子重切后的遗留）从 R2 清掉，避免越积越多
        current = {prefix + clip_name(s) for s in talk["sentences"]}
        stale = sorted(existing - current)
        for k in range(0, len(stale), 1000):
            client.delete_objects(Bucket=BUCKET, Delete={"Objects": [{"Key": key} for key in stale[k:k + 1000]]})
        if stale:
            print(f"    清理本集过期切句 {len(stale)} 个", flush=True)

    print(f"\n完成：切 {total_cut} 句，上传 {total_up} 句")


if __name__ == "__main__":
    main()
