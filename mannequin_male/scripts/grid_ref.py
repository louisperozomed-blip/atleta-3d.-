"""Rejilla métrica sobre las vistas de la hoja (para leer a qué altura/anchura caen sus aristas).
Uso: python3 scripts/grid_ref.py <vista> zmin zmax xmin xmax <salida.png> [modelo.png]"""
import sys
from PIL import Image, ImageDraw
P, W, G = 560.0, 600, 1040
v, z0, z1, x0, x1, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
ROOT = __file__.rsplit('/scripts/', 1)[0]
src = sys.argv[7] if len(sys.argv) > 7 else f'{ROOT}/ref/ref_{v}.png'
im = Image.open(src).convert('RGB')
box = (int(W / 2 + x0 * P), int(G - z1 * P), int(W / 2 + x1 * P), int(G - z0 * P))
k = 3
c = im.crop(box).resize(((box[2] - box[0]) * k, (box[3] - box[1]) * k), Image.LANCZOS)
d = ImageDraw.Draw(c)
z = round(z0, 2)
while z <= z1 + 1e-9:
    y = (G - z * P - box[1]) * k
    col = (255, 80, 80) if round(z * 100) % 10 == 0 else (255, 200, 60)
    d.line([(0, y), (c.width, y)], fill=col, width=1)
    d.text((2, y - 11), f'{z:.2f}', fill=col)
    z = round(z + 0.02, 2)
x = round(x0, 2)
while x <= x1 + 1e-9:
    xx = (W / 2 + x * P - box[0]) * k
    d.line([(xx, 0), (xx, c.height)], fill=(80, 200, 255) if round(x * 100) % 10 == 0 else (60, 120, 160), width=1)
    d.text((xx + 2, 2), f'{x:+.2f}', fill=(80, 200, 255))
    x = round(x + 0.02, 2)
c.save(out)
