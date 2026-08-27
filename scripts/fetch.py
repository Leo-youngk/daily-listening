# -*- coding: utf-8 -*-
"""按 resolved.json 下载音频 + json3 字幕 + 元信息，支持断点续抓
用法:
  python fetch.py                  # 全部
  python fetch.py --limit 10       # 只抓前 10 个（冒烟）
  python fetch.py --category ted   # 只抓 TED
  python fetch.py --subs-only      # 只补字幕不碰音频
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORPUS = os.path.join(HERE, "corpus")
RESOLVED = os.path.join(CORPUS, "resolved.json")
STATE = os.path.join(CORPUS, "fetch_state.json")
AUDIO_DIR = os.path.join(ROOT, "public", "audio")
SUBS_DIR = os.path.join(ROOT, "public", "subs")

YT = [sys.executable, "-m", "yt_dlp", "--no-warnings"]


def load_state():
    if os.path.exists(STATE):
        return json.load(open(STATE, encoding="utf-8"))
    return {}


def save_state(st):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)


def run(cmd, timeout=900):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return r.returncode == 0, (r.stderr or "")[-800:]


def download_audio(entry) -> bool:
    out = os.path.join(AUDIO_DIR, f"{entry['slug']}.m4a")
    if os.path.exists(out) and os.path.getsize(out) > 100_000:
        return True
    tmp = os.path.join(AUDIO_DIR, f"{entry['slug']}.%(ext)s")
    cmd = YT + ["-f", "bestaudio[ext=m4a]/bestaudio", "-o", tmp, "--no-playlist",
                "--no-overwrites", "--retries", "3", entry["url"]]
    ok, err = run(cmd, timeout=1800)
    if not ok:
        print(f"    audio fail: {err}", flush=True)
        return False
    # 若下载成了 webm（iOS 不支持），标记失败
    webm = os.path.join(AUDIO_DIR, f"{entry['slug']}.webm")
    if os.path.exists(webm):
        print("    WARN: webm audio (iOS 不支持), 需 ffmpeg 转码", flush=True)
    return os.path.exists(out) and os.path.getsize(out) > 100_000


def download_subs(entry) -> bool:
    prefix = os.path.join(SUBS_DIR, entry["slug"])
    # 已有任意英文字幕则跳过
    has_en = any(f.startswith(entry["slug"] + ".") and ".en" in f and f.endswith(".json3")
                 for f in os.listdir(SUBS_DIR))
    if has_en:
        return True
    cmd = YT + ["--skip-download", "--write-subs", "--write-auto-subs",
                "--sub-langs", "en,en-orig,zh-Hans,zh-CN,zh-Hant,zh-TW",
                "--sub-format", "json3",
                "--sleep-requests", "1.5", "--sleep-subtitles", "1",
                "--extractor-retries", "3", "--retry-sleep", "8",
                "--write-info-json", "-o", prefix, "--no-playlist", entry["url"]]
    ok, err = run(cmd, timeout=600)
    if not ok:
        # 部分轨道失败但英文字幕已落地也算成功
        has_en = any(f.startswith(entry["slug"] + ".") and ".en" in f and f.endswith(".json3")
                     for f in os.listdir(SUBS_DIR))
        if has_en:
            return True
        print(f"    subs fail: {err}", flush=True)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--category", default="")
    ap.add_argument("--subs-only", action="store_true")
    args = ap.parse_args()

    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(SUBS_DIR, exist_ok=True)
    entries = json.load(open(RESOLVED, encoding="utf-8"))
    if args.category:
        entries = [e for e in entries if e["category"] == args.category]
    if args.limit:
        entries = entries[:args.limit]

    state = load_state()
    total = len(entries)
    for i, e in enumerate(entries, 1):
        slug = e["slug"]
        st = state.get(slug, {})
        need_audio = not args.subs_only and not st.get("audio")
        need_subs = not st.get("subs")
        if not need_audio and not need_subs:
            continue
        print(f"[{i}/{total}] {slug}", flush=True)
        ok_audio = st.get("audio", False)
        if need_audio:
            ok_audio = download_audio(e)
        ok_subs = st.get("subs", False)
        if need_subs:
            ok_subs = download_subs(e)
        state[slug] = {"audio": bool(ok_audio), "subs": bool(ok_subs), "ts": int(time.time())}
        save_state(state)
        print(f"    audio={'ok' if ok_audio else 'FAIL'} subs={'ok' if ok_subs else 'FAIL'}", flush=True)
        time.sleep(4)  # 限速缓冲，避免被 YouTube 429

    done = sum(1 for v in state.values() if v.get("audio") and v.get("subs"))
    print(f"\nfinished: {done}/{len(state)} complete")


if __name__ == "__main__":
    main()
