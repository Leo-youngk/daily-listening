# -*- coding: utf-8 -*-
"""为已入库但中文缺失的句子补机译（逐句调用，失败重试）"""
import json, os, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "public", "data")
SLUGS = ["pattie_maes_demos_the_sixth_sense",
         "reggie_watts_disorients_you_in_the_most_entertaining_way",
         "atul-gawande-commencement"]

from deep_translator import GoogleTranslator
tr = GoogleTranslator(source="en", target="zh-CN")


def trans(text: str) -> str:
    words = text.split()
    if len(words) > 280:  # 超长句切块
        parts = []
        for i in range(0, len(words), 280):
            chunk = " ".join(words[i:i + 280])
            try:
                parts.append(tr.translate(chunk) or "")
            except Exception:
                parts.append("")
            time.sleep(0.4)
        return "".join(parts)
    for attempt in range(3):
        try:
            out = tr.translate(text)
            if out:
                return out
        except Exception:
            time.sleep(1.5 + attempt)
    return ""


for slug in SLUGS:
    path = os.path.join(DATA, slug + ".json")
    d = json.load(open(path, encoding="utf-8"))
    missing = [s for s in d["sentences"] if not s["zh"].strip()]
    print(f"{slug}: {len(missing)} missing", flush=True)
    for i, s in enumerate(missing, 1):
        zh = trans(s["en"])
        if zh:
            s["zh"] = zh
        if i % 10 == 0:
            print(f"  {i}/{len(missing)}", flush=True)
        time.sleep(0.3)
    still = sum(1 for s in d["sentences"] if not s["zh"].strip())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    total = len(d["sentences"])
    print(f"  coverage now {total - still}/{total}", flush=True)
print("done")
