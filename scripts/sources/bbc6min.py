# -*- coding: utf-8 -*-
"""BBC Learning English · 6 Minute English 抓取适配器。

列表页一次性返回全部期数（约 494 期，最新在前）。每期页面内嵌音频下载直链、
官方重点词表（Vocabulary，约 6 条，带英文释义）与逐字稿（官方声明"非逐字"但足够准，
用于强制对齐）。

注意：页面结构 2022 年前后改过，本解析器只认得近年的格式（实测最近 173 期），
更早的期数会解析不出正文——只取最近 N 期时不受影响。
"""
import re
from html import unescape

from bs4 import BeautifulSoup, NavigableString, Tag

from .common import fetch_text

SERIES = "bbc"
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


def list_episodes(limit=100):
    """返回 [{"url":..., "code": "260827"}]，最新在前，按 code 去重。"""
    html = fetch_text(LIST_URL)
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


def extract_vocabulary(html):
    """官方重点词表：<h3>Vocabulary</h3> 之后的段落里，<strong> 是词条，其后的文本是英文释义。"""
    soup = BeautifulSoup(html, "lxml")
    heading = next((h for h in soup.find_all(["h3", "h2"]) if h.get_text(strip=True).lower() == "vocabulary"), None)
    if heading is None:
        return []
    items = []
    term, definition = None, []

    def flush():
        if term and definition:
            text = re.sub(r"\s+", " ", " ".join(definition)).strip()
            if text:
                items.append({"term": term, "def": text})

    for block in heading.find_next_siblings():
        if block.name in ("h2", "h3") or "TRANSCRIPT" in block.get_text():
            break
        if block.name != "p":
            continue
        for node in block.children:
            if isinstance(node, Tag) and node.name == "strong":
                label = node.get_text(" ", strip=True).replace("\xa0", " ").strip()
                if not label:
                    continue
                flush()
                term, definition = label, []
            elif isinstance(node, NavigableString):
                text = str(node).replace("\xa0", " ").strip()
                if text and term:
                    definition.append(text)
    flush()
    return items


def fetch_episode(url, code):
    html = fetch_text(url)
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
    cover = unescape(og_m.group(1) or og_m.group(2)) if og_m else None
    return {
        "slug": f"bbc6min_{code}",
        "series": SERIES,
        "title": title or f"6 Minute English {date}",
        "transcript": transcript,
        "mp3_url": mp3_m.group(0),
        "date": date,
        "cover": cover,
        "source_url": url,
        "keywords": extract_vocabulary(html),
    }
