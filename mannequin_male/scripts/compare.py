"""Compara un render con la hoja (mismo lienzo y cámara).

Uso: RENDER_DIR=<carpeta> python3 scripts/compare.py <etiqueta> [zmin zmax]
Genera <tag>_sidebyside.jpg (hoja | modelo, por vista), <tag>_overlay.jpg (modelo al 50 % sobre la
hoja + contorno), <tag>_silhouette.png (rojo = solo hoja, cian = solo modelo) e imprime:
IoU por vista y, cada 2 cm, la diferencia de cada borde de silueta (m). Los bordes se emparejan
tramo a tramo (torso/pierna, brazo...) y se resume el error medio y el % de filas dentro de ±1 cm.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P, W, G = 560.0, 600, 1040
tag = sys.argv[1]
zmin = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
zmax = float(sys.argv[3]) if len(sys.argv) > 3 else 1.80
D = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'test'))
VIEWS = ('front', 'side', 'back')


def load(p):
    return np.array(Image.open(p).convert('RGB'))


def edges(row, side_view):
    """Bordes de la silueta en la fila: en SIDE solo el más delantero y el más trasero; en FRONT y
    BACK los bordes de cada tramo en el lado +X (x > 0)."""
    xs = np.where(row)[0]
    if not len(xs):
        return []
    if side_view:
        return [(xs.min() - W / 2) / P, (xs.max() + 1 - W / 2) / P]
    lab, n = nd.label(row)
    out = []
    for k in range(1, n + 1):
        q = np.where(lab == k)[0]
        a, b = (q.min() - W / 2) / P, (q.max() + 1 - W / 2) / P
        if b > 0.004:
            out += [max(a, 0.0), b] if a < 0 else [a, b]
    return out


def main():
    tiles, ovs, sils, report = [], [], [], {}
    for v in VIEWS:
        ref = load(f'{ROOT}/ref/ref_{v}.png')
        ren = load(f'{D}/{tag}_{v}.png')
        sref = np.array(Image.open(f'{ROOT}/ref/sil_{v}.png')) > 127
        smod = load(f'{D}/{tag}_mask_{v}.png').mean(2) > 127
        r0, r1 = int(G - zmax * P), int(G - zmin * P)
        zone = np.zeros_like(sref)
        zone[max(r0, 0):min(r1, 1079)] = True
        a, b = sref & zone, smod & zone
        iou = (a & b).sum() / max((a | b).sum(), 1)
        diffs, lines = [], []
        for z in np.arange(np.ceil(zmin * 50) / 50, zmax + 1e-9, 0.02):
            r = int(round(G - z * P))
            er, em = edges(sref[r], v == 'side'), edges(smod[r], v == 'side')
            if len(er) != len(em) or not er:
                lines.append(f'{z:.2f}  tramos distintos: hoja {np.round(er, 3).tolist()}  modelo {np.round(em, 3).tolist()}')
                continue
            d = np.array(em) - np.array(er)
            diffs.append(np.abs(d))
            lines.append(f'{z:.2f}  ' + ' '.join(f'{x:+.3f}' for x in d))
        alld = np.concatenate(diffs) if diffs else np.array([np.nan])
        report[v] = dict(iou=round(float(iou), 3), mean=round(float(np.nanmean(alld)), 4),
                         within_1cm=round(float((alld <= 0.0105).mean()), 3), n=len(alld))
        print(f'== {v}: IoU {iou:.3f}  error medio {np.nanmean(alld) * 1000:.1f} mm  '
              f'bordes dentro de ±1 cm {100 * (alld <= 0.0105).mean():.0f} % ({len(alld)})')
        if '-v' in sys.argv:
            print('   ' + '\n   '.join(lines))
        tiles.append(np.concatenate([ref, ren], 1))
        ov = (0.5 * ref + 0.5 * ren).astype(np.uint8)
        ov[smod ^ nd.binary_erosion(smod)] = (255, 170, 0)
        ovs.append(ov)
        s = np.full(ref.shape, 25, np.uint8)
        s[sref & smod] = (150, 150, 150)
        s[sref & ~smod] = (230, 60, 60)
        s[~sref & smod] = (60, 210, 230)
        sils.append(s)
    sep = np.full((1080, 8, 3), 60, np.uint8)
    for name, lst in (('sidebyside', tiles), ('overlay', ovs), ('silhouette', sils)):
        row = []
        for i, t in enumerate(lst):
            row += [t] + ([sep] if i < len(lst) - 1 else [])
        img = Image.fromarray(np.concatenate(row, 1))
        ImageDraw.Draw(img).text((10, 10), f'{tag} · {name}', fill=(230, 230, 230))
        if name == 'sidebyside':
            img = img.resize((img.width * 2 // 3, img.height * 2 // 3), Image.LANCZOS)
        if name == 'silhouette':
            img.save(f'{D}/{tag}_{name}.png')
        else:
            img.convert('RGB').save(f'{D}/{tag}_{name}.jpg', quality=88)
    import json
    with open(f'{D}/{tag}_compare.json', 'w') as fh:
        json.dump(report, fh, indent=1)


if __name__ == '__main__':
    main()
