"""COMBATE · Etapa 1a · Recorte y fondo transparente de las hojas de combate.

Reutiliza el extractor de tools/extract.py (bandas, números, celdas, matte y
ajuste de la baldosa) con dos cambios:
  * El fondo se mide en cada hoja: parry/block/dodge/hit/death tienen el fondo
    más turquesa (G-R ~18, B-G ~7), casi del tono de la tela del personaje
    (B-G <= 1), así que los umbrales de "fondo" se centran en el color real de
    la hoja en vez de en el gris azulado de walk/idle.
  * La dirección de cada fila sale de ref/sheets_combate/labels.json.

Salida: build/combat/raw/<anim>_<dir>_<i>.png y build/combat/raw_meta.json
"""
import json
import os

import numpy as np
from PIL import Image

import extract as X
from combat_common import CBUILD, CRAW, CREF, CSHEETS, rows_of
from common import NFRAMES, frame_name


def sheet_bg(a, seps):
    """Color de fondo de la hoja: franja alta de cada banda y margen derecho."""
    ks = []
    for s in seps:
        ks.append(a[s + 6:s + 14, 150:1215].reshape(-1, 3))
    ks.append(a[seps[0] + 40:, 1205:1222].reshape(-1, 3))
    k = np.concatenate(ks)
    k = k[k.mean(1) < 60]
    return np.median(k, 0)


def row_separators(a):
    """Como extract.row_separators, pero admite una quinta raya al pie de la hoja (deathblow)."""
    lum = a.mean(2)
    prof = np.median(lum, axis=1)
    ys = np.nonzero(prof < prof.mean() - 12)[0]
    groups = []
    for y in ys:
        if groups and y - groups[-1][-1] <= 3:
            groups[-1].append(y)
        else:
            groups.append([y])
    seps = [int(np.mean(g)) for g in groups]
    # heavy/spin: las rayas del título (arriba del todo) no son separadores de banda
    if len(seps) > 5: seps = [s for s in seps if s > 50]
    assert len(seps) in (4, 5), seps
    return seps


def classify_adaptive(a, c):
    mx, mn = a.max(2), a.min(2)
    ch = mx - mn
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    lum = a.mean(2)
    sat = (ch > 45) & (mx > 60)
    gr_c, bg_c, lum_c = c[1] - c[0], c[2] - c[1], c.mean()
    GR, BG = G - R, B - G
    teal = gr_c > 10.5   # el clasificador original solo admite G-R <= 11 en el fondo
    # baldosa y sombra pintada grises neutras (en death son más oscuras que en walk: B~R)
    neutral = (ch <= 7) & (lum >= 18) & (lum < 100) & (np.abs(B - R) <= 5)
    # baldosa con sombra gris azulada (attack2_2: ~(57,62,70)); la tela es verde (G >= B), la crema cálida
    neutral |= (lum >= 40) & (lum < 100) & (ch <= 17) & (B >= G) & (G >= R)
    # sombra pintada gris cálida sobre la baldosa (hit/dodge/death: ~(48,42,36))
    neutral |= (lum >= 30) & (lum < 75) & (ch <= 15) & (R >= G) & (G >= B)
    if not teal:
        # fondo gris azulado como el de walk/idle: el clasificador original
        sat, bgl = X.classify(a)
        return sat, bgl | neutral
    # fondo oscuro con el tinte de la hoja (la tela es verde: B-G <= 1; el fondo, B-G >= 4)
    dark_bg = (lum < lum_c + 14) & (lum >= lum_c - 10) & (np.abs(GR - gr_c) <= 7) & (BG >= max(1.0, bg_c - 4)) & (BG <= bg_c + 6) \
        & (ch <= max(16, gr_c + bg_c + 8))
    # tonos más oscuros del mismo fondo (sombra/viñeta alrededor de la figura): color ~ k·fondo
    cc = np.asarray(c, np.float32)
    k = (a @ cc) / float(cc @ cc)
    res = np.linalg.norm(a - k[..., None] * cc, axis=2)
    dark_bg |= (k >= 0.3) & (k <= 1.25) & (res <= 5 + 3 * k)
    mid_bg = (lum >= 30) & (lum < 56) & (ch <= 9) & (B >= R) & (G >= R - 1)
    if teal:
        # sombras y degradado entre el fondo turquesa y la baldosa gris
        mid_bg |= (lum >= lum_c - 4) & (lum < 60) & (GR >= -1) & (GR <= gr_c + 4) & (BG >= 2) & (BG <= bg_c + 5)
    tile_bg = (lum >= 44) & (lum < 100) & (ch <= 11) & (B >= R - 2)
    bglike = dark_bg | mid_bg | tile_bg | neutral
    sure = ((lum < lum_c + 10) & (np.abs(GR - gr_c) <= 5) & (BG >= max(2.0, bg_c - 3)) & (BG <= bg_c + 4)) | tile_bg
    X.SURE_BG = sure
    return sat, bglike


# heavy/spin (zip «Animaciones_HEAVY_SPIN»): cada frame va en una tarjeta con el número en su esquina superior
# izquierda (no centrado encima): las columnas salen de los bordes oscuros de las tarjetas
CARD_SHEETS = ("heavy", "spin")
CARD_EDGES = [116, 299, 478, 657, 858, 1046, 1216]


def card_columns(a, y0, y1):
    lum = a[y0 + 30:y1 - 30].mean(2)
    prof = np.median(lum, axis=0)
    edges = []
    for e in CARD_EDGES:
        lo, hi = max(0, e - 14), min(len(prof), e + 15)
        edges.append(lo + int(np.argmin(prof[lo:hi])))
    return [(edges[i] + edges[i + 1]) / 2 for i in range(6)], edges


def number_glyphs(a, y0, y1, xmin=150):
    """Números 1..6 de la cabecera de cada banda: crema claro y plano (en las hojas
    turquesa tienen poca saturación, así que se buscan por brillo)."""
    import cv2
    band = a[y0:y1]
    m = (band.mean(2) > 150).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    g = []
    for i in range(1, n):
        x, y, w, h, ar = st[i]
        if 10 <= h <= 34 and w <= 30 and x > xmin and ar > 30:
            px = band[y:y + h, x:x + w][lab[y:y + h, x:x + w] == i]
            g.append((x, y + y0, w, h, px.std(0).mean()))
    if g:
        ty = np.median([q[1] for q in g]); th = np.median([q[3] for q in g])
        g = [q[:4] for q in g if abs(q[1] - ty) <= 3 and abs(q[3] - th) <= 3 and q[4] < 40]
    return g


def extract_cell(a, sat, bglike, box, glyph_mask, inner):
    """Como extract.extract_cell, pero con los personajes vecinos: cuando una
    cuchilla o una chispa cruza el borde de la celda, cada píxel se queda con
    el núcleo (propio o vecino) más cercano."""
    import cv2
    from scipy import ndimage as ndi
    x0, y0, x1, y1 = box  # noqa
    col, alpha, fg, tfit = X.extract_cell(a, sat, bglike, box, glyph_mask, inner)
    s_ = sat[y0:y1, x0:x1] & ~glyph_mask[y0:y1, x0:x1]
    sd = cv2.dilate(s_.astype(np.uint8), np.ones((5, 5), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(sd, connectivity=8)
    own = np.isin(lab, [i for i in range(1, n) if st[i, 4] > 400 and inner[0] <= cen[i][0] < inner[1]])
    oth = np.isin(lab, [i for i in range(1, n) if st[i, 4] > 400 and not (inner[0] <= cen[i][0] < inner[1])])
    if oth.any() and own.any():
        d_own = ndi.distance_transform_edt(~own)
        d_oth = ndi.distance_transform_edt(~oth)
        keep = fg & (d_own <= d_oth)
        lb, nb = ndi.label(keep)
        if nb > 1:
            ids = np.unique(lb[own & keep]); ids = ids[ids > 0]
            keep = np.isin(lb, ids)
        if keep.sum() < fg.sum():
            col, alpha = X.matte(a[y0:y1, x0:x1], keep)
            fg = keep
    # sombra pintada en el suelo que queda pegada a los pies: manchas grandes, oscuras y sin croma
    # (el contorno negro es fino y no sobrevive a la apertura; las botas son cálidas, R > B)
    crop = a[y0:y1, x0:x1]
    lum = crop.mean(2); ch = crop.max(2) - crop.min(2)
    Bc, Gc = crop[..., 2], crop[..., 1]
    dark = fg & (((ch <= 16) & (lum < 70) & (Bc >= crop[..., 0] - 4)) | ((Bc - Gc >= 3) & (lum < 45)))
    ys = np.nonzero(fg)[0]
    if len(ys):
        top, bot = ys.min(), ys.max()
        # solo a la altura de los pies (la túnica oscura baja hasta ~80 % de la figura)
        dark[:bot - max(14, int((bot - top) * 0.14))] = False
        dark &= lum >= 16
        blob = ndi.binary_opening(dark, np.ones((5, 5)))
        outside = ndi.binary_dilation(~fg, iterations=2)
        lb, nb = ndi.label(blob)
        rm = np.zeros_like(blob)
        for i in range(1, nb + 1):
            comp = lb == i
            if comp.sum() >= 40 and (comp & outside).any():
                rm |= comp
        if rm.any():
            rm = ndi.binary_dilation(rm, iterations=2) & dark
            fg2 = ndi.binary_opening(fg & ~rm, np.ones((2, 2)))
            lb2, n2 = ndi.label(fg2)
            if n2 > 1:
                sz = ndi.sum(fg2, lb2, range(1, n2 + 1))
                # quedan el cuerpo y las piezas con color propio (chispas, cuchilla); no manchas oscuras sueltas
                sat_c = sat[y0:y1, x0:x1]
                ids = [i + 1 for i in range(n2) if sz[i] == sz.max() or (sz[i] >= 20 and (sat_c & (lb2 == i + 1)).any())]
                fg2 = np.isin(lb2, ids)
            fg = fg2
            col, alpha = X.matte(crop, fg)
    # si la figura llega al borde de la celda ampliada es que está pegada a la vecina en la hoja
    # (cuchilla de una contra chispas de otra): se corta por la línea media entre columnas
    W_ = fg.shape[1]
    cut = False
    if fg[:, 0].any():
        fg[:, :max(0, inner[0] - 6)] = False; cut = True
    if fg[:, -1].any():
        fg[:, min(W_, inner[1] + 6):] = False; cut = True
    if cut:
        col, alpha = X.matte(crop, fg)
    # limpieza final: el cuerpo y las piezas con color propio (chispas); fuera manchas sueltas de fondo
    lb3, n3 = ndi.label(fg)
    if n3 > 1:
        sz = ndi.sum(fg, lb3, range(1, n3 + 1))
        sat_c = sat[y0:y1, x0:x1]
        ids = [i + 1 for i in range(n3) if sz[i] == sz.max() or
               (sz[i] >= 12 and (sat_c & (lb3 == i + 1)).sum() >= 0.3 * sz[i])]
        if len(ids) < n3:
            fg = np.isin(lb3, ids)
            col, alpha = X.matte(crop, fg)
    return col, alpha, fg, tfit


def run(only=None):
    meta = {}
    for sheet, (anim, part) in CSHEETS.items():
        if only and anim not in only:
            continue
        path = os.path.join(CREF, sheet + ".png")
        a = X.load(path)
        if a.shape[1] != 1225:
            # riposte llegó a 1312x1199: se reescala (uniforme) al ancho de las demás, así la rejilla común
            # (columnas, rótulos a la izquierda) cae en el mismo sitio; la escala final la decide el casco
            k = 1225 / a.shape[1]
            a = np.asarray(Image.fromarray(a.round().astype(np.uint8)).resize((1225, round(a.shape[0] * k)), Image.LANCZOS)).astype(np.float32)
        H, W = a.shape[:2]
        seps = row_separators(a)
        if len(seps) == 5:
            # deathblow cierra la última banda con una raya: la hoja acaba ahí
            a = a[:seps[4] - 1]; seps = seps[:4]
        H, W = a.shape[:2]
        c = sheet_bg(a, seps)
        sat, bglike = classify_adaptive(a, c)
        print(f"{sheet}: fondo {c.round()}")
        bands = [(seps[k] + 3, seps[k + 1] - 2 if k < 3 else H - 1) for k in range(4)]
        glyph_mask = np.zeros(sat.shape, bool)
        # rótulos de dirección a la izquierda (N, SW...): texto crema claro
        lum_ = a.mean(2); ch_ = a.max(2) - a.min(2)
        glyph_mask[:, :140] = (lum_[:, :140] > 110) & (ch_[:, :140] < 90)
        glyph_mask[:, :125] |= ~sat[:, :125]     # flechitas del rótulo
        prev_cols = None
        for r, (by0, by1) in enumerate(bands):
            d = rows_of(sheet)[r]
            card = anim in CARD_SHEETS
            glyphs = number_glyphs(a, by0, by0 + 45, 120 if card else 150)
            for (gx, gy, gw, gh) in glyphs:
                glyph_mask[gy - 1:gy + gh + 1, gx - 1:gx + gw + 1] = True
            cols, cedges = card_columns(a, by0, by1) if card else (X.cluster_columns(glyphs), None)
            if card:
                # el número de la esquina: su caja (no se busca columna por él)
                glyphs = []
            if len(cols) != NFRAMES:
                fixed = []
                # rejilla común de las hojas (algún número queda tapado por la cuchilla)
                for pc in (prev_cols or [214, 394, 575, 756, 934, 1116]):
                    near = [x for x in cols if abs(x - pc) < 30]
                    fixed.append(near[0] if near else pc)
                print("  (columna inferida)", sheet, r, [round(x) for x in cols], "->", [round(x) for x in fixed])
                cols = fixed
            prev_cols = cols
            ty = min(g[1] for g in glyphs) if glyphs else by0 + 8
            th = max(g[3] for g in glyphs) if glyphs else 22
            bright = a.mean(2) > 120
            for cx in cols:
                sl = (slice(ty - 2, ty + th + 3), slice(int(cx) - 13, int(cx) + 14))
                seen = any(abs(g[0] + g[2] / 2 - cx) < 20 for g in glyphs)
                glyph_mask[sl] |= sat[sl] | (bright[sl] if seen else False)
            # los textos de fase bajo cada frame: franja inferior de la banda
            lab_y0 = by1 - 44 if r < 3 else seps[3] + (seps[3] - seps[2]) - 46
            assert len(cols) == NFRAMES, (sheet, r, cols)
            pitch = float(np.median(np.diff(cols)))
            for i, cx in enumerate(cols):
                xl = int(round(cx - pitch * 0.62)) if i == 0 else int(round((cols[i - 1] + cx) / 2))
                xr = int(round(cx + pitch * 0.62)) if i == NFRAMES - 1 else int(round((cols[i + 1] + cx) / 2))
                xl, xr = max(xl, 0), min(xr, W)
                MARGIN = 60
                bxl, bxr = max(xl - MARGIN, 0), min(xr + MARGIN, W)
                if card:
                    # la figura y sus efectos caben en su tarjeta: se recorta por dentro de sus bordes oscuros
                    xl, xr = cedges[i] + 5, cedges[i + 1] - 4
                    bxl, bxr = xl, xr
                box = (bxl, by0, bxr, min(by1, lab_y0 + 4))
                col, alpha, fg, tfit = extract_cell(a, sat, bglike, box, glyph_mask, (xl - bxl, xr - bxl))
                ys, xs = np.nonzero(alpha > 0.5)
                name = frame_name(anim, d, i)
                rgba = np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)
                Image.fromarray(rgba).save(os.path.join(CRAW, name + ".png"))
                t = None if tfit is None else {"iou": round(float(tfit[0]), 3), "cx": float(tfit[1]),
                                               "cy": float(tfit[2]), "hw": float(tfit[3]), "hh": float(tfit[4])}
                meta[name] = {"sheet": sheet, "box": box,
                              "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], "tile": t}
    fn = os.path.join(CBUILD, "raw_meta.json")
    if only and os.path.exists(fn):
        old = json.load(open(fn)); old.update(meta); meta = old
    with open(fn, "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    import sys
    run(sys.argv[1:] or None)
