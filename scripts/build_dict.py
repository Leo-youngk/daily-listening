# -*- coding: utf-8 -*-
"""从 ECDICT 生成"只覆盖本语料"的精简离线词典分片。

数据来源：ECDICT (https://github.com/skywind3000/ECDICT)，MIT License。
本脚本不修改词条内容，只做筛选、裁剪与分片。

产物：
    public/dict/index.json      词典版本 + 分片清单
    public/dict/<shard>.json    分片，键为语料中出现的表面词形 / 词组

分片键 = 词条去掉非字母字符后的前两个字母（不足两位补 '_'），
前端用同一函数计算，点击一次只下载一个分片。
"""
import collections
import csv
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"
OUT_DIR = ROOT / "public" / "dict"
ECDICT_CSV = ROOT / "scripts" / ".vendor" / "ecdict.csv"
LEMMA_TXT = ROOT / "scripts" / ".vendor" / "lemma.en.txt"

DICT_VERSION = "ecdict-1.0.28-r1"

WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
POS_LINE_RE = re.compile(r"^([a-z]+\.(?:\s*&\s*[a-z]+\.)*)\s*(.+)$")
DROP_LINE_PREFIXES = ("[网络]",)

MAX_SENSES = 6
MAX_ZH_LEN = 60
MAX_EN_LEN = 160


def shard_key(term: str) -> str:
    t = re.sub(r"[^a-z]", "", term.lower())
    if not t:
        return "_"
    return t[:2] if len(t) >= 2 else t + "_"


def norm(word: str) -> str:
    return word.lower().replace("’", "'").strip("-'")


def load_lemma_map() -> dict[str, str]:
    """lemma.en.txt: "lemma -> form1,form2,..."，返回 形式 -> 原形。"""
    m: dict[str, str] = {}
    for line in LEMMA_TXT.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith(";") or "->" not in line:
            continue
        head, forms = line.split("->", 1)
        lemma = norm(head.split("/")[0])
        if not lemma:
            continue
        for f in forms.split(","):
            f = norm(f.split("/")[0])
            if f and f != lemma and f not in m:
                m[f] = lemma
    return m


def parse_exchange(exchange: str) -> tuple[str | None, list[str]]:
    """解析 ECDICT exchange 字段，返回 (原形, 该词的其他变位形式)。"""
    lemma = None
    forms: list[str] = []
    for part in exchange.split("/"):
        if ":" not in part:
            continue
        tag, val = part.split(":", 1)
        val = norm(val)
        if not val:
            continue
        if tag == "0":
            lemma = val
        elif tag in ("p", "d", "i", "3", "s", "r", "t"):
            forms.append(val)
    return lemma, forms


def parse_translation(translation: str) -> list[dict[str, str]]:
    senses: list[dict[str, str]] = []
    for raw in translation.replace("\\n", "\n").split("\n"):
        line = raw.strip()
        if not line or line.startswith(DROP_LINE_PREFIXES):
            continue
        m = POS_LINE_RE.match(line)
        if m:
            pos = m.group(1).replace(" ", "")
            zh = m.group(2).strip()
        else:
            pos = ""
            zh = line
        if not zh:
            continue
        if len(zh) > MAX_ZH_LEN:
            zh = zh[: MAX_ZH_LEN - 1] + "…"
        senses.append({"pos": pos, "zh": zh})
        if len(senses) >= MAX_SENSES:
            break
    return senses


def short_definition(definition: str) -> str:
    lines = [l.strip() for l in definition.replace("\\n", "\n").split("\n") if l.strip()]
    if not lines:
        return ""
    text = "; ".join(lines[:2])
    return text[: MAX_EN_LEN - 1] + "…" if len(text) > MAX_EN_LEN else text


def collect_corpus() -> tuple[set[str], set[str], int, int]:
    """返回 (表面词形, 相邻 2/3 词组合, 素材数, 句子数)"""
    words: set[str] = set()
    ngrams: set[str] = set()
    talks = sentences = 0
    for path in sorted(DATA_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"  跳过无法解析的素材：{path.name}", file=sys.stderr)
            continue
        if "sentences" not in data:
            continue
        talks += 1
        for s in data["sentences"]:
            en = s.get("en") or ""
            if not en:
                continue
            sentences += 1
            toks = [norm(w) for w in WORD_RE.findall(en)]
            toks = [t for t in toks if t]
            words.update(toks)
            for i in range(len(toks)):
                if i + 1 < len(toks):
                    ngrams.add(f"{toks[i]} {toks[i + 1]}")
                if i + 2 < len(toks):
                    ngrams.add(f"{toks[i]} {toks[i + 1]} {toks[i + 2]}")
    return words, ngrams, talks, sentences


def main() -> None:
    if not ECDICT_CSV.exists():
        raise SystemExit(f"缺少 ECDICT 词库：{ECDICT_CSV}\n执行 scripts/fetch_ecdict.py 下载。")

    print("扫描语料…")
    words, ngrams, talks, sentences = collect_corpus()
    print(f"  素材 {talks} 篇 / 句子 {sentences} 句 / 表面词形 {len(words)} 个 / 相邻组合 {len(ngrams)} 个")

    print("载入 lemma 表…")
    lemma_map = load_lemma_map()

    # 语料里出现的词组候选，也要考虑首词还原后的形式（figured out -> figure out）
    ngram_lookup: dict[str, set[str]] = collections.defaultdict(set)
    for g in ngrams:
        parts = g.split(" ")
        ngram_lookup[g].add(g)
        base = lemma_map.get(parts[0])
        if base:
            ngram_lookup[" ".join([base] + parts[1:])].add(g)

    wanted_single = set(words)
    for w in words:
        base = lemma_map.get(w)
        if base:
            wanted_single.add(base)

    print("扫描 ECDICT…")
    csv.field_size_limit(10_000_000)
    raw_entries: dict[str, dict] = {}
    exchange_lemma: dict[str, str] = {}
    total = 0
    with ECDICT_CSV.open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            total += 1
            key = norm(row["word"] or "")
            if not key:
                continue
            is_phrase = " " in key
            if is_phrase:
                if key not in ngram_lookup:
                    continue
            elif key not in wanted_single:
                continue

            senses = parse_translation(row.get("translation") or "")
            definition = short_definition(row.get("definition") or "")
            if not senses and not definition:
                continue

            lemma_from_exchange, forms = parse_exchange(row.get("exchange") or "")
            if lemma_from_exchange and lemma_from_exchange != key:
                exchange_lemma[key] = lemma_from_exchange
            for f in forms:
                exchange_lemma.setdefault(f, key)

            try:
                frq = int(row.get("frq") or 0)
            except ValueError:
                frq = 0
            try:
                bnc = int(row.get("bnc") or 0)
            except ValueError:
                bnc = 0

            raw_entries[key] = {
                "ph": (row.get("phonetic") or "").strip(),
                "senses": senses,
                "en": definition,
                "rank": frq or bnc or 0,
            }
    print(f"  ECDICT 共 {total} 条，命中 {len(raw_entries)} 条")

    def resolve_lemma(w: str) -> str:
        for cand in (exchange_lemma.get(w), lemma_map.get(w)):
            if cand and cand in raw_entries:
                return cand
        return w

    print("生成分片…")
    shards: dict[str, dict[str, dict]] = collections.defaultdict(dict)

    def emit(term: str, lemma: str) -> None:
        # 屈折形式自身的词条通常只写"xxx的过去式"，义项要取原形的，
        # 且直接内联，避免前端为一次点击发两次分片请求
        src = raw_entries[lemma if lemma in raw_entries else term]
        rec = {"lemma": lemma, "senses": src["senses"]}
        if src["ph"]:
            rec["ph"] = src["ph"]
        if src["en"]:
            rec["en"] = src["en"]
        if src["rank"]:
            rec["rank"] = src["rank"]
        if term != lemma:
            own = raw_entries.get(term)
            note = own["senses"][0]["zh"] if own and own["senses"] else ""
            if note and len(note) <= 24:
                rec["note"] = note
        shards[shard_key(term)][term] = rec

    for w in sorted(words):
        lemma = resolve_lemma(w)
        if w in raw_entries or lemma in raw_entries:
            emit(w, lemma)

    # 词组：ECDICT 里存在的固定搭配，按语料中的实际写法也建一份键
    phrase_count = 0
    for key, surfaces in ngram_lookup.items():
        if key not in raw_entries:
            continue
        phrase_count += 1
        emit(key, key)
        for surface in surfaces:
            if surface != key:
                emit(surface, key)

    if OUT_DIR.exists():
        for old in OUT_DIR.glob("*.json"):
            old.unlink()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest = {}
    total_bytes = 0
    for name, entries in sorted(shards.items()):
        payload = json.dumps(
            {"v": DICT_VERSION, "entries": entries},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        (OUT_DIR / f"{name}.json").write_text(payload, encoding="utf-8")
        manifest[name] = len(entries)
        total_bytes += len(payload.encode("utf-8"))

    (OUT_DIR / "index.json").write_text(
        json.dumps(
            {
                "v": DICT_VERSION,
                "source": "ECDICT (https://github.com/skywind3000/ECDICT), MIT License",
                "shards": manifest,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    sizes = sorted(
        ((OUT_DIR / f"{n}.json").stat().st_size, n) for n in manifest
    )
    print(f"  分片 {len(manifest)} 个 / 词条 {sum(manifest.values())} 条 / 词组 {phrase_count} 个")
    print(f"  总体积 {total_bytes / 1024 / 1024:.2f} MB，最大分片 {sizes[-1][1]}.json {sizes[-1][0] / 1024:.0f} KB")
    missing = sorted(w for w in words if shard_key(w) not in shards or w not in shards[shard_key(w)])
    print(f"  语料中未收录 {len(missing)} 个词形（多为专有名词），示例：{missing[:10]}")


if __name__ == "__main__":
    main()
