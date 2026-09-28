"""Recorta la hoja de referencia en tres vistas (front/side/back) y genera siluetas.

Uso: python3 scripts/crop_reference.py
Cada recorte mide 560x940 px; el suelo (suela) queda en y=921 y el centro del
personaje en x=280. Escala de trabajo: 512 px = 1 m (ver scripts/common.py).
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = np.array([198, 198, 201])
W, H = 560, 940
# centro de cada figura (x en la hoja) y límites del panel para no mezclar figuras vecinas
VIEWS = {'front': (308, 0, 600), 'side': (768, 600, 925), 'back': (1220, 925, 1536)}


def silhouette_mask(img):
    """Máscara del personaje: descarta el fondo y la sombra gris del suelo."""
    c = np.asarray(img).astype(int)
    diff = np.abs(c - BG).sum(2)
    neutral = (c.max(2) - c.min(2)) < 14
    shadow = neutral & (c.mean(2) > 120)
    m = (diff > 45) & ~shadow
    m = nd.binary_closing(m, iterations=2)
    lab, n = nd.label(~m)
    sizes = nd.sum(np.ones_like(lab), lab, range(n + 1))
    for i in range(1, n + 1):
        if sizes[i] < 2500:        # rellenar huecos pequeños (zonas blancas)
            m[lab == i] = True
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    if n > 1:
        sizes = nd.sum(m, lab, range(n + 1))
        sizes[0] = 0
        m = np.isin(lab, np.where(sizes > 400)[0])
    return m


def main():
    src = np.array(Image.open(os.path.join(ROOT, 'reference/atleta_turnaround.png')).convert('RGB'))
    out = os.path.join(ROOT, 'reference')
    info = {}
    for name, (cx, p0, p1) in VIEWS.items():
        crop = np.tile(BG, (H, W, 1)).astype(np.uint8)
        for x in range(W):
            sx = cx - W // 2 + x
            if p0 <= sx < p1:
                crop[:, x] = src[:H, sx]
        crop[930:] = BG  # quitar etiquetas FRONT/SIDE/BACK
        Image.fromarray(crop).save(f'{out}/ref_{name}.png')
        m = silhouette_mask(crop)
        Image.fromarray((m * 255).astype(np.uint8)).save(f'{out}/sil_{name}.png')
        ys, xs = np.where(m)
        info[name] = dict(top=int(ys.min()), bottom=int(ys.max()), left=int(xs.min()), right=int(xs.max()))
    print(json.dumps(info, indent=1))


if __name__ == '__main__':
    main()
