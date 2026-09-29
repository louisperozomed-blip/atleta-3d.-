"""Recorta reference/base_mesh_sheet.png en vistas (FRONT/SIDE/BACK) y paneles de detalle.

Uso: python3 scripts/crop_reference.py
Salida en reference/: ref_front/side/back.png (400x960), sil_*.png (siluetas) y panel_*.png.
Escala: la figura mide 921 px de la cabeza (y=19) a la planta (y=940) = 1.70 m -> 541.8 px/m.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'reference', 'base_mesh_sheet.png')
TOP_PX, GROUND_PX = 19, 940
HEIGHT_M = 1.70
PX_PER_M = (GROUND_PX - TOP_PX) / HEIGHT_M
CROP_W, CROP_H = 400, 960
BG = (61, 61, 61)
# centro x de cada figura y límites del panel (para no mezclar figuras vecinas)
VIEWS = {'front': (262, 62, 470), 'side': (603, 500, 700), 'back': (941, 740, 1138)}
PANELS = {'head': (1143, 22, 1520, 252), 'torso': (1143, 255, 1520, 510),
          'pelvis': (1143, 512, 1520, 685), 'limbs': (1143, 687, 1520, 1000)}


def silhouette_mask(img, thr=73):
    g = np.asarray(img).astype(int).mean(2)
    m = g > thr
    m = nd.binary_closing(m, iterations=2)
    m = nd.binary_fill_holes(m)
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    if n > 1:
        sizes = nd.sum(m, lab, range(n + 1))
        sizes[0] = 0
        m = lab == int(np.argmax(sizes))
    return m


def main():
    a = np.array(Image.open(SHEET).convert('RGB'))
    out = os.path.join(ROOT, 'reference')
    info = {}
    for v, (cx, x0, x1) in VIEWS.items():
        crop = np.tile(np.array(BG, np.uint8), (CROP_H, CROP_W, 1))
        for x in range(CROP_W):
            sx = cx - CROP_W // 2 + x
            if x0 <= sx < x1:
                crop[:, x] = a[:CROP_H, sx]
        crop[945:] = BG                       # etiquetas FRONT/SIDE/BACK y sombra del suelo
        Image.fromarray(crop).save(os.path.join(out, f'ref_{v}.png'))
        m = silhouette_mask(crop)
        Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(out, f'sil_{v}.png'))
        ys, xs = np.where(m)
        info[v] = dict(top=int(ys.min()), bottom=int(ys.max()), left=int(xs.min()), right=int(xs.max()))
    for p, box in PANELS.items():
        Image.fromarray(a).crop(box).save(os.path.join(out, f'panel_{p}.png'))
    info['px_per_m'] = PX_PER_M
    print(json.dumps(info, indent=1))


if __name__ == '__main__':
    main()
