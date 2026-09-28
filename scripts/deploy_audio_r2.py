# -*- coding: utf-8 -*-
"""把 public/audio 的音频转码并上传到 Cloudflare R2。

架构：
- high = 直接上传 public/audio 里的原始 128kbps AAC 源文件（v1/high/<slug>.m4a），不再有损转码。
- standard = 现场转码为 64kbps 单声道 44.1kHz CBR MP3（v1/standard/<slug>.mp3），默认播放音质。
  为什么是 MP3 而不是 AAC：m4a 起播前要先下完文件头的 moov 索引（每个音频帧一条，
  25 分钟的节目有 240~300KB），弱网下首播要多等好几秒；MP3 没有这张表，下到几 KB 就能出声，
  定码率下按字节比例 seek 也准。播客行业普遍用 MP3 也是这个原因。
- 前端经 Pages Functions 的 /audio/* 同源读取（app/functions/audio），不再单独握手一个音频域名。
- R2 object key 带 v1/ 版本前缀，响应是一年 immutable 缓存；以后替换音频内容就换 v2/ 前缀。
- 幂等：已存在且大小同源文件的 high / 已存在的 standard 跳过，可断点续传。

用法：
    python deploy_audio_r2.py --ready        # 只传 ingest 已完成的期（corpus/episodes.json）
    python deploy_audio_r2.py --ready --jobs 3
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
ENV_FILE = os.path.join(ROOT, ".env.cloudflare.local")
BUCKET = "daily-listening-audio"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def load_env(path: str) -> dict:
    values = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def make_client(env: dict):
    return boto3.client(
        "s3",
        endpoint_url=env["R2_ENDPOINT"],
        aws_access_key_id=env["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def transcode_standard(src: str) -> str:
    fd, tmp = tempfile.mkstemp(suffix=".mp3", prefix="std-")
    os.close(fd)
    cmd = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", src,
        "-vn", "-ac", "1", "-ar", "44100",
        "-c:a", "libmp3lame", "-b:a", "64k",
        tmp,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
        os.path.exists(tmp) and os.unlink(tmp)
        raise RuntimeError((r.stderr or "ffmpeg failed")[-300:])
    return tmp


def remote_size(client, key: str) -> int | None:
    try:
        head = client.head_object(Bucket=BUCKET, Key=key)
        return head["ContentLength"]
    except Exception:
        return None


def upload(client, path: str, key: str, content_type: str) -> None:
    client.upload_file(path, BUCKET, key, ExtraArgs={"ContentType": content_type})


def deploy_one(client, fname: str) -> tuple[bool, bool]:
    """返回 (新传了 high, 新传了 standard)。"""
    slug = fname[:-4]
    src = os.path.join(AUDIO_DIR, fname)
    high_key = f"v1/high/{slug}.m4a"
    std_key = f"v1/standard/{slug}.mp3"

    new_high = remote_size(client, high_key) != os.path.getsize(src)
    if new_high:
        upload(client, src, high_key, "audio/mp4")

    new_std = remote_size(client, std_key) is None
    if new_std:
        tmp = transcode_standard(src)
        try:
            upload(client, tmp, std_key, "audio/mpeg")
        finally:
            os.unlink(tmp)
    return new_high, new_std


def main() -> None:
    import argparse
    import json
    ap = argparse.ArgumentParser()
    ap.add_argument("--ready", action="store_true",
                    help="只传 ingest 已完成的期数（corpus/episodes.json），可以和 ingest.py 同时跑，不会传到写了一半的文件")
    ap.add_argument("--jobs", type=int, default=3)
    args = ap.parse_args()
    client = make_client(load_env(ENV_FILE))

    files = sorted(f for f in os.listdir(AUDIO_DIR) if f.endswith(".m4a"))
    if args.ready:
        with open(os.path.join(HERE, "corpus", "episodes.json"), encoding="utf-8") as fh:
            ready = set(json.load(fh))
        files = [f for f in files if f[:-4] in ready]

    total = len(files)
    new_high = new_std = done = 0
    failed = []
    with ThreadPoolExecutor(args.jobs) as pool:
        futures = {pool.submit(deploy_one, client, f): f[:-4] for f in files}
        for future in as_completed(futures):
            slug = futures[future]
            done += 1
            try:
                h, s = future.result()
                new_high += h
                new_std += s
                print(f"[{done}/{total}] {slug}: ok", flush=True)
            except Exception as exc:
                failed.append(slug)
                print(f"[{done}/{total}] {slug}: FAIL {exc}", flush=True)

    print(f"\n完成：high 新传 {new_high}，standard(mp3) 新传 {new_std}，失败 {len(failed)}", flush=True)
    if failed:
        print("失败：" + ", ".join(sorted(failed)), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
