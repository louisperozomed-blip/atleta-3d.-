"""ENEMIGO · detección de la cuadrícula de cada hoja (ref/sheets_enemigo).

Las hojas no tienen líneas separadoras y el título va arriba a la izquierda o centrado, así que la
cuadrícula sale del propio texto crema:
  · columnas: los 6 números de la cabecera (línea de glifos pequeños con 6 componentes)
  · filas: los rótulos de dirección de la izquierda (letra grande + subtítulo), agrupados en 4 bloques
Límites de celda = puntos medios entre centros; primera fila desde debajo de la cabecera.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def text_mask(a):
    lum = a.mean(2); ch = a.max(2) - a.min(2)
    return (lum > 165) & (ch < 70) & (a[..., 0] >= a[..., 2] - 5)


def comps(m):
    lab, n = ndi.label(m)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        ys, xs = sl
        out.append((xs.start, ys.start, xs.stop - xs.start, ys.stop - ys.start, int((lab[sl] == i).sum())))
    return out


def grid(a):
    H, W = a.shape[:2]
    tm = text_mask(a)
    # --- rótulos de la izquierda -> filas
    left = tm.copy(); left[:, 185:] = False; left[:95] = False
    cs = [c for c in comps(left) if c[4] > 8]
    ys = sorted(set(y for c in cs for y in range(c[1], c[1] + c[3])))
    groups = []
    for y in ys:
        if groups and y - groups[-1][-1] <= 30:
            groups[-1].append(y)
        else:
            groups.append([y])
    groups = [g for g in groups if len(g) > 10]
    assert len(groups) == 4, [(g[0], g[-1]) for g in groups]
    rowc = [(g[0] + g[-1]) / 2 for g in groups]
    label_right = max(c[0] + c[2] for c in cs)
    # --- números de la cabecera -> columnas
    top = tm.copy(); top[140:] = False; top[:, :label_right - 20 if label_right < 240 else 170] = False
    cs = [c for c in comps(top) if 7 <= c[3] <= 26 and c[2] <= 26 and c[4] > 12]
    lines = {}
    for c in cs:
        k = round((c[1] + c[3]) / 6)
        lines.setdefault(k, []).append(c)
    # la línea de los números: la más alta con 6 componentes bien espaciadas
    cand = []
    for k, L in lines.items():
        L2 = [c for c in cs if abs((c[1] + c[3]) - k * 6) <= 5]
        xs = sorted(c[0] + c[2] / 2 for c in L2)
        # fusiona glifos pegados (p. ej. un número de dos trazos)
        mx = []
        for x in xs:
            if mx and x - mx[-1] < 40: mx[-1] = (mx[-1] + x) / 2
            else: mx.append(x)
        if len(mx) == 6 and np.std(np.diff(mx)) < 25:
            cand.append((min(c[1] for c in L2), mx, max(c[1] + c[3] for c in L2)))
    assert cand, "sin línea de números"
    cand.sort()
    num_y, colc, num_bot = cand[0]
    # fondo de la cabecera: la última línea de texto por encima de la primera figura (etiquetas de fase)
    # línea de etiquetas de fase: glifos de texto (alto 7-20 px) que empiezan justo bajo los números
    lab_lines = [c for c in comps(tm[:170]) if num_bot - 2 <= c[1] <= num_bot + 22 and 6 <= c[3] <= 20 and c[2] <= 22 and c[4] > 6 and c[0] > 170]
    head_bot = (max(c[1] + c[3] for c in lab_lines) if lab_lines else num_bot) + 3
    colb = [int(colc[0] - (colc[1] - colc[0]) / 2)] + [int((colc[i] + colc[i + 1]) / 2) for i in range(5)] + \
           [int(min(W, colc[5] + (colc[5] - colc[4]) / 2))]
    rowb = [head_bot] + [int((rowc[i] + rowc[i + 1]) / 2) for i in range(3)] + [H]
    return {"cols": colb, "rows": rowb, "colc": colc, "rowc": rowc, "num_y": num_y, "head_bot": head_bot,
            "label_right": label_right}


if __name__ == "__main__":
    import glob, json, os, sys
    from PIL import ImageDraw
    out = sys.argv[1]
    res = {}
    for f in sorted(glob.glob("../ref/sheets_enemigo/*.png")):
        n = os.path.basename(f)[:-4]
        a = load(f)
        try:
            g = grid(a)
        except AssertionError as e:
            print(n, "FALLO", e); continue
        res[n] = g
        im = Image.open(f).convert("RGB"); d = ImageDraw.Draw(im)
        for x in g["cols"]: d.line([(x, g["head_bot"]), (x, im.height)], fill=(255, 0, 255), width=2)
        for y in g["rows"]: d.line([(g["cols"][0], y), (g["cols"][-1], y)], fill=(255, 0, 255), width=2)
        im.resize((im.width // 3, im.height // 3)).save(f"{out}/g_{n}.png")
        print(n, "cols", g["cols"], "rows", g["rows"])
    json.dump(res, open(f"{out}/grids.json", "w"))
