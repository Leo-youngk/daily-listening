# -*- coding: utf-8 -*-
"""Gemini 批量翻译字幕（英 -> 简体中文）。

- 一集一次请求（超过 CHUNK 句才分块，块首带前文几句做上下文），整篇有上下文，译文比逐句机翻连贯。
- responseSchema 强制返回字符串数组；数量不等或有空值就重试，仍不行就抛错阻断构建，绝不写半截数据。
- 免费层每个模型每天只有少量请求：按质量排一串 Gemini 3.x 模型轮流用，额度用完自动换下一个并打印提示。
- 缓存 corpus/zh/<slug>.json：英文句子列表不变就不重翻。
- key 只从仓库根目录 .env.google.local 读（已 gitignore），不进命令行、不进代码。
"""
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(HERE, "corpus", "zh")
ENV_FILE = os.path.join(ROOT, ".env.google.local")
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
# 免费层按模型分别限"每天请求数"（flash 约 20 次/天），所以按译文质量排一串模型轮流用：
# 某个模型当天额度用完就换下一个，每集用的模型记进缓存和数据（zhModel），降级看得见。
MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    # 别名模型单独计额度：前面的都用完时兜底（它们也会照抄英文，由 _is_chinese 拦下）
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]
CHUNK = 320
CONTEXT = 3
SERIES_NAME = {"bbc": "BBC 6 Minute English", "curious": "English Learning for Curious Minds",
               "thinking": "Thinking in English"}

_exhausted = set()
_overloaded = {}  # 模型 -> 连续过载次数
_lock = threading.Lock()
# 同一个模型连续过载这么多次，这一轮就不再用它
MAX_OVERLOAD = 3


class TranslationError(RuntimeError):
    pass


_echoed = {}  # 模型 -> 原样照抄英文的次数
MAX_ECHO = 2
_CJK = re.compile(r"[一-鿿]")


def _is_chinese(out):
    """至少九成句子含汉字才算翻译了（纯人名、"OK." 这类短句允许保留英文）。"""
    return sum(1 for z in out if _CJK.search(z)) >= 0.9 * len(out)


class _CountMismatch(Exception):
    """模型对长列表反复漏句/并句：交给调用方拆小块再翻。"""


# 同一块连续这么多次数量不符，就拆成两半重翻；块小于 MIN_SPLIT 句不再拆
MAX_MISMATCH = 2
MIN_SPLIT = 12


def _key():
    if os.environ.get("GOOGLE_API_KEY"):
        return os.environ["GOOGLE_API_KEY"]
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            if line.startswith("GOOGLE_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise TranslationError("缺少 GOOGLE_API_KEY（仓库根目录 .env.google.local）")


def _prompt(series, title, context, sentences):
    parts = [
        f"下面是英语学习播客《{SERIES_NAME.get(series, series)}》一期节目（标题：{title}）的字幕，按顺序给出。",
        "请把 JSON 数组里的每一句英文翻译成自然、准确的简体中文字幕。",
        "要求：输出与输入等长的 JSON 字符串数组，一一对应；不合并、不拆分、不增删；",
        "人名、节目名保留英文原文；习语按意思译；忠实原意，口语化但不添油加醋。",
    ]
    if context:
        parts.append("（仅供理解上下文、不要翻译的前文：" + " ".join(context) + "）")
    parts.append(json.dumps(sentences, ensure_ascii=False))
    return "\n".join(parts)


def _call(model, prompt, key):
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {"type": "ARRAY", "items": {"type": "STRING"}},
            "temperature": 0.2,
        },
    }
    req = urllib.request.Request(API.format(model=model, key=key), data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def _retry_delay(err_body, fallback):
    m = re.search(r'"retryDelay":\s*"(\d+(?:\.\d+)?)s"', err_body or "")
    return float(m.group(1)) + 1 if m else fallback


def _next_model():
    with _lock:
        for model in MODELS:
            if model not in _exhausted:
                return model
    raise TranslationError("所有模型今天的免费额度都用完了，明天再跑（已翻完的都在缓存里，不会重翻）")


def _exhaust(model, why):
    with _lock:
        if model in _exhausted:
            return
        _exhausted.add(model)
    later = [m for m in MODELS if m not in _exhausted]
    print(f"    !! {model} {why}，改用 {later[0] if later else '（无可用模型）'}", flush=True)


def _translate_chunk(series, title, context, sentences, key):
    prompt = _prompt(series, title, context, sentences)
    delay = 10.0
    mismatches = 0
    for _attempt in range(12):
        model = _next_model()
        try:
            out = _call(model, prompt, key)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code == 429 and "PerDay" in body:
                _exhaust(model, "今日免费额度用完")
                continue
            if e.code == 404:
                _exhaust(model, "不可用")
                continue
            if e.code in (500, 503):
                with _lock:
                    _overloaded[model] = _overloaded.get(model, 0) + 1
                    streak = _overloaded[model]
                if streak >= MAX_OVERLOAD:
                    _exhaust(model, f"连续 {streak} 次过载")
                    continue
            if e.code in (429, 500, 503):
                wait = _retry_delay(body, delay)
                print(f"    .. {model} HTTP {e.code}，{wait:.0f}s 后重试", flush=True)
                time.sleep(wait)
                delay = min(delay * 2, 120)
                continue
            raise TranslationError(f"Gemini HTTP {e.code}: {body[:200]}")
        except Exception as e:  # 网络中断、JSON 解析失败
            print(f"    .. {model} 异常 {type(e).__name__}，重试", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 120)
            continue
        with _lock:
            _overloaded[model] = 0
        if (isinstance(out, list) and len(out) == len(sentences)
                and all(isinstance(z, str) and z.strip() for z in out)):
            if _is_chinese(out):
                return [z.strip() for z in out], model
            # 小模型偶尔把英文原样吐回来：句数对得上但没翻，同一模型连续两次就换下一个
            with _lock:
                _echoed[model] = _echoed.get(model, 0) + 1
                streak = _echoed[model]
            print(f"    .. {model} 返回的不是中文（原样照抄英文），重试", flush=True)
            if streak >= MAX_ECHO:
                _exhaust(model, f"连续 {streak} 次没翻译")
            continue
        print(f"    .. {model} 译文数量/内容不合规（{len(out) if isinstance(out, list) else '?'} vs {len(sentences)}），重试", flush=True)
        mismatches += 1
        if mismatches >= MAX_MISMATCH and len(sentences) >= MIN_SPLIT:
            raise _CountMismatch()
    raise TranslationError("Gemini 多次重试仍未返回合规译文")


def _translate_span(series, title, sentences, start, end, key):
    """翻 sentences[start:end]；模型反复对不上句数时对半拆开递归翻，块首带前文做上下文。"""
    chunk = sentences[start:end]
    context = sentences[max(0, start - CONTEXT):start]
    try:
        zh, model = _translate_chunk(series, title, context, chunk, key)
        return zh, {model}
    except _CountMismatch:
        mid = (start + end) // 2
        print(f"    .. 第 {start}-{end} 句拆成两半重翻", flush=True)
        a, ma = _translate_span(series, title, sentences, start, mid, key)
        b, mb = _translate_span(series, title, sentences, mid, end, key)
        return a + b, ma | mb


def translate_episode(slug, series, title, sentences):
    """返回 (中文列表, 所用模型)。英文不变时直接读缓存。"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    digest = hashlib.sha1("\n".join(sentences).encode("utf-8")).hexdigest()
    cache_path = os.path.join(CACHE_DIR, slug + ".json")
    if os.path.exists(cache_path):
        cached = json.load(open(cache_path, encoding="utf-8"))
        # 早期缓存里有整集照抄英文的"译文"，不算数，重翻
        if (cached.get("hash") == digest and len(cached.get("zh", [])) == len(sentences)
                and _is_chinese(cached["zh"])):
            return cached["zh"], cached.get("model", MODELS[0])
    key = _key()
    out, models = [], set()
    for start in range(0, len(sentences), CHUNK):
        zh, used = _translate_span(series, title, sentences, start, min(start + CHUNK, len(sentences)), key)
        out.extend(zh)
        models |= used
    # 一集分块翻译时可能跨了模型，记质量最低的那个
    model = max(models, key=MODELS.index)
    tmp = cache_path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"hash": digest, "model": model, "zh": out}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, cache_path)
    return out, model
