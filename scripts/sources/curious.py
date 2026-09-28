# -*- coding: utf-8 -*-
"""English Learning for Curious Minds（Leonardo English）抓取适配器。

RSS（Transistor）给出音频与集数，官网每集页面免费公开全文稿：
`.rtb-podcastcontent` 里一段一个 <p>，段首带 [hh:mm:ss] 时间戳。
页面把同一份稿子渲染了三遍（会员/非会员/下载），只取第一份。
官方重点词表是会员内容，这里不取。
"""
import re
from html import unescape

from bs4 import BeautifulSoup

from .common import fetch_text, item_date, item_duration, item_image, rss_items

SERIES = "curious"
FEED = "https://feeds.transistor.fm/leonardo-english-english-language-learning-for-curious-minds"
PAGE_RE = re.compile(r"https://www\.leonardoenglish\.com/podcasts/[^\s\"<>]+")
NUMBER_RE = re.compile(r"^#\s*(\d+)\s*[|:：-]\s*(.+)$")
STAMP_RE = re.compile(r"^\[\d\d:\d\d:\d\d\]\s*")
OG_IMAGE_RE = re.compile(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"|<meta[^>]+content="([^"]+)"[^>]+property="og:image"')


def list_episodes(limit=50):
    """最新在前，只取带编号的正片（跳过预告等无编号条目）。"""
    out = []
    for item in rss_items(FEED):
        m = NUMBER_RE.match((item.findtext("title") or "").strip())
        links = PAGE_RE.findall(item.findtext("description") or "")
        enclosure = item.find("enclosure")
        if not m or not links or enclosure is None:
            continue
        out.append({
            "code": m.group(1),
            "title": m.group(2).strip(),
            "url": links[0],
            "mp3_url": enclosure.get("url"),
            "date": item_date(item),
            "duration": item_duration(item),
            "image": item_image(item),
        })
        if limit and len(out) >= limit:
            break
    return out


def extract_transcript(html):
    soup = BeautifulSoup(html, "lxml")
    body = soup.select_one(".rtb-podcastcontent")
    if body is None:
        return ""
    lines = []
    for p in body.find_all("p"):
        text = STAMP_RE.sub("", p.get_text(" ", strip=True).replace("\u200d", "").replace("\xa0", " ")).strip()
        text = re.sub(r"\s+", " ", text)
        if len(text) > 1:
            lines.append(text)
    return "\n".join(lines)


def fetch_episode(ep):
    html = fetch_text(ep["url"])
    transcript = extract_transcript(html)
    if not transcript:
        return None
    og = OG_IMAGE_RE.search(html)
    cover = unescape(og.group(1) or og.group(2)) if og else ep.get("image")
    return {
        "slug": f"curious_{ep['code']}",
        "series": SERIES,
        "title": ep["title"],
        "transcript": transcript,
        "mp3_url": ep["mp3_url"],
        "date": ep["date"],
        "cover": cover,
        "source_url": ep["url"],
        "keywords": [],
    }
