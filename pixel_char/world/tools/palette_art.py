"""Paleta de la nueva dirección de arte (fantasía oscura, naturaleza que se traga un mundo muerto).

- 22 colores del mundo: k-means sobre las 5 referencias (ref/estilo/*.png), con los tonos muy saturados
  y los cálidos apartados (la bioluminiscencia y el naranja se fijan a mano para controlarlos).
- anclas fijas: negros de tinta, cian/verde bioluminiscente, naranja de farol y de flor, musgo terracota.
- 12 tonos propios del personaje (k-means sobre su atlas): él debe ser lo más cálido de la escena.
Salida: assets/palette_art.json, walk/palette_art.png y review/art1/paleta_refs.png (referencias
reducidas a la paleta, para comprobar que conserva el ambiente).
"""
import json, os, glob
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ANCHORS = {
    "tinta": (8, 12, 12), "negro_verde": (14, 22, 21),
    "bio_cian": (70, 225, 255), "bio_cian_osc": (24, 120, 150), "bio_verde": (120, 255, 150), "bio_verde_osc": (40, 150, 95),
    "farol": (255, 186, 90), "farol_hondo": (224, 120, 40), "flor": (240, 128, 40), "musgo_terracota": (150, 84, 58),
    "musgo_terracota_osc": (96, 54, 42), "chispa": (255, 236, 190),
}


def kmeans(px, k, seed=0):
    px = px.astype(np.float32)
    cv2.setRNGSeed(seed)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 80, 0.3)
    _, lab, cen = cv2.kmeans(px, k, None, crit, 5, cv2.KMEANS_PP_CENTERS)
    return cen, np.bincount(lab.ravel(), minlength=k)


def to_lab(rgb):
    a = np.asarray(rgb, np.uint8).reshape(-1, 1, 3)
    return cv2.cvtColor(a, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)


def main():
    px = []
    for f in sorted(glob.glob(os.path.join(ROOT, "ref", "estilo", "*.jpg"))):
        a = np.asarray(Image.open(f).convert("RGB").resize((180, 320), Image.BILINEAR)).reshape(-1, 3)
        hsv = cv2.cvtColor(a.reshape(-1, 1, 3), cv2.COLOR_RGB2HSV).reshape(-1, 3)
        # fuera: muy saturados (bio, flores) y cálidos (se fijan como anclas) y el cielo azul de la 05
        warm = (hsv[:, 0] < 25) | (hsv[:, 0] > 160)
        keep = ~((hsv[:, 1] > 150) & (hsv[:, 2] > 120)) & ~(warm & (hsv[:, 1] > 90)) & ~((hsv[:, 0] > 95) & (hsv[:, 0] < 115) & (hsv[:, 2] > 170))
        px.append(a[keep][::2])
    px = np.concatenate(px)
    # en Lab para que el k-means reparta por diferencias perceptibles (más tonos oscuros distintos)
    lab = to_lab(px)
    cen, cnt = kmeans(lab, 22)
    world = cv2.cvtColor(np.clip(cen, 0, 255).astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_LAB2RGB).reshape(-1, 3)
    atlas = np.asarray(Image.open(os.path.join(ROOT, "assets", "color.png")))
    cp = atlas[atlas[..., 3] > 200][:, :3][::7]
    cc, _ = kmeans(to_lab(cp), 12, 1)
    char = cv2.cvtColor(np.clip(cc, 0, 255).astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_LAB2RGB).reshape(-1, 3)
    anchors = np.array(list(ANCHORS.values()), np.uint8)
    pal = np.concatenate([world, anchors, char]).astype(np.float32) / 255
    groups = ["mundo"] * len(world) + ["ancla"] * len(anchors) + ["personaje"] * len(char)
    order = np.argsort(pal @ np.array([0.299, 0.587, 0.114]))
    pal, groups = pal[order], [groups[i] for i in order]
    json.dump({"colors": pal.round(4).tolist(), "groups": groups, "anchors": ANCHORS},
              open(os.path.join(ROOT, "assets", "palette_art.json"), "w"))
    im = Image.new("RGB", (len(pal) * 20, 44)); d = ImageDraw.Draw(im)
    for i, c in enumerate(pal):
        d.rectangle([i * 20, 0, i * 20 + 19, 35], fill=tuple(int(v * 255) for v in c))
        d.rectangle([i * 20, 37, i * 20 + 19, 43], fill={"mundo": (90, 110, 105), "ancla": (230, 150, 60), "personaje": (200, 90, 60)}[groups[i]])
    im.save(os.path.join(ROOT, "walk", "palette_art.png"))
    # referencias reducidas a la paleta (dither ordenado), para revisar el ambiente
    P = (pal * 255).astype(np.float32)
    B = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16 - 0.5
    tiles = []
    for f in sorted(glob.glob(os.path.join(ROOT, "ref", "estilo", "*.jpg"))):
        a = np.asarray(Image.open(f).convert("RGB").resize((160, 280), Image.BILINEAR)).astype(np.float32)
        h, w = a.shape[:2]
        a = a + B[np.arange(h)[:, None] % 4, np.arange(w)[None, :] % 4][..., None] * 22
        d2 = ((a[:, :, None, :] - P[None, None]) ** 2 * np.array([2, 4, 3])).sum(-1)
        q = P[d2.argmin(-1)].astype(np.uint8)
        tiles.append(np.concatenate([np.asarray(Image.open(f).convert("RGB").resize((160, 280))), q], 0))
    out = Image.fromarray(np.concatenate(tiles, 1)).resize((160 * 5 * 2, 560 * 2), Image.NEAREST)
    os.makedirs(os.path.join(ROOT, "review", "art1"), exist_ok=True)
    out.save(os.path.join(ROOT, "review", "art1", "paleta_refs.png"))
    print("paleta", len(pal), "colores:", len(world), "del mundo,", len(anchors), "anclas,", len(char), "del personaje")


if __name__ == "__main__":
    main()
