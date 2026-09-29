"""Tabla de medidas de las siluetas de la hoja (en metros) cada 2 cm de altura.
FRONT/BACK: tramos de silueta en el lado +X (torso o pierna, y brazo). SIDE: delante / detrás.
Uso: python3 scripts/measure_ref.py [zmin zmax paso]"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
P, W, G = 560.0, 600, 1040
z0, z1, dz = (float(a) for a in sys.argv[1:4]) if len(sys.argv) > 3 else (0.0, 1.80, 0.02)
S = {v: np.array(Image.open(f'ref/sil_{v}.png')) > 127 for v in ('front', 'side', 'back')}


def runs(row):
    lab, n = nd.label(row)
    out = []
    for k in range(1, n + 1):
        xs = np.where(lab == k)[0]
        out.append(((xs.min() - W / 2) / P, (xs.max() + 1 - W / 2) / P))
    return out


for z in np.arange(z0, z1 + 1e-9, dz):
    r = int(round(G - z * P))
    f = [f'[{a:+.3f},{b:+.3f}]' for a, b in runs(S['front'][r]) if b > 0]
    bk = [f'[{a:+.3f},{b:+.3f}]' for a, b in runs(S['back'][r]) if b > 0]
    xs = np.where(S['side'][r])[0]
    sd = f'yF {-(xs.max() + 1 - W / 2) / P:+.3f} yB {-(xs.min() - W / 2) / P:+.3f}' if len(xs) else ''
    print(f'{z:.2f} F {" ".join(f):40s} B {" ".join(bk):40s} S {sd}')
