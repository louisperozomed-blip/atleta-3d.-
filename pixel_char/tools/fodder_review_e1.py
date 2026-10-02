"""RELLENO · lámina de la etapa 1 (review/fodder): color antes/después, 8 direcciones con las correcciones
marcadas ((a) naranja = arreglado con código, (b) rojo = provisional, regenerar) y el frame IMPACT de attack."""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

from common import ROOT
from fodder_extract import FBUILD, FRAW
from fodder_normalize import ANIMS, DIRS, FFIX

REV = os.path.join(ROOT, "review", "fodder")
os.makedirs(REV, exist_ok=True)
BG = (62, 66, 62)


def tight(im, box):
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 20)
    if len(xs):
        im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    im.thumbnail(box)
    return im


def paste_bottom(cs, im, x, y, w, h):
    cs.paste(im, (x + (w - im.width) // 2, y + h - im.height), im)


def main():
    fm = json.load(open(os.path.join(FBUILD, "fixed_meta.json")))
    fixed = {}
    for f in fm["fixes"]:
        kind, an, d = f["frames"].split("_")[:3]
        fixed[(kind, an, d)] = f["tipo"][0]
    # 1) direcciones (frame representativo) con correcciones marcadas
    FR = {"idle": 0, "walk": 0, "attack": 3, "hit": 2, "death": 3}
    cw, ch = 150, 140
    for kind in ("zombie", "dog"):
        cs = Image.new("RGB", (80 + cw * 8, 30 + ch * len(ANIMS)), BG); d = ImageDraw.Draw(cs)
        for j, dd in enumerate(DIRS):
            d.text((80 + j * cw + cw // 2 - 6, 8), dd, fill=(255, 240, 160))
        for r, an in enumerate(ANIMS):
            d.text((6, 30 + r * ch + ch // 2), f"{an}\nframe {FR[an] + 1}", fill=(255, 240, 160))
            for j, dd in enumerate(DIRS):
                im = tight(Image.open(os.path.join(FFIX, f"{kind}_{an}_{dd}_{FR[an]}.png")), (cw - 8, ch - 8))
                x, y = 80 + j * cw, 30 + r * ch
                paste_bottom(cs, im, x, y, cw, ch - 4)
                t = fixed.get((kind, an, dd))
                if t:
                    col = (255, 150, 40) if t == "a" else (255, 60, 60)
                    d.rectangle((x + 2, y + 2, x + cw - 3, y + ch - 3), outline=col, width=3)
                    d.text((x + 6, y + 6), "(" + t + ")", fill=col)
        cs.save(os.path.join(REV, f"E1_direcciones_{kind}.png"))
    # 2) color antes / después (fila S, frame 1) de las 5 hojas de cada criatura
    cs = Image.new("RGB", (40 + cw * 10, 40 + ch * 2), BG); d = ImageDraw.Draw(cs)
    for k_, kind in enumerate(("zombie", "dog")):
        for j, an in enumerate(ANIMS):
            for b, src in enumerate((FRAW, os.path.join(FBUILD, "color"))):
                p = os.path.join(src, f"{kind}_{an}_SW_0.png")
                im = tight(Image.open(p), (cw - 8, ch - 8))
                x, y = 40 + (j * 2 + b) * cw, 40 + k_ * ch
                paste_bottom(cs, im, x, y, cw, ch - 4)
                d.text((x + 4, y + 2), f"{an} {'antes' if b == 0 else 'después'}", fill=(255, 240, 160))
    cs.save(os.path.join(REV, "E1_color_antes_despues.png"))
    # 3) frame IMPACT de attack en las 8 direcciones
    cs = Image.new("RGB", (80 + cw * 8, 30 + ch * 2), BG); d = ImageDraw.Draw(cs)
    for r, kind in enumerate(("zombie", "dog")):
        d.text((6, 30 + r * ch + ch // 2), kind + "\nIMPACT", fill=(255, 240, 160))
        for j, dd in enumerate(DIRS):
            im = tight(Image.open(os.path.join(FFIX, f"{kind}_attack_{dd}_3.png")), (cw - 8, ch - 8))
            paste_bottom(cs, im, 80 + j * cw, 30 + r * ch, cw, ch - 4)
            if r == 0: d.text((80 + j * cw + cw // 2 - 6, 8), dd, fill=(255, 240, 160))
    cs.save(os.path.join(REV, "E1_impacto.png"))
    print("lámina en", REV)


if __name__ == "__main__":
    main()
