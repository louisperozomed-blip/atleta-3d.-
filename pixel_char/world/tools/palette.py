"""Paleta compartida para el personaje: colores del mundo (k-means sobre capturas reales de las 5 zonas,
sin la interfaz) + tonos propios del personaje (k-means sobre el atlas). El shader del personaje cuantiza
a esta paleta con dither ordenado, así sus píxeles usan los mismos colores que la escena sin perder
su negro, crema, naranja y verde.
Salida: world/assets/palette.json y world/walk/palette.png
"""
import json, os, glob
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def kmeans(px, k, seed=0):
    px = px.astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.5)
    cv2.setRNGSeed(seed)
    _, lab, cen = cv2.kmeans(px, k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(lab.ravel(), minlength=k)
    return cen, counts


def main():
    world = []
    for f in sorted(glob.glob(os.path.join(ROOT, "review", "stage1", "z_*.png"))):
        a = np.asarray(Image.open(f).convert("RGB"))
        h, w = a.shape[:2]
        a = a[int(h * 0.08):int(h * 0.86), :]          # sin HUD ni barra de botones
        # sin el centro (donde está el personaje)
        m = np.ones(a.shape[:2], bool)
        m[int(a.shape[0] * 0.3):int(a.shape[0] * 0.7), int(w * 0.38):int(w * 0.62)] = False
        world.append(a[m][::7])
    world = np.concatenate(world)
    wc, wn = kmeans(world, 24)
    # tonos propios del personaje TAL COMO SE VE en el mundo (iluminado): diferencia entre capturas con y
    # sin el personaje (tests/palette_capture.mjs); si no hay capturas, se usa el atlas
    cap = os.environ.get("PALCAP")
    char = []
    if cap:
        for fa in sorted(glob.glob(os.path.join(cap, "c*_a.png"))):
            a = np.asarray(Image.open(fa).convert("RGB")).astype(int)
            b = np.asarray(Image.open(fa.replace("_a.png", "_b.png")).convert("RGB")).astype(int)
            m = np.abs(a - b).sum(-1) > 24
            char.append(a[m])
    if char:
        cc, cn = kmeans(np.concatenate(char), 14)
    else:
        atlas = np.asarray(Image.open(os.path.join(ROOT, "assets", "color.png")))
        cc, cn = kmeans(atlas[atlas[..., 3] > 200][:, :3][::11], 14)
    pal = np.concatenate([wc, cc]) / 255.0
    order = np.argsort(pal @ np.array([0.299, 0.587, 0.114]))
    pal = pal[order]
    json.dump({"colors": pal.round(4).tolist(), "world": 24, "character": 14}, open(os.path.join(ROOT, "assets", "palette.json"), "w"))
    im = Image.new("RGB", (len(pal) * 24, 40)); d = ImageDraw.Draw(im)
    for i, c in enumerate(pal):
        d.rectangle([i * 24, 0, i * 24 + 23, 39], fill=tuple(int(v * 255) for v in c))
    im.save(os.path.join(ROOT, "walk", "palette.png"))
    print("paleta", len(pal), "colores (24 del mundo + 14 del personaje en el mundo)")


if __name__ == "__main__":
    main()
