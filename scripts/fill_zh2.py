# -*- coding: utf-8 -*-
"""剥离方括号舞台标签后翻译剩余缺失句"""
import json, os, re, time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "public", "data")
SLUGS = ["pattie_maes_demos_the_sixth_sense",
         "reggie_watts_disorients_you_in_the_most_entertaining_way"]

STAGE = {"music": "音乐", "applause": "掌声", "laughter": "笑声", "cheers": "欢呼"}

from deep_translator import GoogleTranslator
tr = GoogleTranslator(source="en", target="zh-CN")


def trans(text):
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
    fixed, failed = 0, 0
    for s in d["sentences"]:
        if s["zh"].strip():
            continue
        en = s["en"].strip()
        tags = re.findall(r"\[([^\]]+)\]", en)
        body = re.sub(r"\[[^\]]+\]", "", en).strip()
        zh_tags = " ".join(f"[{STAGE.get(t.lower().split()[0], t)}]" for t in tags if t.strip())
        zh_body = trans(body) if body else ""
        time.sleep(0.3)
        if zh_body or zh_tags:
            s["zh"] = (zh_tags + " " + zh_body).strip()
            fixed += 1
        else:
            failed += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    total = len(d["sentences"])
    covered = sum(1 for s in d["sentences"] if s["zh"].strip())
    print(f"{slug}: fixed {fixed} failed {failed}, coverage {covered}/{total}")
