"""Ajusta tables.json a las siluetas de la hoja (una pasada; se repite con cada iteración).

Uso: RENDER_DIR=<carpeta> python3 scripts/fit.py <etiqueta> [partes] [--damp 0.8]
partes: torso,leg,neck,head,arm (por defecto todas). Lee las máscaras del render <etiqueta> y para
cada anillo mide en la hoja y en el modelo:
  FRONT: semiancho (torso/cuello/cabeza) o centro y semiancho del tramo (pierna, brazo);
  SIDE: bordes delantero y trasero a la altura del anillo.
y corrige semiancho por cociente y los radios delante/detrás por diferencia. Las filas del torso
que quedan tapadas por los brazos en FRONT (z > 1.36) no se tocan en anchura.
"""
import json
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAB = os.path.join(ROOT, 'scripts', 'tables.json')
P, W, G = 560.0, 600, 1040
tag = sys.argv[1]
parts = sys.argv[2].split(',') if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else \
    ['torso', 'leg', 'neck', 'head', 'arm']
damp = float(sys.argv[sys.argv.index('--damp') + 1]) if '--damp' in sys.argv else 0.8
D = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'test'))
ref = {v: np.array(Image.open(f'{ROOT}/ref/sil_{v}.png')) > 127 for v in ('front', 'side')}
mod = {v: np.array(Image.open(f'{D}/{tag}_mask_{v}.png').convert('L')) > 127 for v in ('front', 'side')}


def row(z):
    return int(round(G - z * P))


def runs(mask, z):
    out = []
    for dr in (-1, 0, 1):
        lab, n = nd.label(mask[row(z) + dr])
        rr = []
        for k in range(1, n + 1):
            q = np.where(lab == k)[0]
            rr.append(((q.min() - W / 2) / P, (q.max() + 1 - W / 2) / P))
        out.append(rr)
    return out[1]


def central_half(mask, z):
    for a, b in runs(mask, z):
        if a < 0 < b:
            return 0.5 * (b - a)
    return None


def side_edges(mask, z):
    xs = np.where(mask[row(z)])[0]
    if not len(xs):
        return None
    return -(xs.max() + 1 - W / 2) / P, -(xs.min() - W / 2) / P      # (y delante, y detrás)


def run_near(mask, z, x):
    best = None
    for a, b in runs(mask, z):
        if b < 0:
            continue
        c = 0.5 * (a + b)
        if best is None or abs(c - x) < abs(best[0] - x):
            best = (c, 0.5 * (b - a))
    return best


T = json.load(open(TAB))
log = []
if 'torso' in parts:
    for r in T['torso']:
        zf, zb, w, yf, yb = r
        zm = 0.5 * (zf + zb)
        if zm < 1.36:
            a, b = central_half(ref['front'], zm), central_half(mod['front'], zm)
            if a and b:
                r[2] = round(w * (1 + damp * (a / b - 1)), 4)
        ea, eb = side_edges(ref['side'], zf), side_edges(mod['side'], zf)
        if ea and eb:
            r[3] = round(yf + damp * (ea[0] - eb[0]), 4)
        ea, eb = side_edges(ref['side'], zb), side_edges(mod['side'], zb)
        if ea and eb:
            r[4] = round(yb + damp * (ea[1] - eb[1]), 4)
        log.append(('torso', zf, r[2:]))
for part in ('neck', 'head'):
    if part not in parts:
        continue
    for i, r in enumerate(T[part]):
        zf, zb, w, yf, yb = r
        zm = 0.5 * (zf + zb)
        a, b = central_half(ref['front'], zm), central_half(mod['front'], zm)
        # en FRONT el cuello queda tapado por los trapecios hasta z 1.56: su anchura es manual
        if a and b and zm > 1.575:
            r[2] = round(w * (1 + damp * (a / b - 1)), 4)
        ea, eb = side_edges(ref['side'], zf), side_edges(mod['side'], zf)
        # el primer anillo de la cabeza es la cara inferior de la mandíbula: no se ve en SIDE
        if ea and eb and not (part == 'head' and i == 0):
            r[3] = round(yf + damp * (ea[0] - eb[0]), 4)
        ea, eb = side_edges(ref['side'], zb), side_edges(mod['side'], zb)
        if ea and eb:
            r[4] = round(yb + damp * (ea[1] - eb[1]), 4)
        log.append((part, zf, r[2:]))
if 'leg' in parts:
    for r in T['leg']:
        z, cx, cy, rx, rf, rb = r
        if z > 0.88:
            continue
        a, b = run_near(ref['front'], z, cx), run_near(mod['front'], z, cx)
        if a and b:
            r[1] = round(cx + damp * (a[0] - b[0]), 4)
            r[3] = round(rx * (1 + damp * (a[1] / b[1] - 1)), 4)
        ea, eb = side_edges(ref['side'], z), side_edges(mod['side'], z)
        if ea and eb and 0.22 < z < 0.72:       # arriba la mano tapa el muslo; abajo, el pie
            r[4] = round(rf - damp * (ea[0] - eb[0]), 4)
            r[5] = round(rb + damp * (ea[1] - eb[1]), 4)
        log.append(('leg', z, r[1:]))
if 'arm' in parts:
    A = T['arm']
    sh, el, wr = (np.array(A[k]) for k in ('shoulder', 'elbow', 'wrist'))
    for seg, (p0, p1) in (('upper', (sh, el)), ('lower', (el, wr))):
        for r in A[seg]:
            t = r[0]
            c = p0 + (p1 - p0) * t
            if c[2] > 1.37 or c[2] < 0.95:      # deltoides fundido con el torso / mano
                continue
            a, b = run_near(ref['front'], c[2], c[0]), run_near(mod['front'], c[2], c[0])
            if a and b and a[0] > 0.17 and b[0] > 0.17:
                r[1] = round(r[1] * (1 + damp * (a[1] / b[1] - 1)), 4)
            log.append((seg, t, r[1:]))
json.dump(T, open(TAB, 'w'), indent=1)
for l in log:
    print(l)
