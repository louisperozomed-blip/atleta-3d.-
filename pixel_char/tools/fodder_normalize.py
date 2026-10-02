"""RELLENO · Etapa 1c · escala, pivote en los pies y correcciones de dirección.

Escala: única por criatura. La baldosa NO sirve de regla (en las hojas del zombi mide 70 px de semiancho en
idle/walk, 75-78 en attack/hit y 83-94 en death; en el perro 101-111) pero la figura sí mantiene su tamaño:
la altura de pie mide 180-195 px en todas las hojas del zombi y 157-174 en las del perro (lo que varía es la
pose: agachado al atacar). La escala al mundo se fija luego en fodder_maps.py.
Pivote: centro de la baldosa de cada frame (regularizado por fila en fodder_extract) + desfase por fila
(animación y dirección) para que el pie apoyado caiga en el pivote; en x, a medio camino entre torso y pies.
Correcciones (FIXES): espejos de filas coherentes donde la dirección está cambiada o falta la hoja.
Salida: build/fodder/fixed/<tipo>_<anim>_<dir>_<i>.png (lienzo CANVAS, pivote PIVOT) + build/fodder/fixed_meta.json
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from enemy_normalize import warp as _warp
import enemy_normalize as EN
from fodder_extract import FBUILD

FCOLOR = os.path.join(FBUILD, "color")
FFIX = os.path.join(FBUILD, "fixed")
os.makedirs(FFIX, exist_ok=True)
KINDS = ["zombie", "dog"]
ANIMS = ["idle", "walk", "attack", "hit", "death"]
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
CANVAS = (440, 320)
PIVOT = (220, 280)
# frames apoyados (para el nivel del pie): el resto puede estar en el aire (salto del perro) o tumbado
GROUNDED = {("dog", "attack"): [0, 1, 4, 5], ("zombie", "death"): [0, 1], ("dog", "death"): [0, 1]}
# (tipo, anim, dir destino, dir origen, clase, problema)
MIRROR = [
    ("zombie", "idle", "E", "W", "a", "zombie_idle_1 E mira a la izquierda (calavera a la izquierda en los 6 frames)"),
    ("zombie", "idle", "SE", "SW", "a", "zombie_idle_1 SE dibujada como un SW (mira a la izquierda)"),
    ("zombie", "idle", "NE", "NW", "a", "zombie_idle_1 NE gira a la izquierda como un NW"),
    ("zombie", "attack", "NW", "NE", "a", "zombie_attack_2 NW dibujada de frente-izquierda (se ve la cara), igual que SW"),
    ("zombie", "hit", "W", "E", "a", "zombie_hit_2 W mira a la derecha (calavera a la derecha)"),
    ("dog", "death", "E", "W", "a", "no hay dog_death_1 (N, NE, E, SE): E = espejo de W"),
    ("dog", "death", "SE", "SW", "a", "no hay dog_death_1: SE = espejo de SW"),
    ("dog", "death", "NE", "NW", "a", "no hay dog_death_1: NE = espejo de NW"),
]
COPY = [
    ("dog", "death", "N", "NW", "b", "no hay dog_death_1 y la N no se deduce de ninguna: NW provisional; regenerar dog_death_1"),
]


def load(n):
    return np.asarray(Image.open(os.path.join(FCOLOR, n + ".png"))).astype(np.float32)


def warp(img, s, px, py):
    EN.CANVAS, EN.PIVOT = CANVAS, PIVOT
    return _warp(img, s, px, py)


def main():
    meta = json.load(open(os.path.join(FBUILD, "raw_meta.json")))
    out, piv = {}, {}
    for kind in KINDS:
        for an in ANIMS:
            for d in DIRS:
                names = [f"{kind}_{an}_{d}_{i}" for i in range(6)]
                if not os.path.exists(os.path.join(FCOLOR, names[0] + ".png")):
                    continue
                imgs = [load(n) for n in names]
                bots, cxs, fxs = [], [], []
                for img in imgs:
                    b = ndi.binary_opening(img[..., 3] > 127, np.ones((5, 5)))
                    ys, xs = np.nonzero(b)
                    top, bot = ys.min(), ys.max()
                    bots.append(bot)
                    up = b.copy(); up[top + int((bot - top) * 0.55):] = False
                    cxs.append(np.nonzero(up)[1].mean())
                    ft = b.copy(); ft[:bot - 16] = False
                    fxs.append(np.nonzero(ft)[1].mean())
                T = [meta[n]["tile"] for n in names]
                rel = [bots[i] - T[i]["cy"] for i in range(6)]
                g = GROUNDED.get((kind, an), range(6))
                dy = np.percentile([rel[i] for i in g], 75)
                dx = np.median([0.5 * (cxs[i] + fxs[i]) - T[i]["cx"] for i in g])
                for i, n in enumerate(names):
                    px, py = T[i]["cx"] + dx, T[i]["cy"] + dy
                    out[n] = warp(imgs[i], 1.0, px, py)
                    piv[n] = [round(float(px), 1), round(float(py), 1)]
    fixes = []
    for kind, an, d, sd, cls, why in MIRROR:
        for i in range(6):
            out[f"{kind}_{an}_{d}_{i}"] = out[f"{kind}_{an}_{sd}_{i}"][:, ::-1].copy()
        fixes.append({"frames": f"{kind}_{an}_{d}_1..6", "tipo": cls, "problema": why, "arreglo": f"espejo horizontal de {kind} {an} {sd}"})
    for kind, an, d, sd, cls, why in COPY:
        for i in range(6):
            out[f"{kind}_{an}_{d}_{i}"] = out[f"{kind}_{an}_{sd}_{i}"].copy()
        fixes.append({"frames": f"{kind}_{an}_{d}_1..6", "tipo": cls, "problema": why, "arreglo": f"copia de {kind} {an} {sd}"})
    for n, img in out.items():
        Image.fromarray(img).save(os.path.join(FFIX, n + ".png"))
    ext = {}
    for kind in KINDS:
        e = np.zeros(4)
        for n, img in out.items():
            if not n.startswith(kind + "_"):
                continue
            ys, xs = np.nonzero(img[..., 3] > 8)
            e = np.maximum(e, [PIVOT[0] - xs.min(), xs.max() - PIVOT[0], PIVOT[1] - ys.min(), ys.max() - PIVOT[1]])
        ext[kind] = e.tolist()
        print(kind, "extensión (izq, der, arriba, abajo):", e)
    json.dump({"canvas": CANVAS, "pivot": PIVOT, "pivots": piv, "fixes": fixes, "extent_px": ext},
              open(os.path.join(FBUILD, "fixed_meta.json"), "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
