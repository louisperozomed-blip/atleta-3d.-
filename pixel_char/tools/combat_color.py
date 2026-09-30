"""COMBATE · Etapa 1 · Igualado de color por zonas.

parry, block, dodge, hit y death (y la variante deathalt) salieron más rojos,
saturados y brillantes que walk/idle y que las hojas de ataque, con la cuchilla
roja. Se corrigen por familias de material en Lab con mapeo por cuantiles (el
orden de luces y sombras de cada zona se conserva: solo se desplaza/estira su
rango), agrupando todos los frames de la animación (misma corrección para
todos: sin parpadeo):
  caliente = cuchilla, estela y chispas (croma alto y claros): L, tono y croma
             -> los de la cuchilla de attack1-3 (naranja cálido, borde brillante)
  cálido   = crema, dorado y bordado: L, tono y croma -> walk/idle + ataques
  verde    = tela verde azulada: L, a, b -> walk/idle + ataques
  negro    = casco, juntas, contorno: L -> walk/idle + ataques
Además el reborde rojo encendido que rodea la silueta en esas hojas (en walk
el contorno es oscuro) se apaga hacia el contorno cálido oscuro.

Entrada: build/combat/raw  ->  salida: build/combat/color (mismos nombres)
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from combat_common import CBUILD, CRAW
from common import BUILD

COLOR = os.path.join(CBUILD, "color")
os.makedirs(COLOR, exist_ok=True)
RECOLOR = ["parry", "block", "dodge", "hit", "death", "deathalt"]
KEEP = ["attack1", "attack2", "attack3"]
Q = np.linspace(1, 99, 25)


def sig(x):
    return 1 / (1 + np.exp(-x))


def lab_of(rgb):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    return L, A, B


def families(L, A, B):
    C = np.hypot(A, B)
    H = np.degrees(np.arctan2(B, A))
    hot = sig((C - 45) / 4) * sig((L - 110) / 8)
    warmish = sig((C - 12) / 3) * sig((H + 5) / 4) * sig((110 - H) / 4)
    warm = warmish * (1 - hot)
    green = sig((-A - 5) / 2) * sig((C - 6) / 2) * (1 - warmish)
    black = np.clip(1 - hot - warm - green, 0, 1)
    return {"hot": hot, "warm": warm, "green": green, "black": black}, C, H


LB = np.array([0, 50, 90, 130, 170, 210, 256], float)
LC = (LB[:-1] + LB[1:]) / 2


def collect(files):
    """Por familia: cuantiles de L y, por tramo de L, tono (media circular), croma y a/b medianos."""
    acc = {k: {"L": [], "C": [], "H": [], "A": [], "B": []} for k in ("hot", "warm", "green", "black")}
    for f in files:
        a = np.asarray(Image.open(f))
        m = a[..., 3] > 250
        L, A, B = lab_of(a[..., :3])
        fam, C, H = families(L, A, B)
        for k, w in fam.items():
            s = m & (w > 0.7)
            for key, v in (("L", L), ("C", C), ("H", H), ("A", A), ("B", B)):
                acc[k][key].append(v[s])
    out = {}
    for k, d in acc.items():
        L = np.concatenate(d["L"])
        if len(L) < 50:
            out[k] = None
            continue
        C, H, A, B = (np.concatenate(d[x]) for x in ("C", "H", "A", "B"))
        bins = []
        for lo, hi in zip(LB[:-1], LB[1:]):
            m = (L >= lo) & (L < hi)
            if m.sum() < 40:
                bins.append(None)
                continue
            h = np.radians(H[m])
            bins.append({"H": float(np.degrees(np.arctan2(np.sin(h).mean(), np.cos(h).mean()))),
                         "C": float(np.median(C[m])), "A": float(np.median(A[m])), "B": float(np.median(B[m]))})
        out[k] = {"Lq": np.percentile(L, Q), "bins": bins, "n": len(L)}
    return out


def curve(s, t, key):
    xs, ys = [], []
    for c, bs, bt in zip(LC, s["bins"], t["bins"]):
        if bs and bt:
            d = bt[key] - bs[key]
            if key == "H":
                d = (d + 180) % 360 - 180
            xs.append(c); ys.append(d if key != "C" else bt["C"] / max(bs["C"], 1))
    return (np.array(xs), np.array(ys)) if xs else None


def qmap(x, src, dst):
    xs = np.maximum.accumulate(src + np.arange(len(src)) * 1e-3)
    return np.interp(x, xs, dst)


def hot_w(L, C, H, hmax):
    """Peso de la familia "rojo/naranja intenso": cuchilla, estela, chispas y bordado encendido."""
    return sig((C - 40) / 5) * sig((hmax - H) / 5) * sig((H + 25) / 5) * sig((L - 50) / 8)


def hot_stats(files, hmax):
    Ls, Cs, Hs = [], [], []
    for f in files:
        a = np.asarray(Image.open(f))
        L, A, B = lab_of(a[..., :3])
        C = np.hypot(A, B); H = np.degrees(np.arctan2(B, A))
        s = (a[..., 3] > 250) & (hot_w(L, C, H, hmax) > 0.6)
        Ls.append(L[s]); Cs.append(C[s]); Hs.append(H[s])
    L, C, H = map(np.concatenate, (Ls, Cs, Hs))
    return {"L": np.percentile(L, Q), "C": np.percentile(C, Q), "H": np.percentile(H, Q), "n": len(L)}


def recolor(rgba, st, tg):
    """1) familia rojo intenso -> cuantiles (L, croma, tono) de la de attack1-3 (cuchilla naranja cálida,
          borde brillante);
       2) rojos restantes (reflejos del visor, sombras rojizas) -> tono naranja de referencia por tramo de L,
          con menos croma en los oscuros;
       3) crema clara: tono -7° y croma -10 % (como walk/ataques); núcleo rosado de la cuchilla -> blanco cálido;
       4) reborde rojo encendido del contorno del cuerpo -> contorno cálido oscuro (como walk).
    Crema, verde y negro no se tocan: conservan el sombreado pintado."""
    rgb, al = rgba[..., :3], rgba[..., 3]
    L, A, B = lab_of(rgb)
    C = np.hypot(A, B)
    H = np.degrees(np.arctan2(B, A))
    wh = hot_w(L, C, H, 50)
    L1 = qmap(L, st["L"], tg["L"]); C1 = qmap(C, st["C"], tg["C"]); H1 = qmap(H, st["H"], tg["H"])
    Ht = np.interp(L, [60, 160, 220], [48, 57, 66])
    wr = sig((C - 18) / 4) * sig((Ht - 3 - H) / 4) * sig((H + 40) / 6) * (1 - wh)
    H2 = H + wr * (Ht - H)
    C2 = C * (1 - np.where(L < 90, 0.35, 0.12) * wr)
    L2 = L.copy()
    L2 = L2 * (1 - wh) + L1 * wh; C2 = C2 * (1 - wh) + C1 * wh; H2 = H2 * (1 - wh) + H1 * wh
    # crema clara: algo más amarilla y saturada que la de walk/ataques (tono ~88° frente a ~80°)
    wc = sig((L - 150) / 10) * sig((H - 62) / 4) * sig((112 - H) / 4) * sig((60 - C) / 5) * (1 - wh)
    H2 = H2 - 7 * wc
    C2 = C2 * (1 - 0.1 * wc)
    wp = sig((L - 185) / 6) * sig((42 - H) / 5) * sig((C - 6) / 2) * sig((50 - C) / 5)
    H2 = H2 * (1 - wp) + 72 * wp
    C2 = C2 * (1 - wp) + np.maximum(C2, 22) * wp
    inside = al > 127
    body = ndi.binary_opening(inside, np.ones((25, 25)))
    ring = body & ~ndi.binary_erosion(body, iterations=3) & inside
    red = sig((C - 30) / 5) * sig((48 - H) / 5)
    w = ndi.gaussian_filter((ring * red).astype(np.float32), 0.7)
    L2 = L2 * (1 - 0.45 * w)
    C2 = C2 * (1 - 0.35 * w)
    A2, B2 = C2 * np.cos(np.radians(H2)), C2 * np.sin(np.radians(H2))
    lab = np.dstack([np.clip(L2, 0, 255), np.clip(A2 + 128, 0, 255), np.clip(B2 + 128, 0, 255)])
    out = cv2.cvtColor(lab.round().astype(np.uint8), cv2.COLOR_LAB2RGB)
    res = np.dstack([out, al])
    res[al == 0] = 0
    return res


def main():
    att_files = [os.path.join(CRAW, f) for f in os.listdir(CRAW) if f.startswith(tuple(KEEP))]
    tg = hot_stats(att_files, 70)
    report = {"objetivo_cuchilla": {k: [round(float(tg[k][i]), 1) for i in (2, 12, 22)] for k in ("L", "C", "H")}}
    for f in sorted(os.listdir(CRAW)):
        if not f.startswith(tuple(RECOLOR)):
            Image.fromarray(np.asarray(Image.open(os.path.join(CRAW, f)))).save(os.path.join(COLOR, f))
    for an in RECOLOR:
        files = sorted(x for x in os.listdir(CRAW) if x.startswith(an + "_"))
        st = hot_stats([os.path.join(CRAW, x) for x in files], 50)
        report[an] = {k: [round(float(st[k][i]), 1) for i in (2, 12, 22)] for k in ("L", "C", "H")}
        for x in files:
            a = np.asarray(Image.open(os.path.join(CRAW, x)))
            Image.fromarray(recolor(a, st, tg)).save(os.path.join(COLOR, x))
    json.dump(report, open(os.path.join(CBUILD, "color_report.json"), "w"), indent=1)
    for k, v in report.items():
        print(k, v)


if __name__ == "__main__":
    main()
