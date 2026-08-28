# -*- coding: utf-8 -*-
"""VOA Learning English 抓取适配器：仅 Health & Lifestyle / Science & Technology 两个栏目。

栏目用 ?p=N 分页，每页 12 篇文章；正文在 #article-content 内，无 class 的
<p> 是正文段落，遇到纯下划线的分隔段落即正文结束（后面是 Words in This Story 词表）。
"""
import re
import time
import urllib.request

from bs4 import BeautifulSoup

SECTIONS = {
    "health": "https://learningenglish.voanews.com/z/955",
    "scitech": "https://learningenglish.voanews.com/z/1579",
}
ARTICLE_LINK_RE = re.compile(r'href="(/a/[^"]+?/(\d+)\.html)"')
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
TIME_RE = re.compile(r'<time[^>]*datetime="([^"]+)"')
OG_IMAGE_RE = re.compile(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"|<meta[^>]+content="([^"]+)"[^>]+property="og:image"')
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def list_articles(section, limit=60, max_pages=10):
    """返回 [{"url":..., "id": "7921334"}]，按栏目列表顺序（最新在前）去重。"""
    base = SECTIONS[section]
    seen = {}
    for p in range(1, max_pages + 1):
        html = _get(f"{base}?p={p}")
        found = ARTICLE_LINK_RE.findall(html)
        if not found:
            break
        new_count = 0
        for path, aid in found:
            if aid not in seen:
                seen[aid] = "https://learningenglish.voanews.com" + path
                new_count += 1
        if limit and len(seen) >= limit:
            break
        if new_count == 0:
            break
        time.sleep(0.5)
    items = [{"url": url, "id": aid} for aid, url in seen.items()]
    return items[:limit] if limit else items


def extract_article(html):
    """返回 (title, body_text, mp3_url, date)。"""
    soup = BeautifulSoup(html, "lxml")
    art = soup.find(id="article-content")
    if art is None:
        return None
    lines = []
    for p in art.find_all("p", recursive=True):
        if p.get("class"):
            continue
        text = p.get_text(" ", strip=True)
        if not text:
            continue
        if re.fullmatch(r"_+", text):
            break
        lines.append(text)
    body = "\n".join(lines)

    title_m = TITLE_RE.search(html)
    title = title_m.group(1).strip() if title_m else ""

    mp3_urls = re.findall(r'https?://[^"\s]+?_hq\.mp3', html)
    if not mp3_urls:
        mp3_urls = re.findall(r'https?://[^"\s]+?\.mp3', html)
    mp3_url = mp3_urls[0] if mp3_urls else None

    time_m = TIME_RE.search(html)
    date = time_m.group(1)[:10] if time_m else None

    og_m = OG_IMAGE_RE.search(html)
    cover = (og_m.group(1) or og_m.group(2)) if og_m else None

    return title, body, mp3_url, date, cover


def fetch_article(url, aid):
    html = _get(url)
    parsed = extract_article(html)
    if not parsed:
        return None
    title, body, mp3_url, date, cover = parsed
    if not body or not mp3_url:
        return None
    return {
        "slug": f"voa_{aid}",
        "title": title,
        "transcript": body,
        "mp3_url": mp3_url,
        "date": date,
        "cover": cover,
        "source_url": url,
    }


def main():
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("--section", choices=list(SECTIONS), default="health")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    items = list_articles(args.section, args.limit)
    results = []
    for it in items:
        print(it["url"], flush=True)
        data = fetch_article(it["url"], it["id"])
        if data:
            print(f"  OK title={data['title']!r} chars={len(data['transcript'])}", flush=True)
            results.append(data)
        else:
            print("  SKIP (no body/mp3)", flush=True)
        time.sleep(1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n{len(results)}/{len(items)} ok")


if __name__ == "__main__":
    main()
