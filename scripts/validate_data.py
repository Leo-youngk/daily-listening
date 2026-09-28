# -*- coding: utf-8 -*-
"""public/data 的结构校验闸门。

这批 JSON 是整个应用最脆的一环：由十几个抓取/对齐脚本先后写入，出过并发覆写、
半截文件、字段分叉。前端只做 typecheck，运行时拿到脏数据只会静默错位，
所以把不变量固化在这里，接进 CI。

最关键的一条是词级时间轴长度必须等于前端 tokenizeSentence 分出的词数——
Sentence.w 的下标直接当作 DOM 里 data-w 的下标用，一旦对不上就是词高亮整句错格。

用法：
    python scripts/validate_data.py            # 全量校验，有 ERROR 时退出码 1
    python scripts/validate_data.py --quiet    # 只打印问题与汇总
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"

# 必须与 app/src/lib/lookup.ts 的 WORD_RE 逐字一致
WORD_RE = re.compile("[A-Za-z][A-Za-z'’-]*")

CATEGORIES = {"bbc", "curious", "thinking"}
ZH_SOURCES = {"mt"}
W_SOURCES = {"asr"}
REQUIRED = ("slug", "title", "speaker", "category", "date", "duration", "cover",
            "audioUrls", "zhSource", "keywords", "sentences")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# 时间轴容差：对齐脚本按毫秒取整，允许句界外溢一点
TIME_EPS = 0.05
# 句子重叠超过这个秒数，前端 sentenceAt 会触发回退分支，高亮行为变得不可预期
MAX_OVERLAP = 0.3


def token_count(text):
    return len(WORD_RE.findall(text))


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, message):
        self.errors.append(where + ": " + message)

    def warn(self, where, message):
        self.warnings.append(where + ": " + message)


def check_meta(slug, talk, rep):
    where = slug
    for key in REQUIRED:
        if key not in talk:
            rep.error(where, "缺字段 " + key)
    if talk.get("slug") != slug:
        rep.error(where, "slug 与文件名不符（%r）" % (talk.get("slug"),))
    if talk.get("category") not in CATEGORIES:
        rep.error(where, "category 非法：%r" % (talk.get("category"),))
    if talk.get("zhSource") not in ZH_SOURCES:
        rep.error(where, "zhSource 非法：%r" % (talk.get("zhSource"),))
    if "wSource" in talk and talk["wSource"] not in W_SOURCES:
        rep.error(where, "wSource 非法：%r" % (talk["wSource"],))

    duration = talk.get("duration")
    if not isinstance(duration, (int, float)) or duration <= 0:
        rep.error(where, "duration 非法：%r" % (duration,))

    urls = talk.get("audioUrls")
    if not isinstance(urls, dict):
        rep.error(where, "audioUrls 不是对象")
    else:
        for quality in ("standard", "high"):
            value = urls.get(quality)
            if not isinstance(value, str) or not value.startswith("http"):
                rep.error(where, "audioUrls.%s 非法：%r" % (quality, value))

    cover = talk.get("cover")
    if not isinstance(cover, str) or not cover.startswith("/covers/"):
        rep.error(where, "cover 非法：%r" % (cover,))
    elif not (ROOT / "public" / cover.lstrip("/")).is_file():
        rep.error(where, "封面文件不存在：%s" % (cover,))

    if not isinstance(talk.get("date"), str) or not DATE_RE.match(talk.get("date") or ""):
        rep.error(where, "date 非法：%r" % (talk.get("date"),))

    keywords = talk.get("keywords")
    if not isinstance(keywords, list):
        rep.error(where, "keywords 不是数组")
    else:
        for k, item in enumerate(keywords):
            if not isinstance(item, dict) or not str(item.get("term", "")).strip() or not str(item.get("def", "")).strip():
                rep.error(where, "keywords[%d] 缺 term/def：%r" % (k, item))


def check_sentences(slug, talk, rep):
    """返回本篇的统计，供汇总用"""
    where = slug
    sentences = talk.get("sentences")
    stat = {"n": 0, "with_w": 0, "overlaps": 0}
    if not isinstance(sentences, list) or not sentences:
        rep.error(where, "sentences 为空或不是数组")
        return stat

    duration = talk.get("duration") or 0
    stat["n"] = len(sentences)
    # 模型把英文原样吐回来时句数照样对得上，只能看译文里有没有汉字
    untranslated = sum(1 for s in sentences
                       if isinstance(s, dict) and not re.search(r"[一-鿿]", str(s.get("zh") or "")))
    if untranslated > 0.1 * len(sentences):
        rep.error(where, "%d/%d 句的 zh 没有中文（译文照抄了英文）" % (untranslated, len(sentences)))
    previous_end = None
    previous_start = None

    for index, sentence in enumerate(sentences):
        tag = "%s[%d]" % (slug, index)
        if not isinstance(sentence, dict):
            rep.error(tag, "句子不是对象")
            continue

        if sentence.get("i") != index:
            rep.error(tag, "i 与下标不符：%r" % (sentence.get("i"),))

        english = sentence.get("en")
        if not isinstance(english, str) or not english.strip():
            rep.error(tag, "en 为空")
            english = ""
        if not isinstance(sentence.get("zh"), str):
            rep.error(tag, "zh 不是字符串：%r" % (sentence.get("zh"),))

        start = sentence.get("start")
        end = sentence.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            rep.error(tag, "start/end 不是数字：%r %r" % (start, end))
            continue
        if start < -TIME_EPS:
            rep.error(tag, "start 为负：%s" % (start,))
        if end <= start:
            rep.error(tag, "end <= start：%s -> %s" % (start, end))
        if duration and end > duration + 1.0:
            rep.error(tag, "end 超出时长：%s > %s" % (end, duration))

        if previous_start is not None and start < previous_start:
            rep.error(tag, "start 非单调：%s < 上一句 %s" % (start, previous_start))
        if previous_end is not None and start < previous_end - TIME_EPS:
            overlap = previous_end - start
            stat["overlaps"] += 1
            if overlap > MAX_OVERLAP:
                rep.warn(tag, "与上一句重叠 %.2fs，高亮会走回退分支" % overlap)
        previous_start, previous_end = start, end

        words = sentence.get("w")
        if words is None:
            continue
        stat["with_w"] += 1
        if not isinstance(words, list) or not words:
            rep.error(tag, "w 不是非空数组")
            continue
        if len(words) % 2:
            rep.error(tag, "w 长度是奇数：%d" % len(words))
            continue

        expected = token_count(english)
        if len(words) // 2 != expected:
            rep.error(tag, "w 词数 %d != tokenizeSentence 的 %d（词高亮会整句错格）"
                      % (len(words) // 2, expected))
            continue

        bad_pair = None
        for k in range(0, len(words), 2):
            a, b = words[k], words[k + 1]
            if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or a > b + TIME_EPS:
                bad_pair = k
                break
        if bad_pair is not None:
            rep.error(tag, "w[%d] 的 start/end 非法：%r %r"
                      % (bad_pair, words[bad_pair], words[bad_pair + 1]))
            continue

        starts = words[0::2]
        if any(b < a - TIME_EPS for a, b in zip(starts, starts[1:])):
            rep.error(tag, "w 的词起点非单调")
        if words[0] < start - 0.5 or words[-1] > end + 0.5:
            rep.warn(tag, "w 超出句界：[%.2f,%.2f] vs [%.2f,%.2f]"
                     % (words[0], words[-1], start, end))

    if 0 < stat["with_w"] < stat["n"]:
        rep.warn(where, "词级时间轴只覆盖 %d/%d 句" % (stat["with_w"], stat["n"]))
    if stat["with_w"] and "wSource" not in talk:
        rep.error(where, "有词级时间轴却没有 wSource")
    if talk.get("wSource") and not stat["with_w"]:
        rep.error(where, "声明了 wSource=%s 却没有任何词级时间轴" % (talk["wSource"],))
    return stat


def check_format(slug, raw, rep):
    """写入格式必须走 data_io.write_talk，否则数据 diff 会退化成不可读的一整行"""
    if not raw.startswith("{\n  "):
        rep.error(slug, "不是 indent=2 展开格式，应改用 scripts/data_io.py 的 write_talk")
    if not raw.endswith("\n"):
        rep.error(slug, "文件结尾缺换行")
    if re.search(r'"w":\s*\[\s*\n', raw):
        rep.error(slug, "w 数组被展开成多行，应压成一行（见 scripts/data_io.py）")


def check_manifest(talks, rep):
    path = DATA / "manifest.json"
    if not path.is_file():
        rep.error("manifest.json", "文件不存在")
        return
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        rep.error("manifest.json", "无法解析：%s" % (exc,))
        return
    if not isinstance(items, list) or not items:
        rep.error("manifest.json", "不是非空数组")
        return

    listed = {}
    for item in items:
        slug = item.get("slug")
        if not slug:
            rep.error("manifest.json", "条目缺 slug：%s" % (str(item)[:80],))
            continue
        if slug in listed:
            rep.error("manifest.json", "slug 重复：%s" % (slug,))
        listed[slug] = item

    for slug in sorted(set(listed) - set(talks)):
        rep.error("manifest.json", "列了 %s，但 %s.json 不存在" % (slug, slug))
    for slug in sorted(set(talks) - set(listed)):
        rep.error("manifest.json", "%s.json 存在，但清单里没有" % (slug,))

    # 清单是列表页的唯一数据源，和详情页对不上就会出现"点进去换了一篇"
    for slug in sorted(listed):
        item = listed[slug]
        talk = talks.get(slug)
        if not talk:
            continue
        for key in ("title", "speaker", "category", "zhSource", "date", "cover"):
            if item.get(key) != talk.get(key):
                rep.error("manifest.json", "%s 的 %s 与正文不一致：%r vs %r"
                          % (slug, key, item.get(key), talk.get(key)))
        if abs((item.get("duration") or 0) - (talk.get("duration") or 0)) > 1.0:
            rep.error("manifest.json", "%s 的 duration 与正文不一致：%s vs %s"
                      % (slug, item.get("duration"), talk.get("duration")))


def check_vocab(talks, rep):
    """背词数据（build_vocab.py 产物）与语料一致：例句必须指向真实存在的句子，
    起点必须与句子一致——切句原声按"句子下标-起点厘秒"命名，对不上就是 404。"""
    book_path = ROOT / "public" / "wordbook" / "cet6.json"
    if not book_path.is_file():
        rep.error("wordbook", "缺少 public/wordbook/cet6.json（运行 build_vocab.py）")
        return
    words = json.loads(book_path.read_text(encoding="utf-8"))["words"]
    if len(words) < 5000:
        rep.error("wordbook", "六级词表只有 %d 词" % len(words))
    for row in words:
        if len(row) != 5 or row[4] not in (4, 6) or not row[0]:
            rep.error("wordbook", "词条格式非法：%r" % (row,))
            break

    episodes = json.loads((ROOT / "public" / "wordbook" / "episodes.json").read_text(encoding="utf-8"))["episodes"]
    if set(episodes) != set(talks):
        rep.error("wordbook", "episodes.json 与语料不一致：多 %s 少 %s"
                  % (sorted(set(episodes) - set(talks))[:3], sorted(set(talks) - set(episodes))[:3]))
    if any(k < 0 or k >= len(words) for idx in episodes.values() for k in idx):
        rep.error("wordbook", "episodes.json 里有越界的词表下标")

    examples_dir = ROOT / "public" / "examples"
    checked = 0
    for shard in sorted(examples_dir.glob("*.json")):
        if shard.name == "index.json":
            continue
        for term, items in json.loads(shard.read_text(encoding="utf-8"))["entries"].items():
            for ex in items:
                checked += 1
                where = "examples/%s:%s" % (shard.stem, term)
                talk = talks.get(ex["s"])
                if not talk or ex["i"] >= len(talk["sentences"]):
                    rep.error(where, "指向不存在的句子 %s#%s" % (ex["s"], ex["i"]))
                    continue
                sentence = talk["sentences"][ex["i"]]
                if sentence["en"] != ex["en"]:
                    rep.error(where, "例句文本与语料不一致（重跑 build_vocab.py）")
                if abs(sentence["start"] - ex["a"]) > 0.005:
                    rep.error(where, "例句起点与语料不一致，切句原声会 404（重跑 build_vocab.py 与 cut_clips.py）")
                if ex["w"] >= token_count(ex["en"]):
                    rep.error(where, "目标词下标越界：%s" % ex["w"])
    if not checked:
        rep.error("examples", "没有任何原声例句")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiet", action="store_true", help="不打印逐篇统计")
    args = parser.parse_args()

    rep = Report()
    talks = {}
    totals = Counter()

    files = sorted(p for p in DATA.glob("*.json") if p.name != "manifest.json")
    if not files:
        print("public/data 下没有语料文件", file=sys.stderr)
        return 1

    for path in files:
        slug = path.stem
        raw = path.read_text(encoding="utf-8")
        try:
            talk = json.loads(raw)
        except Exception as exc:
            rep.error(slug, "无法解析：%s" % (exc,))
            continue
        talks[slug] = talk
        check_format(slug, raw, rep)
        check_meta(slug, talk, rep)
        stat = check_sentences(slug, talk, rep)
        totals["talks"] += 1
        totals["sentences"] += stat["n"]
        totals["with_w"] += stat["with_w"]
        totals["overlaps"] += stat["overlaps"]
        if stat["n"] and stat["with_w"] == stat["n"]:
            totals["full_w_talks"] += 1

    check_manifest(talks, rep)
    check_vocab(talks, rep)

    for line in rep.warnings:
        print("[WARN ] " + line)
    for line in rep.errors:
        print("[ERROR] " + line)

    if not args.quiet:
        print()
        print("篇数 %d · 句数 %d" % (totals["talks"], totals["sentences"]))
        print("词级时间轴 %d/%d 句（整篇覆盖 %d/%d 篇）"
              % (totals["with_w"], totals["sentences"], totals["full_w_talks"], totals["talks"]))
        print("句间重叠 %d 处" % totals["overlaps"])
    print("\n%d 个错误，%d 个警告" % (len(rep.errors), len(rep.warnings)))
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
