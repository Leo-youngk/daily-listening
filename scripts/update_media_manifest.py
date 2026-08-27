# -*- coding: utf-8 -*-
"""以真实音频时长和版本化 R2 URL 更新每篇数据及 manifest。"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "public", "data")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
MANIFEST_FIELDS = (
    "slug", "title", "speaker", "category", "school", "year", "duration",
    "cover", "views", "audioUrls", "zhSource",
)


def write_json_atomic(path: str, value, *, compact: bool) -> None:
    handle, temp_path = tempfile.mkstemp(prefix=".dtl-", suffix=".json", dir=os.path.dirname(path))
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
            json.dump(
                value,
                file,
                ensure_ascii=False,
                separators=(",", ":") if compact else None,
            )
            file.write("\n")
        os.replace(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def audio_duration(path: str) -> float:
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    match = DURATION_RE.search(result.stderr)
    if not match:
        raise RuntimeError(f"无法读取音频时长：{path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--media-base-url",
        default="https://daily-listening-media.if5v.workers.dev",
    )
    args = parser.parse_args()
    base = args.media_base_url.rstrip("/")
    if not base.startswith("https://"):
        raise SystemExit("media-base-url 必须为 HTTPS")

    files = [
        name for name in sorted(os.listdir(DATA_DIR))
        if name.endswith(".json") and name != "manifest.json"
    ]
    with open(os.path.join(HERE, "corpus", "resolved.json"), encoding="utf-8") as file:
        resolved = {item["slug"]: item for item in json.load(file)}
    manifest = []
    coverage_warnings: list[tuple[str, float, float, float]] = []
    for index, name in enumerate(files, 1):
        path = os.path.join(DATA_DIR, name)
        with open(path, encoding="utf-8") as file:
            data = json.load(file)
        slug = data.get("slug") or name[:-5]
        audio_path = os.path.join(AUDIO_DIR, f"{slug}.m4a")
        if not os.path.exists(audio_path):
            raise RuntimeError(f"缺少源音频：{audio_path}")
        duration = round(audio_duration(audio_path), 2)
        data["duration"] = duration
        data["audioUrls"] = {
            "standard": f"{base}/v1/standard/{slug}.m4a",
            "high": f"{base}/v1/high/{slug}.m4a",
        }
        data["sourceUrl"] = (resolved.get(slug) or {}).get("url")
        data.pop("audioUrl", None)
        cover = str(data.get("cover") or "")
        if cover and not cover.startswith(("/", "https://")):
            data["cover"] = f"/{cover}"

        sentences = data.get("sentences") or []
        subtitle_end = float(sentences[-1]["end"]) if sentences else 0
        coverage = subtitle_end / duration if duration else 0
        if coverage < 0.85:
            coverage_warnings.append((slug, coverage, subtitle_end, duration))

        write_json_atomic(path, data, compact=True)
        manifest.append({key: data.get(key) for key in MANIFEST_FIELDS})
        if index % 25 == 0 or index == len(files):
            print(f"更新 {index}/{len(files)}", flush=True)

    manifest.sort(key=lambda item: (
        0 if item["category"] == "ted" else 1,
        -(item.get("views") or 0),
    ))
    write_json_atomic(os.path.join(DATA_DIR, "manifest.json"), manifest, compact=False)
    print(f"manifest: {len(manifest)} 篇")
    if coverage_warnings:
        print("字幕覆盖低于 85%（需逐项核验尾部是否为掌声/问答）：")
        for slug, coverage, subtitle_end, duration in coverage_warnings:
            print(f"  {slug}: {coverage:.1%} ({subtitle_end:.1f}/{duration:.1f}s)")


if __name__ == "__main__":
    main()
