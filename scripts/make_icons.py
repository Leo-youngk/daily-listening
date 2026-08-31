# -*- coding: utf-8 -*-
"""生成 PWA 图标：满幅出血的兔子标记。

图标资产本身不画圆角和投影——iOS/Android 会自己套遮罩，图里再画一层
就会出现圆角套圆角、四角露底。maskable 版把内容压进 80% 安全圆内。

用法：
    python scripts/make_icons.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(os.path.dirname(HERE), "public", "icons")

BG = (91, 143, 217)
WHITE = (255, 255, 255)
PINK = (243, 179, 190)
INK = (42, 50, 66)

# 归一化坐标，取自设计稿；y 中心 0.4885 是内容包围盒的实际中心
CONTENT_CY = 0.4885
EARS = [
    # 外耳中心、内耳中心、旋转角（逆时针为正）
    (0.407692, 0.338462, 0.407692, 0.353846, 9),
    (0.592308, 0.338462, 0.592308, 0.353846, -9),
]
EAR_RX, EAR_RY = 0.076923, 0.207692
INNER_RX, INNER_RY = 0.035385, 0.130769
HEAD = (0.5, 0.638462, 0.246154, 0.207692)
EYES = [(0.423077, 0.615385), (0.576923, 0.615385)]
EYE_R = 0.027692
NOSE = (0.5, 0.692308, 0.026154, 0.018462)

SUPERSAMPLE = 4


def _ellipse(draw: ImageDraw.ImageDraw, cx: float, cy: float, rx: float, ry: float, fill) -> None:
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


def render(size: int, scale: float) -> Image.Image:
    w = size * SUPERSAMPLE

    def point(x: float, y: float) -> tuple[float, float]:
        return (0.5 + (x - 0.5) * scale) * w, (0.5 + (y - CONTENT_CY) * scale) * w

    def radius(r: float) -> float:
        return r * scale * w

    base = Image.new("RGBA", (w, w), BG + (255,))

    for ecx, ecy, icx, icy, angle in EARS:
        layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        pen = ImageDraw.Draw(layer)
        cx, cy = point(ecx, ecy)
        _ellipse(pen, cx, cy, radius(EAR_RX), radius(EAR_RY), WHITE + (255,))
        ix, iy = point(icx, icy)
        _ellipse(pen, ix, iy, radius(INNER_RX), radius(INNER_RY), PINK + (255,))
        base = Image.alpha_composite(base, layer.rotate(angle, resample=Image.BICUBIC, center=(cx, cy)))

    pen = ImageDraw.Draw(base)
    hx, hy = point(HEAD[0], HEAD[1])
    _ellipse(pen, hx, hy, radius(HEAD[2]), radius(HEAD[3]), WHITE + (255,))
    for ex, ey in EYES:
        px, py = point(ex, ey)
        _ellipse(pen, px, py, radius(EYE_R), radius(EYE_R), INK + (255,))
    nx, ny = point(NOSE[0], NOSE[1])
    _ellipse(pen, nx, ny, radius(NOSE[2]), radius(NOSE[3]), PINK + (255,))

    return base.convert("RGB").resize((size, size), Image.LANCZOS)


def main() -> int:
    os.makedirs(ICON_DIR, exist_ok=True)
    # maskable 的安全区是直径 80% 的圆，内容包围盒的半对角线要压进 0.4
    targets = [
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("icon-maskable-512.png", 512, 0.86),
    ]
    for name, size, scale in targets:
        path = os.path.join(ICON_DIR, name)
        render(size, scale).save(path, "PNG", optimize=True)
        print(f"wrote {name} ({size}x{size}, scale={scale}, {os.path.getsize(path) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
