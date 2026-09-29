"""Comparativas de la etapa 2: sprite | normal map | especular | iluminado."""
from PIL import Image, ImageDraw
from litpreview import lit
from common import DIRS

W, H = 240, 272
for anim, fr in (("walk", 1), ("run", 2), ("jump", 3), ("idle", 0)):
    sheet = Image.new("RGB", (W * 4, H * len(DIRS) + 24), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    for k, t in enumerate(["sprite", "normal map (verde arriba)", "especular", "iluminado (luz arriba-izq)"]):
        dr.text((k * W + 6, 6), t, fill=(0, 0, 0))
    for r, d in enumerate(DIRS):
        n = f"{anim}_{d}_{fr}"
        y = 24 + r * H
        c = Image.open(f"../frames/{n}.png")
        sheet.paste(c, (0, y), c)
        sheet.paste(Image.open(f"../build/maps/{n}_n.png"), (W, y))
        sheet.paste(Image.open(f"../build/maps/{n}_s.png").convert("RGB"), (2 * W, y))
        im = lit(n, 135)
        sheet.paste(im, (3 * W, y), im)
        dr.text((4, y + 4), d, fill=(0, 0, 0))
    sheet.save(f"../review/stage2_compare_{anim}.png")
