"""Propone correcciones de la tabla LEG de body.py a partir de las siluetas medidas.

Uso: python3 scripts/fit_leg.py <etapa> <etiqueta>
Para cada anillo de la pierna mide en la referencia y en la máscara del modelo el centro y
semiancho (FRONT) y los bordes delante/detrás (SIDE) a esa altura y propone
cx, rx, rf, rb corregidos. Por encima de z 0.78 la mano tapa el muslo en SIDE: no se corrige y.
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from body import Body  # noqa: E402
from compare import z_to_row, PX_PER_M  # noqa: E402
ROOT = os.path.dirname(HERE)
stage, tag = int(sys.argv[1]), sys.argv[2]
d = os.path.join(ROOT, 'renders', f'stage{stage}')
ref = {v: np.array(Image.open(os.path.join(ROOT, 'reference', f'sil_{v}.png'))) > 127 for v in ('front', 'side')}
mod = {v: np.array(Image.open(os.path.join(d, f'{tag}_mask_{v}.png')).convert('L')) > 127 for v in ('front', 'side')}


def leg_run(m, r):
    """tramo de la pierna +X en FRONT (a la derecha del eje)."""
    lab, _ = nd.label(m[r])
    xs = np.where(m[r])[0]
    xs = xs[xs > 203]
    if not len(xs):
        return None
    run = np.where(lab == lab[xs[0]])[0]
    run = run[run > 200]
    return (run.min() - 200) / PX_PER_M, (run.max() - 200) / PX_PER_M


def side_edges(m, r):
    xs = np.where(m[r])[0]
    return -(xs.max() - 200) / PX_PER_M, -(xs.min() - 200) / PX_PER_M   # (Y delante, Y detrás)


def avg(f, m, z):
    vals = [f(m, z_to_row(z) + k) for k in (-2, 0, 2)]
    vals = [v for v in vals if v is not None]
    return np.mean(vals, 0)


print('    LEG = [')
for (z, cx, cy, rx, rf, rb) in Body.LEG:
    a, b = avg(leg_run, ref['front'], z), avg(leg_run, mod['front'], z)
    cr, hr = (a[0] + a[1]) / 2, (a[1] - a[0]) / 2
    cm, hm = (b[0] + b[1]) / 2, (b[1] - b[0]) / 2
    ncx, nrx = cx + (cr - cm), rx * hr / hm
    nrf, nrb = rf, rb
    if z < 0.78:
        fr, br = avg(side_edges, ref['side'], z)
        fm, bm = avg(side_edges, mod['side'], z)
        nrf, nrb = rf - (fr - fm), rb + (br - bm)
    print(f'        ({z:.3f}, {ncx:.3f}, {cy:.3f}, {nrx:.3f}, {nrf:.3f}, {nrb:.3f}),'
          f'   # dx {cr - cm:+.3f} w {hr - hm:+.3f}')
print('    ]')
