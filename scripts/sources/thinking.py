# -*- coding: utf-8 -*-
"""Thinking in English（Tom Wilkinson）抓取适配器。

RSS 给出音频，博客每集文章免费公开全文稿，结构：
    开头几段导语（是否朗读因集而异，交给对齐按句过滤）
    Listen Here! / Interactive Transcript!（播放器挂件）
    Vocabulary（官方重点词：「词 (词性): 释义」+ 例句）
    正文若干小节（<h2> 小节标题不朗读；中间夹着其他文章的推荐卡片，也是 <h2>）
    Extended Vocabulary List / Vocabulary Games …（会员与页脚，到此为止）
正文段落里夹着 [00:08:00] 这类时间戳，需去掉。
只取带编号的正片（"407. 标题"），跳过 Bonus Episode。
"""
import re
from html import unescape

from bs4 import BeautifulSoup

from .common import fetch_text, item_date, item_duration, item_image, rss_items

SERIES = "thinking"
FEED = "https://feeds.megaphone.fm/ARML8307714981"
# 只收 ASCII 路径字符：节目简介里的链接后面常跟着不可见的 U+2060，会被当成 URL 的一部分
PAGE_RE = re.compile(r"https://thinkinginenglish\.blog/\d{4}/[A-Za-z0-9\-._~/%]+")
NUMBER_RE = re.compile(r"^(\d+)\.\s*(.+)$")
SUFFIX_RE = re.compile(r"\s*\((?:English )?Vocabulary Lesson\)\s*$", re.I)
STAMP_RE = re.compile(r"\s*\[\d\d:\d\d:\d\d\]\s*")
VOCAB_ITEM_RE = re.compile(r"^(.{1,60}?)\s*\(([a-z. /]+)\)\s*[:：]\s*(.+)$", re.I)
END_HEADINGS = ("extended vocabulary list", "vocabulary games", "do you want to think in english",
                "conversation club", "share this")
SKIP_HEADINGS = ("listen here", "interactive transcript")
OG_IMAGE_RE = re.compile(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"|<meta[^>]+content="([^"]+)"[^>]+property="og:image"')


def list_episodes(limit=50):
    out = []
    for item in rss_items(FEED):
        m = NUMBER_RE.match((item.findtext("title") or "").strip())
        links = PAGE_RE.findall(item.findtext("description") or "")
        enclosure = item.find("enclosure")
        if not m or not links or enclosure is None:
            continue
        out.append({
            "code": m.group(1),
            "title": SUFFIX_RE.sub("", m.group(2)).strip(),
            "url": links[0],
            "mp3_url": enclosure.get("url"),
            "date": item_date(item),
            "duration": item_duration(item),
            "image": item_image(item),
        })
        if limit and len(out) >= limit:
            break
    return out


def _clean(text):
    text = STAMP_RE.sub(" ", text.replace("\xa0", " "))
    return re.sub(r"\s+", " ", text).strip()


def parse_article(html):
    """返回 (正文行列表, 官方词表)"""
    soup = BeautifulSoup(html, "lxml")
    art = soup.select_one("article.page-content-single") or soup.select_one("article")
    if art is None:
        return [], []
    lines, vocab = [], []
    in_vocab = False
    for el in art.find_all(["p", "h2", "h3", "ul"]):
        if el.name == "p" and el.find_parent("ul"):
            continue
        text = el.get_text(" ", strip=True)
        low = text.lower()
        if el.name in ("h2", "h3"):
            if any(low.startswith(h) for h in END_HEADINGS):
                break
            in_vocab = low == "vocabulary"
            continue  # 小节标题、推荐卡片标题都不朗读
        if in_vocab:
            if el.name == "ul" and not el.find_parent("ul"):
                for li in el.find_all("li", recursive=False):
                    # 词条行 = <li> 里嵌套例句列表之前的部分：<strong>词</strong> (词性): 释义
                    head = "".join(
                        child.get_text(" ") if hasattr(child, "get_text") else str(child)
                        for child in li.children if getattr(child, "name", None) != "ul"
                    )
                    m = VOCAB_ITEM_RE.match(_clean(head))
                    if m:
                        vocab.append({"term": m.group(1).strip(), "pos": m.group(2).strip(), "def": m.group(3).strip()})
            continue
        if el.name != "p" or any(low.startswith(h) for h in SKIP_HEADINGS) or low.startswith("you can now read"):
            continue
        text = _clean(text)
        if len(text) > 1:
            lines.append(text)
    return lines, vocab


def fetch_episode(ep):
    html = fetch_text(ep["url"])
    lines, vocab = parse_article(html)
    if not lines:
        return None
    og = OG_IMAGE_RE.search(html)
    cover = unescape(og.group(1) or og.group(2)) if og else ep.get("image")
    # og:image 走的是 Jetpack 图片 CDN（i0.wp.com），从本机访问 404；原图在博客自己的域名下
    if cover:
        cover = re.sub(r"^https://i\d\.wp\.com/", "https://", cover).split("?")[0]
    return {
        "slug": f"thinking_{ep['code']}",
        "series": SERIES,
        "title": ep["title"],
        "transcript": "\n".join(lines),
        "mp3_url": ep["mp3_url"],
        "date": ep["date"],
        "cover": cover,
        "source_url": ep["url"],
        "keywords": [{"term": v["term"], "def": v["def"]} for v in vocab],
    }
