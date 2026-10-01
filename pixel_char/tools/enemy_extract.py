"""ENEMIGO · Etapa 1a · Recorte y fondo transparente de las hojas del Autómata del bosque.

Fondo: color uniforme de la hoja (mediana del borde). Baldosa y su sombra: grises neutros y lisos
(croma <= 10 y desviación local baja), más claros que el fondo. Figura: el resto, conectado al núcleo
de la celda (componente texturada más grande con el centro dentro de la celda). Si una garra o la
figura vecina entra en la celda, cada píxel se queda con el núcleo (propio o vecino) más cercano.
Borde: extract.matte (alfa suave, color del interior en el anillo: sin halo del fondo).
Baldosa: se ajusta el rombo (extract.fit_tile) -> suelo de referencia y escala de dibujo.

Salida: build/enemy/raw/<anim>_<dir>_<i>.png y build/enemy/raw_meta.json
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

import extract as X
from common import BUILD, ROOT

EREF = os.path.join(ROOT, "ref", "sheets_enemigo")
EBUILD = os.path.join(BUILD, "enemy")
ERAW = os.path.join(EBUILD, "raw")
os.makedirs(ERAW, exist_ok=True)
MARGIN = 70


def local_std(g, r=3):
    m = ndi.uniform_filter(g, 2 * r + 1)
    return np.sqrt(np.maximum(ndi.uniform_filter(g * g, 2 * r + 1) - m * m, 0))


def classify(a, text):
    H, W = a.shape[:2]
    border = np.concatenate([a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3), a[-6:].reshape(-1, 3)])
    bg = np.median(border, 0)
    lum = a.mean(2); ch = a.max(2) - a.min(2)
    ls = local_std(lum, 2)
    near_bg = np.linalg.norm(a - bg, axis=2) < 13
    neutral = (ch <= 10) & (lum >= bg.mean() - 6) & (lum < 110) & (ls < 4.5)
    # color de la baldosa: moda de los neutros lisos más claros que el fondo
    cand = lum[neutral & (lum > bg.mean() + 6)]
    tile_l = float(np.median(cand)) if len(cand) > 500 else bg.mean() + 20
    tile = neutral & (np.abs(lum - tile_l) < 14)
    shadowish = neutral & ~tile
    bglike = near_bg | tile | shadowish | text
    return bg, tile_l, bglike, tile, ls


def cores(a, ls, bglike):
    """Partes seguras de la figura: texturadas o con color, lejos del fondo."""
    ch = a.max(2) - a.min(2)
    seed = ~bglike & ((ls > 7) | (ch > 22))
    # solo lo grueso del cuerpo: estelas, garras y polvo (finos) no unen figuras vecinas
    seed = ndi.binary_closing(seed, np.ones((3, 3)))
    return ndi.binary_opening(seed, np.ones((9, 9)))


def extract_cell(a, bglike, tile, core_all, box, inner):
    x0, y0, x1, y1 = box
    crop = a[y0:y1, x0:x1]
    bgl = bglike[y0:y1, x0:x1]
    cm = core_all[y0:y1, x0:x1]
    n, lab, st, cen = cv2.connectedComponentsWithStats(cm.astype(np.uint8), connectivity=8)
    own = [i for i in range(1, n) if st[i, 4] > 600 and inner[0] <= cen[i][0] < inner[1] and inner[2] <= cen[i][1] < inner[3]]
    if not own:
        own = [int(np.argmax(st[1:, 4])) + 1]
    oth = [i for i in range(1, n) if st[i, 4] > 600 and i not in own]
    fg = ~bgl
    # quita motas y queda lo conectado al núcleo propio
    fg = ndi.binary_opening(fg, np.ones((2, 2)))
    ownm = np.isin(lab, own)
    if oth:
        othm = np.isin(lab, oth)
        fg &= ndi.distance_transform_edt(~ownm) <= ndi.distance_transform_edt(~othm)
    lb, nb = ndi.label(fg)
    keep = np.unique(lb[ownm & fg]); keep = keep[keep > 0]
    fg = np.isin(lb, keep)
    # piezas sueltas: queda la mayor y las que tienen el centro dentro de la celda (efectos, chispas)
    # (sobre una versión abierta: las líneas finas, como el borde de la baldosa de la fila de arriba, no unen piezas)
    fo = ndi.binary_opening(fg, np.ones((3, 3)))
    lb, nb = ndi.label(fo)
    if nb > 1:
        sz = ndi.sum(fo, lb, range(1, nb + 1)); cm = ndi.center_of_mass(fo, lb, range(1, nb + 1))
        big = int(np.argmax(sz))
        ok = [i + 1 for i in range(nb) if i == big or (sz[i] >= 60 and inner[0] <= cm[i][1] < inner[1] and inner[2] <= cm[i][0] < inner[3])]
        fg = fg & ndi.binary_dilation(np.isin(lb, ok), iterations=2)
    # bordes de la baldosa pegados a los pies: líneas finas grises y claras en la franja baja
    lum = crop.mean(2); chc = crop.max(2) - crop.min(2)
    ys_ = np.nonzero(fg)[0]
    if len(ys_):
        low = np.zeros_like(fg); low[ys_.min() + int((ys_.max() - ys_.min()) * 0.6):] = True
        thin = fg & ~ndi.binary_opening(fg, np.ones((4, 4)))
        edge = thin & low & (chc <= 18) & (lum > 50)
        edge = ndi.binary_dilation(edge, iterations=1) & fg & (chc <= 22) & low
        fg &= ~edge
        fg = ndi.binary_opening(fg, np.ones((2, 2)))
        lb2, n2 = ndi.label(fg)
        if n2 > 1:
            sz2 = ndi.sum(fg, lb2, range(1, n2 + 1)); fg = np.isin(lb2, np.nonzero(sz2 >= max(30, sz2.max() * 0.004))[0] + 1)
    # agujeros pequeños (placas lisas dentro de la figura) -> figura
    holes = ndi.binary_fill_holes(fg) & ~fg
    lh, nh = ndi.label(holes)
    if nh:
        sz = ndi.sum(holes, lh, range(1, nh + 1))
        fg |= np.isin(lh, np.nonzero(sz < 160)[0] + 1)
    col, alpha = X.matte(crop, fg)
    t = tile[y0:y1, x0:x1] & ~ndi.binary_dilation(fg, iterations=2)
    t[:, :inner[0]] = False; t[:, inner[1]:] = False; t[:inner[2]] = False; t[inner[3]:] = False
    tfit = X.fit_tile(t, ndi.binary_dilation(fg, iterations=2))
    return col, alpha, fg, tfit


def run(only=None):
    labels = json.load(open(os.path.join(EREF, "labels.json")))
    meta = {}
    fn = os.path.join(EBUILD, "raw_meta.json")
    if only and os.path.exists(fn):
        meta = json.load(open(fn))
    for sheet, sh in labels["sheets"].items():
        if only and sh["anim"] not in only:
            continue
        a = X.load(os.path.join(EREF, sheet + ".png"))
        H, W = a.shape[:2]
        g = sh["grid"]
        # texto: cabecera y rótulos de la izquierda
        text = np.zeros((H, W), bool)
        text[:max(0, g["rows"][0] - 2)] = True          # (grid_c: la 1.ª fila empieza en 0)
        xmin = g["cols"][0] - 4
        if g.get("layout") == "b":
            # hojas del Duelo 3 (enemy_grid.grid_b): el texto va dentro de las celdas (número arriba, fase debajo)
            # y las chispas del CLASH asoman a la izquierda de la primera columna: se quita solo el texto
            for x0_, y0_, x1_, y1_ in g["text_boxes"]:
                text[max(0, y0_):y1_, max(0, x0_):x1_] = True
            xmin = 0      # los rótulos ya están en text_boxes
        else:
            text[:, :g["cols"][0] - 4] = True
        bg, tile_l, bglike, tile, ls = classify(a, text)
        core_all = cores(a, ls, bglike)
        for r, d in enumerate(sh["rows"]):
            ry0, ry1 = g["rows"][r], g["rows"][r + 1]
            for i in range(6):
                xl, xr = g["cols"][i], g["cols"][i + 1]
                bx0, bx1 = max(xl - MARGIN, xmin), min(xr + MARGIN, W)
                by0, by1 = max(ry0 - 40, g["rows"][0]), min(ry1 + 20, H)
                col, alpha, fg, tfit = extract_cell(a, bglike, tile, core_all, (bx0, by0, bx1, by1), (xl - bx0, xr - bx0, ry0 - by0, ry1 - by0))
                name = f"{sh['anim']}_{d}_{i}"
                Image.fromarray(np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)).save(os.path.join(ERAW, name + ".png"))
                ys, xs = np.nonzero(alpha > 0.5)
                meta[name] = {"sheet": sheet, "box": [bx0, by0, bx1, by1],
                              "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                              "tile": None if tfit is None else {"iou": round(float(tfit[0]), 3), "cx": float(tfit[1]),
                                                                 "cy": float(tfit[2]), "hw": float(tfit[3]), "hh": float(tfit[4])}}
        print(sheet, "fondo", bg.round(), "baldosa L", round(tile_l))
    json.dump(meta, open(fn, "w"), indent=1)


if __name__ == "__main__":
    run(sys.argv[1:] or None)
