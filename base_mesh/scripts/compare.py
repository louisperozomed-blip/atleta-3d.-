"""Compara los renders de una etapa con la hoja de referencia.

Uso: python3 scripts/compare.py <etapa> <etiqueta> [zmin zmax]
Genera en renders/stageN/:
  <tag>_sidebyside.jpg  : por vista [referencia | render | wireframe]
  <tag>_overlay.jpg     : render al 50 % sobre la referencia + contorno de diferencias
  <tag>_silhouette.png  : rojo = solo referencia, cian = solo modelo, gris = ambos
e imprime IoU por vista y la tabla de anchos por altura (en metros) para ver las diferencias.
zmin/zmax limitan la comparación a la zona de la etapa (p. ej. 0.85 1.42 para el torso).
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from crop_reference import silhouette_mask, PX_PER_M  # noqa: E402

GROUND = 940
VIEWS = ('front', 'side', 'back')


def z_to_row(z):
    return int(round(GROUND - z * PX_PER_M))


def load(p):
    return np.array(Image.open(p).convert('RGB'))


def model_mask(img):
    d = np.abs(img.astype(int) - 61).max(2)
    m = d > 10
    m = nd.binary_opening(m, iterations=1)
    return nd.binary_fill_holes(m)


def widths(mask, rows, central=False):
    out = []
    for r in rows:
        xs = np.where(mask[r])[0]
        if len(xs) and central:
            # solo el tramo que contiene el eje (sin brazos separados del cuerpo)
            lab, n = nd.label(mask[r])
            c = lab[200] if lab[200] else lab[xs[np.argmin(abs(xs - 200))]]
            xs = np.where(lab == c)[0]
        out.append((xs.min(), xs.max()) if len(xs) else (None, None))
    return out


def main():
    stage, tag = int(sys.argv[1]), sys.argv[2]
    zmin = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    zmax = float(sys.argv[4]) if len(sys.argv) > 4 else 1.75
    d = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', f'stage{stage}'))
    r0, r1 = max(z_to_row(zmax), 0), min(z_to_row(zmin), 959)
    tiles, overlays, sils = [], [], []
    print(f'== {tag}  zona z {zmin:.2f}-{zmax:.2f}')
    for v in VIEWS:
        ref = load(os.path.join(ROOT, 'reference', f'ref_{v}.png'))
        ren = load(os.path.join(d, f'{tag}_{v}.png'))
        wir = load(os.path.join(d, f'{tag}_wire_{v}.png'))
        sref = np.array(Image.open(os.path.join(ROOT, 'reference', f'sil_{v}.png'))) > 127
        mp = os.path.join(d, f'{tag}_mask_{v}.png')
        smod = (load(mp).mean(2) > 127) if os.path.exists(mp) else model_mask(ren)
        zone = np.zeros_like(sref)
        zone[r0:r1 + 1] = True
        a, b = sref & zone, smod & zone
        iou = (a & b).sum() / max((a | b).sum(), 1)
        print(f'  IoU {v:5s} {iou:.3f}')
        # tabla de bordes por altura
        zs = np.arange(np.ceil(zmin * 20) / 20, zmax + 1e-6, 0.05)
        rows = [z_to_row(z) for z in zs]
        cen = stage < 3 and v != 'side'
        wr, wm = widths(sref, rows, cen), widths(smod, rows, cen)
        line = []
        for z, (rl, rr), (ml, mr) in zip(zs, wr, wm):
            if rl is None or ml is None:
                continue
            # en metros relativos a la columna 200 (eje de la figura)
            f = lambda c: (c - 200) / PX_PER_M
            line.append(f'{z:.2f}: ref[{f(rl):+.3f},{f(rr):+.3f}] mod[{f(ml):+.3f},{f(mr):+.3f}] '
                        f'd[{f(ml) - f(rl):+.3f},{f(mr) - f(rr):+.3f}]')
        print('   ' + '\n   '.join(line))
        tiles.append(np.concatenate([ref, ren, wir], 1))
        ov = (0.5 * ref + 0.5 * ren).astype(np.uint8)
        edge = smod ^ nd.binary_erosion(smod, iterations=1)
        ov[edge] = (255, 170, 0)
        overlays.append(ov)
        s = np.full(ref.shape, 30, np.uint8)
        s[sref & smod] = (150, 150, 150)
        s[sref & ~smod] = (230, 60, 60)
        s[~sref & smod] = (60, 210, 230)
        sils.append(s)
    sep = np.full((960, 6, 3), 20, np.uint8)

    def row(lst):
        out = []
        for i, t in enumerate(lst):
            out += [t] + ([sep] if i < len(lst) - 1 else [])
        return np.concatenate(out, 1)
    for name, lst in (('sidebyside', tiles), ('overlay', overlays), ('silhouette', sils)):
        img = Image.fromarray(row(lst))
        dr = ImageDraw.Draw(img)
        dr.text((8, 8), f'{tag} - {name}', fill=(255, 255, 255))
        if name == 'sidebyside':
            img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
        if name == 'silhouette':
            img.save(os.path.join(d, f'{tag}_{name}.png'))
        else:
            img.save(os.path.join(d, f'{tag}_{name}.jpg'), quality=88)


if __name__ == '__main__':
    main()
