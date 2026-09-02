# -*- coding: utf-8 -*-
"""诊断音频文件：码率分布 + moov atom 位置（决定能否秒开）"""
import json
import os
import struct

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DIST_AUDIO = os.path.join(ROOT, "app", "dist", "audio")
MANIFEST = os.path.join(ROOT, "app", "dist", "data", "manifest.json")


def box_layout(path):
    """返回顶层 box 顺序，如 ['ftyp','mdat','moov']"""
    boxes = []
    with open(path, "rb") as f:
        size = os.path.getsize(path)
        pos = 0
        while pos + 8 <= size:
            f.seek(pos)
            header = f.read(8)
            if len(header) < 8:
                break
            length, name = struct.unpack(">I4s", header)
            try:
                name = name.decode("ascii")
            except UnicodeDecodeError:
                break
            if length == 1:
                large = f.read(8)
                if len(large) < 8:
                    break
                length = struct.unpack(">Q", large)[0]
            elif length == 0:
                length = size - pos
            if length < 8:
                break
            boxes.append(name)
            pos += length
    return boxes


def main():
    manifest = {e["slug"]: e for e in json.load(open(MANIFEST, encoding="utf-8"))}
    files = sorted(f for f in os.listdir(DIST_AUDIO) if f.endswith(".m4a"))
    moov_last = 0
    moov_first = 0
    bitrates = []
    for f in files:
        path = os.path.join(DIST_AUDIO, f)
        size = os.path.getsize(path)
        slug = f[:-4]
        dur = (manifest.get(slug) or {}).get("duration") or 0
        kbps = size * 8 / dur / 1000 if dur else 0
        bitrates.append((kbps, f, size))
        boxes = box_layout(path)
        if "moov" in boxes and "mdat" in boxes:
            if boxes.index("moov") < boxes.index("mdat"):
                moov_first += 1
            else:
                moov_last += 1
    bitrates.sort(reverse=True)
    print(f"总文件数: {len(files)}")
    print(f"moov 在前（可秒开）: {moov_first}, moov 在后（需二次请求）: {moov_last}")
    sizes = [b[2] for b in bitrates]
    print(f"大小: 最小 {min(sizes)/1e6:.1f}MB, 最大 {max(sizes)/1e6:.1f}MB, 总计 {sum(sizes)/1e6:.0f}MB")
    kbs = [b[0] for b in bitrates]
    print(f"码率: 最小 {min(kbs):.0f}kbps, 最大 {max(kbs):.0f}kbps, 平均 {sum(kbs)/len(kbs):.0f}kbps")
    print("\n码率最高的 5 个:")
    for kbps, f, size in bitrates[:5]:
        print(f"  {kbps:5.0f}kbps  {size/1e6:6.1f}MB  {f}")
    print("\n码率最低的 5 个:")
    for kbps, f, size in bitrates[-5:]:
        print(f"  {kbps:5.0f}kbps  {size/1e6:6.1f}MB  {f}")


if __name__ == "__main__":
    main()
