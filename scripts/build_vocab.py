# -*- coding: utf-8 -*-
"""背单词的静态数据：六级词表、原声例句索引、每集词汇信息。

产物：
    public/wordbook/cet6.json      六级词表：[词, 音标, 简明释义, 词频名次, 级别]；级别 6 = 六级新增（不在
                                   四级/中高考词表里），4 = 四级及以下也要求。六级新增在前，各自按词频从高到低
    public/wordbook/episodes.json  每集出现的六级词（词表下标），首页推荐与"本集词汇"用
    public/examples/<分片>.json    每个六级词最多 5 条原声例句（句子已切成独立音频，见 cut_clips.py）
    public/examples/index.json     版本与切句音频地址前缀
    public/data/<slug>.json        写回 lemmas：本集出现的六级词表面形式 -> 词表原形（字幕上色用）
    public/data/manifest.json      写回 cet6 / hard：本集六级词数、超纲词数（难度参考）

词表来源：ECDICT 的 tag 字段（cet6），MIT License。
"""
import collections
import csv
import json
import re
import sys
from pathlib import Path

from build_dict import ECDICT_CSV, load_lemma_map, norm, parse_exchange, parse_translation, shard_key
from data_io import write_manifest, write_talk

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
WORDBOOK_DIR = ROOT / "public" / "wordbook"
EXAMPLES_DIR = ROOT / "public" / "examples"
# 切句原声与页面同源，见 build_talks.MEDIA_BASE
MEDIA_BASE = "/audio"
VERSION = "cet6-r1"

# 必须与 app/src/lib/lookup.ts 的 WORD_RE 一致：例句里的词下标直接对应字幕的 data-w
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
BASIC_TAGS = {"zk", "gk", "cet4"}
MAX_EXAMPLES = 5
MAX_PER_EPISODE = 2


DOMAIN_RE = re.compile(r"\[[^\]]*\]")


def brief(translation):
    """背词卡用的简明释义：每个词性只留前 3 个义项，去掉 [计] [法] 这类专业义项。"""
    senses = parse_translation(translation)
    # 有词性标注的是正式义项；没标词性的多是网络释义，只在没有正式义项时才用
    formal = [s for s in senses if s["pos"]] or senses
    parts, seen = [], set()
    for sense in formal[:3]:
        items = [x.strip() for x in re.split(r"[,，;；]", DOMAIN_RE.sub("", sense["zh"])) if x.strip()]
        items = [x for x in items if x not in seen][:3]
        seen.update(items)
        if items:
            parts.append(f"{sense['pos']} {'，'.join(items)}".strip())
    text = "；".join(parts[:2])
    return text if len(text) <= 36 else text[:35] + "…"


def load_ecdict():
    """返回 (六级词 -> 词条, 屈折形式 -> 原形, 词 -> 标签集合, 词 -> 词频名次)"""
    csv.field_size_limit(10_000_000)
    cet6, exchange, tags, rank = {}, {}, {}, {}
    with ECDICT_CSV.open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            word = (row["word"] or "").strip()
            key = norm(word)
            if not key or " " in key:
                continue
            tagset = set((row.get("tag") or "").split())
            tags[key] = tags.get(key, set()) | tagset
            try:
                frq = int(row.get("frq") or 0)
            except ValueError:
                frq = 0
            try:
                bnc = int(row.get("bnc") or 0)
            except ValueError:
                bnc = 0
            rank[key] = frq or bnc or 0
            lemma, forms = parse_exchange(row.get("exchange") or "")
            if lemma and lemma != key:
                exchange.setdefault(key, lemma)
            for f in forms:
                exchange.setdefault(f, key)
            if "cet6" in tagset and word.isalpha() and word.islower():
                cet6[key] = {"ph": (row.get("phonetic") or "").strip(), "zh": brief(row.get("translation") or ""),
                             "rank": frq or bnc or 0, "tier": 4 if tagset & BASIC_TAGS else 6}
    return cet6, exchange, tags, rank


def main():
    if not ECDICT_CSV.exists():
        raise SystemExit(f"缺少 ECDICT 词库：{ECDICT_CSV}（执行 scripts/fetch_ecdict.py 下载）")
    print("载入 ECDICT…")
    cet6, exchange, tags, rank = load_ecdict()
    lemma_map = load_lemma_map()
    # 六级新增在前；同级内有词频的按词频升序，没词频的排最后（按字母）
    words = sorted(cet6, key=lambda w: (cet6[w]["tier"] != 6, cet6[w]["rank"] <= 0, cet6[w]["rank"], w))
    index = {w: k for k, w in enumerate(words)}
    print(f"  六级词 {len(words)} 个")

    def to_cet6(surface):
        w = norm(surface)
        if w.endswith("'s"):
            w = w[:-2]
        for cand in (w, exchange.get(w), lemma_map.get(w)):
            if cand in cet6:
                return cand
        return None

    def is_hard(surface, position):
        """超纲：不在中高考/四六级词表里、且词频在 5000 名之后的词；句中大写的当专名跳过。"""
        w = norm(surface)
        if w.endswith("'s"):
            w = w[:-2]
        base = exchange.get(w) or lemma_map.get(w) or w
        if base not in tags and w not in tags:
            return None
        if position > 0 and surface[0].isupper():
            return None
        t = tags.get(base, set()) | tags.get(w, set())
        if t & (BASIC_TAGS | {"cet6"}):
            return None
        r = rank.get(base) or rank.get(w) or 0
        return base if (r == 0 or r > 5000) else None

    candidates = collections.defaultdict(list)
    episode_words = {}
    manifest = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    stats = {}
    for item in manifest:
        slug = item["slug"]
        path = DATA_DIR / f"{slug}.json"
        talk = json.loads(path.read_text(encoding="utf-8"))
        sentences = talk["sentences"]
        lemmas, seen, hard = {}, set(), set()
        for s in sentences:
            tokens = WORD_RE.findall(s["en"])
            dur = s["end"] - s["start"]
            for wi, tok in enumerate(tokens):
                lemma = to_cet6(tok)
                if lemma:
                    lemmas[norm(tok)] = lemma
                    seen.add(lemma)
                    # 例句打分：长度适中、时长适中、有中文、不是片头片尾的寒暄
                    score = -abs(len(tokens) - 14) * 0.2 - abs(dur - 6) * 0.15
                    if not (6 <= len(tokens) <= 28) or not (2.0 <= dur <= 13.0) or not s.get("zh"):
                        score -= 10
                    if s["i"] < 2 or s["i"] >= len(sentences) - 2:
                        score -= 5
                    candidates[lemma].append((score, slug, s["i"], wi, s["en"], s["zh"], s["start"], s["end"]))
                else:
                    h = is_hard(tok, wi)
                    if h:
                        hard.add(h)
        talk["lemmas"] = dict(sorted(lemmas.items()))
        write_talk(path, talk)
        episode_words[slug] = sorted(index[w] for w in seen)
        stats[slug] = {"cet6": len(seen), "hard": len(hard)}

    for item in manifest:
        item.update(stats[item["slug"]])
    write_manifest(DATA_DIR / "manifest.json", manifest)

    # 每个词挑最多 5 条：分数高的优先，同一集最多 2 条，尽量覆盖不同节目
    shards = collections.defaultdict(dict)
    covered = 0
    for lemma, cands in candidates.items():
        cands.sort(key=lambda c: -c[0])
        picked, per_episode = [], collections.Counter()
        for c in cands:
            if per_episode[c[1]] >= MAX_PER_EPISODE:
                continue
            per_episode[c[1]] += 1
            _, slug, i, wi, en, zh, a, b = c
            picked.append({"s": slug, "i": i, "w": wi, "en": en, "zh": zh, "a": a, "b": b})
            if len(picked) >= MAX_EXAMPLES:
                break
        if picked:
            covered += 1
            shards[shard_key(lemma)][lemma] = picked

    WORDBOOK_DIR.mkdir(parents=True, exist_ok=True)
    EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    for old in EXAMPLES_DIR.glob("*.json"):
        old.unlink()
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    (WORDBOOK_DIR / "cet6.json").write_text(json.dumps({
        "v": VERSION,
        "source": "ECDICT (https://github.com/skywind3000/ECDICT), MIT License",
        "words": [[w, cet6[w]["ph"], cet6[w]["zh"], cet6[w]["rank"], cet6[w]["tier"]] for w in words],
    }, **compact) + "\n", encoding="utf-8")
    (WORDBOOK_DIR / "episodes.json").write_text(json.dumps({"v": VERSION, "episodes": episode_words}, **compact) + "\n",
                                                encoding="utf-8")
    for name, entries in sorted(shards.items()):
        (EXAMPLES_DIR / f"{name}.json").write_text(json.dumps({"v": VERSION, "entries": entries}, **compact) + "\n",
                                                   encoding="utf-8")
    (EXAMPLES_DIR / "index.json").write_text(json.dumps({
        "v": VERSION,
        "clipBase": f"{MEDIA_BASE}/v1/clips",
        "words": covered,
        "shards": sorted(shards),
    }, **compact) + "\n", encoding="utf-8")

    with_3 = sum(1 for e in (shards[shard_key(w)].get(w, []) for w in words) if len(e) >= 3)
    print(f"  有原声例句的六级词 {covered}/{len(words)}（{covered / len(words):.0%}），≥3 条 {with_3 / len(words):.0%}")
    print(f"  例句分片 {len(shards)} 个；每集六级词中位数 "
          f"{sorted(s['cet6'] for s in stats.values())[len(stats) // 2]}，超纲词中位数 "
          f"{sorted(s['hard'] for s in stats.values())[len(stats) // 2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
