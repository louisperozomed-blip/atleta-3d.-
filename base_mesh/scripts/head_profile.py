"""Perfil fino de la cabeza (cada 1 cm): hoja contra máscara del modelo, SIDE (delante/detrás) y
FRONT (semiancho). Uso: RENDER_DIR=... python3 scripts/head_profile.py <etiqueta>"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = 921 / 1.7
d = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'stage5'))
tag = sys.argv[1]


def ld(p):
    return np.array(Image.open(p).convert('L')) > 127


RS, RF = ld(f'{ROOT}/reference/sil_side.png'), ld(f'{ROOT}/reference/sil_front.png')
MS, MF = ld(f'{d}/{tag}_mask_side.png'), ld(f'{d}/{tag}_mask_front.png')


def side(m, r):
    xs = np.where(m[r])[0]
    return (-(xs.max() - 200) / P, -(xs.min() - 200) / P) if len(xs) else (np.nan, np.nan)


def half(m, r):
    lab, _ = nd.label(m[r])
    c = lab[200]
    xs = np.where(lab == c)[0] if c else []
    return (xs.max() - xs.min()) / 2 / P if len(xs) else np.nan


print('   z   | yF hoja  modelo  dif | yB hoja  modelo  dif | semiancho hoja modelo dif')
for z in np.arange(1.45, 1.705, 0.01):
    r = int(round(940 - z * P))
    a, b = side(RS, r), side(MS, r)
    h1, h2 = half(RF, r), half(MF, r)
    print(f' {z:.2f} | {a[0]:+.3f} {b[0]:+.3f} {b[0]-a[0]:+.3f} | {a[1]:+.3f} {b[1]:+.3f} {b[1]-a[1]:+.3f} |'
          f' {h1:.3f} {h2:.3f} {h2-h1:+.3f}')
