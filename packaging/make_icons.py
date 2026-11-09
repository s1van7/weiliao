"""生成三端可用的应用图标（微聊）：绿色底 + 双气泡。"""
import sys
from PIL import Image, ImageDraw


def make_icon(size: int) -> Image.Image:
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 绿色圆角底
    radius = int(s * 0.23)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=(7, 193, 96, 255))

    # 大白色气泡
    bx0, by0, bx1, by1 = int(s * 0.16), int(s * 0.20), int(s * 0.72), int(s * 0.63)
    br = int(s * 0.13)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=br, fill=(255, 255, 255, 255))
    # 气泡小尾巴
    d.polygon(
        [(int(s * 0.28), by1 - int(s * 0.02)), (int(s * 0.24), int(s * 0.75)), (int(s * 0.40), by1 - int(s * 0.02))],
        fill=(255, 255, 255, 255),
    )
    # 三个点
    cy = (by0 + by1) // 2
    for i, cx in enumerate([0.30, 0.44, 0.58]):
        r = int(s * 0.035)
        d.ellipse([int(s * cx) - r, cy - r, int(s * cx) + r, cy + r], fill=(7, 193, 96, 255))

    # 小气泡（右下，稍暗白，做出层次）
    sx0, sy0, sx1, sy1 = int(s * 0.52), int(s * 0.48), int(s * 0.87), int(s * 0.78)
    sr = int(s * 0.10)
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=sr, fill=(235, 255, 243, 255), outline=(7, 193, 96, 60), width=max(1, int(s * 0.006)))
    d.polygon(
        [(sx1 - int(s * 0.16), sy1 - int(s * 0.01)), (sx1 - int(s * 0.06), int(s * 0.85)), (sx1 - int(s * 0.02), sy1 - int(s * 0.01))],
        fill=(235, 255, 243, 255),
    )
    for cx in [0.64, 0.75]:
        r = int(s * 0.025)
        d.ellipse([int(s * cx) - r, int(s * 0.63) - r, int(s * cx) + r, int(s * 0.63) + r], fill=(7, 193, 96, 255))

    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    sizes = {192: 'icon-192.png', 512: 'icon-512.png', 180: 'apple-touch-icon.png'}
    for size, name in sizes.items():
        make_icon(size).save(f'{out}/{name}')
    print('icons written to', out)
