# -*- coding: utf-8 -*-
"""线上部署验收：素材完整性、缓存版本、404 行为、查词接口。

用法：
    python scripts/verify_deploy.py                 # 只做不花钱的静态校验
    python scripts/verify_deploy.py --with-lookup   # 额外真调一次 /api/lookup
    python scripts/verify_deploy.py --base https://<预览域名>
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = "https://daily-listening-e7k.pages.dev"
HEADERS = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}
EXPECTED_TALKS = 309
DICT_VERSION = "ecdict-1.0.28-r1"

failures: list[str] = []
checks = 0


def check(ok: bool, label: str, detail: str = "") -> bool:
    global checks
    checks += 1
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)
    return ok


def fetch(base: str, path: str, method: str = "GET", body: dict | None = None):
    """返回 (status, text)；HTTP 错误也当作结果返回，不抛异常。"""
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(HEADERS)
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def verify_manifest(base: str) -> None:
    status, text = fetch(base, "/data/manifest.json")
    if not check(status == 200, "manifest.json 可访问", f"HTTP {status}"):
        return
    items = json.loads(text)
    check(len(items) == EXPECTED_TALKS, "素材数量", f"{len(items)} 篇（期望 {EXPECTED_TALKS}）")

    categories: dict[str, int] = {}
    for item in items:
        categories[item.get("category", "?")] = categories.get(item.get("category", "?"), 0) + 1
    print("        分类分布:", ", ".join(f"{k}={v}" for k, v in sorted(categories.items())))

    external = [i["slug"] for i in items if str(i.get("cover", "")).startswith("http")]
    check(not external, "封面全部同源", f"外链 {len(external)} 个: {external[:3]}")

    # 抽查首条素材的字幕结构
    slug = items[0]["slug"]
    status, text = fetch(base, f"/data/{slug}.json")
    if check(status == 200, f"素材 JSON 可访问 ({slug})", f"HTTP {status}"):
        talk = json.loads(text)
        sentences = talk.get("sentences", [])
        check(bool(sentences), "字幕非空", f"{len(sentences)} 句")
        check(
            all(s["i"] == n for n, s in enumerate(sentences)),
            "字幕序号连续",
        )
        check(
            all(s["start"] <= s["end"] for s in sentences),
            "字幕时间区间有序",
        )
        last_end = sentences[-1]["end"] if sentences else 0
        duration = talk.get("duration", 0)
        check(
            duration <= 0 or last_end <= duration + 1,
            "末句不超出音频时长",
            f"末句 {last_end:.1f}s / 时长 {duration:.1f}s",
        )


def verify_dict(base: str) -> None:
    status, text = fetch(base, "/dict/index.json")
    if not check(status == 200, "词典索引可访问", f"HTTP {status}"):
        return
    index = json.loads(text)
    check(index.get("v") == DICT_VERSION, "词典版本", index.get("v", "?"))
    check("MIT" in index.get("source", ""), "保留 ECDICT 署名", index.get("source", ""))
    check(len(index.get("shards", {})) > 300, "分片数量", str(len(index.get("shards", {}))))

    status, text = fetch(base, "/dict/pl.json")
    if check(status == 200, "词典分片可访问 (pl)", f"HTTP {status}"):
        entries = json.loads(text)["entries"]
        check("play out" in entries, "词组 play out 已收录")
        check(len(entries.get("play", {}).get("senses", [])) > 1, "play 收录多个义项")


def verify_build(base: str) -> None:
    status, idx = fetch(base, "/")
    if not check(status == 200, "首页可访问", f"HTTP {status}"):
        return
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', idx)
    if not check(bool(m), "首页引用了打包后的 JS"):
        return
    status, js = fetch(base, m.group(1))
    check(status == 200, "主 JS 可访问", f"HTTP {status}")
    # 压缩后 "版本 " 和 sha 会被拆成相邻的独立字面量，中间夹引号和逗号
    sha = re.search(r'版本 [`\'",\s]{0,6}([0-9a-f]{7}|nogit)', js)
    check(bool(sha), "构建版本号已内联", sha.group(1) if sha else "未找到")
    check("mymemory" not in js.lower(), "已移除 MyMemory 翻译接口")
    check("dictionaryapi.dev" not in js, "已移除浏览器直连 dictionaryapi.dev")

    status, sw = fetch(base, "/sw.js")
    if check(status == 200, "sw.js 可访问", f"HTTP {status}"):
        check("data-cache-v4" in sw, "数据缓存版本为 v4")
        check("dict-ecdict-1-0-28-r1" in sw, "词典缓存名带版本号")
        check("cover-cache-v3" in sw, "封面缓存版本为 v3")
        check("mymemory" not in sw.lower(), "sw 不再缓存 MyMemory")
        check("cleanupOutdatedCaches" in sw or "outdated" in sw.lower(), "清理过期预缓存")


def verify_404(base: str) -> None:
    status, text = fetch(base, "/data/__does_not_exist__.json")
    check(status == 404, "缺失素材返回 404", f"HTTP {status}")
    check("<div id=\"root\"" not in text, "缺失素材不回落成首页 HTML")


def verify_lookup(base: str) -> None:
    """真调一次上下文判义。会消耗 Workers AI 额度，默认不跑。"""
    cases = [
        {
            "label": "play out 判成短语动词",
            "req": {
                "word": "play",
                "wordIndex": 7,
                "sentence": "We have no idea how this will play out over the next decade.",
            },
            "reject": ["播放"],
        },
        {
            "label": "Nativity play 判成戏剧",
            "req": {
                "word": "play",
                "wordIndex": 8,
                "sentence": "I was a sheep in the school Nativity play that December.",
            },
            "reject": ["播放"],
        },
    ]
    meanings = []
    for case in cases:
        status, text = fetch(base, "/api/lookup", "POST", case["req"])
        if not check(status in (200, 429), case["label"] + " 接口可用", f"HTTP {status}"):
            continue
        data = json.loads(text)
        if data.get("source") != "ai":
            check(False, case["label"], f"降级到词典义项: {data.get('reason', '?')}")
            continue
        meaning = data.get("contextMeaning", "")
        meanings.append(meaning)
        print(f"        term={data.get('term')} 本句义={meaning}")
        check(bool(meaning), case["label"] + " 返回本句义")
        check(
            all(bad not in meaning for bad in case["reject"]),
            case["label"] + " 未落回错误义项",
            meaning,
        )
        check(bool(data.get("otherMeanings")), case["label"] + " 附带其他常见义项")
    if len(meanings) == 2:
        check(meanings[0] != meanings[1], "同一个词在两句里给出不同的本句义")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--with-lookup", action="store_true", help="真调 /api/lookup（消耗 Workers AI 额度）")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    print(f"验收目标: {base}\n")
    verify_manifest(base)
    verify_dict(base)
    verify_build(base)
    verify_404(base)
    if args.with_lookup:
        verify_lookup(base)

    print(f"\n{checks - len(failures)}/{checks} 项通过")
    if failures:
        print("失败项:")
        for f in failures:
            print("  -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
