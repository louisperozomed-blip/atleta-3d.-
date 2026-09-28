"""Genera la comparativa lado a lado referencia vs render y un solape de siluetas.

Uso: python3 scripts/compare.py <tag> [dir]
Salida: renders/compare_<tag>.png  (fila 1: ref | render | diferencias de silueta)
Imprime IoU de silueta por vista.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = np.array([198, 198, 201])


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crop_reference import silhouette_mask  # noqa: E402


def silhouette(img):
    return silhouette_mask(np.array(img.convert('RGB')))


def main(tag, d=None):
    d = d or os.path.join(ROOT, 'renders', 'iter')
    cols = []
    ious = {}
    for v in ('front', 'side', 'back'):
        ref = Image.open(os.path.join(ROOT, 'reference', f'ref_{v}.png')).convert('RGB')
        ren = Image.open(os.path.join(d, f'{tag}_{v}.png')).convert('RGB')
        sr = np.array(Image.open(os.path.join(ROOT, 'reference', f'sil_{v}.png'))) > 0
        sm = silhouette(ren)
        iou = (sr & sm).sum() / max((sr | sm).sum(), 1)
        ious[v] = iou
        diff = np.zeros(sr.shape + (3,), np.uint8) + 40
        diff[sr & sm] = (200, 200, 200)
        diff[sr & ~sm] = (230, 60, 60)    # falta en el modelo (rojo)
        diff[~sr & sm] = (60, 120, 240)   # sobra en el modelo (azul)
        # superposición semitransparente del render sobre la referencia
        over = Image.blend(ref, ren, 0.5)
        col = Image.new('RGB', (ref.width * 4, ref.height + 30), (255, 255, 255))
        col.paste(ref, (0, 30)); col.paste(ren, (ref.width, 30))
        col.paste(over, (ref.width * 2, 30)); col.paste(Image.fromarray(diff), (ref.width * 3, 30))
        dr = ImageDraw.Draw(col)
        dr.text((10, 8), f'{v.upper()}  ref | modelo | mezcla 50% | silueta (rojo=falta, azul=sobra)  IoU={iou:.3f}', fill=(0, 0, 0))
        cols.append(col)
    W = cols[0].width
    out = Image.new('RGB', (W, sum(c.height for c in cols)), (255, 255, 255))
    y = 0
    for c in cols:
        out.paste(c, (0, y)); y += c.height
    out = out.resize((out.width // 2, out.height // 2), Image.LANCZOS)
    p = os.path.join(ROOT, 'renders', f'compare_{tag}.png')
    out.save(p)
    # versión compacta: ref vs modelo para las tres vistas en una fila
    row = Image.new('RGB', (560 * 6, 940), (255, 255, 255))
    for i, v in enumerate(('front', 'side', 'back')):
        row.paste(Image.open(os.path.join(ROOT, 'reference', f'ref_{v}.png')), (i * 1120, 0))
        row.paste(Image.open(os.path.join(d, f'{tag}_{v}.png')).convert('RGB'), (i * 1120 + 560, 0))
    row.resize((row.width // 2, row.height // 2), Image.LANCZOS).save(os.path.join(ROOT, 'renders', f'sidebyside_{tag}.png'))
    print(tag, ' '.join(f'{k}={v:.3f}' for k, v in ious.items()))
    return ious


def runs(row):
    out, st = [], None
    for x, v in enumerate(row):
        if v and st is None:
            st = x
        if not v and st is not None:
            if x - st > 2:
                out.append((st, x - 1))
            st = None
    return out


def rows_report(tag, d=None, step=24):
    """Tabla por alturas: tramos de silueta ref vs modelo (en metros)."""
    d = d or os.path.join(ROOT, 'renders', 'iter')
    for v in ('front', 'side'):
        sr = np.array(Image.open(os.path.join(ROOT, 'reference', f'sil_{v}.png'))) > 0
        sm = silhouette(Image.open(os.path.join(d, f'{tag}_{v}.png')))
        print('==', v)
        f = lambda x: f'{(x - 280) / 512:+.3f}'
        for y in range(20, 925, step):
            a = ' '.join(f'[{f(p)},{f(q)}]' for p, q in runs(sr[y]))
            b = ' '.join(f'[{f(p)},{f(q)}]' for p, q in runs(sm[y]))
            print(f'z={(921 - y) / 512:.3f} REF {a}\n          MOD {b}')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[2] == 'rows':
        rows_report(sys.argv[1])
        sys.exit()
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
