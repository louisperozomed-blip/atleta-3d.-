"""ENEMIGO · Etapa 1c · Escala, pivote en los pies y correcciones de dirección.

Escala: el grosor de piernas y pies (pieza rígida) mide lo mismo en píxeles en las 20 hojas (14-15 px,
±7 %, ruido de la medida), así que todas están dibujadas a la misma escala: escala única. La baldosa NO
sirve de regla aquí: en block, dodge y death está dibujada un 10 % mayor (hw 97-101 px frente a 87-93) y
escalar por ella encogería al autómata un 10 %. La altura cambia solo por la pose (idle es la más erguida).
Pivote: centro de la baldosa de cada frame (suavizado por fila) + desfase por fila para que el pie apoyado
caiga en el pivote.
Correcciones (ver FIXES): espejos de filas coherentes para las filas con la dirección cambiada.
Salida: build/enemy/fixed/<anim>_<dir>_<i>.png (lienzo CANVAS, pivote PIVOT) y build/enemy/fixed_meta.json
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from enemy_extract import EBUILD, EREF

ECOLOR = os.path.join(EBUILD, "color")
EFIX = os.path.join(EBUILD, "fixed")
os.makedirs(EFIX, exist_ok=True)
ANIMS = ["idle", "walk", "run", "attack1", "attack2", "parry", "hit", "block", "dodge", "death", "deflected", "counter"]
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
CANVAS = (360, 330)
PIVOT = (180, 300)
# frames apoyados en el suelo (para el nivel del pie); el resto puede estar en el aire
GROUNDED = {"dodge": [0, 1, 4, 5], "death": [0, 1, 2]}
MIRROR = [
    ("idle", "E", "idle", "W", None, "a", "fila E mirando a la izquierda (en walk y run el E mira a la derecha)"),
    ("idle", "SE", "idle", "SW", None, "a", "fila SE dibujada como un SW (ojo a la izquierda) y frame 3 de perfil"),
    ("hit", "NE", "hit", "NW", None, "a", "hit_1 NE: las poses giran y dejan ver el ojo; espejo de hit_2 NW"),
    ("hit", "E", "hit", "W", None, "a", "hit_1 E: frames 2, 5 y 6 de frente; espejo de hit_2 W"),
    ("hit", "SE", "hit", "SW", None, "a", "hit_1 SE: no coincide con su dirección; espejo de hit_2 SW"),
    ("attack2", "SW", "attack2", "SE", None, "a", "frames 3-5 de espaldas; espejo de attack2_1 SE (fila entera, para que sea coherente)"),
    ("attack1", "SW", "attack1", "SE", None, "a", "frames 2-5 miran al frente (S) en vez de SW; espejo de attack1_1 SE"),
    ("attack1", "W", "attack1", "E", None, "a", "frames 2-6 miran al frente-izquierda en vez de W; espejo de attack1_1 E"),
    ("parry", "SW", "parry", "SE", None, "a", "la fila mira al frente (S); espejo de parry_1 SE"),
    ("block", "SW", "block", "SE", None, "a", "igual que la fila S (de frente); espejo de block_1 SE"),
    ("block", "W", "block", "E", None, "a", "dibujada como un SW; espejo de block_1 E"),
    # Duelo 3
    ("deflected", "E", "deflected", "W", None, "a", "deflected_1 E mira a la izquierda (ojo y brazo del choque a la izquierda); espejo de deflected_2 W"),
    ("deflected", "SE", "deflected", "SW", None, "a", "deflected_1 SE dibujada como un SW (ojo a la izquierda); espejo de deflected_2 SW"),
    ("deflected", "NE", "deflected", "NW", None, "a", "deflected_1 NE gira a la izquierda (se ve el ojo arriba a la izquierda); espejo de deflected_2 NW"),
    ("counter", "SW", "counter", "SE", None, "a", "counter_2 SW dibujada como un SE (ojo a la derecha); espejo de counter_1 SE"),
    ("counter", "NW", "counter", "NE", None, "a", "counter_2 NW corta hacia la derecha, como NE; espejo de counter_1 NE"),
]


def load(n):
    return np.asarray(Image.open(os.path.join(ECOLOR, n + ".png"))).astype(np.float32)


def warp(img, s, px, py):
    pm = img.copy(); pm[..., :3] *= pm[..., 3:4] / 255.0
    M = np.array([[s, 0, PIVOT[0] - s * px], [0, s, PIVOT[1] - s * py]], np.float32)
    w = np.clip(cv2.warpAffine(pm, M, CANVAS, flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=0), 0, 255)
    al = w[..., 3:4]
    rgb = np.where(al > 0.5, w[..., :3] * 255.0 / np.maximum(al, 1e-3), 0)
    out = np.dstack([np.clip(rgb, 0, 255), al]).round().astype(np.uint8)
    out[out[..., 3] < 2] = 0
    return out


def main():
    labels = json.load(open(os.path.join(EREF, "labels.json")))
    meta = json.load(open(os.path.join(EBUILD, "raw_meta.json")))
    # baldosas suavizadas por fila (patrón de columna común a las 4 filas + recta por fila)
    for sh, v in labels["sheets"].items():
        an, rows = v["anim"], v["rows"]
        X = np.array([[meta[f"{an}_{d}_{i}"]["box"][0] + (meta[f"{an}_{d}_{i}"]["tile"] or {"cx": np.nan})["cx"] for i in range(6)] for d in rows])
        Y = np.array([[meta[f"{an}_{d}_{i}"]["box"][1] + (meta[f"{an}_{d}_{i}"]["tile"] or {"cy": np.nan})["cy"] for i in range(6)] for d in rows])
        colpat = np.nanmedian(X, 0)
        ii = np.arange(6)
        for r, d in enumerate(rows):
            ok = np.isfinite(X[r]) & np.isfinite(Y[r])
            kx = np.polyfit(ii[ok], (X[r] - colpat)[ok], 1) if ok.sum() >= 2 else [0, 0]
            ky = np.polyfit(ii[ok], Y[r][ok], 1) if ok.sum() >= 2 else [0, np.nanmedian(Y)]
            for i in range(6):
                n = f"{an}_{d}_{i}"
                meta[n]["tile_s"] = {"cx": colpat[i] + np.polyval(kx, i) - meta[n]["box"][0], "cy": np.polyval(ky, i) - meta[n]["box"][1]}
    out, piv = {}, {}
    for an in ANIMS:
        for d in DIRS:
            names = [f"{an}_{d}_{i}" for i in range(6)]
            imgs = [load(n) for n in names]
            bots, cxs, fxs = [], [], []
            for img in imgs:
                al = img[..., 3] > 127
                b = ndi.binary_opening(al, np.ones((5, 5)))
                ys, xs = np.nonzero(b)
                top, bot = ys.min(), ys.max()
                bots.append(bot)
                up = b.copy(); up[top + int((bot - top) * 0.55):] = False
                cxs.append(np.nonzero(up)[1].mean())
                ft = b.copy(); ft[:bot - 16] = False
                fxs.append(np.nonzero(ft)[1].mean())
            T = [meta[n]["tile_s"] for n in names]
            rel_bot = [bots[i] - T[i]["cy"] for i in range(6)]
            g = GROUNDED.get(an, range(6))
            dy = np.percentile([rel_bot[i] for i in g], 75)
            # x: a medio camino entre torso y pies (como el personaje)
            dx = np.median([0.5 * (cxs[i] + fxs[i]) - T[i]["cx"] for i in range(6)])
            for i, n in enumerate(names):
                px, py = T[i]["cx"] + dx, T[i]["cy"] + dy
                out[n] = warp(imgs[i], 1.0, px, py)
                piv[n] = [round(float(px), 1), round(float(py), 1)]
    fixes = []
    for an, d, san, sd, frames, kind, why in MIRROR:
        for i in range(6):
            out[f"{an}_{d}_{i}"] = out[f"{san}_{sd}_{i}"][:, ::-1].copy()
        fixes.append({"frames": f"{an}_{d}_1..6", "tipo": kind, "problema": why, "arreglo": f"espejo horizontal de {san} {sd}"})
    # hit N: hit_1 N tiene los frames 5-6 de frente -> STAGGER (4) sostenido y READY = idle N reposo
    out["hit_N_4"] = out["hit_N_3"].copy()
    out["hit_N_5"] = out["idle_N_0"].copy()
    fixes.append({"frames": "hit_N_5..6", "tipo": "a provisional / b", "problema": "hit_1 N: frames 5-6 (RECOVER, READY) de frente",
                  "arreglo": "RECOVER = STAGGER (frame 4) sostenido, READY = idle N reposo; regenerar la fila N"})
    for n, img in out.items():
        Image.fromarray(img).save(os.path.join(EFIX, n + ".png"))
    # extensión real respecto al pivote (para dimensionar el atlas)
    ext = np.zeros(4)
    for img in out.values():
        ys, xs = np.nonzero(img[..., 3] > 8)
        ext = np.maximum(ext, [PIVOT[0] - xs.min(), xs.max() - PIVOT[0], PIVOT[1] - ys.min(), ys.max() - PIVOT[1]])
    json.dump({"canvas": CANVAS, "pivot": PIVOT, "scale": 1.0, "pivots": piv, "fixes": fixes, "extent_px": ext.tolist()},
              open(os.path.join(EBUILD, "fixed_meta.json"), "w"), indent=1, ensure_ascii=False)
    print("extensión (izq, der, arriba, abajo):", ext)


if __name__ == "__main__":
    main()
