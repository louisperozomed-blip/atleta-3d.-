"""Recorta ref/hoja_maniqui.jpg en vistas (FRONT / SIDE / BACK) y paneles, calibrados a 1.80 m.

Uso: python3 scripts/crop_reference.py
Cada vista de la hoja está dibujada a una escala algo distinta (la figura mide 1058 px en FRONT,
1040 en SIDE y 1031 en BACK), así que cada una se calibra por separado: se mide la cabeza (fila
superior) y el suelo (planta del pie) y se remuestrea a un lienzo común de W×H px con P px/m, el
suelo en la fila GROUND y el eje del cuerpo en la columna W/2.
Salida en ref/: ref_{front,side,back}.png, sil_*.png (siluetas), panel_*.png y calib.json.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'ref', 'hoja_maniqui.jpg')
HEIGHT = 1.80
P = 560.0                 # px por metro del lienzo común
W, H = 600, 1080
GROUND = 1040             # fila del suelo en el lienzo
BG = 20
# columnas de cada figura en la hoja y columna del eje (FRONT/BACK: centro de la cabeza;
# SIDE: punto medio del pie)
VIEWS = {'front': (110, 560), 'side': (600, 810), 'back': (845, 1275)}
PANELS = {'head': (1283, 20, 1705, 282), 'torso': (1283, 288, 1705, 577),
          'pelvis': (1283, 582, 1705, 780), 'limbs': (1283, 782, 1705, 1112)}


def mask_of(g, thr=60):
    m = g > thr
    m = nd.binary_closing(m, iterations=2)
    m = nd.binary_fill_holes(m)
    m = nd.binary_opening(m, iterations=1)
    lab, n = nd.label(m)
    if n > 1:
        sizes = nd.sum(m, lab, range(n + 1))
        sizes[0] = 0
        m = lab == int(np.argmax(sizes))
    return m


def main():
    img = Image.open(SHEET).convert('RGB')
    a = np.array(img).astype(float)
    g = a.mean(2)
    g[1095:] = BG                                    # etiquetas FRONT / SIDE / BACK
    calib = {}
    out = os.path.join(ROOT, 'ref')
    for v, (x0, x1) in VIEWS.items():
        sub = np.full_like(g, BG)
        sub[:, x0:x1] = g[:, x0:x1]
        m = mask_of(sub)
        rows = np.where(m.any(1))[0]
        top, bot = int(rows.min()), int(rows.max()) + 1
        s = (bot - top) / HEIGHT                     # px por metro de esta vista
        r = top + int(0.11 * s)                      # a media cabeza
        xs = np.where(m[r])[0]
        cx = 0.5 * (xs.min() + xs.max())
        if v == 'side':
            # eje en SIDE: punto medio del pie (talón - puntera) a 2 cm del suelo -> el origen
            # queda entre los pies también en profundidad
            rn = int(round(bot - 0.02 * s))
            xs = np.where(m[rn])[0]
            cx = 0.5 * (xs.min() + xs.max())
        calib[v] = dict(top=top, ground=bot, px_per_m=round(s, 2), axis_x=round(cx, 1))
        # remuestreo al lienzo común
        Y, X = np.mgrid[0:H, 0:W]
        sx = cx + (X - W / 2) * s / P
        sy = bot - (GROUND - Y) * s / P
        valid = (sx >= x0) & (sx < x1 - 1) & (sy >= 0) & (sy < a.shape[0] - 1)
        crop = np.full((H, W, 3), BG, np.uint8)
        for c in range(3):
            ch = nd.map_coordinates(a[:, :, c], [sy, sx], order=1, cval=BG)
            crop[..., c] = np.where(valid, ch, BG).astype(np.uint8)
        crop[GROUND + 6:] = BG
        Image.fromarray(crop).save(os.path.join(out, f'ref_{v}.png'))
        ms = nd.map_coordinates(m.astype(float), [sy, sx], order=1) > 0.5
        ms &= valid
        ms[GROUND + 1:] = False
        Image.fromarray((ms * 255).astype(np.uint8)).save(os.path.join(out, f'sil_{v}.png'))
    for p, box in PANELS.items():
        img.crop(box).save(os.path.join(out, f'panel_{p}.png'))
    calib['canvas'] = dict(W=W, H=H, px_per_m=P, ground_row=GROUND, height_m=HEIGHT)
    with open(os.path.join(out, 'calib.json'), 'w') as fh:
        json.dump(calib, fh, indent=1)
    print(json.dumps(calib, indent=1))


if __name__ == '__main__':
    main()
