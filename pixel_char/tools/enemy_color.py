"""ENEMIGO · Etapa 1b · Igualado de color por zonas con idle, walk y run (la referencia).

Medido (mediana, filas S/N/E/W):          L    croma  musgo%  tono musgo
  idle / walk / run (referencia)          70   19-24  24-32   86-94°
  attack1 / attack2 / parry               65-72 27-28 13-21   82-84°  -> más naranjas y saturados
  hit_2 / block / dodge / death           54-69 12-20 24-34   91-96°  -> más pálidos, grises (death, oscuro)
El musgo "falta" en attack/parry porque su verde se ha ido hacia el amarillo-naranja y cae en el rango
del metal: devolviendo el tono a su sitio, el musgo vuelve.

Método (por HOJA de origen, la misma corrección para sus 24 frames: sin parpadeo), en Lab:
  1. tono: mapeo por cuantiles de la distribución de tono de los píxeles con color (croma > 8) al de la
     referencia -> el reparto metal/musgo vuelve a ser el de idle/walk
  2. croma: mapeo por cuantiles por familia (metal oxidado 25-75°, musgo > 75°) tras el paso 1
  3. luminosidad: mapeo por cuantiles global al 75 % (conserva el orden de luces y sombras)
  El ojo cian y su brillo (tono < -90° o > 150°, croma alto) no se tocan.
Entrada build/enemy/raw -> salida build/enemy/color. Informe: build/enemy/color_report.json
"""
import json
import os

import cv2
import numpy as np
from PIL import Image

from enemy_extract import EBUILD, ERAW, EREF

ECOLOR = os.path.join(EBUILD, "color")
os.makedirs(ECOLOR, exist_ok=True)
REF_ANIMS = ("idle", "walk", "run")
Q = np.linspace(1, 99, 33)
D8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def sig(x):
    return 1 / (1 + np.exp(-x))


def lab(rgb):
    l = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    A, B = l[..., 1] - 128, l[..., 2] - 128
    return l[..., 0], np.hypot(A, B), np.degrees(np.arctan2(B, A))


def is_eye(C, H):
    return (C > 18) & ((H < -90) | (H > 150))


def collect(names):
    Ls, Hs, Cm, Cs = [], [], [], []
    for n in names:
        a = np.asarray(Image.open(os.path.join(ERAW, n + ".png")))
        m = a[..., 3] > 250
        L, C, H = lab(a[..., :3])
        e = is_eye(C, H)
        Ls.append(L[m & ~e])
        c = m & ~e & (C > 8) & (H > 0) & (H < 150)
        Hs.append(H[c]); Cm.append(C[c & (H <= 75)]); Cs.append(C[c & (H > 75)])
    L, H, CM, CS = (np.concatenate(x) for x in (Ls, Hs, Cm, Cs))
    return {"L": np.percentile(L, Q), "H": np.percentile(H, Q), "Cmetal": np.percentile(CM, Q), "Cmoss": np.percentile(CS, Q),
            "moss_frac": float(len(CS) / max(1, len(CS) + len(CM))), "L50": float(np.median(L)), "C50": float(np.median(np.concatenate([CM, CS])))}


def qmap(x, s, t):
    xs = np.maximum.accumulate(s + np.arange(len(s)) * 1e-3)
    return np.interp(x, xs, t)


def recolor(rgba, st, tg, kL=0.75):
    rgb, al = rgba[..., :3], rgba[..., 3]
    L, C, H = lab(rgb)
    e = is_eye(C, H)
    w = sig((C - 6) / 1.5) * sig(H / 4) * sig((150 - H) / 4) * (1 - e)
    H2 = H * (1 - w) + qmap(H, st["H"], tg["H"]) * w
    Cm = qmap(C, st["Cmetal"], tg["Cmetal"]); Cs = qmap(C, st["Cmoss"], tg["Cmoss"])
    fm = sig((H2 - 75) / 4)
    C2 = C * (1 - w) + (Cm * (1 - fm) + Cs * fm) * w
    L2 = L + kL * (qmap(L, st["L"], tg["L"]) - L) * (1 - e)
    A2, B2 = C2 * np.cos(np.radians(H2)), C2 * np.sin(np.radians(H2))
    out = cv2.cvtColor(np.dstack([np.clip(L2, 0, 255), np.clip(A2 + 128, 0, 255), np.clip(B2 + 128, 0, 255)]).round().astype(np.uint8), cv2.COLOR_LAB2RGB)
    res = np.dstack([out, al]); res[al == 0] = 0
    return res


def main():
    labels = json.load(open(os.path.join(EREF, "labels.json")))
    frames = {sh: [f"{v['anim']}_{d}_{i}" for d in v["rows"] for i in range(6)] for sh, v in labels["sheets"].items()}
    tg = collect([n for sh, v in labels["sheets"].items() if v["anim"] in REF_ANIMS for n in frames[sh]])
    report = {"referencia": {k: round(tg[k], 3) for k in ("moss_frac", "L50", "C50")}}
    for sh, v in labels["sheets"].items():
        names = frames[sh]
        if v["anim"] in REF_ANIMS:
            for n in names:
                Image.open(os.path.join(ERAW, n + ".png")).save(os.path.join(ECOLOR, n + ".png"))
            continue
        st = collect(names)
        for n in names:
            a = np.asarray(Image.open(os.path.join(ERAW, n + ".png")))
            Image.fromarray(recolor(a, st, tg)).save(os.path.join(ECOLOR, n + ".png"))
        after = collect([n for n in names]) if False else None
        report[sh] = {"antes": {k: round(st[k], 3) for k in ("moss_frac", "L50", "C50")}}
    # medida después
    global ERAW_
    for sh, v in labels["sheets"].items():
        if v["anim"] in REF_ANIMS:
            continue
        Ls, Cs, Hs = [], [], []
        for n in frames[sh]:
            a = np.asarray(Image.open(os.path.join(ECOLOR, n + ".png"))); m = a[..., 3] > 250
            L, C, H = lab(a[..., :3]); e = is_eye(C, H)
            Ls.append(L[m & ~e]); c = m & ~e & (C > 8) & (H > 0) & (H < 150); Cs.append(C[c]); Hs.append(H[c])
        L, C, H = (np.concatenate(x) for x in (Ls, Cs, Hs))
        report[sh]["despues"] = {"moss_frac": round(float((H > 75).mean()), 3), "L50": round(float(np.median(L)), 1), "C50": round(float(np.median(C)), 1)}
    json.dump(report, open(os.path.join(EBUILD, "color_report.json"), "w"), indent=1)
    for k, v in report.items():
        print(k, v)


if __name__ == "__main__":
    main()
