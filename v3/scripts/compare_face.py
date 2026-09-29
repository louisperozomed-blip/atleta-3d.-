"""Comparativa de primer plano de la cara: referencia ampliada | render (frente y perfil).

Uso: python3 scripts/compare_face.py <tag>  ->  renders/face_<tag>.png
El recorte de la referencia usa la misma escala (512 px = 1 m) y el mismo centro que render_face.py.
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE_M, CZ = 0.30, 1.575
PX = 512.0


def ref_crop(view, cx_m):
    im = Image.open(os.path.join(ROOT, 'reference', f'ref_{view}.png')).convert('RGB')
    cx = 280 + cx_m * PX
    cy = 921 - CZ * PX
    h = SIZE_M * PX / 2
    return im.crop((int(cx - h), int(cy - h), int(cx + h), int(cy + h))).resize((600, 600), Image.LANCZOS)


def main(tag):
    d = os.path.join(ROOT, 'renders', 'iter')
    tiles = [ref_crop('front', 0.0), Image.open(os.path.join(d, f'{tag}_face_front.png')).convert('RGB'),
             ref_crop('side', 0.10), Image.open(os.path.join(d, f'{tag}_face_side.png')).convert('RGB')]
    out = Image.new('RGB', (2400, 630), (255, 255, 255))
    dr = ImageDraw.Draw(out)
    for i, (t, lab) in enumerate(zip(tiles, ['REF frente', 'modelo frente', 'REF perfil', 'modelo perfil'])):
        out.paste(t, (i * 600, 30))
        dr.text((i * 600 + 10, 8), lab, fill=(0, 0, 0))
    p = os.path.join(ROOT, 'renders', f'face_{tag}.png')
    out.save(p)
    print(p)


if __name__ == '__main__':
    main(sys.argv[1])
