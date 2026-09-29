"""Pinta la textura de la cara (ojos, cejas, nariz, boca) con PIL, supermuestreada.

Uso: python3 scripts/face_paint.py  ->  export/face_paint.png (384 x 384)
v3: una sola proyección frontal de la cara: x ∈ [-0.08, 0.08] m (izquierda→derecha de la vista
FRONT) y z ∈ [1.48, 1.64] m (abajo→arriba). build_model.py asigna estas UV planas a las caras
frontales de la cabeza, así los rasgos se pintan sobre la propia geometría facetada.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4                                     # supermuestreo

SKIN = (222, 138, 74)                      # tono base de la piel (PALETTE['skin'])
LID = (40, 22, 18)
IRIS = (122, 60, 28)
IRIS_DARK = (74, 34, 18)
PUPIL = (30, 16, 12)
SCLERA = (246, 238, 230)
BROW = (72, 36, 22)
CREASE = (190, 108, 56)
LIP = (118, 50, 38)
SHADOW = (196, 112, 58)

FACE_X0, FACE_X1, FACE_Z0, FACE_Z1 = -0.08, 0.08, 1.48, 1.64
TEX = 384
EYE_W, EYE_H = 0.062, 0.074
EYE_SCALE = 1.14      # v3 iter: ojos un 14 % más grandes (ref)
MOUTH_W, MOUTH_H = 0.050, 0.050


def rect_for(cx, cz, w, h):
    """Rectángulo en píxeles de un parche centrado en (cx, cz) metros dentro de la textura de cara."""
    sx = TEX / (FACE_X1 - FACE_X0)
    sz = TEX / (FACE_Z1 - FACE_Z0)
    x0 = (cx - w / 2 - FACE_X0) * sx
    x1 = (cx + w / 2 - FACE_X0) * sx
    y0 = (FACE_Z1 - (cz + h / 2)) * sz
    y1 = (FACE_Z1 - (cz - h / 2)) * sz
    return (x0, y0, x1, y1)


RECTS = {'eye_l': rect_for(0.040, 1.575, EYE_W, EYE_H), 'eye_r': rect_for(-0.040, 1.575, EYE_W, EYE_H),
         'mouth': rect_for(0.0, 1.521, MOUTH_W, MOUTH_H)}


def to_px(rect, w, h, pts, flip_x=False, scale=1.0):
    x0, y0, x1, y1 = rect
    out = []
    for e, f in pts:
        e, f = e * scale, f * scale
        if flip_x:
            e = -e
        u = (e / w + 0.5) * (x1 - x0) + x0
        v = (0.5 - f / h) * (y1 - y0) + y0
        out.append((u * SS, v * SS))
    return out


def ellipse(cx, cy, rx, ry, n=40):
    import math
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def thick_line(pts, t0, t1):
    """Polígono de una línea con grosor variable (t0 al inicio, t1 al final)."""
    import math
    left, right = [], []
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        t = t0 + (t1 - t0) * i / max(n - 1, 1)
        left.append((x + nx * t / 2, y + ny * t / 2))
        right.append((x - nx * t / 2, y - ny * t / 2))
    return left + right[::-1]


def paint_eye(dr, rect, flip):
    """Ojo almendrado estilo anime. e = hacia fuera (sien), f = hacia arriba; metros."""
    P = lambda pts: to_px(rect, EYE_W, EYE_H, pts, flip, EYE_SCALE)  # noqa: E731
    # el centro del ojo está 0.004 m por debajo del centro del parche
    oy = -0.004
    upper = [(-0.0175, 0.0005 + oy), (-0.011, 0.0075 + oy), (-0.002, 0.0100 + oy), (0.008, 0.0098 + oy),
             (0.0165, 0.0065 + oy), (0.0200, 0.0030 + oy)]
    lower = [(0.0180, -0.0010 + oy), (0.0120, -0.0075 + oy), (0.0000, -0.0098 + oy), (-0.0110, -0.0075 + oy)]
    sclera = upper + lower
    # pliegue del párpado
    dr.polygon(P(thick_line([(-0.013, 0.0130 + oy), (-0.002, 0.0158 + oy), (0.010, 0.0152 + oy), (0.018, 0.0110 + oy)],
                            0.0010, 0.0016)), fill=CREASE)
    dr.polygon(P(sclera), fill=SCLERA)
    # iris grande (recortado por el blanco): se pinta en una capa y se enmascara
    return sclera, upper, lower, oy


def eye_layers(img, rect, flip):
    dr = ImageDraw.Draw(img)
    sclera, upper, lower, oy = paint_eye(dr, rect, flip)
    P = lambda pts: to_px(rect, EYE_W, EYE_H, pts, flip, EYE_SCALE)  # noqa: E731
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).polygon(P(sclera), fill=255)
    layer = Image.new('RGB', img.size, SCLERA)
    ld = ImageDraw.Draw(layer)
    ld.polygon(P(ellipse(0.0005, 0.0005 + oy, 0.0088, 0.0112)), fill=IRIS)
    ld.polygon(P(ellipse(0.0005, 0.0045 + oy, 0.0088, 0.0070)), fill=IRIS_DARK)   # sombra del párpado
    ld.polygon(P(ellipse(0.0005, 0.0000 + oy, 0.0040, 0.0058)), fill=PUPIL)
    ld.polygon(P(ellipse(0.0045, 0.0045 + oy, 0.0024, 0.0026)), fill=(255, 255, 255))
    ld.polygon(P(ellipse(-0.0030, -0.0045 + oy, 0.0011, 0.0011)), fill=(255, 255, 255))
    img.paste(layer, (0, 0), mask)
    # párpado superior grueso y oscuro con pestañas marcadas en el extremo exterior
    lid = upper + [(0.0265, 0.0070 + oy)]
    dr.polygon(P(thick_line(lid, 0.0020, 0.0042)), fill=LID)
    dr.polygon(P(thick_line([(0.0170, 0.0060 + oy), (0.0240, 0.0110 + oy)], 0.0022, 0.0008)), fill=LID)
    dr.polygon(P(thick_line([(0.0185, 0.0035 + oy), (0.0275, 0.0035 + oy)], 0.0020, 0.0006)), fill=LID)
    # párpado inferior fino
    dr.polygon(P(thick_line(lower[1:], 0.0010, 0.0014)), fill=IRIS_DARK)
    # ceja gruesa, recta, algo más baja hacia el centro (expresión decidida)
    brow = [(-0.0170, 0.0190), (-0.0060, 0.0215), (0.0080, 0.0240), (0.0220, 0.0250), (0.0270, 0.0230)]
    dr.polygon(P(thick_line(brow, 0.0060, 0.0036)), fill=BROW)


def paint_mouth(img, rect):
    dr = ImageDraw.Draw(img)
    P = lambda pts: to_px(rect, MOUTH_W, MOUTH_H, pts)  # noqa: E731
    # el parche está centrado en z = 1.521; nariz arriba, boca abajo (metros relativos)
    nose = [(-0.0080, 0.0110), (-0.0035, 0.0078), (0.0000, 0.0068), (0.0035, 0.0078), (0.0080, 0.0110),
            (0.0045, 0.0092), (0.0000, 0.0090), (-0.0045, 0.0092)]
    dr.polygon(P(nose), fill=SHADOW)
    # sombra lateral de la nariz (luz desde la izquierda de la imagen) y punta facetada
    dr.polygon(P([(0.0020, 0.0240), (0.0065, 0.0120), (0.0060, 0.0095), (0.0010, 0.0140)]), fill=SHADOW)
    for sx in (-1, 1):
        dr.polygon(P(ellipse(0.0036 * sx, 0.0093, 0.0014, 0.0008, 12)), fill=(150, 80, 45))
    dr.polygon(P(thick_line([(-0.0135, -0.0120), (-0.0060, -0.0112), (0.0000, -0.0110), (0.0060, -0.0112),
                             (0.0135, -0.0120)], 0.0024, 0.0024)), fill=LIP)
    dr.polygon(P(thick_line([(-0.0070, -0.0165), (0.0000, -0.0170), (0.0070, -0.0165)], 0.0022, 0.0022)), fill=SHADOW)


def main():
    W, H = TEX, TEX
    img = Image.new('RGB', (W * SS, H * SS), SKIN)
    eye_layers(img, RECTS['eye_l'], flip=False)
    eye_layers(img, RECTS['eye_r'], flip=True)
    paint_mouth(img, RECTS['mouth'])
    img = img.resize((W, H), Image.LANCZOS)
    out = os.path.join(ROOT, 'export', 'face_paint.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print(out)


if __name__ == '__main__':
    main()
