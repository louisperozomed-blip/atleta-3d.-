"""Montaje por pose del test de deformación: front | side | 3-4 | primeros planos.
Uso: RENDER_DIR=... python3 scripts/deform_montage.py <etiqueta>"""
import glob
import os
import sys
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'stage5'))
tag = sys.argv[1]
poses = ['codos_rodillas', 'brazo_arriba', 'brazo_adelante', 'columna_cuello', 'cadera_90']
rows = []
for p in poses:
    main = [Image.open(f'{d}/{tag}_{p}_{v}.png').crop((0, 0, 400, 960)).resize((200, 480)) for v in ('front', 'side', '34')]
    close = [Image.open(f).resize((480, 480)) for f in sorted(glob.glob(f'{d}/{tag}_{p}_*_wire.png'))]
    row = Image.new('RGB', (600 + 480 * 2, 480), (30, 30, 30))
    for i, im in enumerate(main):
        row.paste(im, (200 * i, 0))
    for i, im in enumerate(close[:2]):
        row.paste(im, (600 + 480 * i, 0))
    ImageDraw.Draw(row).text((6, 6), p, fill=(255, 255, 255))
    rows.append(row)
W = Image.new('RGB', (rows[0].width, 480 * len(rows)))
for i, r in enumerate(rows):
    W.paste(r, (0, 480 * i))
W.save(f'{d}/{tag}_deform.jpg', quality=85)
for f in glob.glob(f'{d}/{tag}_*_front.png') + glob.glob(f'{d}/{tag}_*_side.png') + glob.glob(f'{d}/{tag}_*_34.png'):
    os.remove(f)
