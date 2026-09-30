"""COMBATE · Etapa 1 · Escala, pivote y correcciones de dirección.

Escala: media geométrica de dos medidas
  - casco: la única pieza rígida; su radio inscrito (R) frente al de idle/walk
    normalizados de la misma dirección (mediana por animación, cada fila ±4 %)
  - baldosa: todas las hojas usan la misma baldosa (~92 px de semieje), así que
    a igual baldosa, igual escala de dibujo que idle
block/dodge/hit/death tienen el casco ~8-10 % mayor pero el cuerpo más corto
(proporciones más rechonchas): solo con el casco el cuerpo quedaría más bajo
que idle; a medio camino ni la cabeza queda grande ni el cuerpo pequeño.
Pivote: centro de la baldosa de cada frame (suavizado por fila) + desfase por
fila para que el pie apoyado caiga en el pivote. Se conserva el desplazamiento
pintado (estocadas, retrocesos, caída): es el movimiento raíz de cada animación.

Correcciones de dirección (ver review/combat/E1_*):
  attack1_SW  <- espejo horizontal de attack1_SE (la fila mostraba la mochila)
  attack3_SW_5 <- espejo de attack3_SE_5 (RECOVERY mostraba la mochila)
  attack3_*_3 (IMPACT, de frente en todas las filas) <- trasplante: pose de
      FOLLOW THROUGH de la misma fila (dirección correcta, cuchilla abajo) + el
      estallido de fuego del IMPACT original bajo los pies
Salida: build/combat/fixed/<anim>_<dir>_<i>.png (240x272, pivote 120,250) y
        build/combat/fixed_meta.json
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from combat_common import CBUILD, CFIX, CSHEETS, rows_of
from common import BUILD, DIRS, NFRAMES, frame_name
from normalize import measures

# lienzo algo mayor que el de idle/walk (240x272, pivote 120,250): la cuchilla levantada de attack3
# llega a 257 px sobre el suelo y la estocada de attack2 a 120 px del pivote
CANVAS = (256, 288)
PIVOT = (128, 264)

COLOR = os.path.join(CBUILD, "color")
NORM = os.path.join(BUILD, "norm")
ANIMS = ["attack1", "attack2", "attack3", "parry", "block", "dodge", "hit", "death"]


def load(d, n):
    return np.asarray(Image.open(os.path.join(d, n + ".png"))).astype(np.float32)


def helmet_R(rgba):
    """R del casco sin la cuchilla (la cuchilla levantada sobre la cabeza movería el 'top')."""
    a = rgba[..., 3] > 127
    c = rgba[..., :3]
    hot = (c[..., 0] > 190) & (c[..., 0] - c[..., 2] > 110)
    thin = hot & ~ndi.binary_opening(a, np.ones((9, 9)))
    m = ndi.binary_opening(a & ~thin, np.ones((5, 5)))
    lab, n = ndi.label(m)
    if n > 1:
        sz = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (np.argmax(sz) + 1)
    ys = np.nonzero(m)[0]
    dt = ndi.distance_transform_edt(m)
    dt[ys.min() + 55:] = 0
    return float(dt.max())


def warp(img, s, px, py):
    pm = img.copy()
    pm[..., :3] *= pm[..., 3:4] / 255.0
    M = np.array([[s, 0, PIVOT[0] - s * px], [0, s, PIVOT[1] - s * py]], np.float32)
    w = np.clip(cv2.warpAffine(pm, M, CANVAS, flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT,
                               borderValue=0), 0, 255)
    al = w[..., 3:4]
    rgb = np.where(al > 0.5, w[..., :3] * 255.0 / np.maximum(al, 1e-3), 0)
    out = np.dstack([np.clip(rgb, 0, 255), al]).round().astype(np.uint8)
    out[out[..., 3] < 2] = 0
    return out


def over(dst, src):
    """src sobre dst (RGBA uint8)."""
    d = dst.astype(np.float32) / 255; s = src.astype(np.float32) / 255
    a = s[..., 3:4] + d[..., 3:4] * (1 - s[..., 3:4])
    rgb = (s[..., :3] * s[..., 3:4] + d[..., :3] * d[..., 3:4] * (1 - s[..., 3:4])) / np.maximum(a, 1e-4)
    return (np.dstack([rgb, a]) * 255).round().clip(0, 255).astype(np.uint8)


def fire_layer(img):
    """Estallido de fuego del IMPACT de attack3 (fila S): lo encendido (naranja muy saturado) en la franja
    del suelo, alrededor de los pies. Se pone detrás del cuerpo de la otra pose y las motas de más abajo,
    delante."""
    a = img[..., 3] > 20
    lab = cv2.cvtColor(img[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)
    C = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    fire = a & (C > 40) & (img[..., 0] > 140)
    yy = np.arange(img.shape[0])[:, None]
    fire &= yy > PIVOT[1] - 62
    out = img.copy()
    out[..., 3] = np.where(fire, img[..., 3], 0)
    return out


def main():
    meta = json.load(open(os.path.join(CBUILD, "raw_meta.json")))
    frames, M, Rr = {}, {}, {}
    for an in ANIMS:
        for d in DIRS:
            for i in range(NFRAMES):
                n = frame_name(an, d, i)
                frames[n] = load(COLOR, n)
                M[n] = measures(frames[n])
                Rr[n] = helmet_R(frames[n])
    # R objetivo por dirección: idle/walk normalizados
    Rt = {d: float(np.median([helmet_R(load(NORM, frame_name(a, d, i))) for a in ("idle", "walk")
                              for i in range(NFRAMES)])) for d in DIRS}
    # R de referencia en crudo de idle/walk (para el desfase x del pivote)
    raw_old = os.path.join(BUILD, "raw")
    off_d = {}
    for d in DIRS:
        mm = [measures(load(raw_old, frame_name("idle", d, k))) for k in range(NFRAMES)]
        off_d[d] = 0.5 * np.median([m["feet_x"] - m["cxu"] for m in mm])
    scale, report = {}, {}
    old_rows = json.load(open(os.path.join(BUILD, "norm_meta.json")))["rows"]
    s_idle = float(np.median([old_rows[f"idle_{d}"]["scale"] for d in DIRS]))
    for an in ANIMS:
        rows = {d: Rt[d] / np.median([Rr[frame_name(an, d, i)] for i in range(NFRAMES)]) for d in DIRS}
        s_an = float(np.median(list(rows.values())))
        # escala por baldosa: todas las hojas usan la misma baldosa (~92 px), así que a igual baldosa igual dibujo
        hw = float(np.median([meta[frame_name(an, d, i)]["tile"]["hw"] for d in DIRS for i in range(NFRAMES)
                              if meta[frame_name(an, d, i)]["tile"]]))
        s_tile = s_idle * 92.0 / hw
        for d in DIRS:
            s_helm = float(np.clip(rows[d], s_an * 0.96, s_an * 1.04))
            # media geométrica: el casco (rígido) dice que block/dodge/hit/death están ~8-10 % más grandes, pero
            # su cuerpo es más corto; a medio camino ni la cabeza queda grande ni el cuerpo pequeño
            scale[(an, d)] = float(np.sqrt(s_helm * s_tile))
        report[an] = {"casco": round(s_an, 4), "baldosa": round(s_tile, 4), "tile_hw": round(hw, 1),
                      "rows": {d: round(scale[(an, d)], 4) for d in DIRS}}
    # baldosas suavizadas por fila (como normalize.py)
    for sheet, (an, part) in CSHEETS.items():
        if an not in ANIMS:
            continue
        rows = rows_of(sheet)
        X = np.array([[meta[frame_name(an, d, i)]["box"][0] + meta[frame_name(an, d, i)]["tile"]["cx"]
                       for i in range(NFRAMES)] for d in rows])
        Y = np.array([[meta[frame_name(an, d, i)]["box"][1] + meta[frame_name(an, d, i)]["tile"]["cy"]
                       for i in range(NFRAMES)] for d in rows])
        colpat = np.median(X, 0)
        ii = np.arange(NFRAMES)
        for r, d in enumerate(rows):
            kx = np.polyfit(ii, X[r] - colpat, 1)
            ky = np.polyfit(ii, Y[r], 1)
            for i in range(NFRAMES):
                n = frame_name(an, d, i)
                t = meta[n]["tile"]
                t["cx"] = colpat[i] + np.polyval(kx, i) - meta[n]["box"][0]
                t["cy"] = np.polyval(ky, i) - meta[n]["box"][1]
    out = {}
    piv = {}
    for an in ANIMS:
        for d in DIRS:
            s = scale[(an, d)]
            names = [frame_name(an, d, i) for i in range(NFRAMES)]
            tiles = [meta[n]["tile"] for n in names]
            rel_bot = [M[n]["bot"] - t["cy"] for n, t in zip(names, tiles)]
            # suelo: el pie apoyado. En los frames de salto (attack3 LEAP/OVERHEAD) el pie está en el aire,
            # así que se usa el percentil 25 de los frames (los apoyados son los más bajos... en pantalla, mayor y)
            dy = np.percentile(rel_bot, 75) if an != "attack3" else np.median([rel_bot[i] for i in (0, 3, 4, 5)])
            rel_cx = [M[n]["cxu"] - t["cx"] for n, t in zip(names, tiles)]
            dx = np.median(rel_cx) + off_d[d]
            for i, n in enumerate(names):
                t = tiles[i]
                px, py = t["cx"] + dx, t["cy"] + dy
                out[n] = warp(frames[n], s, px, py)
                piv[n] = [round(float(px), 1), round(float(py), 1), round(s, 4)]
    fixes = []
    # attack1 SW <- espejo de attack1 SE
    for i in range(NFRAMES):
        out[frame_name("attack1", "SW", i)] = out[frame_name("attack1", "SE", i)][:, ::-1].copy()
    fixes.append({"frames": "attack1_SW_0..5", "tipo": "a", "fix": "espejo horizontal de attack1_SE (la fila SW mostraba la mochila)"})
    # attack3 SW RECOVERY <- espejo de SE RECOVERY
    out[frame_name("attack3", "SW", 5)] = out[frame_name("attack3", "SE", 5)][:, ::-1].copy()
    fixes.append({"frames": "attack3_SW_5", "tipo": "a", "fix": "espejo de attack3_SE_5 (RECOVERY mostraba la mochila)"})
    # attack3 IMPACT: S, SE y SW se quedan (de frente o casi). En N, NE, E, W y NW: pose de FOLLOW THROUGH
    # de la misma fila (dirección correcta, cuchilla abajo) + el estallido de fuego del IMPACT de la fila S
    fire = fire_layer(out[frame_name("attack3", "S", 3)])
    for d in ("N", "NE", "E", "W", "NW"):
        base = out[frame_name("attack3", d, 4)]
        comp = over(fire, base)                  # el fuego por detrás del cuerpo
        front = fire.copy()
        yy = np.arange(CANVAS[1])[:, None]
        front[..., 3] = np.where(yy > PIVOT[1] - 4, front[..., 3], 0)
        out[frame_name("attack3", d, 3)] = over(comp, front)
    fixes.append({"frames": "attack3_{N,NE,E,W,NW}_3", "tipo": "a provisional / b",
                  "fix": "IMPACT de frente -> pose FOLLOW THROUGH de la misma fila + estallido de fuego del IMPACT S "
                         "(el golpe con la cuchilla clavada se pierde: regenerar esas 5 filas). S, SE y SW se "
                         "conservan (de frente o casi)"})
    for n, img in out.items():
        Image.fromarray(img).save(os.path.join(CFIX, n + ".png"))
    json.dump({"canvas": CANVAS, "pivot": PIVOT, "scale": report, "pivots": piv, "fixes": fixes,
               "Rt": Rt}, open(os.path.join(CBUILD, "fixed_meta.json"), "w"), indent=1)
    for an, r in report.items():
        print(an, "casco", r["casco"], "baldosa", r["baldosa"], "final~", round(float(np.median(list(r["rows"].values()))), 4))


if __name__ == "__main__":
    main()
