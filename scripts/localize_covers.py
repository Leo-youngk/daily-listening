# -*- coding: utf-8 -*-
"""把封面图从 YouTube 图床下载到本地 public/covers/，并改写 manifest 与单篇数据中的 cover 路径。

背景：手机上（国内网络）无法访问 i.ytimg.com，导致封面全部加载失败。
优先下载 maxresdefault（1280x720），失败或为占位图时降级为 hqdefault。
"""
import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from data_io import write_talk

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "public", "data")
COVERS = os.path.join(ROOT, "public", "covers")

UA = {"User-Agent": "Mozilla/5.0"}
PLACEHOLDER_SIZES = {120 * 90, 120 * 120}  # maxres 不存在时的灰图特征


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=20).read()


def download_one(slug, cover_url):
    """下载封面，返回 (slug, 本地相对路径 或 None)"""
    dst = os.path.join(COVERS, slug + ".jpg")
    if os.path.exists(dst) and os.path.getsize(dst) > 1024:
        return slug, "covers/" + slug + ".jpg"
    m = re.search(r"/vi(?:_webp)?/([^/]+)/", cover_url)
    if not m:
        return slug, None
    vid = m.group(1)
    for name in ("maxresdefault", "hqdefault", "mqdefault"):
        try:
            blob = fetch(f"https://i.ytimg.com/vi/{vid}/{name}.jpg")
            if name == "maxresdefault" and len(blob) < 2000:
                continue  # 占位灰图
            with open(dst, "wb") as f:
                f.write(blob)
            return slug, "covers/" + slug + ".jpg"
        except Exception:
            continue
    return slug, None


def main():
    os.makedirs(COVERS, exist_ok=True)
    manifest_path = os.path.join(DATA, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))

    results = {}
    tasks = [(it["slug"], it.get("cover") or "") for it in manifest if it.get("cover")]
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(download_one, s, u): s for s, u in tasks}
        done = 0
        for fut in as_completed(futs):
            slug, rel = fut.result()
            results[slug] = rel
            done += 1
            if done % 20 == 0:
                print(f"progress {done}/{len(tasks)}")

    ok = 0
    for item in manifest:
        rel = results.get(item["slug"])
        if rel:
            item["cover"] = rel
            ok += 1
            dj = os.path.join(DATA, item["slug"] + ".json")
            if os.path.exists(dj):
                d = json.load(open(dj, encoding="utf-8"))
                d["cover"] = rel
                write_talk(dj, d)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)

    failed = [s for s, r in results.items() if not r]
    print(f"covers localized: {ok}/{len(manifest)}")
    if failed:
        print("failed:", failed)


if __name__ == "__main__":
    main()
