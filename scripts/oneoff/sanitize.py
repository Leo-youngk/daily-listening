# -*- coding: utf-8 -*-
"""去掉语料 JSON 中所有字符串字段的 \\r\\n 残留"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")


def strip(obj):
    if isinstance(obj, str):
        return obj.replace("\r", "").strip()
    if isinstance(obj, list):
        return [strip(x) for x in obj]
    if isinstance(obj, dict):
        return {k: strip(v) for k, v in obj.items()}
    return obj


for name in ("ted_top100.json", "resolved.json"):
    path = os.path.join(CORPUS, name)
    data = strip(json.load(open(path, encoding="utf-8")))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"sanitized {name} ({len(data)} entries)")
