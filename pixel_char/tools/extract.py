"""ETAPA 1a · Detección de rejilla, recorte y quitado de fondo.

Para cada hoja de ref/sheets:
  1. Detecta las 4 bandas de fila (líneas separadoras oscuras).
  2. Detecta los números 1..6 de cada banda -> centros de columna.
  3. En cada celda separa el personaje del fondo (gris azulado), de la baldosa
     gris y de las sombras pintadas (grises neutros), quita textos y números.
  4. Calcula alfa suave en el borde por "des-mezcla" con el color de fondo
     local (evita el halo oscuro/azulado) y guarda un RGBA por frame.
  5. Mide la baldosa (rombo) de cada celda: su centro es el punto de apoyo
     en el suelo y su anchura la escala de dibujo.

Salida: build/raw/<anim>_<dir>_<i>.png y build/raw_meta.json
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from common import ANIMS, BUILD, NFRAMES, REF, SHEET_DIRS, frame_name

RAW = os.path.join(BUILD, "raw")
os.makedirs(RAW, exist_ok=True)


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def row_separators(a):
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
    assert len(seps) == 4, seps
    return seps


def classify(a):
    """Devuelve máscaras: sat (colores del personaje), bglike (fondo/baldosa/sombra)."""
    mx = a.max(2)
    mn = a.min(2)
    ch = mx - mn
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    lum = a.mean(2)
    sat = (ch > 45) & (mx > 60)
    # Fondo, baldosa, rejilla de la baldosa y sombras pintadas.
    # El fondo oscuro es gris azulado verdoso (G-R ~7, B-R ~10) mientras que el
    # negro del casco/tela es neutro o cálido, así que en oscuros exigimos tinte frío.
    dark_bg = (lum < 36) & (G - R >= 3) & (G - R <= 11) & (B - R >= 4) & (B - G >= 1) & (ch <= 16)
    mid_bg = (lum >= 30) & (lum < 56) & (ch <= 9) & (B >= R) & (G >= R - 1)
    tile_bg = (lum >= 50) & (lum < 100) & (ch <= 11) & (B >= R + 1)
    bglike = dark_bg | mid_bg | tile_bg
    # Para huecos interiores (entre brazo y cuerpo) solo aceptamos fondo "seguro"
    global SURE_BG
    SURE_BG = ((lum < 36) & (G - R >= 4) & (G - R <= 10) & (B - R >= 6) & (B - G >= 2) & (ch <= 16)) | tile_bg
    return sat, bglike


def number_glyphs(a, sat, y0, y1):
    """Componentes pequeñas en la franja superior de la banda = números 1..6."""
    band = sat[y0:y1]
    a_band = a[y0:y1]
    n, lab, st, cen = cv2.connectedComponentsWithStats(band.astype(np.uint8), connectivity=8)
    glyphs = []
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if 10 <= h <= 30 and w <= 30 and x > 150 and area > 30:
            m = lab[y:y + h, x:x + w] == i
            px = a_band[y:y + h, x:x + w][m]
            # Los números son planos (un solo color); las piezas del personaje no.
            glyphs.append((x, y + y0, w, h, px.std(0).mean()))
    # Los números están alineados (misma línea base y altura); descarta lo demás
    if glyphs:
        ty = np.median([g[1] for g in glyphs]); th = np.median([g[3] for g in glyphs])
        glyphs = [g[:4] for g in glyphs if abs(g[1] - ty) <= 3 and abs(g[3] - th) <= 3 and g[4] < 40]
    return glyphs


def cluster_columns(glyphs):
    xs = sorted([g[0] + g[2] / 2 for g in glyphs])
    cols = []
    for x in xs:
        if cols and x - cols[-1][-1] < 40:
            cols[-1].append(x)
        else:
            cols.append([x])
    return [float(np.mean(c)) for c in cols]


def fit_tile(tile, occl):
    """Ajusta un rombo |x-cx|/hw + |y-cy|/hh <= 1 a la máscara de baldosa,
    ignorando los píxeles tapados por el personaje (IoU suave + Nelder-Mead).
    Devuelve (iou, cx, cy, hw, hh)."""
    ys, xs = np.nonzero(tile)
    if len(xs) < 200:
        return None
    x0, x1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5)
    cx = (x0 + x1) / 2
    hw = (x1 - x0) / 2
    yb = np.percentile(ys, 99.7)
    cy = np.median(ys[(xs < x0 + 4) | (xs > x1 - 4)])
    r0 = (yb - cy) / hw
    Y0, Y1 = max(int(ys.min()) - 10, 0), min(int(ys.max()) + 10, tile.shape[0])
    X0, X1 = max(int(xs.min()) - 10, 0), min(int(xs.max()) + 10, tile.shape[1])
    t = tile[Y0:Y1, X0:X1].astype(np.float32)
    known = (~occl[Y0:Y1, X0:X1]).astype(np.float32)
    yy, xx = np.mgrid[Y0:Y1, X0:X1].astype(np.float32)

    def soft(p):
        c_x, c_y, h_w, r = p
        d = np.abs(xx - c_x) / h_w + np.abs(yy - c_y) / (h_w * r)
        return 1 / (1 + np.exp((d - 1) * h_w * 1.5))

    def cost(p):
        m = soft(p)
        inter = (m * t * known).sum()
        uni = ((m + t - m * t) * known).sum()
        return -inter / max(uni, 1)

    from scipy.optimize import minimize
    res = minimize(cost, [cx, cy, hw, r0], method="Nelder-Mead",
                   options={"xatol": 0.05, "fatol": 1e-5, "maxiter": 600})
    c_x, c_y, h_w, r = res.x
    return (-res.fun, c_x, c_y, h_w, h_w * r)


def local_mean(img, mask, sigma):
    m = mask.astype(np.float32)
    num = np.stack([ndi.gaussian_filter(img[..., c] * m, sigma) for c in range(3)], -1)
    den = ndi.gaussian_filter(m, sigma)[..., None]
    return num / np.maximum(den, 1e-4), den[..., 0]


def matte(crop, fg):
    """Alfa suave y colores descontaminados en el borde de la silueta.

    1. La silueta binaria se suaviza (blur + umbral) para quitar dientes y motas
       producidos por la compresión del original.
    2. El alfa sale de la máscara suavizada (borde de ~1.5 px, sin escalones).
    3. En el anillo del borde el color se toma del interior cercano: así no
       queda ni un píxel del fondo gris azulado (sin halo), pero sí el
       contorno oscuro pintado, que forma parte del estilo.
    """
    sm = ndi.gaussian_filter(fg.astype(np.float32), 1.1) > 0.5
    sm = ndi.binary_opening(sm, structure=np.ones((3, 3)))
    lab, n = ndi.label(sm)
    if n > 1:
        sizes = ndi.sum(sm, lab, range(1, n + 1))
        sm = np.isin(lab, np.nonzero(sizes >= max(40, sizes.max() * 0.004))[0] + 1)
    b = ndi.gaussian_filter(sm.astype(np.float32), 0.75)
    alpha = np.clip((b - 0.5) * 2.4 + 0.5, 0, 1)
    dist_in = ndi.distance_transform_edt(sm & fg)
    interior = (dist_in >= 1.5)
    Fc, _ = local_mean(crop, interior & (dist_in <= 4.5), 1.3)
    Fc2, _ = local_mean(crop, interior, 4.0)
    Fc = np.where(np.isfinite(Fc) & (ndi.gaussian_filter(interior.astype(np.float32), 1.3)[..., None] > 0.02), Fc, Fc2)
    col = crop.copy()
    ring = (alpha > 0) & ~interior
    col[ring] = Fc[ring]
    return col, alpha


def extract_cell(a, sat, bglike, box, glyph_mask, inner):
    """box = celda ampliada (con solape); inner = (x izq, x der) de la celda
    propiamente dicha en coordenadas del recorte. Las capas y brazos pueden
    salirse de la celda, así que se recorta con margen y el personaje se elige
    por tener su centro dentro de la celda."""
    x0, y0, x1, y1 = box
    crop = a[y0:y1, x0:x1]
    s = sat[y0:y1, x0:x1] & ~glyph_mask[y0:y1, x0:x1]
    bgl = bglike[y0:y1, x0:x1]
    sure = SURE_BG[y0:y1, x0:x1]
    H, W = s.shape
    # Núcleo del personaje: componente saturada grande más cercana al centro.
    sd = cv2.dilate(s.astype(np.uint8), np.ones((5, 5), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(sd, connectivity=8)
    big = [i for i in range(1, n) if st[i, 3] > 60 and inner[0] <= cen[i][0] < inner[1]]
    core = np.isin(lab, big)
    # Fondo = componentes "tipo fondo" que tocan el borde de la celda, o
    # huecos interiores grandes con color de fondo/baldosa.
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(bgl.astype(np.uint8), connectivity=4)
    border = set(np.unique(np.concatenate([lab2[0], lab2[-1], lab2[:, 0], lab2[:, -1]])))
    bg = np.zeros_like(bgl)
    for i in range(1, n2):
        if i in border:
            bg |= lab2 == i
        elif st2[i, 4] >= 30:
            comp = lab2 == i
            if sure[comp].mean() > 0.85:
                bg |= comp
    fg = ~bg
    # Los números de la cabecera nunca son personaje (aunque rocen el casco)
    gm = glyph_mask[y0:y1, x0:x1]
    fg &= ~ndi.binary_dilation(gm, iterations=2)
    # Limpieza: quita motas y quédate con lo conectado al núcleo.
    fg = ndi.binary_opening(fg, np.ones((2, 2)))
    n3, lab3 = cv2.connectedComponents(fg.astype(np.uint8), connectivity=8)
    keep = np.unique(lab3[core & fg])
    keep = keep[keep > 0]
    fg = np.isin(lab3, keep)
    # Rellena agujeros diminutos (píxeles aislados clasificados como fondo)
    holes = ndi.binary_fill_holes(fg) & ~fg
    lh, nh = ndi.label(holes)
    if nh:
        sizes = ndi.sum(holes, lh, range(1, nh + 1))
        small = np.isin(lh, np.nonzero(sizes < 25)[0] + 1)
        fg |= small
    col, alpha = matte(crop, fg)
    # Baldosa: grises neutros claros (incluye sombras sobre la baldosa)
    lum = crop.mean(2)
    tile = bgl & (lum > 41) & ~fg
    tile[:, :inner[0]] = False
    tile[:, inner[1]:] = False
    tfit = fit_tile(tile, ndi.binary_dilation(fg, iterations=2))
    return col, alpha, fg, tfit


def main():
    meta = {}
    for anim in ANIMS:
        for part in (1, 2):
            path = os.path.join(REF, f"{anim}_{part}.png")
            a = load(path)
            H, W = a.shape[:2]
            sat, bglike = classify(a)
            seps = row_separators(a)
            bands = [(seps[k] + 3, seps[k + 1] - 2 if k < 3 else H - 1) for k in range(4)]
            glyph_mask = np.zeros(sat.shape, bool)
            prev_cols = None
            for r, (by0, by1) in enumerate(bands):
                d = SHEET_DIRS[part][r]
                glyphs = number_glyphs(a, sat, by0, by0 + 45)
                for (gx, gy, gw, gh) in glyphs:
                    glyph_mask[gy - 1:gy + gh + 1, gx - 1:gx + gw + 1] = True
                cols = cluster_columns(glyphs)
                if len(cols) < NFRAMES:
                    # Algún número tapado (p.ej. un puño en el salto): completa con el
                    # paso medio de la rejilla usando la fila anterior como plantilla.
                    fixed = []
                    for pc in prev_cols:
                        near = [c for c in cols if abs(c - pc) < 30]
                        fixed.append(near[0] if near else pc)
                    print("  (columna inferida)", path, r, cols, "->", fixed)
                    cols = fixed
                prev_cols = cols
                # Tapa también la zona de cada número (por si alguno no se detectó)
                ty = min(g[1] for g in glyphs); th = max(g[3] for g in glyphs)
                for cx in cols:
                    glyph_mask[ty - 2:ty + th + 3, int(cx) - 12:int(cx) + 13] |= sat[ty - 2:ty + th + 3, int(cx) - 12:int(cx) + 13]
                assert len(cols) == NFRAMES, (path, r, cols)
                pitch = float(np.median(np.diff(cols)))
                for i, cx in enumerate(cols):
                    xl = int(round(cx - pitch * 0.62)) if i == 0 else int(round((cols[i - 1] + cx) / 2))
                    xr = int(round(cx + pitch * 0.62)) if i == NFRAMES - 1 else int(round((cols[i + 1] + cx) / 2))
                    xl, xr = max(xl, 0), min(xr, W)
                    MARGIN = 45
                    bxl, bxr = max(xl - MARGIN, 0), min(xr + MARGIN, W)
                    box = (bxl, by0, bxr, by1)
                    col, alpha, fg, tfit = extract_cell(a, sat, bglike, box, glyph_mask,
                                                        (xl - bxl, xr - bxl))
                    ys, xs = np.nonzero(alpha > 0.5)
                    name = frame_name(anim, d, i)
                    rgba = np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)
                    Image.fromarray(rgba).save(os.path.join(RAW, name + ".png"))
                    meta[name] = {
                        "sheet": f"{anim}_{part}", "box": box,
                        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                        "tile": None if tfit is None else {
                            "iou": round(float(tfit[0]), 3), "cx": float(tfit[1]), "cy": float(tfit[2]),
                            "hw": float(tfit[3]), "hh": float(tfit[4])},
                    }
                    t = meta[name]["tile"]
                    print(f"{name:14s} bbox={meta[name]['bbox']} tile="
                          f"{None if t is None else (round(t['cx'],1), round(t['cy'],1), round(t['hw'],1), round(t['hh']/t['hw'],2), t['iou'])}")
    with open(os.path.join(BUILD, "raw_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    main()
