"""Dibuja el mapa UV (islas en color sobre una cuadrícula) y marca en rojo los píxeles solapados.
Uso: RENDER_DIR=... python3 scripts/uv_layout.py <etiqueta>  -> renders/<carpeta>/<tag>_uv_layout.png"""
import json
import os
import sys
import colorsys
import numpy as np
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'stage5'))
tag = sys.argv[1]
data = json.load(open(f'{d}/{tag}_uvpolys.json'))
R = 2048
labels = data['labels']
names = sorted(set(labels))
col = {n: tuple(int(255 * c) for c in colorsys.hsv_to_rgb(i / len(names), 0.45, 0.85)) for i, n in enumerate(names)}
bg = np.full((R, R, 3), 40, np.uint8)
g = (np.add.outer(np.arange(R) // 128, np.arange(R) // 128) % 2).astype(bool)
bg[g] = 52
img = Image.fromarray(bg)
dr = ImageDraw.Draw(img)
count = np.zeros((R, R), np.uint16)
for P, lab in zip(data['polys'], labels):
    pts = [(u * R, (1 - v) * R) for u, v in P]
    dr.polygon(pts, fill=col[lab], outline=(20, 20, 20))
    m = Image.new('L', (R, R), 0)
    ImageDraw.Draw(m).polygon(pts, fill=1)
a = np.array(img)
# solapes: recalcular con una máscara por isla (dos islas en el mismo píxel, o una isla sobre sí misma)
per_island = {}
for P, lab in zip(data['polys'], labels):
    per_island.setdefault(lab, []).append(P)
over = np.zeros((R, R), bool)
report = {}
for lab, polys in per_island.items():
    acc = np.zeros((R, R), np.uint8)
    for P in polys:
        m = Image.new('L', (R, R), 0)
        ImageDraw.Draw(m).polygon([(u * R, (1 - v) * R) for u, v in P], fill=1, outline=0)
        acc += np.array(m)
    self_over = acc > 1
    report[lab] = int(self_over.sum())
    count += (acc > 0)
    over |= self_over
over |= count > 1
a[over] = (255, 40, 40)
Image.fromarray(a).save(f'{d}/{tag}_uv_layout.png')
print('solape entre islas (px):', int((count > 1).sum()), ' dentro de cada isla:', {k: v for k, v in report.items() if v})

# mapa UV sobre la textura de cuadrícula (la misma que se usa en los renders y en el visor)
N = R
yy, xx = np.mgrid[0:N, 0:N]
cellpx = N // 32
cell = ((xx // cellpx + (N - 1 - yy) // cellpx) % 2).astype(float)
zone = (((xx // (N // 8)) * 3 + ((N - 1 - yy) // (N // 8)) * 5) % 8)
pal = np.array([colorsys.hsv_to_rgb(h, 0.55, 0.95) for h in np.arange(8) / 8.0])
rgb = pal[zone] * (0.55 + 0.45 * cell)[..., None]
rgb[(xx % cellpx == 0) | (yy % cellpx == 0)] = 0.15
chk = Image.fromarray((rgb * 255).astype(np.uint8))
dr = ImageDraw.Draw(chk)
for P in data['polys']:
    dr.polygon([(u * R, (1 - v) * R) for u, v in P], outline=(255, 255, 255))
chk.save(f'{d}/{tag}_uv_checker.png')
