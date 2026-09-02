# -*- coding: utf-8 -*-
"""检测 a84730a 引入的中文字幕整体错位。

fetch_ted_zh_subs.py 直接拿 TED.com 的 cue.time 和我们的句子做时间重叠，但音频来自
YouTube 上传版，片头有一段 TED 动画，两条时间轴差一个常数。结果就是中文整体超前若干句。

检测办法：a84730a 之前的 zh 是逐句机器翻译，天然对齐。用字符 bigram 相似度找出
新 zh[i] 与旧 zh[i+k] 最像的 k，k 的中位数就是错位句数。
"""
import io
import json
import os
import subprocess
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")
BASE = "a84730a"


def bigrams(text):
    t = "".join(ch for ch in text if "一" <= ch <= "鿿")
    return Counter(t[i:i + 2] for i in range(len(t) - 1))


def similarity(a, b):
    if not a or not b:
        return 0.0
    common = sum((a & b).values())
    return 2 * common / (sum(a.values()) + sum(b.values()))


def old_version(path_rel, rev):
    try:
        raw = subprocess.run(["git", "show", f"{rev}:{path_rel}"], cwd=ROOT,
                             capture_output=True, check=True).stdout
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def changed_slugs():
    out = subprocess.run(["git", "show", "--name-only", "--format=", BASE],
                         cwd=ROOT, capture_output=True, check=True).stdout.decode()
    return [os.path.basename(line)[:-5] for line in out.splitlines()
            if line.startswith("public/data/") and line.endswith(".json")
            and not line.endswith("manifest.json")]


def best_shift(new_zh, old_zh, span=6):
    """返回 (最佳位移, 该位移下的平均相似度, 0 位移的平均相似度)"""
    new_grams = [bigrams(z) for z in new_zh]
    old_grams = [bigrams(z) for z in old_zh]
    scores = {}
    for k in range(-span, span + 1):
        total, count = 0.0, 0
        for i, ng in enumerate(new_grams):
            j = i + k
            if 0 <= j < len(old_grams) and ng and old_grams[j]:
                total += similarity(ng, old_grams[j])
                count += 1
        if count >= max(5, len(new_grams) // 4):
            scores[k] = total / count
    if not scores:
        return None, 0.0, 0.0
    best = max(scores, key=scores.get)
    return best, scores[best], scores.get(0, 0.0)


def main():
    out = io.open(os.path.join(ROOT, "tmpdiag", "zh_shift.txt"), "w", encoding="utf-8")
    rows = []
    for slug in changed_slugs():
        rel = f"public/data/{slug}.json"
        new = old_version(rel, BASE)
        old = old_version(rel, BASE + "~1")
        if not new or not old:
            continue
        ns, os_ = new.get("sentences", []), old.get("sentences", [])
        if len(ns) != len(os_):
            out.write(f"{slug}\tLEN-MISMATCH {len(ns)} vs {len(os_)}\n")
            continue
        k, best_score, zero_score = best_shift([s["zh"] for s in ns], [s["zh"] for s in os_])
        rows.append((slug, k, best_score, zero_score, len(ns)))
        out.write(f"{slug}\tshift={k}\tbest={best_score:.3f}\tzero={zero_score:.3f}\tn={len(ns)}\n")
        print(f"{slug} shift={k} best={best_score:.3f} zero={zero_score:.3f}", flush=True)

    bad = [r for r in rows if r[1] not in (0,)]
    out.write(f"\n总计 {len(rows)} 篇，位移非 0 的 {len(bad)} 篇\n")
    dist = Counter(r[1] for r in rows)
    out.write("位移分布: " + json.dumps(dict(sorted(dist.items())), ensure_ascii=False) + "\n")
    out.close()
    print(f"\n总计 {len(rows)} 篇，位移非 0 的 {len(bad)} 篇")
    print("位移分布:", dict(sorted(dist.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
