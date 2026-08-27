# -*- coding: utf-8 -*-
"""部署前处理：把 dist/audio 全量重编码为 48kbps 单声道 AAC（+faststart），
起播缓冲、切句、拖动都只需原来 1/3 的流量；人声内容听感几乎无损失。

- 仅处理 app/dist/audio；源素材 public/audio 保持高音质不变
- 可重入：码率已 <= TARGET+4 kbps 的文件自动跳过
- 并行转码；顺带确保所有文件 <= Cloudflare Pages 单文件 25MiB 限制
"""
import json, os, struct, subprocess, sys
from concurrent.futures import ProcessPoolExecutor, as_completed

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DIST_AUDIO = os.path.join(ROOT, "app", "dist", "audio")
MANIFEST = os.path.join(ROOT, "app", "dist", "data", "manifest.json")
TARGET_KBPS = 48
WORKERS = int(sys.argv[1]) if len(sys.argv) > 1 else 4


def est_kbps(path, dur):
    if not dur:
        return 999
    return os.path.getsize(path) * 8 / dur / 1000


def transcode(args):
    f, path, dur = args
    tmp = path + ".tmp.m4a"
    cmd = [FFMPEG, "-y", "-i", path, "-vn", "-ac", "1", "-c:a", "aac",
           "-b:a", f"{TARGET_KBPS}k", "-movflags", "+faststart", tmp]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not os.path.exists(tmp):
        return f, "fail", (r.stderr or "")[-150:]
    old = os.path.getsize(path)
    os.replace(tmp, path)
    new = os.path.getsize(path)
    return f, "ok", f"{old/1e6:.1f}MB -> {new/1e6:.1f}MB"


def main():
    manifest = {e["slug"]: e for e in json.load(open(MANIFEST, encoding="utf-8"))}
    tasks = []
    skipped = 0
    for f in sorted(os.listdir(DIST_AUDIO)):
        if not f.endswith(".m4a"):
            continue
        path = os.path.join(DIST_AUDIO, f)
        dur = (manifest.get(f[:-4]) or {}).get("duration") or 0
        if est_kbps(path, dur) <= TARGET_KBPS + 4:
            skipped += 1
            continue
        tasks.append((f, path, dur))
    print(f"待转码 {len(tasks)}，跳过（已是低码率）{skipped}，并行 {WORKERS}")
    ok = fail = 0
    with ProcessPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(transcode, t) for t in tasks]
        for i, fut in enumerate(as_completed(futs), 1):
            f, status, info = fut.result()
            if status == "ok":
                ok += 1
            else:
                fail += 1
            print(f"[{i}/{len(tasks)}] {f}: {status} {info}")
    # 仍超 25MiB 的超长篇（如 2 小时演讲）：降到 28kbps 硬压进限制内
    for f in sorted(os.listdir(DIST_AUDIO)):
        if not f.endswith(".m4a"):
            continue
        path = os.path.join(DIST_AUDIO, f)
        if os.path.getsize(path) <= 25 * 1024 * 1024:
            continue
        tmp = path + ".tmp.m4a"
        cmd = [FFMPEG, "-y", "-i", path, "-vn", "-ac", "1", "-c:a", "aac",
               "-b:a", "28k", "-movflags", "+faststart", tmp]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode == 0 and os.path.exists(tmp):
            os.replace(tmp, path)
            print(f"[超长篇] {f}: 降至 28kbps -> {os.path.getsize(path)/1e6:.1f}MB")
        else:
            print(f"[超长篇] {f}: 压缩失败")
    over = [f for f in os.listdir(DIST_AUDIO)
            if f.endswith(".m4a") and os.path.getsize(os.path.join(DIST_AUDIO, f)) > 25 * 1024 * 1024]
    total = sum(os.path.getsize(os.path.join(DIST_AUDIO, f))
                for f in os.listdir(DIST_AUDIO) if f.endswith(".m4a"))
    print(f"\n完成: {ok} 成功, {fail} 失败, 总计 {total/1e9:.2f}GB")
    print("still over 25MiB:", over or "NONE")


if __name__ == "__main__":
    main()
