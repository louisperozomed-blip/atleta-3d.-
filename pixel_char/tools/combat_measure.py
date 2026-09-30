"""Medidas de congruencia: tamaño/proporciones frente a idle/walk/run (en unidades de baldosa)."""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from combat_common import CBUILD, CRAW
from common import BUILD, DIRS, NFRAMES

RAW = os.path.join(BUILD, "raw")


def body_mask(rgba):
    a = rgba[..., 3] > 127
    c = rgba[..., :3].astype(np.float32)
    R, G, B = c[..., 0], c[..., 1], c[..., 2]
    # cuchilla, estela y chispas: muy saturados rojo/naranja brillante
    # cuchilla/estela/chispas: estructuras finas muy saturadas; se quitan con una apertura
    # (el cuerpo es grueso y sobrevive; la cuchilla, fina, no)
    hot = (R > 190) & (R - B > 110)
    thin = hot & ~ndi.binary_opening(a, np.ones((9, 9)))
    m = ndi.binary_opening(a & ~thin, np.ones((5, 5)))
    lab, n = ndi.label(m)
    if n > 1:
        sz = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (np.argmax(sz) + 1)
    return a, m


def measure(path, tile):
    rgba = np.asarray(Image.open(path)).astype(np.float32)
    a, m = body_mask(rgba)
    ys, xs = np.nonzero(m)
    top, bot = ys.min(), ys.max()
    dt = ndi.distance_transform_edt(m)
    z = dt.copy(); z[top + 55:] = 0
    Rh = float(z.max())
    # anchura del cuerpo a media altura (torso), sin cuchilla
    band = m[top + int((bot - top) * 0.35): top + int((bot - top) * 0.6)]
    wid = np.percentile(band.sum(1), 90)
    hw = tile["hw"] if tile else 92.0
    return {"R": Rh / hw, "H": (bot - top) / hw, "W": wid / hw, "bot_rel": (bot - tile["cy"]) / hw if tile else None,
            "hw": hw}


def main():
    old = json.load(open(os.path.join(BUILD, "raw_meta.json")))
    new = json.load(open(os.path.join(CBUILD, "raw_meta.json")))
    res = {}
    for n, m in list(old.items()) + list(new.items()):
        p = os.path.join(RAW if n in old else CRAW, n + ".png")
        res[n] = measure(p, m["tile"])
    json.dump(res, open(os.path.join(CBUILD, "measures.json"), "w"), indent=0)
    return res


if __name__ == "__main__":
    r = main()
    anims = ["idle", "walk", "run", "attack1", "attack2", "attack3", "parry", "block", "dodge", "hit", "death", "deathalt"]
    print("hw (semieje baldosa px) por animación:",
          {a: round(np.median([v["hw"] for k, v in r.items() if k.startswith(a + "_")]), 1) for a in anims})
    for key in ("R", "H", "W"):
        print(f"\n{key} (frame 0 y 5; relativo a la mediana idle+walk de la misma dirección)")
        print("dir  " + " ".join(f"{a[:7]:>8s}" for a in anims))
        for d in DIRS:
            ref = np.median([r[f"{a}_{d}_{i}"][key] for a in ("idle", "walk") for i in range(NFRAMES)])
            row = []
            for a in anims:
                vals = [r[f"{a}_{d}_{i}"][key] for i in (0, 5) if f"{a}_{d}_{i}" in r]
                row.append(f"{np.median(vals) / ref:8.2f}" if vals else "       -")
            print(f"{d:4s} " + " ".join(row))
