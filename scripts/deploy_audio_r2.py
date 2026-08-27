# -*- coding: utf-8 -*-
"""把 public/audio 的音频转码并上传到 Cloudflare R2。

架构：
- high  = 直接上传 public/audio 里的原始 128kbps AAC 源文件，不再有损转码。
- standard = 现场转码为 72kbps mono 44.1kHz AAC-LC + faststart，作为默认播放音质。
- R2 object key 带 v1/ 版本前缀（对应 media-worker 的路由与 Worker 侧一年 immutable 缓存），
  以后如需替换音频内容，改成 v2/ 前缀即可让所有客户端读取新文件，不会被旧缓存卡住。
- 幂等：已存在且大小同源文件的 high / 已存在的 standard 会被跳过，方便断点续传。
"""
from __future__ import annotations

import os
import sys
import tempfile

import boto3
import imageio_ffmpeg
import subprocess

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
    fd, tmp = tempfile.mkstemp(suffix=".m4a", prefix="std-")
    os.close(fd)
    cmd = [
        FFMPEG, "-y", "-i", src,
        "-vn", "-ac", "1", "-ar", "44100",
        "-c:a", "aac", "-b:a", "72k",
        "-movflags", "+faststart",
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


def upload(client, path: str, key: str) -> None:
    client.upload_file(
        path, BUCKET, key,
        ExtraArgs={"ContentType": "audio/mp4"},
    )


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    env = load_env(ENV_FILE)
    client = make_client(env)

    files = sorted(f for f in os.listdir(AUDIO_DIR) if f.endswith(".m4a"))
    if limit:
        files = files[:limit]

    total = len(files)
    ok_high = ok_std = skip_high = skip_std = fail = 0

    for i, fname in enumerate(files, 1):
        slug = fname[:-4]
        src = os.path.join(AUDIO_DIR, fname)
        src_size = os.path.getsize(src)
        high_key = f"v1/high/{fname}"
        std_key = f"v1/standard/{fname}"

        try:
            if remote_size(client, high_key) == src_size:
                skip_high += 1
            else:
                upload(client, src, high_key)
                ok_high += 1

            std_remote = remote_size(client, std_key)
            if std_remote is not None:
                skip_std += 1
            else:
                tmp = transcode_standard(src)
                try:
                    upload(client, tmp, std_key)
                    ok_std += 1
                finally:
                    os.unlink(tmp)

            print(f"[{i}/{total}] {slug}: ok")
        except Exception as exc:
            fail += 1
            print(f"[{i}/{total}] {slug}: FAIL {exc}")

    print(f"\n完成 high(新传{ok_high}/跳过{skip_high}) standard(新传{ok_std}/跳过{skip_std}) 失败{fail}")


if __name__ == "__main__":
    main()
