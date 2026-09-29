"""ETAPA 1c · Igualado de color entre frames sin perder el sombreado pintado.

Cada píxel pertenece (de forma suave) a tres familias de material:
  cálido  = crema / dorado / naranja (piezas metálicas y bordados)
  verde   = tela verde azulada
  negro   = casco, tela negra, juntas
Para cada frame y familia se mide:
  - la distribución de L (percentiles 5..95)
  - la mediana de (a, b) por tramos de L
agrupando los 6 frames de cada fila (misma corrección para toda la fila,
así no se introduce parpadeo) y se compara con la mediana global de todos los frames. La corrección es:
  - L: curva monótona por percentiles (conserva el orden de luces y sombras,
    solo desplaza/estira el rango) aplicada al 80 % (40 % en cálidos, cuya L media depende
    de cuánto bordado naranja enseña cada pose)
  - a, b: desplazamiento por tramo de L, interpolado, aplicado al 100 %
ponderadas por la pertenencia suave del píxel a la familia.
"""
import json
import os

import cv2
import numpy as np
from PIL import Image

from common import ANIMS, BUILD, DIRS, NFRAMES, ROOT, frame_name

NORM = os.path.join(BUILD, "norm")
FINAL = os.path.join(ROOT, "frames")
os.makedirs(FINAL, exist_ok=True)

QS = np.array([5, 15, 30, 50, 70, 85, 95])
LBINS = np.array([0, 40, 80, 120, 160, 200, 256])
LSTRENGTH = {"warm": 0.4, "green": 0.8, "black": 0.8}


def sig(x):
    return 1 / (1 + np.exp(-x))


def memberships(lab):
    L, A, B = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    ch = np.hypot(A, B)
    warm = sig((ch - 12) / 3) * sig((A - 3) / 2) * sig((B - 8) / 3)
    green = sig((-A - 5) / 2) * sig((ch - 6) / 2)
    black = sig((10 - ch) / 3) * sig((70 - L) / 8) * (1 - warm) * (1 - green)
    return {"warm": warm, "green": green, "black": black}


def stats(labs, alphas, mems):
    """Estadísticas agrupando varios frames (una fila = una animación y dirección)."""
    out = {}
    for k in ("warm", "green", "black"):
        sel = [(al > 250) & (m[k] > 0.7) for al, m in zip(alphas, mems)]
        if sum(x.sum() for x in sel) < 50:
            out[k] = None
            continue
        L = np.concatenate([lab[..., 0][s] for lab, s in zip(labs, sel)])
        A = np.concatenate([lab[..., 1][s] for lab, s in zip(labs, sel)])
        B = np.concatenate([lab[..., 2][s] for lab, s in zip(labs, sel)])
        ab = []
        for lo, hi in zip(LBINS[:-1], LBINS[1:]):
            m = (L >= lo) & (L < hi)
            ab.append([np.median(A[m]), np.median(B[m]), m.sum()] if m.sum() > 30 else [np.nan, np.nan, 0])
        out[k] = {"Lq": np.percentile(L, QS).tolist(), "ab": ab}
    return out


def main():
    imgs, labs, mems, st = {}, {}, {}, {}
    names = [frame_name(an, d, i) for an in ANIMS for d in DIRS for i in range(NFRAMES)]
    for n in names:
        a = np.asarray(Image.open(os.path.join(NORM, n + ".png")))
        imgs[n] = a
        lab = cv2.cvtColor(a[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)
        labs[n] = lab
        mems[n] = memberships(lab)
    rows = {}
    for an in ANIMS:
        for d in DIRS:
            rn = [frame_name(an, d, i) for i in range(NFRAMES)]
            rs = stats([labs[n] for n in rn], [imgs[n][..., 3] for n in rn], [mems[n] for n in rn])
            for n in rn:
                st[n] = rs
    # objetivo global = mediana de las estadísticas por frame
    target = {}
    for k in ("warm", "green", "black"):
        Lq = np.median([st[n][k]["Lq"] for n in names if st[n][k]], axis=0)
        ab = np.array([[row[:2] for row in st[n][k]["ab"]] for n in names if st[n][k]], float)
        target[k] = {"Lq": Lq, "ab": np.nanmedian(ab, axis=0)}
    report = {}
    centers = (LBINS[:-1] + LBINS[1:]) / 2
    for n in names:
        lab = labs[n].copy()
        L0 = lab[..., 0].copy()
        dL = np.zeros_like(L0)
        dA = np.zeros_like(L0)
        dB = np.zeros_like(L0)
        wsum = np.zeros_like(L0)
        rep = {}
        for k, w in mems[n].items():
            s = st[n][k]
            if s is None:
                continue
            t = target[k]
            # curva monótona de L por percentiles, extendida linealmente a 0 y 255
            xs = np.concatenate([[0], s["Lq"], [255]])
            ys = np.concatenate([[0], t["Lq"], [255]])
            xs = np.maximum.accumulate(xs + np.arange(len(xs)) * 1e-3)
            Lmap = np.interp(L0, xs, ys)
            dL += w * LSTRENGTH[k] * (Lmap - L0)
            # desplazamiento de a,b por tramo de L
            fa = np.array([r[0] for r in s["ab"]], float)
            fb = np.array([r[1] for r in s["ab"]], float)
            oa, ob = t["ab"][:, 0] - fa, t["ab"][:, 1] - fb
            ok = np.isfinite(oa) & np.isfinite(ob)
            if ok.sum() >= 1:
                oa_i = np.interp(L0, centers[ok], oa[ok])
                ob_i = np.interp(L0, centers[ok], ob[ok])
                # corrección limitada para no cambiar el diseño
                dA += w * np.clip(oa_i, -8, 8)
                dB += w * np.clip(ob_i, -10, 10)
            wsum += w
            rep[k] = {"dL50": round(float(t["Lq"][3] - s["Lq"][3]), 1),
                      "dab": [round(float(np.nanmean(oa)), 1), round(float(np.nanmean(ob)), 1)]}
        lab[..., 0] = np.clip(L0 + dL, 0, 255)
        lab[..., 1] = np.clip(lab[..., 1] + dA, 0, 255)
        lab[..., 2] = np.clip(lab[..., 2] + dB, 0, 255)
        rgb = cv2.cvtColor(lab.round().astype(np.uint8), cv2.COLOR_LAB2RGB)
        out = np.dstack([rgb, imgs[n][..., 3]])
        out[out[..., 3] == 0] = 0
        Image.fromarray(out).save(os.path.join(FINAL, n + ".png"))
        report[n] = rep
    json.dump(report, open(os.path.join(BUILD, "colormatch_report.json"), "w"), indent=0)
    # resumen: mayor corrección aplicada por familia
    for k in ("warm", "green", "black"):
        dl = [abs(report[n][k]["dL50"]) for n in names if k in report[n]]
        print(k, "|dL50| medio %.1f máx %.1f" % (np.mean(dl), np.max(dl)))


if __name__ == "__main__":
    main()
