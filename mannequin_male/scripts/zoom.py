"""Recorte comparativo hoja | modelo de una zona (mismo lienzo y cámara, x2).
Uso: RENDER_DIR=<carpeta> python3 scripts/zoom.py <etiqueta> <zona> zmin zmax [xhalf | x0:x1] [vistas]
Escribe <tag>_zoom_<zona>.jpg: por cada vista, hoja arriba y modelo (arcilla + aristas) abajo."""
import os
import sys
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P, W, G = 560.0, 600, 1040
tag, zone, z0, z1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
xs = sys.argv[5] if len(sys.argv) > 5 else '0.30'
x0, x1 = map(float, xs.split(':')) if ':' in xs else (-float(xs), float(xs))
views = sys.argv[6].split(',') if len(sys.argv) > 6 else ['front', 'side', 'back']
D = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'test'))
box = (int(W / 2 + x0 * P), int(G - z1 * P), int(W / 2 + x1 * P), int(G - z0 * P))
k = 2 if z1 - z0 > 0.4 else 4
cols = []
for v in views:
    b = Image.open(f'{D}/{tag}_{v}.png').convert('RGB').crop(box)
    rp = f'{ROOT}/ref/ref_{v}.png'
    a = Image.open(rp).convert('RGB').crop(box) if os.path.exists(rp) else Image.new('RGB', b.size, (20, 20, 20))
    c = Image.new('RGB', (a.width, a.height * 2 + 4), (60, 60, 60))
    c.paste(a, (0, 0))
    c.paste(b, (0, a.height + 4))
    cols.append(c.resize((c.width * k, c.height * k), Image.LANCZOS))
out = Image.new('RGB', (sum(c.width for c in cols) + 8 * (len(cols) - 1), cols[0].height), (60, 60, 60))
x = 0
for c in cols:
    out.paste(c, (x, 0))
    x += c.width + 8
ImageDraw.Draw(out).text((8, 8), f'{tag} · {zone} · hoja (arriba) / modelo (abajo)', fill=(240, 240, 240))
out.save(f'{D}/{tag}_zoom_{zone}.jpg', quality=88)
