# -*- coding: utf-8 -*-
"""把 json3 字幕转成逐句双语 JSON，缺中文的用机译补齐，最后生成 manifest
用法: python vtt2json.py [--limit N] [--no-translate]
"""
import argparse, hashlib, json, os, re, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORPUS = os.path.join(HERE, "corpus")
SUBS_DIR = os.path.join(ROOT, "public", "subs")
DATA_DIR = os.path.join(ROOT, "public", "data")
CACHE_PATH = os.path.join(CORPUS, "trans_cache.json")

translator = None


def get_translator():
    global translator
    if translator is None:
        from deep_translator import GoogleTranslator
        translator = GoogleTranslator(source="en", target="zh-CN")
    return translator


def load_cache():
    if os.path.exists(CACHE_PATH):
        return json.load(open(CACHE_PATH, encoding="utf-8"))
    return {}


def save_cache(c):
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False)


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
        parts = [z["text"] for z in zh_cues
                 if span > 0 and min(s["end"], z["end"]) - max(s["start"], z["start"]) > 0.2 * span]
        out.append(" ".join(parts).strip())
    return out


def translate_batch(texts, cache):
    """批量机译，带缓存。逐条查缓存，未命中按批请求"""
    result = [""] * len(texts)
    todo = []
    for i, t in enumerate(texts):
        key = hashlib.md5(t.encode()).hexdigest()
        if t in cache:
            result[i] = cache[t]
        else:
            todo.append((i, t))
    if todo:
        tr = get_translator()
        BATCH = 25
        for b in range(0, len(todo), BATCH):
            chunk = todo[b:b + BATCH]
            joined = "\n".join(t for _, t in chunk)
            # 接口限 5000 字符，超限逐条翻；单条超限按 400 词切块
            pieces = [(i, t) for i, t in chunk] if len(joined) > 4800 else None
            try:
                if pieces:
                    for i, t in pieces:
                        result[i] = translate_long(tr, t)
                        cache[t] = result[i]
                        time.sleep(0.3)
                else:
                    out = tr.translate(joined)
                    lines = out.split("\n")
                    if len(lines) != len(chunk):  # 行数不一致则逐条重试
                        for i, t in chunk:
                            try:
                                result[i] = tr.translate(t)
                            except Exception:
                                result[i] = ""
                            cache[t] = result[i]
                            time.sleep(0.25)
                    else:
                        for (i, t), line in zip(chunk, lines):
                            result[i] = line.strip()
                            cache[t] = line.strip()
                time.sleep(0.5)
            except Exception as e:
                print(f"    translate error: {e}", flush=True)
                time.sleep(2)
        save_cache(cache)
    return result


def translate_long(tr, text: str) -> str:
    """超长句按约 300 词切块翻译后拼接"""
    words = text.split()
    if len(words) <= 300:
        try:
            return tr.translate(text) or ""
        except Exception:
            return ""
    parts = []
    for i in range(0, len(words), 300):
        chunk = " ".join(words[i:i + 300])
        try:
            parts.append(tr.translate(chunk) or "")
        except Exception:
            parts.append("")
        time.sleep(0.3)
    return "".join(parts)


def find_file(slug, want_lang):
    for f in os.listdir(SUBS_DIR):
        if not (f.startswith(slug + ".") and f.endswith(".json3")):
            continue
        if want_lang == "zh" and ("-Hans" in f or "zh-CN" in f or "zh-Hant" in f or ".zh." in f):
            return os.path.join(SUBS_DIR, f)
        if want_lang == "en" and (".en." in f or ".en-US." in f or ".en-GB." in f or ".en-orig." in f):
            return os.path.join(SUBS_DIR, f)
    return None


def yt_thumb(url):
    """从 YouTube 视频 URL 提取封面地址"""
    m = re.search(r"(?:v=|youtu\.be/|watch\?v=)([\w-]{11})", url or "")
    if m:
        return f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg"
    return ""


def build_entry(resolved_map, slug, cache, no_translate):
    en_path = find_file(slug, "en")
    if not en_path:
        return None
    meta = json.load(open(os.path.join(SUBS_DIR, slug + ".info.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(SUBS_DIR, slug + ".info.json")) else {}
    en_sents = merge_sentences(parse_json3(en_path))

    # —— 音源/文字稿一致性校验：字幕覆盖率须 ≥ 85%（尾部掌声/问答无字幕属正常，
    #    更大缺口则判定为错配视频，拒绝入库）——
    expect = (resolved_map.get(slug) or {}).get("duration") or meta.get("duration") or 0
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
        if no_translate:
            zh_list = [""] * len(en_sents)
        else:
            zh_list = translate_batch([s["text"] for s in en_sents], cache)

    r = resolved_map.get(slug, {})
    cover = meta.get("thumbnail", "") or yt_thumb(r.get("url", ""))
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
        "duration": round(en_sents[-1]["end"]) if en_sents else 0,
        "cover": cover,
        "views": r.get("views"),
        "audioUrl": f"audio/{slug}.m4a",
        "zhSource": zh_source,
        "sentences": sentences,
    }
    out = os.path.join(DATA_DIR, slug + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return {k: data[k] for k in
            ("slug", "title", "speaker", "category", "school", "year", "duration", "cover", "views", "audioUrl", "zhSource")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-translate", action="store_true")
    ap.add_argument("--force", action="store_true", help="忽略已有产物全量重生成")
    args = ap.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    resolved_map = {e["slug"]: e for e in json.load(open(os.path.join(CORPUS, "resolved.json"), encoding="utf-8"))}
    state_path = os.path.join(CORPUS, "fetch_state.json")
    state = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}
    # 以抓取状态表中字幕成功的条目为准，且确实存在英文字幕文件
    slugs = sorted(s for s, v in state.items()
                   if v.get("subs") and find_file(s, "en"))
    if not args.force:
        before = len(slugs)
        slugs = [s for s in slugs if not os.path.exists(os.path.join(DATA_DIR, s + ".json"))]
        print(f"incremental: {before - len(slugs)} already built, {len(slugs)} to do", flush=True)
    if args.limit:
        slugs = slugs[:args.limit]
    cache = load_cache()

    # 已有产物也纳入 manifest（增量模式）
    manifest = []
    if not args.force:
        for f in os.listdir(DATA_DIR):
            if f.endswith(".json") and f != "manifest.json":
                try:
                    d = json.load(open(os.path.join(DATA_DIR, f), encoding="utf-8"))
                    manifest.append({k: d.get(k) for k in
                                     ("slug", "title", "speaker", "category", "school", "year",
                                      "duration", "cover", "views", "audioUrl", "zhSource")})
                except Exception:
                    pass
    for i, slug in enumerate(slugs, 1):
        print(f"[{i}/{len(slugs)}] {slug}", flush=True)
        entry = build_entry(resolved_map, slug, cache, args.no_translate)
        if entry:
            manifest.append(entry)
    # 排序：TED 按播放量，毕业演讲在后
    manifest.sort(key=lambda e: (0 if e["category"] == "ted" else 1, -(e.get("views") or 0)))
    with open(os.path.join(DATA_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    print(f"\nmanifest: {len(manifest)} talks")


if __name__ == "__main__":
    main()
