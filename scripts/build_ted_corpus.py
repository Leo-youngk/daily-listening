# -*- coding: utf-8 -*-
"""从 Kaggle ted_main.csv 按播放量取 TOP 100，生成 ted_top100.json"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "corpus", "ted_main.csv")
OUT_PATH = os.path.join(HERE, "corpus", "ted_top100.json")


def slugify(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


def main():
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))
    rows.sort(key=lambda r: -int(r["views"]))
    top = rows[:100]
    out = []
    for r in top:
        out.append({
            "slug": slugify(r["url"]),
            "title": r["title"],
            "speaker": r["main_speaker"],
            "duration": int(r["duration"]),
            "views": int(r["views"]),
            "ted_url": r["url"],
            "category": "ted",
        })
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(out)} entries -> {OUT_PATH}")
    print("TOP3:", [(e["speaker"], e["title"]) for e in out[:3]])


if __name__ == "__main__":
    main()
