"""Hoja antes/después por zona (capturas de tests/capture_art.mjs).
uso: python3 compare_art.py <dir_antes> <dir_despues> <salida.png> "<título>" [nombres...]"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
a, b, out, title = sys.argv[1:5]
names = sys.argv[5:] or ["heart", "roots", "crystal", "ponds", "ruins"]
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
Fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
ims = [(Image.open(f"{a}/{n}.png").convert("RGB"), Image.open(f"{b}/{n}.png").convert("RGB")) for n in names]
w, h = ims[0][0].size; s = 0.5; tw, th = int(w * s), int(h * s)
sa = json.load(open(f"{a}/stats.json")) if os.path.exists(f"{a}/stats.json") else {}
sb = json.load(open(f"{b}/stats.json")) if os.path.exists(f"{b}/stats.json") else {}
o = Image.new("RGB", (tw * len(names) + 8 * (len(names) + 1), th * 2 + 90), (10, 14, 13))
d = ImageDraw.Draw(o); d.text((8, 6), title, fill=(220, 230, 225), font=Fb)
for i, (n, (x, y)) in enumerate(zip(names, ims)):
    px = 8 + i * (tw + 8)
    for r, (im, lab, st) in enumerate(((x, "ANTES", sa.get(n)), (y, "DESPUÉS", sb.get(n)))):
        py = 30 + r * (th + 28)
        o.paste(im.resize((tw, th), Image.NEAREST), (px, py + 16))
        t = f"{lab} · {n}" + (f" · {st['calls']} dc · {st['triangles'] / 1000:.0f}k tri" if st else "")
        d.text((px, py), t, fill=(255, 190, 110) if r else (170, 180, 175), font=F)
o.save(out); print(out, o.size)
