# -*- coding: utf-8 -*-
"""下载 ECDICT 词库到 scripts/.vendor（已 gitignore），供 build_dict.py 使用。

ECDICT: https://github.com/skywind3000/ECDICT  MIT License
"""
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
VENDOR = ROOT / "scripts" / ".vendor"
BASE = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/"
FILES = {
    "ecdict.csv": "ecdict.csv",
    "lemma.en.txt": "lemma.en.txt",
    "LICENSE": "ECDICT-LICENSE",
}


def main() -> None:
    VENDOR.mkdir(parents=True, exist_ok=True)
    for remote, local in FILES.items():
        dst = VENDOR / local
        if dst.exists() and dst.stat().st_size > 0:
            print(f"已存在，跳过：{local}")
            continue
        print(f"下载 {remote} …")
        with urllib.request.urlopen(BASE + remote, timeout=600) as resp:
            dst.write_bytes(resp.read())
        print(f"  -> {dst} ({dst.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
