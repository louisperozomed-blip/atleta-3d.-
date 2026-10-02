"""RELLENO (zombi y perro) · Etapa 1a · recorte, fondo transparente y baldosa fuera.

Las hojas (ref/sheets_fodder/<tipo>_<anim>_<1|2>.jpg, JPEG 1536x1024) tienen fondo liso y una baldosa
isométrica bajo cada figura, pero aquí la baldosa NO es gris lisa como en las del autómata: es una losa oscura
con rejilla, celdas que brillan en amarillo y setas pequeñas. Así que se separa por color Y por geometría:
  1. primer plano = lo que se aparta del color del fondo (mediana del borde), sin los rótulos
  2. modelo de color por hoja (histograma RGB 32³ suavizado): baldosa = la franja más baja de cada celda (el
     pico delantero de la losa, donde no hay figura); figura = la mitad de arriba. Razón de verosimilitud por
     píxel, suavizada 3x3
  3. rombo de la baldosa ajustado (extract.fit_tile) a los píxeles «baldosa» de la mitad baja; tamaño = mediana
     de la hoja (todas iguales), centros regularizados por columna y fila (como en el autómata)
  4. se quita SOLO lo que es color de baldosa dentro del rombo (y su canto, ~14 px por debajo): el musgo oscuro
     del cuerpo, fuera del rombo, se queda
  5. cada celda se queda con la figura cuyo núcleo cae dentro (los pedazos de la vecina, fuera) y el borde con
     extract.matte (alfa suave, sin halo)
Salida: build/fodder/raw/<tipo>_<anim>_<dir>_<i>.png + build/fodder/raw_meta.json (caja, rombo de la baldosa)
"""
import glob
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

import extract as X
import fodder_grid as G
from common import BUILD, ROOT

FREF = os.path.join(ROOT, "ref", "sheets_fodder")
FBUILD = os.path.join(BUILD, "fodder")
FRAW = os.path.join(FBUILD, "raw")
os.makedirs(FRAW, exist_ok=True)
ROWS = {"1": ["N", "NE", "E", "SE"], "2": ["S", "SW", "W", "NW"]}
MARGIN = 60
EDGE = 14          # canto de la losa bajo el rombo (px)


def sheets():
    out = []
    for f in sorted(glob.glob(os.path.join(FREF, "*.jpg"))):
        n = os.path.basename(f)[:-4]
        kind, anim, half = n.split("_")
        out.append((n, kind, anim, half, f))
    return out


def color_model(a, fg, cells, key):
    ht = np.zeros(32768); hf = np.zeros(32768)
    for (x0, y0, x1, y1) in cells:
        m = fg[y0:y1, x0:x1]
        ys, xs = np.nonzero(m)
        if len(ys) < 200:
            continue
        top, bot = ys.min(), ys.max(); h = bot - top
        k = key[y0:y1, x0:x1]
        low = m.copy(); low[:bot - int(h * 0.12)] = False
        up = m.copy(); up[top + int(h * 0.5):] = False
        ht += np.bincount(k[low], minlength=32768); hf += np.bincount(k[up], minlength=32768)
    ht = ndi.gaussian_filter(ht.reshape(32, 32, 32), 1).ravel() + 1e-3
    hf = ndi.gaussian_filter(hf.reshape(32, 32, 32), 1).ravel() + 1e-3
    ht /= ht.sum(); hf /= hf.sum()
    return ndi.uniform_filter(np.log(hf[key] / ht[key]), 3)


def rhombus(shape, cx, cy, hw, hh, grow=0.0):
    yy, xx = np.mgrid[:shape[0], :shape[1]].astype(np.float32)
    d = np.abs(xx - cx) / (hw + grow) + np.abs(yy - cy) / (hh + grow * hh / hw)
    inside = d <= 1
    # canto de la losa: el rombo desplazado hacia abajo hasta EDGE px
    for k in range(2, EDGE + 1, 2):
        inside |= (np.abs(xx - cx) / (hw + grow) + np.abs(yy - k - cy) / (hh + grow * hh / hw)) <= 1
    return inside


def run(only=None):
    meta = {}
    fn = os.path.join(FBUILD, "raw_meta.json")
    if only and os.path.exists(fn):
        meta = json.load(open(fn))
    report = {}
    for n, kind, anim, half, f in sheets():
        if only and n not in only and f"{kind}_{anim}" not in only:
            continue
        a = G.load(f)
        H, W = a.shape[:2]
        g = G.grid(a)
        border = np.concatenate([a[:, :5].reshape(-1, 3), a[:, -5:].reshape(-1, 3), a[-5:].reshape(-1, 3)])
        bg = np.median(border, 0)
        fg = np.abs(a - bg).max(2) > 22
        text = np.zeros((H, W), bool)
        for b in g["text_boxes"]:
            text[max(0, b[1]):b[3], max(0, b[0]):b[2]] = True
        text[:, :g["label_right"] + 2] = True               # columna de rótulos
        text[:max(0, g["head_bot"] - 30)] = True             # título y cabecera (las orejas pueden subir un poco)
        fg &= ~text
        fg = ndi.binary_opening(fg, np.ones((2, 2)))
        q = (a // 8).astype(int); key = q[..., 0] * 1024 + q[..., 1] * 32 + q[..., 2]
        cells = [(g["cols"][i], g["rows"][r], g["cols"][i + 1], g["rows"][r + 1]) for r in range(4) for i in range(6)]
        lr = color_model(a, fg, cells, key)
        tilec = fg & (lr <= 0)
        figc = fg & (lr > 0)
        # rombo por celda
        fits = {}
        for r in range(4):
            for i in range(6):
                x0, y0, x1, y1 = cells[r * 6 + i]
                m = fg[y0:y1, x0:x1]
                ys, xs = np.nonzero(m)
                if len(ys) < 200:
                    fits[(r, i)] = None; continue
                top, bot = ys.min(), ys.max()
                t = tilec[y0:y1, x0:x1].copy(); t[:top + int((bot - top) * 0.45)] = False
                occ = figc[y0:y1, x0:x1].copy(); occ[:top + int((bot - top) * 0.45)] = False
                t = ndi.binary_opening(t, np.ones((2, 2)))
                ft = X.fit_tile(t, ndi.binary_dilation(occ, iterations=1))
                fits[(r, i)] = None if ft is None else (ft[0], ft[1] + x0, ft[2] + y0, ft[3], ft[4])
        ok = [v for v in fits.values() if v is not None and v[0] > 0.35]
        hw = float(np.median([v[3] for v in ok])); hh = float(np.median([v[4] for v in ok]))
        # centros: patrón por columna (mediana de las 4 filas, relativo al borde de la celda) + recta por fila
        X0 = np.array([[np.nan if fits[(r, i)] is None or fits[(r, i)][0] < 0.35 else fits[(r, i)][1] - cells[r * 6 + i][0] for i in range(6)] for r in range(4)])
        Y0 = np.array([[np.nan if fits[(r, i)] is None or fits[(r, i)][0] < 0.35 else fits[(r, i)][2] for i in range(6)] for r in range(4)])
        ii = np.arange(6)
        with np.errstate(all="ignore"):
            colpat = np.nanmedian(X0, 0)
        if np.isnan(colpat).any():
            okc = ~np.isnan(colpat); colpat = np.interp(ii, ii[okc], colpat[okc]) if okc.any() else np.full(6, (cells[0][2] - cells[0][0]) / 2)
        tiles = {}
        for r in range(4):
            okr = np.isfinite(X0[r]) & np.isfinite(Y0[r])
            kx = np.polyfit(ii[okr], (X0[r] - colpat)[okr], 1) if okr.sum() >= 3 else [0, 0]
            ky = np.polyfit(ii[okr], Y0[r][okr], 1) if okr.sum() >= 3 else [0, np.nanmedian(Y0)]
            for i in range(6):
                tiles[(r, i)] = (cells[r * 6 + i][0] + colpat[i] + np.polyval(kx, i), float(np.polyval(ky, i)))
        # PLANTILLA de la baldosa: las 24 losas de una hoja son la misma imagen (diferencia mediana ~2/255 fuera de
        # la figura), así que su mediana alineada es la losa limpia; cada celda se reajusta ±3 px contra ella.
        # Donde la plantilla no es fiable (el centro, tapado por la figura en casi todas las celdas) manda el
        # modelo de color.
        # tamaño por columna (en algunas hojas las columnas de la derecha son más anchas y su losa mayor)
        hwc = []
        for i in range(6):
            v = [fits[(r, i)] for r in range(4) if fits[(r, i)] is not None and fits[(r, i)][0] > 0.35]
            hwc.append(float(np.median([x[3] for x in v])) if v else hw)
        hwc = [h_ if abs(h_ / hw - 1) > 0.04 else hw for h_ in hwc]
        pw, ph = int(2 * hw + 28), int(2 * hh + EDGE + 28)
        def geom(k):
            sc = hwc[k[1]] / hw
            return sc, int(round(pw * sc)), int(round(ph * sc))
        org = {}
        for k, (cx, cy) in tiles.items():
            sc, w_, h_ = geom(k)
            org[k] = [int(round(cx - (hw + 14) * sc)), int(round(cy - (hh + 14) * sc))]
        def raw(k):
            sc, w_, h_ = geom(k); x, y = org[k]
            out = np.zeros((h_, w_, 3), np.float32); xa, ya = max(0, x), max(0, y)
            sub = a[ya:min(H, y + h_), xa:min(W, x + w_)]
            out[ya - y:ya - y + sub.shape[0], xa - x:xa - x + sub.shape[1]] = sub
            return out
        def patch(k):
            r_ = raw(k)
            return r_ if r_.shape[:2] == (ph, pw) else cv2.resize(r_, (pw, ph), interpolation=cv2.INTER_LINEAR)
        for it in range(2):
            P = np.stack([patch(k) for k in tiles]); med = np.median(P, 0)
            for k in tiles:
                best = None
                for ddy in range(-3, 4):
                    for ddx in range(-3, 4):
                        org[k][0] += ddx; org[k][1] += ddy
                        e = float(np.median(np.abs(patch(k) - med).max(2)))
                        if best is None or e < best[0]: best = (e, ddx, ddy)
                        org[k][0] -= ddx; org[k][1] -= ddy
                org[k][0] += best[1]; org[k][1] += best[2]
        P = np.stack([patch(k) for k in tiles]); med = np.median(P, 0)
        mad = np.median(np.abs(P - med).max(3), 0)
        rep_t = float(np.median(mad))
        figm = fg.copy()
        for k, (cx, cy) in tiles.items():
            sc, w_, h_ = geom(k); x, y = org[k]
            medk = med if sc == 1 else cv2.resize(med, (w_, h_), interpolation=cv2.INTER_LINEAR)
            madk = mad if sc == 1 else cv2.resize(mad, (w_, h_), interpolation=cv2.INTER_LINEAR)
            xa, ya, xb, yb = max(0, x), max(0, y), min(W, x + w_), min(H, y + h_)
            rh = rhombus((h_, w_), cx - x, cy - y, hwc[k[1]], hh * sc, grow=8)[ya - y:yb - y, xa - x:xb - x]
            rhb = rhombus((h_, w_), cx - x, cy - y, hwc[k[1]], hh * sc, grow=18)[ya - y:yb - y, xa - x:xb - x]
            dif = np.abs(a[ya:yb, xa:xb] - medk[ya - y:yb - y, xa - x:xb - x]).max(2)
            rel = madk[ya - y:yb - y, xa - x:xb - x] < 14
            same = ndi.binary_opening(dif < 30, np.ones((2, 2)))
            # (el modelo de color también cuenta en todo el rombo algo ampliado: restos de losa bajo los cuerpos tumbados,
            #  donde la plantilla se desalinea)
            tile_px = (rh & rel & same) | (rhb & tilec[ya:yb, xa:xb])
            figm[ya:yb, xa:xb] &= ~tile_px
            # restos finos de los cantos de la losa (oscuros, poco saturados) alrededor del rombo: fuera
            rhw = rhombus((h_, w_), cx - x, cy - y, hwc[k[1]], hh * sc, grow=40)[ya - y:yb - y, xa - x:xb - x]
            fm_ = figm[ya:yb, xa:xb]
            thin = fm_ & ~ndi.binary_opening(fm_, np.ones((5, 5)))
            A_ = a[ya:yb, xa:xb]; Lk = A_.mean(2); Ck = A_.max(2) - A_.min(2)
            fm_ &= ~(rhw & thin & (Lk < 95) & (Ck < 55))
        tiles_hw = {k: (hwc[k[1]], hh * hwc[k[1]] / hw) for k in tiles}
        figm = ndi.binary_opening(figm, np.ones((2, 2)))
        # núcleos: lo grueso de cada figura (sin garras ni colas finas, que no unen vecinas)
        core = ndi.binary_opening(figm, np.ones((7, 7)))
        rep = {"tile_mad": round(rep_t, 1), "tile_hw": round(hw, 1), "hw_col": [round(x, 1) for x in hwc], "tile_hh": round(hh, 1), "fits_ok": len(ok), "bg": bg.round().tolist()}
        for r in range(4):
            d = ROWS[half][r]
            for i in range(6):
                x0, y0, x1, y1 = cells[r * 6 + i]
                bx0, bx1 = max(x0 - MARGIN, 0), min(x1 + MARGIN, W)
                by0, by1 = max(y0 - 40, 0), min(y1 + 20, H)
                crop = a[by0:by1, bx0:bx1]
                fm = figm[by0:by1, bx0:bx1].copy()
                cm = core[by0:by1, bx0:bx1]
                nl, lab, st, cen = cv2.connectedComponentsWithStats(cm.astype(np.uint8), connectivity=8)
                inner = (x0 - bx0, x1 - bx0, y0 - by0, y1 - by0)
                own = [k for k in range(1, nl) if st[k, 4] > 500 and inner[0] <= cen[k][0] < inner[1] and inner[2] <= cen[k][1] < inner[3]]
                if not own and nl > 1:
                    own = [int(np.argmax(st[1:, 4])) + 1]
                oth = [k for k in range(1, nl) if st[k, 4] > 500 and k not in own]
                ownm = np.isin(lab, own)
                if oth:
                    fm &= ndi.distance_transform_edt(~ownm) <= ndi.distance_transform_edt(~np.isin(lab, oth))
                lb, nb = ndi.label(fm)
                keep = np.unique(lb[ownm & fm]); keep = keep[keep > 0]
                fo = np.isin(lb, keep)
                # piezas sueltas con el centro dentro de la celda (chispas, estela del zarpazo): se quedan
                lb2, nb2 = ndi.label(fm & ~fo)
                if nb2:
                    sz = ndi.sum(fm, lb2, range(1, nb2 + 1)); cmz = ndi.center_of_mass(fm, lb2, range(1, nb2 + 1))
                    # (no las que caen sobre la baldosa: restos de sus celdas brillantes y setas)
                    tcx, tcy = tiles[(r, i)][0] - bx0, tiles[(r, i)][1] - by0
                    onT = lambda p: abs(p[1] - tcx) / (hw + 6) + abs(p[0] - tcy - EDGE / 2) / (hh + EDGE) <= 1
                    extra = [k + 1 for k in range(nb2) if sz[k] >= 60 and inner[0] <= cmz[k][1] < inner[1] and inner[2] <= cmz[k][0] < inner[3] and not onT(cmz[k])]
                    # y pegadas al cuerpo (a ≤ 30 px) salvo las grandes (estela): fuera restos de rótulos y rayitas sueltas
                    dmain = ndi.distance_transform_edt(~fo)
                    extra = [k for k in extra if sz[k - 1] >= 400 or dmain[lb2 == k].min() <= 30]
                    fo |= np.isin(lb2, extra)
                holes = ndi.binary_fill_holes(fo) & ~fo
                lh, nh = ndi.label(holes)
                if nh:
                    sz = ndi.sum(holes, lh, range(1, nh + 1))
                    fo |= np.isin(lh, np.nonzero(sz < 120)[0] + 1)
                col, alpha = X.matte(crop, fo)
                name = f"{kind}_{anim}_{d}_{i}"
                Image.fromarray(np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)).save(os.path.join(FRAW, name + ".png"))
                ys, xs = np.nonzero(alpha > 0.5)
                cx, cy = tiles[(r, i)]
                meta[name] = {"sheet": n, "box": [bx0, by0, bx1, by1],
                              "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None,
                              "tile": {"cx": round(cx - bx0, 2), "cy": round(cy - by0, 2), "hw": round(tiles_hw[(r, i)][0], 2), "hh": round(tiles_hw[(r, i)][1], 2),
                                       "fit": None if fits[(r, i)] is None else round(float(fits[(r, i)][0]), 3)}}
        report[n] = rep
        print(n, rep)
    json.dump(meta, open(fn, "w"), indent=1)
    rf = os.path.join(FBUILD, "extract_report.json")
    old = json.load(open(rf)) if only and os.path.exists(rf) else {}
    old.update(report)
    json.dump(old, open(rf, "w"), indent=1)


if __name__ == "__main__":
    run(sys.argv[1:] or None)
