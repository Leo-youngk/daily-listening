# -*- coding: utf-8 -*-
"""节目源适配器共用的网络与 RSS 工具。

部分域名（pdrl.fm / megaphone / BBC）从本机访问偶发 SSL 重置，所有请求都带指数退避重试。
"""
import email.utils
import time
import urllib.request
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
ITUNES = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}


def fetch_bytes(url, timeout=60, tries=6):
    delay = 2.0
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:
            if attempt == tries - 1:
                raise RuntimeError(f"{url}: {exc}") from exc
            time.sleep(delay)
            delay = min(delay * 2, 30)


def fetch_text(url, timeout=60, tries=6):
    return fetch_bytes(url, timeout=timeout, tries=tries).decode("utf-8", "replace")


def rss_items(feed_url):
    """返回 RSS 的 <item> 列表（按 feed 顺序，通常最新在前）。"""
    root = ET.fromstring(fetch_bytes(feed_url))
    return root.findall("./channel/item")


def item_duration(item):
    raw = item.findtext("itunes:duration", default="", namespaces=ITUNES) or ""
    seconds = 0.0
    for part in raw.split(":"):
        seconds = seconds * 60 + float(part or 0)
    return seconds


def item_date(item):
    """pubDate -> YYYY-MM-DD"""
    raw = item.findtext("pubDate") or ""
    parsed = email.utils.parsedate_to_datetime(raw) if raw else None
    return parsed.strftime("%Y-%m-%d") if parsed else None


def item_image(item):
    node = item.find("itunes:image", ITUNES)
    return node.get("href") if node is not None else None
