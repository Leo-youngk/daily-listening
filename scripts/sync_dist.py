# -*- coding: utf-8 -*-
"""构建后把素材同步到 app/dist（开发模式不需要）。

素材目录体量大，vite 的 copyPublicDir 已关掉，改由本脚本在抓取完成后一次性拷贝。
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "app" / "dist"
PUB = ROOT / "public"

DIRS = ["data", "icons", "covers", "dict"]
FILES = ["_headers", "404.html"]


def main() -> int:
    if not DIST.is_dir():
        print("dist 不存在，请先在 app 目录执行 npm run build", file=sys.stderr)
        return 1

    for name in DIRS:
        src = PUB / name
        if not src.is_dir():
            print(f"skip {name}（源目录不存在）")
            continue
        dst = DIST / name
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        print(f"synced {name} ({sum(1 for _ in dst.rglob('*') if _.is_file())} files)")

    for name in FILES:
        src = PUB / name
        if src.is_file():
            shutil.copy2(src, DIST / name)
            print(f"synced {name}")

    print(f"done -> {DIST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
