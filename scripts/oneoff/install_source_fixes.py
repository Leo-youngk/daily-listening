# -*- coding: utf-8 -*-
"""安装已验证的正确音源；旧错配素材移动到可恢复的隔离目录。"""
from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PUBLIC = os.path.join(ROOT, "public")
SOURCE_DIR = os.path.join(ROOT, "media-build", "source-fixes")
QUARANTINE = os.path.join(ROOT, "media-build", "quarantine")
CORPUS = os.path.join(HERE, "corpus")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

OLD_JOSEPH = "joseph-brodsky-commencement"
DEREK = "derek_sivers_how_to_start_a_movement"
DAVID = "david-mccullough-wellesley-high-2012"
DEREK_TRIM_START = 15.5
DEREK_TRIM_END = 175.0


def write_json_atomic(path: str, value, *, indent: int | None = None) -> None:
    handle, temp_path = tempfile.mkstemp(prefix=".dtl-", suffix=".json", dir=os.path.dirname(path))
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
            json.dump(value, file, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
            file.write("\n")
        os.replace(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def require(path: str) -> str:
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise RuntimeError(f"缺少已验证替换文件：{path}")
    return path


def quarantine_slug(slug: str) -> None:
    # 数据 JSON 是一条语料是否已完成隔离的提交标记。脚本可能在后续封面下载处
    # 中断；此时再次运行不能把刚安装的新音频覆盖回隔离目录。
    if not os.path.exists(os.path.join(PUBLIC, "data", slug + ".json")):
        return
    target = os.path.join(QUARANTINE, slug)
    os.makedirs(target, exist_ok=True)
    paths = [
        os.path.join(PUBLIC, "audio", slug + ".m4a"),
        os.path.join(PUBLIC, "data", slug + ".json"),
        os.path.join(PUBLIC, "covers", slug + ".jpg"),
    ]
    paths.extend(glob.glob(os.path.join(PUBLIC, "subs", slug + ".*")))
    for path in paths:
        if os.path.exists(path):
            destination = os.path.join(target, os.path.basename(path))
            if os.path.exists(destination):
                os.unlink(destination)
            shutil.move(path, destination)


def trim_derek_audio() -> str:
    source = require(os.path.join(SOURCE_DIR, DEREK + ".m4a"))
    output = os.path.join(SOURCE_DIR, DEREK + ".trimmed.m4a")
    result = subprocess.run(
        [
            FFMPEG, "-y", "-ss", str(DEREK_TRIM_START), "-i", source,
            "-t", str(DEREK_TRIM_END - DEREK_TRIM_START), "-vn", "-c:a", "aac",
            "-b:a", "128k", "-movflags", "+faststart", output,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    if result.returncode != 0 or not os.path.exists(output):
        raise RuntimeError(f"Derek 音频裁切失败：{result.stderr[-400:]}")
    return output


def shifted_derek_subtitle() -> str:
    source = require(os.path.join(SOURCE_DIR, DEREK + ".en.json3"))
    with open(source, encoding="utf-8") as file:
        data = json.load(file)
    shift_ms = round(DEREK_TRIM_START * 1000)
    events = []
    for event in data.get("events", []):
        start = int(event.get("tStartMs", 0)) - shift_ms
        if start < 0:
            continue
        copied = dict(event)
        copied["tStartMs"] = start
        events.append(copied)
    data["events"] = events
    output = os.path.join(SOURCE_DIR, DEREK + ".shifted.en.json3")
    write_json_atomic(output, data)
    return output


def download_cover(slug: str) -> None:
    info_path = require(os.path.join(SOURCE_DIR, slug + ".info.json"))
    with open(info_path, encoding="utf-8") as file:
        info = json.load(file)
    candidates = [item.get("url") for item in reversed(info.get("thumbnails") or []) if item.get("url")]
    if info.get("thumbnail"):
        candidates.append(info["thumbnail"])
    if not candidates:
        raise RuntimeError(f"没有封面地址：{slug}")
    payload = None
    last_error = None
    for url in candidates:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                candidate = response.read()
            if len(candidate) >= 10_000:
                payload = candidate
                break
        except Exception as error:
            last_error = error
    if payload is None:
        raise RuntimeError(f"所有封面地址均不可用：{slug} ({last_error})")
    destination = os.path.join(PUBLIC, "covers", slug + ".jpg")
    with open(destination, "wb") as file:
        file.write(payload)


def update_corpus() -> dict[str, dict]:
    resolved_path = os.path.join(CORPUS, "resolved.json")
    with open(resolved_path, encoding="utf-8") as file:
        resolved = json.load(file)
    david_entry = {
        "slug": DAVID,
        "category": "commencement",
        "title": "You Are Not Special",
        "speaker": "David McCullough Jr.",
        "school": "Wellesley High School",
        "year": 2012,
        "views": None,
        "url": "https://www.youtube.com/watch?v=_lfxYhtf8o4",
        "video_title": "You Are Not Special Commencement Speech from Wellesley High School",
        "channel": "Wellesley Public Media",
        "duration": 765,
        "match_score": 1.0,
    }
    found_joseph = False
    for index, item in enumerate(resolved):
        if item["slug"] == DEREK:
            item.update({
                "url": "https://www.youtube.com/watch?v=V74AxCqOTvg",
                "video_title": "How to start a movement | Derek Sivers",
                "channel": "TED",
                "duration": DEREK_TRIM_END - DEREK_TRIM_START,
                "match_score": 1.0,
            })
        elif item["slug"] == OLD_JOSEPH:
            resolved[index] = david_entry
            found_joseph = True
    if not found_joseph and not any(item["slug"] == DAVID for item in resolved):
        raise RuntimeError("resolved.json 中未找到需替换的 Joseph Brodsky 条目")
    write_json_atomic(resolved_path, resolved, indent=2)

    state_path = os.path.join(CORPUS, "fetch_state.json")
    with open(state_path, encoding="utf-8") as file:
        state = json.load(file)
    state.pop(OLD_JOSEPH, None)
    state[DEREK] = {"audio": True, "subs": True}
    state[DAVID] = {"audio": True, "subs": True}
    write_json_atomic(state_path, state, indent=2)
    return {item["slug"]: item for item in resolved}


def install() -> None:
    david_audio = require(os.path.join(SOURCE_DIR, DAVID + ".m4a"))
    david_subtitle = require(os.path.join(SOURCE_DIR, DAVID + ".en-orig.json3"))
    david_info = require(os.path.join(SOURCE_DIR, DAVID + ".info.json"))
    derek_info = require(os.path.join(SOURCE_DIR, DEREK + ".info.json"))
    derek_audio = trim_derek_audio()
    derek_subtitle = shifted_derek_subtitle()

    quarantine_slug(DEREK)
    quarantine_slug(OLD_JOSEPH)
    for slug, audio, subtitle, info, subtitle_name in [
        (DEREK, derek_audio, derek_subtitle, derek_info, DEREK + ".en.json3"),
        (DAVID, david_audio, david_subtitle, david_info, DAVID + ".en-orig.json3"),
    ]:
        shutil.copy2(audio, os.path.join(PUBLIC, "audio", slug + ".m4a"))
        shutil.copy2(subtitle, os.path.join(PUBLIC, "subs", subtitle_name))
        shutil.copy2(info, os.path.join(PUBLIC, "subs", slug + ".info.json"))
        download_cover(slug)

    resolved_map = update_corpus()
    sys.path.insert(0, HERE)
    from vtt2json import build_entry, load_cache
    cache = load_cache()
    for slug in (DEREK, DAVID):
        if not build_entry(resolved_map, slug, cache):
            raise RuntimeError(f"替换后数据生成失败：{slug}")
    print("已安装 2 个正确来源；旧错配素材已移动到 media-build/quarantine。")


if __name__ == "__main__":
    install()
