# -*- coding: utf-8 -*-
"""「精选」频道：用户点名的 10 期长播客（与三档常规节目分开抓，清单固定写在下面）。

每期：音频 -> m4a（AAC 128k）-> 文字稿 -> 强制对齐（json3 + ASR 词序列）-> 封面 -> 写进 episodes.json。
文字稿三种来源：
- newsdaily：E:\\newsdaily 抓好的官方逐字稿。那边的正文前面拼了一段 AI 生成的中文导读和英文摘要，
  只取「【完整原文文稿】」之后的部分；再去掉说话人标签、(SOUNDBITE ...) 这类舞台提示、时间戳。
  音频里的广告在官方稿里没有，对齐时会被跳过。
- tal：This American Life 官网文字稿页，逐段 <p begin> 很干净。
- asr：没有官方稿（YouTube 访谈、Diary of a CEO），用 Whisper large-v3-turbo 转写出带标点的文字稿，
  同一份词时间轴直接作为对齐用的 ASR 序列。
YouTube 音频按 SponsorBlock 标注的赞助段剪掉（yt-dlp 自带的剪切需要 ffprobe，这里自己用 ffmpeg 剪）。

断点续跑：已入库（ingest_state.json 里 ok）的跳过。
用法：python ingest_featured.py [--only slug1,slug2]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

from bs4 import BeautifulSoup

from align import align_to_file, chunk_bounds, enable_cuda, norm_words, SAMPLE_RATE
from ingest import (AUDIO_DIR, COVERS_DIR, EPISODES, FFMPEG, STATE, SUBS_DIR, TRANSCRIPTS, load_json,
                    probe_duration, save_json)
from sources.common import fetch_bytes, fetch_text, item_image, rss_items

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORK = os.path.join(ROOT, "media-build", "featured")
NEWSDAILY = r"E:\newsdaily\etl\out\detail"
SERIES = "featured"
ASR_MODEL = "large-v3-turbo"
MIN_MATCH_RATIO = 0.85

FEEDS = {
    "hiddenbrain": "https://feeds.simplecast.com/kwWc0lhf",
    "freakonomics": "https://feeds.simplecast.com/Y8lFbOT4",
    "econtalk": "https://feeds.simplecast.com/wgl4xEgL",
    "doac": "https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn",
}

# audio: ("rss", feed, 精确标题) / ("url", mp3 地址) / ("youtube", 视频 id)
# text: ("newsdaily", 文件名, 去标签规则) / ("tal", 期号) / ("asr",)
EPISODES_LIST = [
    {"slug": "featured_hb_feelings", "title": "How Feelings Make Us Smarter", "show": "Hidden Brain",
     "speaker": "Shankar Vedantam", "date": "2026-08-10",
     "source_url": "https://www.hiddenbrain.org/podcast/how-feelings-make-us-smarter/",
     "audio": ("rss", "hiddenbrain", "How Feelings Make Us Smarter"),
     "text": ("newsdaily", "063382b1c27e49ff265131b42ed22797", "hiddenbrain")},
    {"slug": "featured_hb_tunnel", "title": "You 2.0: Tunnel Vision", "show": "Hidden Brain",
     "speaker": "Shankar Vedantam", "date": "2019-08-05",
     "source_url": "https://www.hiddenbrain.org/podcast/you-2-0-tunnel-vision/",
     "audio": ("rss", "hiddenbrain", "You 2.0: Tunnel Vision"),
     "text": ("newsdaily", "a0d501a0714bd1e6eed0cef22b3af08b", "hiddenbrain")},
    {"slug": "featured_fk_quitting", "title": "The Upside of Quitting", "show": "Freakonomics Radio",
     "speaker": "Stephen Dubner", "date": "2014-05-29",
     "source_url": "https://freakonomics.com/podcast/the-upside-of-quitting-rebroadcast/",
     "audio": ("rss", "freakonomics", "The Upside of Quitting (Rebroadcast )"),
     "text": ("newsdaily", "7630f538266a5ab4870cafe59fb214ba", "freakonomics")},
    {"slug": "featured_ec_phone", "title": "Can a Phone Be a Cow? (with Philip Auerswald)", "show": "EconTalk",
     "speaker": "Russ Roberts", "date": "2026-06-22",
     "source_url": "https://www.econtalk.org/can-a-phone-be-a-cow-with-philip-auerswald",
     "audio": ("rss", "econtalk", "Can a Phone Be a Cow? (with Philip Auerswald)"),
     "text": ("newsdaily", "e3ccc4937135d4b5f15503f56d9a0289", "econtalk")},
    {"slug": "featured_tal_355", "title": "The Giant Pool of Money", "show": "This American Life",
     "speaker": "Ira Glass", "date": "2008-05-09",
     "source_url": "https://www.thisamericanlife.org/355/the-giant-pool-of-money",
     "cover": "https://www.thisamericanlife.org/sites/default/files/episodes/images/355_social.jpg",
     "audio": ("tal", 355), "text": ("tal", 355)},
    {"slug": "featured_tal_624", "title": "Private Geography", "show": "This American Life",
     "speaker": "Ira Glass", "date": "2017-09-01",
     "source_url": "https://www.thisamericanlife.org/624/private-geography",
     "cover": "https://www.thisamericanlife.org/sites/default/files/episodes/images/624_social.jpg",
     "audio": ("tal", 624), "text": ("tal", 624)},
    {"slug": "featured_naval_44", "title": "44 Harsh Truths About The Game Of Life – Naval Ravikant",
     "show": "Modern Wisdom", "speaker": "Chris Williamson & Naval Ravikant", "date": "2025-03-31",
     "source_url": "https://www.youtube.com/watch?v=KyfUysrNaco",
     "audio": ("youtube", "KyfUysrNaco"), "text": ("asr",)},
    {"slug": "featured_hormozi_ruthless", "title": "Be Ruthless About the Life You Want – Alex Hormozi",
     "show": "Modern Wisdom", "speaker": "Chris Williamson & Alex Hormozi", "date": "2023-08-21",
     "source_url": "https://www.youtube.com/watch?v=M4PzOjM5BJQ",
     "audio": ("youtube", "M4PzOjM5BJQ"), "text": ("asr",)},
    {"slug": "featured_senra_rubin", "title": "Rick Rubin on Finding Your Life's Work", "show": "David Senra",
     "speaker": "David Senra & Rick Rubin", "date": "2026-05-24",
     "source_url": "https://www.youtube.com/watch?v=g6MEDOY7tHo",
     "audio": ("youtube", "g6MEDOY7tHo"), "text": ("asr",)},
    {"slug": "featured_doac_noah", "title": "Trevor Noah: My Depression Was Linked To ADHD! Why I Left The Daily Show!",
     "show": "The Diary Of A CEO", "speaker": "Steven Bartlett & Trevor Noah", "date": "2024-10-17",
     "source_url": "https://www.youtube.com/watch?v=FsztuzyXdhY",
     # YouTube 版能按 SponsorBlock 剪掉赞助口播（RSS 版插着动态广告，转写后会混进字幕）；
     # 这个视频偶尔要求登录验证，重试几次就能下
     "audio": ("youtube", "FsztuzyXdhY"), "text": ("asr",)},
]

# ---------- 音频 ----------

_feed_cache = {}


def rss_item(feed, title):
    if feed not in _feed_cache:
        _feed_cache[feed] = rss_items(FEEDS[feed])
    for item in _feed_cache[feed]:
        if (item.findtext("title") or "").strip() == title:
            return item
    raise RuntimeError(f"{feed} 的 RSS 里找不到《{title}》")


def ffmpeg(args):
    r = subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "ffmpeg failed")[-300:])


def to_m4a(src, dest, audio_filter=None):
    part = dest + ".part.m4a"
    args = ["-i", src, "-vn"]
    if audio_filter:
        args += ["-af", audio_filter]
    ffmpeg(args + ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", part])
    os.replace(part, dest)


def sponsor_filter(video_id):
    """SponsorBlock 标注的赞助、自我推广、订阅提醒、片头片尾段，拼成 ffmpeg 的剪切滤镜。"""
    cats = urllib.request.quote(json.dumps(["sponsor", "selfpromo", "interaction", "intro", "outro"]))
    try:
        segs = json.loads(fetch_text(f"https://sponsor.ajay.app/api/skipSegments?videoID={video_id}&categories={cats}"))
    except RuntimeError as exc:
        # 404 = 没有人标注过；网络失败也只是少剪几段广告，不影响可用性，但要打印出来
        print(f"    !! {video_id} 取 SponsorBlock 失败，按原音频处理：{exc}", flush=True)
        return None, 0
    spans = sorted((s["segment"][0], s["segment"][1]) for s in segs)
    if not spans:
        return None, 0
    expr = "+".join(f"between(t,{a:.2f},{b:.2f})" for a, b in spans)
    return f"aselect='not({expr})',asetpts=N/SR/TB", sum(b - a for a, b in spans)


def fetch_audio(ep, dest):
    kind = ep["audio"][0]
    if kind == "youtube":
        src = os.path.join(WORK, f"yt_{ep['audio'][1]}.m4a")
        if not os.path.exists(src):
            raise RuntimeError(f"缺 YouTube 音频 {src}（先用 yt-dlp 下载）")
        flt, cut = sponsor_filter(ep["audio"][1])
        print(f"    剪掉赞助段 {cut / 60:.1f} 分钟", flush=True)
        to_m4a(src, dest, flt)
        return
    if kind == "rss":
        url = rss_item(ep["audio"][1], ep["audio"][2]).find("enclosure").get("url")
    else:  # tal：音频地址写在节目页里
        page = fetch_text(ep["source_url"])
        m = re.search(r"https://www\.thisamericanlife\.org/sites/default/files/audio/[^\"']+\.mp3", page)
        if not m:
            raise RuntimeError("TAL 页面里找不到 mp3")
        url = m.group(0)
    tmp = os.path.join(WORK, ep["slug"] + ".download")
    with open(tmp, "wb") as f:
        f.write(fetch_bytes(url, timeout=600))
    try:
        to_m4a(tmp, dest)
    finally:
        os.unlink(tmp)


def fetch_cover(ep, dest):
    kind = ep["audio"][0]
    if kind == "youtube":
        src = os.path.join(WORK, f"yt_{ep['audio'][1]}.jpg")
    else:
        url = ep.get("cover") or (item_image(rss_item(ep["audio"][1], ep["audio"][2])) if kind == "rss" else None)
        if not url:
            return
        src = os.path.join(WORK, ep["slug"] + ".img")
        with open(src, "wb") as f:
            f.write(fetch_bytes(url))
    part = dest + ".part.jpg"
    ffmpeg(["-i", src, "-vf", "scale='min(640,iw)':-2", "-q:v", "4", "-frames:v", "1", part])
    os.replace(part, dest)

# ---------- 文字稿 ----------

STAGE = re.compile(r"\((?:SOUNDBITE|MUSIC|LAUGHTER|APPLAUSE|CROSSTALK|BEGIN|END|SOUND)[^)]*\)|\[[^\]]{0,80}\]")
CAPS_LABEL = re.compile(r"(?:\b[A-Z][a-z]+ )?\b[A-Z][A-Z'\-]{2,}(?: [A-Z][A-Z'\-]{2,})?:\s")
TIMESTAMP = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?(?=[A-Z])")
GLUED = re.compile(r"([a-z0-9\"”’)][.!?])([A-Z“\"])")


def clean_newsdaily(text, style, speakers=()):
    marker = "【完整原文文稿】"
    if marker in text:
        text = text.split(marker, 1)[1]
    elif "【" in text:
        raise RuntimeError("newsdaily 文稿带 AI 摘要却没有【完整原文文稿】标记，分不清哪段是原稿")
    text = STAGE.sub(" ", text)
    if style == "econtalk":
        text = TIMESTAMP.sub(" ", text)
        text = re.sub(r"\bIntro\.\s*", " ", text)
        for name in speakers:
            text = text.replace(name + ":", " ")
    text = CAPS_LABEL.sub(" ", text)
    text = GLUED.sub(r"\1 \2", text)
    text = re.sub(r"\*\s*\*\s*\*", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tal_transcript(number):
    html = fetch_text(f"https://www.thisamericanlife.org/{number}/transcript")
    soup = BeautifulSoup(html, "html.parser")
    paras = [re.sub(r"\s+", " ", p.get_text(" ")).strip() for p in soup.select("p[begin]")]
    text = " ".join(p for p in paras if p)
    return STAGE.sub(" ", text)


_asr = None


def asr_transcribe(audio_path):
    """Whisper large-v3-turbo 转写：返回 (带标点的全文, ASR 词序列 [(词, 起, 止)])，按停顿切 4 分钟一段。"""
    global _asr
    from faster_whisper import WhisperModel, decode_audio
    if _asr is None:
        device, compute = ("cuda", "float16") if enable_cuda() else ("cpu", "int8")
        print(f"    [asr] loading {ASR_MODEL} on {device}/{compute}", flush=True)
        _asr = WhisperModel(ASR_MODEL, device=device, compute_type=compute)
    audio = decode_audio(audio_path, sampling_rate=SAMPLE_RATE)
    texts, words = [], []
    for a, b in chunk_bounds(audio):
        offset = a / SAMPLE_RATE
        segments, _ = _asr.transcribe(audio[a:b], language="en", word_timestamps=True, vad_filter=True,
                                      beam_size=1, condition_on_previous_text=False)
        for seg in segments:
            texts.append(seg.text.strip())
            for w in (seg.words or []):
                parts = norm_words(w.word)
                if not parts:
                    continue
                span = max(0.01, w.end - w.start) / len(parts)
                for k, part in enumerate(parts):
                    words.append((part, round(offset + w.start + span * k, 3),
                                  round(offset + w.start + span * (k + 1), 3)))
    del audio
    return re.sub(r"\s+", " ", " ".join(texts)).strip(), words

# ---------- 主流程 ----------


def process(ep, episodes, state):
    slug = ep["slug"]
    audio = os.path.join(AUDIO_DIR, slug + ".m4a")
    if not (os.path.exists(audio) and os.path.getsize(audio) > 50_000):
        print("    音频…", flush=True)
        fetch_audio(ep, audio)
    cover = os.path.join(COVERS_DIR, slug + ".jpg")
    if not os.path.exists(cover):
        try:
            fetch_cover(ep, cover)
        except Exception as exc:
            print(f"    !! 封面失败（列表会显示占位色块）：{exc}", flush=True)
    duration = probe_duration(audio)

    words_path = os.path.join(SUBS_DIR, slug + ".words.json")
    kind = ep["text"][0]
    if kind == "asr":
        text_path = os.path.join(TRANSCRIPTS, slug + ".txt")
        if os.path.exists(text_path) and os.path.exists(words_path):
            text = open(text_path, encoding="utf-8").read()
        else:
            print("    Whisper 转写…", flush=True)
            started = time.time()
            text, words = asr_transcribe(audio)
            with open(words_path, "w", encoding="utf-8") as f:
                json.dump(words, f, separators=(",", ":"))
            print(f"    转写 {duration / 60:.0f} 分钟用了 {time.time() - started:.0f}s，{len(words)} 词", flush=True)
    elif kind == "tal":
        text = tal_transcript(ep["text"][1])
    else:
        raw = json.load(open(os.path.join(NEWSDAILY, ep["text"][1] + ".json"), encoding="utf-8"))["contentText"]
        speakers = ("Russ Roberts", "Philip Auerswald") if ep["text"][2] == "econtalk" else ()
        text = clean_newsdaily(raw, ep["text"][2], speakers)
    with open(os.path.join(TRANSCRIPTS, slug + ".txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")

    print("    对齐…", flush=True)
    ok, ratio = align_to_file(audio, text, os.path.join(SUBS_DIR, slug + ".en.json3"), words_path,
                              min_match_ratio=MIN_MATCH_RATIO)
    if not ok:
        raise RuntimeError(f"对齐匹配率不足 {ratio:.3f}")
    episodes[slug] = {
        "slug": slug, "series": SERIES, "title": ep["title"], "show": ep["show"], "speaker": ep["speaker"],
        "date": ep["date"], "sourceUrl": ep["source_url"], "coverUrl": ep.get("cover"), "keywords": [],
        "duration": duration, "matchScore": round(ratio, 3), "textSource": kind,
    }
    state[slug] = {"series": SERIES, "ok": True, "ts": int(time.time())}
    save_json(EPISODES, episodes)
    save_json(STATE, state)
    return ratio, duration


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}
    os.makedirs(WORK, exist_ok=True)
    episodes = load_json(EPISODES, {})
    state = load_json(STATE, {})
    failed = []
    for i, ep in enumerate(EPISODES_LIST, 1):
        slug = ep["slug"]
        if only and slug not in only:
            continue
        if state.get(slug, {}).get("ok") and slug in episodes:
            print(f"[{i}/10] {slug}: 已入库，跳过", flush=True)
            continue
        print(f"[{i}/10] {slug} · {ep['show']} · {ep['title'][:60]}", flush=True)
        started = time.time()
        try:
            ratio, duration = process(ep, episodes, state)
            print(f"  [ok] match={ratio:.3f} {duration / 60:.0f}min 用时 {time.time() - started:.0f}s", flush=True)
        except Exception as exc:
            failed.append(slug)
            print(f"  [FAIL] {slug}: {exc}", flush=True)
    print(f"\n完成，失败 {len(failed)}：{failed}", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
