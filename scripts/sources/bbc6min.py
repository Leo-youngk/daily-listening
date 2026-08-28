# -*- coding: utf-8 -*-
"""BBC Learning English · 6 Minute English 抓取适配器。

列表页一次性返回全部期数（约 494 期，最新在前），每期页面内嵌音频下载直链
与逐字稿（官方声明"非逐字"但足够准，用于强制对齐）。
"""
import re
import time
import urllib.request

from bs4 import BeautifulSoup

LIST_URL = "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english"
EP_LINK_RE = re.compile(r'href="(/learningenglish/english/features/6-minute-english[^"]*?/ep-(\d{6}))"')
SPEAKER_RE = re.compile(
    r"<strong>\s*([A-Za-z][A-Za-z .'\-]{1,30}?)\s*(?:<br\s*/?>\s*</strong>|</strong>\s*<br\s*/?>)\s*",
    re.I,
)
MP3_RE = re.compile(r'https?://downloads\.bbc\.co\.uk/learningenglish/features/6min/[^"\s]+?\.mp3')
DIVIDER_RE = re.compile(r"^_{5,}$")
FOOTNOTE_RE = re.compile(r"\s\*{1,2}\s.*$")
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
OG_IMAGE_RE = re.compile(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"|<meta[^>]+content="([^"]+)"[^>]+property="og:image"')
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def list_episodes(limit=110):
    """返回 [{"url":..., "code": "260827"}]，最新在前，按 code 去重。"""
    html = _get(LIST_URL)
    seen = {}
    for m in EP_LINK_RE.finditer(html):
        path, code = m.group(1), m.group(2)
        if code not in seen:
            seen[code] = "https://www.bbc.co.uk" + path
    items = [{"url": url, "code": code} for code, url in seen.items()]
    return items[:limit] if limit else items


def _clean_fragment(html_fragment):
    txt = BeautifulSoup(html_fragment, "lxml").get_text(" ")
    txt = txt.replace("\xa0", " ")
    txt = re.sub(r"\s+([,.;:!?)])", r"\1", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def extract_transcript(html):
    """返回逐句台词文本（每个说话轮次一行，不含说话人名），供强制对齐使用。"""
    soup = BeautifulSoup(html, "lxml")
    marker = None
    for strong in soup.find_all("strong"):
        if "TRANSCRIPT" in strong.get_text():
            marker = strong.find_parent("p")
            break
    if marker is None:
        return ""
    container = marker.parent
    siblings = container.find_all("p", recursive=False)
    idx = siblings.index(marker)

    lines = []
    for p in siblings[idx + 1:]:
        p_html = str(p)
        has_speaker = SPEAKER_RE.search(p_html)
        probe = p.get_text(" ", strip=True)
        if DIVIDER_RE.match(probe):
            break  # 分隔线之后是页脚交叉推荐链接，非正文
        if not has_speaker:
            if "not a word-for-word transcript" in probe.lower():
                continue
            if p.find("a"):
                continue
        if has_speaker:
            parts = SPEAKER_RE.split(p_html)
            for i in range(1, len(parts), 2):
                body = parts[i + 1] if i + 1 < len(parts) else ""
                text = _clean_fragment(body)
                text = FOOTNOTE_RE.sub("", text).strip()
                if text:
                    lines.append(text)
        else:
            text = _clean_fragment(p_html)
            text = FOOTNOTE_RE.sub("", text).strip()
            if text:
                lines.append(text)
    return "\n".join(lines)


def fetch_episode(url, code):
    html = _get(url)
    m = TITLE_RE.search(html)
    title = m.group(1) if m else ""
    if " / " in title:
        title = title.split(" / ", 1)[1].strip()
    mp3_m = MP3_RE.search(html)
    if not mp3_m:
        return None
    transcript = extract_transcript(html)
    if not transcript:
        return None
    date = f"20{code[0:2]}-{code[2:4]}-{code[4:6]}"
    og_m = OG_IMAGE_RE.search(html)
    cover = (og_m.group(1) or og_m.group(2)) if og_m else None
    return {
        "slug": f"bbc6min_{code}",
        "title": title or f"6 Minute English {date}",
        "transcript": transcript,
        "mp3_url": mp3_m.group(0),
        "date": date,
        "cover": cover,
        "source_url": url,
    }


def main():
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    eps = list_episodes(args.limit)
    results = []
    for e in eps:
        print(e["url"], flush=True)
        data = fetch_episode(e["url"], e["code"])
        if data:
            print(f"  OK title={data['title']!r} chars={len(data['transcript'])}", flush=True)
            results.append(data)
        else:
            print("  SKIP (no transcript/mp3)", flush=True)
        time.sleep(1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n{len(results)}/{len(eps)} ok")


if __name__ == "__main__":
    main()
