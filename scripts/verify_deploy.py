# -*- coding: utf-8 -*-
"""线上部署验收：节目与字幕、词表与例句、切句原声、整集音频、缓存版本、404 行为、查词接口。

用法：
    python scripts/verify_deploy.py                 # 只做不花钱的静态校验
    python scripts/verify_deploy.py --with-lookup   # 额外真调一次 /api/lookup
    python scripts/verify_deploy.py --base https://<预览域名>
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "https://daily-listening-e7k.pages.dev"
HEADERS = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}
EXPECTED_SERIES = {"bbc": 100, "curious": 50, "thinking": 50}
# 与 build_dict.py / app/src/lib/dict.ts / vite.config.ts 的缓存名同步升级
DICT_VERSION = "ecdict-1.0.28-r3"
DICT_CACHE = "dict-ecdict-1-0-28-r3"
VOCAB_CACHE = "vocab-cache-v2"

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
    categories: dict[str, int] = {}
    for item in items:
        categories[item.get("category", "?")] = categories.get(item.get("category", "?"), 0) + 1
    check(categories == EXPECTED_SERIES, "各档节目期数", ", ".join(f"{k}={v}" for k, v in sorted(categories.items())))

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
        check(all("w" in s for s in sentences), "每句都有词级时间轴")
        check(bool(talk.get("lemmas")), "带六级词标注（lemmas）")
        # 音频与页面同源（functions/audio 读 R2）；标准音质是 MP3，起播不用等 moov 索引
        for quality, mime in (("standard", "audio/mpeg"), ("high", "audio/mp4")):
            audio = base + talk["audioUrls"][quality]
            req = urllib.request.Request(audio, headers={**HEADERS, "Range": "bytes=0-1"})
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    check(res.status == 206 and res.headers.get("Content-Type", "").startswith(mime),
                          f"整集音频可访问（{quality}，{mime}，支持 Range）",
                          f"HTTP {res.status} {res.headers.get('Content-Type')} {audio}")
            except urllib.error.HTTPError as e:
                check(False, f"整集音频可访问（{quality}）", f"HTTP {e.code} {audio}")


def verify_dict(base: str) -> None:
    status, text = fetch(base, "/dict/index.json")
    if not check(status == 200, "词典索引可访问", f"HTTP {status}"):
        return
    index = json.loads(text)
    check(index.get("v") == DICT_VERSION, "词典版本", index.get("v", "?"))
    check("MIT" in index.get("source", ""), "保留 ECDICT 署名", index.get("source", ""))
    check(len(index.get("shards", {})) > 300, "分片数量", str(len(index.get("shards", {}))))

    status, text = fetch(base, "/dict/ta.json")
    if check(status == 200, "词典分片可访问 (ta)", f"HTTP {status}"):
        entries = json.loads(text)["entries"]
        check(len(entries.get("take", {}).get("senses", [])) > 1, "take 收录多个义项")


def verify_vocab(base: str) -> None:
    status, text = fetch(base, "/wordbook/cet6.json")
    if check(status == 200, "六级词表可访问", f"HTTP {status}"):
        words = json.loads(text)["words"]
        check(len(words) > 5000, "六级词表词数", str(len(words)))
    status, text = fetch(base, "/wordbook/episodes.json")
    if check(status == 200, "每集词汇索引可访问", f"HTTP {status}"):
        check(len(json.loads(text)["episodes"]) == sum(EXPECTED_SERIES.values()), "每集词汇索引覆盖全部节目")
    status, text = fetch(base, "/examples/index.json")
    if not check(status == 200, "例句索引可访问", f"HTTP {status}"):
        return
    index = json.loads(text)
    shard = index["shards"][len(index["shards"]) // 2]
    status, text = fetch(base, f"/examples/{shard}.json")
    if not check(status == 200, f"例句分片可访问 ({shard})", f"HTTP {status}"):
        return
    term, examples = next(iter(json.loads(text)["entries"].items()))
    ex = examples[0]
    clip = f"{base}{index['clipBase']}/{ex['s']}/{ex['i']}-{round(ex['a'] * 100)}.m4a"
    try:
        with urllib.request.urlopen(urllib.request.Request(clip, headers=HEADERS), timeout=60) as res:
            body = res.read()
            check(res.status == 200 and len(body) > 1000, f"切句原声可播放（{term}）", f"{len(body)} 字节")
    except urllib.error.HTTPError as e:
        check(False, f"切句原声可播放（{term}）", f"HTTP {e.code} {clip}")


def deployed_sha(base: str) -> str | None:
    """线上主 JS 里内联的构建版本号。"""
    status, idx = fetch(base, "/")
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', idx) if status == 200 else None
    if not m:
        return None
    status, js = fetch(base, m.group(1))
    sha = re.search(r'版本 [`\'",\s]{0,6}([0-9a-f]{7}|nogit)', js) if status == 200 else None
    return sha.group(1) if sha else None


def wait_for_deploy(base: str, sha: str, timeout: int = 300) -> None:
    """Pages 部署完成后生产域名要过一会儿才切到新版，先等线上版本号变成本次提交再验收。"""
    deadline = time.time() + timeout
    while True:
        live = deployed_sha(base)
        if live == sha:
            print(f"线上已是 {sha}\n")
            return
        if time.time() > deadline:
            print(f"等了 {timeout} 秒线上仍是 {live}，按现状验收\n")
            return
        print(f"线上还是 {live}，等新版 {sha} 生效…")
        time.sleep(15)


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
        check("data-cache-v5" in sw, "数据缓存版本为 v5")
        check(DICT_CACHE in sw, "词典缓存名带版本号", DICT_CACHE)
        check(VOCAB_CACHE in sw, "词表与例句走独立缓存", VOCAB_CACHE)
        check("cover-cache-v3" in sw, "封面缓存版本为 v3")
        check("mymemory" not in sw.lower(), "sw 不再缓存 MyMemory")
        check("clientsClaim" in sw, "新 sw 安装后立即接管页面")
        check("SKIP_WAITING" not in sw, "新 sw 不再停留在 waiting 状态")
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
    # CI 里带着本次提交号：等生产域名切到这一版再验，避免验到上一版
    if os.environ.get("GITHUB_SHA"):
        wait_for_deploy(base, os.environ["GITHUB_SHA"][:7])
    verify_manifest(base)
    verify_dict(base)
    verify_vocab(base)
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
