# -*- coding: utf-8 -*-
"""把 json3 字幕转成逐句双语 JSON，缺中文的用机译补齐，最后生成 manifest
用法: python vtt2json.py [--limit N] [--no-translate]
"""
import argparse, json, os, re, subprocess, tempfile

import imageio_ffmpeg
from offline_translate import OfflineTranslator, TranslationError
from data_io import write_talk

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORPUS = os.path.join(HERE, "corpus")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
DATA_DIR = os.path.join(ROOT, "public", "data")
CACHE_PATH = os.path.join(CORPUS, "trans_cache.json")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MEDIA_BASE_URL = os.environ.get(
    "MEDIA_BASE_URL",
    "https://daily-listening-media.if5v.workers.dev",
).rstrip("/")
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")

def load_cache():
    if os.path.exists(CACHE_PATH):
        return json.load(open(CACHE_PATH, encoding="utf-8"))
    return {}


def save_cache(c):
    handle, temp_path = tempfile.mkstemp(prefix=".dtl-cache-", suffix=".json", dir=CORPUS)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as f:
            json.dump(c, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        os.replace(temp_path, CACHE_PATH)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def parse_json3(path):
    """json3 -> [{start,end,text}]（秒）"""
    d = json.load(open(path, encoding="utf-8"))
    cues = []
    for ev in d.get("events", []):
        if "segs" not in ev:
            continue
        text = "".join(s.get("utf8", "") for s in ev["segs"])
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"[\n\r]+", " ", text).strip()
        if not text:
            continue
        start = ev.get("tStartMs", 0) / 1000.0
        dur = ev.get("dDurationMs", 2000) / 1000.0
        cues.append({"start": round(start, 2), "end": round(start + dur, 2), "text": text})
    return cues


SENT_END = re.compile(r"[.!?。？！]\s*[\"')\]]*\s*$")


def clean(text: str) -> str:
    """去除自动字幕的滚动重复词（to to to）"""
    words = text.split()
    out = []
    for w in words:
        if out and w == out[-1] and len(out) >= 1 and w.lower() == out[-1].lower():
            continue
        out.append(w)
    return " ".join(out)


def merge_sentences(cues):
    """把碎字幕合并为 40~220 字符 / 12 秒内的句子"""
    sents, cur, cur_start = [], [], None

    def flush(end):
        text = clean(" ".join(x["text"] for x in cur))
        if text:
            sents.append({"start": cur_start, "end": end, "text": text})

    for c in cues:
        if cur_start is None:
            cur_start = c["start"]
        cur.append(c)
        text = " ".join(x["text"] for x in cur)
        end_punct = bool(SENT_END.search(c["text"]))
        long_enough = len(text) >= 40
        too_long = len(text) >= 220 or (c["end"] - cur_start) >= 12
        if (end_punct and long_enough) or too_long:
            flush(c["end"])
            cur, cur_start = [], None
    if cur:
        flush(cur[-1]["end"])
    return sents


def align_zh(en_sents, zh_cues):
    """按时间重叠把中文原始字幕行对齐到英文句（中文不合并，避免滚动字幕错位）"""
    out = []
    for s in en_sents:
        span = s["end"] - s["start"]
        parts = []
        for z in zh_cues:
            zh_span = max(0.01, z["end"] - z["start"])
            overlap = min(s["end"], z["end"]) - max(s["start"], z["start"])
            if span > 0 and overlap > 0.2 * min(span, zh_span):
                if not parts or z["text"] != parts[-1]:
                    parts.append(z["text"])
        out.append(" ".join(parts).strip())
    return out


def translate_batch(texts, cache):
    """只缓存有效翻译；任一空值都会阻断构建。"""
    normalized_cache = {key: str(value).strip() for key, value in cache.items() if str(value).strip()}
    cache.clear()
    cache.update(normalized_cache)
    missing = list(dict.fromkeys(text for text in texts if text not in cache))
    if missing:
        translated = OfflineTranslator().translate(missing)
        if len(translated) != len(missing) or any(not value.strip() for value in translated):
            raise TranslationError("翻译结果存在空值或数量错位")
        cache.update(zip(missing, translated))
        save_cache(cache)
    result = [cache.get(text, "").strip() for text in texts]
    if any(not value for value in result):
        raise TranslationError("翻译完成后仍存在空值")
    return result


def find_file(slug, want_lang):
    candidates = []
    priorities = (
        [".zh-Hans.", ".zh-CN.", ".zh.", ".zh-Hant.", ".zh-TW."]
        if want_lang == "zh"
        else [".en.", ".en-US.", ".en-GB.", ".en-orig."]
    )
    for f in sorted(os.listdir(SUBS_DIR)):
        if not (f.startswith(slug + ".") and f.endswith(".json3")):
            continue
        for rank, marker in enumerate(priorities):
            if marker in f:
                candidates.append((rank, f))
                break
    return os.path.join(SUBS_DIR, min(candidates)[1]) if candidates else None


def probe_audio_duration(slug):
    path = os.path.join(ROOT, "public", "audio", slug + ".m4a")
    if not os.path.exists(path):
        raise RuntimeError(f"缺少音频：{path}")
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=30,
    )
    match = DURATION_RE.search(result.stderr)
    if not match:
        raise RuntimeError(f"无法读取音频时长：{path}")
    hours, minutes, seconds = match.groups()
    return round(int(hours) * 3600 + int(minutes) * 60 + float(seconds), 2)


def yt_thumb(url):
    """从 YouTube 视频 URL 提取封面地址"""
    m = re.search(r"(?:v=|youtu\.be/|watch\?v=)([\w-]{11})", url or "")
    if m:
        return f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg"
    return ""


def build_entry(resolved_map, slug, cache):
    en_path = find_file(slug, "en")
    if not en_path:
        return None
    meta = json.load(open(os.path.join(SUBS_DIR, slug + ".info.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(SUBS_DIR, slug + ".info.json")) else {}
    en_sents = merge_sentences(parse_json3(en_path))

    # —— 音源/文字稿一致性校验：字幕覆盖率须 ≥ 85%（尾部掌声/问答无字幕属正常，
    #    更大缺口则判定为错配视频，拒绝入库）——
    expect = probe_audio_duration(slug)
    subs_end = en_sents[-1]["end"] if en_sents else 0
    if expect and subs_end and subs_end < expect * 0.85:
        print(f"    !! MISMATCH subs_end={subs_end:.0f}s expect={expect:.0f}s —— 跳过，需人工核对视频", flush=True)
        return None
    zh_path = find_file(slug, "zh")
    zh_source = "official"
    zh_list = []
    if zh_path:
        zh_cues = parse_json3(zh_path)
        zh_list = align_zh(en_sents, zh_cues)
        if sum(1 for z in zh_list if z) < len(en_sents) * 0.3:
            zh_list = []  # 中文字幕覆盖太少，弃用
    if not zh_list:
        zh_source = "mt"
        zh_list = translate_batch([s["text"] for s in en_sents], cache)
    elif any(not value.strip() for value in zh_list):
        missing_indexes = [index for index, value in enumerate(zh_list) if not value.strip()]
        missing_values = translate_batch([en_sents[index]["text"] for index in missing_indexes], cache)
        for index, value in zip(missing_indexes, missing_values):
            zh_list[index] = value
        zh_source = "mixed"

    r = resolved_map.get(slug, {})
    local_cover = os.path.join(ROOT, "public", "covers", slug + ".jpg")
    cover = f"/covers/{slug}.jpg" if os.path.exists(local_cover) else (meta.get("thumbnail", "") or yt_thumb(r.get("url", "")))
    sentences = [{"i": idx, "start": s["start"], "end": s["end"],
                  "en": s["text"], "zh": zh_list[idx] if idx < len(zh_list) else ""}
                 for idx, s in enumerate(en_sents)]
    data = {
        "slug": slug,
        "title": meta.get("title") or r.get("title", slug),
        "speaker": r.get("speaker", ""),
        "category": r.get("category", "ted"),
        "school": r.get("school"),
        "year": r.get("year"),
        "duration": expect,
        "cover": cover,
        "views": r.get("views"),
        "sourceUrl": r.get("url"),
        "audioUrls": {
            "standard": f"{MEDIA_BASE_URL}/v1/standard/{slug}.m4a",
            "high": f"{MEDIA_BASE_URL}/v1/high/{slug}.m4a",
        },
        "zhSource": zh_source,
        "sentences": sentences,
    }
    out = os.path.join(DATA_DIR, slug + ".json")
    write_talk(out, data)
    return {k: data[k] for k in
            ("slug", "title", "speaker", "category", "school", "year", "duration", "cover", "views", "audioUrls", "zhSource")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true", help="忽略已有产物全量重生成")
    args = ap.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    resolved_map = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}
    state_path = os.path.join(CORPUS, "fetch_state.json")
    state = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}
    # 以抓取状态表中字幕成功的条目为准，且确实存在英文字幕文件
    slugs = sorted(s for s, v in state.items()
                   if v.get("subs") and find_file(s, "en"))
    if args.limit:
        slugs = slugs[:args.limit]
    cache = load_cache()

    manifest = []
    failures = []
    for i, slug in enumerate(slugs, 1):
        print(f"[{i}/{len(slugs)}] {slug}", flush=True)
        try:
            path = os.path.join(DATA_DIR, slug + ".json")
            if os.path.exists(path) and not args.force:
                d = json.load(open(path, encoding="utf-8"))
                source_changed = d.get("sourceUrl") != (resolved_map.get(slug) or {}).get("url")
                if source_changed or not d.get("sentences") or any(not str(s.get("zh", "")).strip() for s in d["sentences"]):
                    entry = build_entry(resolved_map, slug, cache)
                else:
                    entry = {k: d.get(k) for k in
                             ("slug", "title", "speaker", "category", "school", "year",
                              "duration", "cover", "views", "audioUrls", "zhSource")}
            else:
                entry = build_entry(resolved_map, slug, cache)
            if not entry:
                raise RuntimeError("未生成数据")
            manifest.append(entry)
        except Exception as error:
            failures.append((slug, str(error)))
            print(f"    FAILED: {error}", flush=True)
    if failures:
        print("\n构建失败，拒绝写入 manifest：")
        for slug, error in failures:
            print(f"  {slug}: {error}")
        raise SystemExit(1)
    # 排序：TED 按播放量，毕业演讲在后
    manifest.sort(key=lambda e: (0 if e["category"] == "ted" else 1, -(e.get("views") or 0)))
    with open(os.path.join(DATA_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    print(f"\nmanifest: {len(manifest)} talks")


if __name__ == "__main__":
    main()
