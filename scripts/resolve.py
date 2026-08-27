# -*- coding: utf-8 -*-
"""把语料清单解析为实际 YouTube 视频（频道/时长/标题三重校验），输出 resolved.json"""
import json, os, re, subprocess, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")
RESOLVED = os.path.join(CORPUS, "resolved.json")
UNRESOLVED = os.path.join(CORPUS, "unresolved.json")

YT = [sys.executable, "-m", "yt_dlp", "--flat-playlist", "-J", "--no-warnings"]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).lower().strip()


def tokens(s: str):
    return set(norm(s).split())


def overlap(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def search(query: str, n: int = 8):
    cmd = YT + [f"ytsearch{n}:{query}"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90, encoding="utf-8", errors="replace")
        if r.returncode != 0 or not r.stdout.strip():
            return []
        d = json.loads(r.stdout)
        return [e for e in d.get("entries", []) if e]
    except Exception as e:
        print(f"    [search error] {query}: {e}", flush=True)
        return []


def resolve_ted(entry: dict):
    """TED：限定 TED/TEDx 频道 + 时长接近 ted_main.csv 记录"""
    q = f'"{entry["title"]}" {entry["speaker"]}'
    cands = search(q, 8)
    want = entry.get("duration") or 0
    best, best_score = None, -1.0
    for e in cands:
        ch = (e.get("channel") or e.get("uploader") or "").lower()
        if "ted" not in ch:
            continue
        dur = e.get("duration") or 0
        if want and dur:
            if abs(dur - want) > want * 0.3:  # 时长容差 30%
                continue
        title_sim = overlap(e.get("title", ""), entry["title"])
        dur_score = 1.0
        if want and dur:
            dur_score = 1.0 - abs(dur - want) / want
        score = title_sim * 0.6 + dur_score * 0.4
        if score > best_score:
            best_score, best = score, e
    if best and best_score >= 0.35:
        return make_result(entry, best, best_score)
    return None


def resolve_commencement(entry: dict):
    """毕业演讲：标题含讲者姓氏优先，时长 > 3 分钟"""
    cands = search(entry["query"], 8)
    speaker_tokens = tokens(entry["speaker"])
    best, best_score = None, -1.0
    for e in cands:
        title = e.get("title", "")
        dur = e.get("duration") or 0
        if dur and dur < 180:
            continue
        tl = tokens(title)
        speaker_hit = len(speaker_tokens & tl) / max(len(speaker_tokens), 1)
        if speaker_hit < 0.5:
            continue
        q_sim = overlap(title, entry["query"])
        score = speaker_hit * 0.5 + q_sim * 0.5
        if score > best_score:
            best_score, best = score, e
    if best and best_score >= 0.4:
        return make_result(entry, best, best_score)
    return None


def make_result(entry, video, score):
    return {
        "slug": entry["slug"],
        "category": entry.get("category", "commencement"),
        "title": entry["title"],
        "speaker": entry["speaker"],
        "school": entry.get("school"),
        "year": entry.get("year"),
        "views": entry.get("views"),
        "url": video.get("url"),
        "video_title": video.get("title"),
        "channel": video.get("channel") or video.get("uploader"),
        "duration": video.get("duration"),
        "match_score": round(score, 3),
    }


def load_existing(path):
    if os.path.exists(path):
        return {e["slug"]: e for e in json.load(open(path, encoding="utf-8"))}
    return {}


def main():
    ted = json.load(open(os.path.join(CORPUS, "ted_top100.json"), encoding="utf-8"))
    comm = json.load(open(os.path.join(CORPUS, "commencement_candidates.json"), encoding="utf-8"))
    for e in ted:
        e["category"] = "ted"

    done = load_existing(RESOLVED)
    failed = {}
    tasks = [(e, resolve_ted) for e in ted if e["slug"] not in done] + \
            [(e, resolve_commencement) for e in comm if e["slug"] not in done]
    print(f"to resolve: {len(tasks)}, already done: {len(done)}", flush=True)

    def save():
        with open(RESOLVED, "w", encoding="utf-8") as f:
            json.dump(list(done.values()), f, ensure_ascii=False, indent=2)
        with open(UNRESOLVED, "w", encoding="utf-8") as f:
            json.dump(list(failed.values()), f, ensure_ascii=False, indent=2)

    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(fn, e): e for e, fn in tasks}
        for i, fut in enumerate(as_completed(futs), 1):
            e = futs[fut]
            try:
                res = fut.result()
            except Exception as ex:
                res = None
                print(f"    [exception] {e['slug']}: {ex}", flush=True)
            if res:
                done[res["slug"]] = res
                print(f"[{i}/{len(tasks)}] OK  {res['slug']} -> {res['channel']} | {res['video_title']} | score={res['match_score']}", flush=True)
            else:
                failed[e["slug"]] = e["slug"]
                print(f"[{i}/{len(tasks)}] MISS {e['slug']} ({e.get('query', e.get('title'))})", flush=True)
            if i % 10 == 0:
                save()
    save()
    print(f"\nresolved={len(done)} unresolved={len(failed)}")


if __name__ == "__main__":
    main()
