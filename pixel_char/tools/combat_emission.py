"""Máscara de emisión (cuchilla, estela, chispas y fuego: brillan en la oscuridad).

El color no basta: tras igualar el color, el sombreado naranja de las placas de la armadura y del
bordado tiene el mismo croma, tono y luz que la cuchilla (croma 60-80, tono 46-58°, L 120-160).
Se decide por pieza (componentes conexas de "caliente" = croma > 56, tono 15-64°, L > 85):
  - se enciende si una parte SOBRESALE del cuerpo (>= 8 px fuera de una apertura de 13 px: la
    cuchilla asoma siempre por algún lado, las chispas, la estela y el fuego salen fuera), hasta
    30 px (geodésicos) desde lo que sobresale y con umbral de croma más bajo (> 42),
  - o si es muy grande (>= 500 px: la estela del tajo o el fuego delante del cuerpo), solo en los
    frames activos (big_ok): en los demás esa regla encendía restos del reborde del casco;
  - limitación: cuando el cono de la cuchilla queda pegado al brazo formando una masa gruesa (algunos
    frames de hit, dodge y death) no sobresale y no brilla;
  - el sombreado de las placas y las flores del bordado quedan dentro del cuerpo y no brillan.
Valor 0..1 = cuánto brilla (más en el núcleo claro, que se añade si toca lo que brilla).
"""
import cv2
import numpy as np
from scipy import ndimage as ndi


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def emission(rgba, big_ok=True):
    al = rgba[..., 3].astype(np.float32) / 255
    lab = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    C = np.hypot(A, B); H = np.degrees(np.arctan2(B, A))
    hot = sm(52, 60, C) * sm(10, 18, H) * sm(68, 60, H) * sm(80, 95, L) * (al > 0.3)
    warm = sm(38, 46, C) * sm(10, 18, H) * sm(68, 60, H) * sm(70, 85, L) * (al > 0.3)
    solid = al > 0.5
    # lo que sobresale del cuerpo grueso: no sobrevive a una apertura de 13 px
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)).astype(bool)
    core_body = ndi.binary_opening(solid, disk)
    depth = ndi.distance_transform_edt(~core_body)
    out = solid & (depth > 1.5)
    # 1) piezas que SOBRESALEN al menos 8 px del cuerpo grueso (punta de la cuchilla, chispas, estela);
    #    el resto del reborde rojo del casco es fino y va pegado al cuerpo (profundidad 3-4 px) y no cuenta.
    #    Umbral de croma más bajo (la cuchilla recoloreada es un cono cobrizo de croma 45-60) y se crece
    #    solo hasta 35 px (geodésicos) desde lo que sobresale, para no encender el casco que la cuchilla toca
    wm = ndi.binary_closing(warm > 0.5, np.ones((3, 3))) & (al > 0.3)
    cand = wm & out
    lb, n = ndi.label(cand)
    seed = np.zeros_like(cand)
    if n:
        dmax = ndi.maximum(depth, lb, range(1, n + 1))
        seed = np.concatenate([[False], np.asarray(dmax) >= 8])[lb] & cand
    grow = seed.copy()
    for _ in range(35):
        nxt = ndi.binary_dilation(grow) & wm
        if (nxt == grow).all():
            break
        grow = nxt
    m = grow
    # 2) piezas calientes muy grandes (estela del tajo, fuego) aunque estén delante del cuerpo
    hm = ndi.binary_closing(hot > 0.5, np.ones((3, 3))) & (al > 0.3)
    lb2, n2 = ndi.label(hm)
    if n2 and big_ok:
        sz = ndi.sum(np.ones_like(al), lb2, range(1, n2 + 1))
        m |= np.concatenate([[False], sz >= 500])[lb2]
    hot = np.maximum(hot, warm * m)
    # núcleo blanco-caliente pegado a lo que ya brilla
    core = (L > 185) & (C < 40) & solid & ndi.binary_dilation(m, iterations=3)
    m = m | core
    e = m * (0.55 + 0.45 * sm(120, 220, L)) * np.maximum(hot, core)
    return ndi.gaussian_filter(e.astype(np.float32), 0.6).clip(0, 1) * (al > 0.02)
