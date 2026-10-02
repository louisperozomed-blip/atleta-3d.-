"""RELLENO (zombi y perro) · cuadrícula de cada hoja (ref/sheets_fodder/*.jpg).

Maquetación: título arriba, una línea de cabecera con los 6 frames («1 ANTICIPATION» o «1. CONTACT A») y los
rótulos de dirección a la izquierda («N (BACK)»). Sin líneas separadoras; cada figura sobre su baldosa.
  · filas: los rótulos de la izquierda (texto crema, 4 bloques)
  · columnas: las palabras de la cabecera agrupadas por huecos en x (6 grupos)
Límites = puntos medios entre centros.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def text_mask(a):
    lum = a.mean(2); ch = a.max(2) - a.min(2)
    return (lum > 165) & (ch < 75) & (a[..., 0] >= a[..., 2] - 5)


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
    cs = [c for c in comps(tm) if c[4] > 6]
    # rótulos de la izquierda: texto que empieza antes de x=120 bajo la cabecera
    # (las figuras claras —el perro— también parecen texto crema: los rótulos empiezan pegados al borde y son estrechos)
    left = [c for c in cs if c[0] < 100 and c[1] > 80 and c[3] <= 36 and c[0] + c[2] < 205 and c[2] < 120]
    # centrados en la misma columna (la punta de la cola del perro que asoma a la izquierda no es un rótulo)
    med = np.median([c[0] + c[2] / 2 for c in left])
    left_all = left
    left = [c for c in left if abs(c[0] + c[2] / 2 - med) <= 35]
    ys = sorted(set(y for c in left for y in range(c[1], c[1] + c[3])))
    groups = []
    for y in ys:
        if groups and y - groups[-1][-1] <= 36: groups[-1].append(y)
        else: groups.append([y])
    groups = [g for g in groups if len(g) > 8]
    assert len(groups) == 4, [(g[0], g[-1]) for g in groups]
    rowc = [(g[0] + g[-1]) / 2 for g in groups]
    # borde de la columna de rótulos: también los subtítulos largos («(BACK-RIGHT)»), cuyas letras finales quedan
    # lejos del centro (a costa de la punta de la cola del perro E, que asoma hasta ahí)
    label_right = max(c[0] + c[2] for c in left_all if c[1] >= min(r[1] for r in left) - 5)
    # cabecera: título (glifos altos) y la línea de los frames justo debajo
    title = [c for c in cs if c[1] < 45 and c[3] >= 18]
    tb = max(c[1] + c[3] for c in title) if title else 40
    head = [c for c in cs if tb - 2 <= c[1] <= tb + 70 and 5 <= c[3] <= 26 and c[0] > 100 and c[2] < 40]
    # solo la línea de la cabecera (o las dos del zombi: número y fase): centros cerca del más poblado; las
    # orejas o garras que asoman debajo no son texto
    yc = np.array([c[1] + c[3] / 2 for c in head])
    hist = np.bincount(np.round(yc).astype(int))
    y0 = int(np.argmax(np.convolve(hist, np.ones(7), "same")))
    lines = [y0]
    for c in head:
        cy = c[1] + c[3] / 2
        if 8 < y0 - cy < 26 and sum(abs(d[1] + d[3] / 2 - cy) < 5 for d in head) >= 5: lines.append(cy)
    head = [c for c in head if min(abs(c[1] + c[3] / 2 - l) for l in lines) <= 7]
    xs = sorted(head, key=lambda c: c[0])
    grp = [[xs[0]]]
    for c in xs[1:]:
        if c[0] - max(g[0] + g[2] for g in grp[-1]) > 28: grp.append([c])
        else: grp[-1].append(c)
    # «1.» separado de su palabra (hojas del perro): se une al grupo siguiente
    m = []
    for g in grp:
        if m and len(m[-1]) <= 2 and sum(c[2] for c in m[-1]) < 30 and min(c[0] for c in g) - max(c[0] + c[2] for c in m[-1]) < 60: m[-1] += g
        else: m.append(g)
    grp = [g for g in m if sum(c[4] for c in g) > 40]
    assert len(grp) == 6, [(min(c[0] for c in g), len(g)) for g in grp]
    colc = [(min(c[0] for c in g) + max(c[0] + c[2] for c in g)) / 2 for g in grp]
    head_bot = max(c[1] + c[3] for g in grp for c in g) + 3
    # columna de rótulos completa: todo el texto de las bandas de los rótulos que acaba antes de la 1.ª celda
    c0 = colc[0] - (colc[1] - colc[0]) / 2 + 12
    y0r, y1r = groups[0][0] - 5, groups[-1][-1] + 5
    lab2 = [c for c in cs if y0r <= c[1] and c[1] + c[3] <= y1r + 5 and c[3] <= 36 and c[2] < 60 and c[0] + c[2] <= c0]
    if lab2:
        label_right = max(label_right, max(c[0] + c[2] for c in lab2)); left = left + lab2
    colb = [int(max(label_right + 4, colc[0] - (colc[1] - colc[0]) / 2))] + [int((colc[i] + colc[i + 1]) / 2) for i in range(5)] + \
           [int(min(W, colc[5] + (colc[5] - colc[4]) / 2))]
    rowb = [head_bot] + [int((rowc[i] + rowc[i + 1]) / 2) for i in range(3)] + [H]
    boxes = [(c[0] - 3, c[1] - 3, c[0] + c[2] + 3, c[1] + c[3] + 3) for c in left + title + [c for g in grp for c in g]]
    return {"cols": colb, "rows": rowb, "colc": colc, "rowc": rowc, "head_bot": head_bot, "label_right": label_right,
            "text_boxes": [list(map(int, b)) for b in boxes]}


if __name__ == "__main__":
    import glob, os, sys
    from PIL import ImageDraw
    out = sys.argv[1]
    for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "ref", "sheets_fodder", "*.jpg"))):
        n = os.path.basename(f)[:-4]
        try:
            g = grid(load(f))
        except AssertionError as e:
            print(n, "FALLO", e); continue
        im = Image.open(f).convert("RGB"); d = ImageDraw.Draw(im)
        for x in g["cols"]: d.line([(x, g["head_bot"]), (x, im.height)], fill=(255, 0, 255), width=3)
        for y in g["rows"]: d.line([(g["cols"][0], y), (g["cols"][-1], y)], fill=(255, 0, 255), width=3)
        for b in g["text_boxes"]: d.rectangle(b, outline=(0, 255, 0), width=2)
        im.resize((im.width // 2, im.height // 2)).save(f"{out}/g_{n}.png")
        print(n, "cols", g["cols"], "rows", g["rows"])
