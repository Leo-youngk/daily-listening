# -*- coding: utf-8 -*-
"""验证线上部署是否包含缓存修复"""
import re
import urllib.request

BASE = "https://daily-listening.pages.dev"
HEADERS = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8")


sw = get("/sw.js")
print("sw.js cacheableResponse(statuses):", "statuses" in sw)
print("sw.js cleanupOutdatedCaches:", "outdated" in sw.lower())

idx = get("/")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', idx)
print("index.html JS:", m.group(1) if m else "NOT FOUND")
js = get(m.group(1))
print("migration cleanup in JS:", "dtl-cache-migration-v2" in js)
