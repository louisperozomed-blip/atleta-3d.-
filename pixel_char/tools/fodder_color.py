"""RELLENO · Etapa 1b · igualado de color por zonas (Lab) hacia la hoja de ATAQUE de cada criatura.

Medido en las hojas (píxeles de figura con color, Lab de OpenCV):    L     croma
  zombi  idle (gris verdoso, musgo apagado)                       58-61  19-25
         walk                                                     63     26-28
         attack / hit / death (hueso cálido, setas rojas)         65-66  37-45
  perro  idle (gris oliva)                                        58     20
         walk (tostado)                                           60     24-26
         attack / hit                                             64     30-37
         death (rojo saturado)                                    66     40-45
Referencia = attack (_1 y _2): es lo que el jugador mira mientras aprende el parry (preparación y golpe), y
las hojas de golpe y muerte ya están cerca. Idle y walk suben de croma y se calientan; death del perro baja.
Método (el de enemy_color: misma corrección para los 24 frames de una hoja, sin parpadeo):
  1. tono: mapeo por cuantiles de los píxeles con color
  2. croma: por cuantiles en dos familias (hueso y setas < 75°; musgo > 75°)
  3. luminosidad: por cuantiles al 75 %
Entrada build/fodder/raw -> build/fodder/color; informe build/fodder/color_report.json
"""
import json
import os

import numpy as np
from PIL import Image

from enemy_color import Q, lab, qmap, recolor
from fodder_extract import FBUILD, FRAW, ROWS, sheets

FCOLOR = os.path.join(FBUILD, "color")
os.makedirs(FCOLOR, exist_ok=True)


def frames_of(kind, anim, half):
    return [f"{kind}_{anim}_{d}_{i}" for d in ROWS[half] for i in range(6)]


def collect(names, src=FRAW):
    Ls, Hs, Cm, Cs = [], [], [], []
    for n in names:
        a = np.asarray(Image.open(os.path.join(src, n + ".png")))
        m = a[..., 3] > 250
        L, C, H = lab(a[..., :3])
        Ls.append(L[m])
        c = m & (C > 8) & (H > 0) & (H < 150)
        Hs.append(H[c]); Cm.append(C[c & (H <= 75)]); Cs.append(C[c & (H > 75)])
    L, H, CM, CS = (np.concatenate(x) for x in (Ls, Hs, Cm, Cs))
    if len(CS) < 50: CS = CM
    if len(CM) < 50: CM = CS
    return {"L": np.percentile(L, Q), "H": np.percentile(H, Q), "Cmetal": np.percentile(CM, Q), "Cmoss": np.percentile(CS, Q),
            "moss_frac": float(len(CS) / max(1, len(CS) + len(CM))), "L50": float(np.median(L)), "C50": float(np.median(np.concatenate([CM, CS])))}


def main():
    report = {}
    for kind in ("zombie", "dog"):
        tg = collect(frames_of(kind, "attack", "1") + frames_of(kind, "attack", "2"))
        report[kind + "_referencia"] = {k: round(tg[k], 3) for k in ("moss_frac", "L50", "C50")}
        for n, k, anim, half, _ in sheets():
            if k != kind:
                continue
            names = frames_of(kind, anim, half)
            st = collect(names)
            for nm in names:
                a = np.asarray(Image.open(os.path.join(FRAW, nm + ".png")))
                out = a if anim == "attack" else recolor(a, st, tg)
                Image.fromarray(out).save(os.path.join(FCOLOR, nm + ".png"))
            after = collect(names, FCOLOR)
            report[n] = {"antes": {x: round(st[x], 3) for x in ("moss_frac", "L50", "C50")},
                         "despues": {x: round(after[x], 3) for x in ("moss_frac", "L50", "C50")}}
    json.dump(report, open(os.path.join(FBUILD, "color_report.json"), "w"), indent=1)
    for k, v in report.items():
        print(k, v)


if __name__ == "__main__":
    main()
