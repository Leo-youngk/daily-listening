# -*- coding: utf-8 -*-
"""为已入库的演讲补齐封面：优先本地 info.json，否则查 YouTube oEmbed"""
import json, os, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SUBS = os.path.join(ROOT, "public", "subs")
DATA = os.path.join(ROOT, "public", "data")


def oembed_thumb(url):
    api = "https://www.youtube.com/oembed?url=" + urllib.request.quote(url, safe="") + "&format=json"
    req = urllib.request.Request(api, headers={"User-Agent": "Mozilla/5.0"})
    d = json.load(urllib.request.urlopen(req, timeout=15))
    t = d.get("thumbnail_url", "")
    return t.replace("hqdefault.jpg", "maxresdefault.jpg")


def main():
    manifest_path = os.path.join(DATA, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    resolved = {e["slug"]: e for e in json.load(open(os.path.join(HERE, "corpus", "resolved.json"), encoding="utf-8"))}
    fixed = 0
    for item in manifest:
        slug = item["slug"]
        if item.get("cover"):
            continue
        thumb = ""
        info_path = os.path.join(SUBS, slug + ".info.json")
        if os.path.exists(info_path):
            thumb = json.load(open(info_path, encoding="utf-8")).get("thumbnail", "")
        if not thumb and slug in resolved and resolved[slug].get("url"):
            try:
                thumb = oembed_thumb(resolved[slug]["url"])
            except Exception as e:
                print(f"    oembed fail {slug}: {e}")
            time.sleep(0.3)
        if thumb:
            item["cover"] = thumb
            fixed += 1
            # 同步更新单篇数据文件
            dj = os.path.join(DATA, slug + ".json")
            if os.path.exists(dj):
                d = json.load(open(dj, encoding="utf-8"))
                d["cover"] = thumb
                with open(dj, "w", encoding="utf-8") as f:
                    json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    print(f"covers filled: {fixed}/{len(manifest)}")


if __name__ == "__main__":
    main()
