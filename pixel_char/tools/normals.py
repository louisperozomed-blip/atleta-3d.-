"""ETAPA 2 · Normal maps, máscara especular, atlas y JSON.

Altura por frame (0..1) = mezcla de:
  1. Bisel global: transformada de distancia desde el borde de la silueta con
     perfil circular (el personaje se lee como un volumen redondeado).
  2. Bisel por pieza: las líneas de contorno oscuras pintadas dentro de la
     figura (entre hombrera y brazo, casco y cuerpo…) se detectan con un
     black-top-hat y actúan como pliegues: cada pieza recibe su propio abombado.
  3. Detalle pintado: luminancia pasa-banda (diferencia de gaussianas) de las
     luces y sombras del propio dibujo (lo claro sobresale).
  Todo se suaviza (gaussiana) antes de derivar para evitar ruido.
Normal (espacio tangente, convención OpenGL/Unity: +X derecha, +Y ARRIBA / verde
hacia arriba): n = normalize(-dh/dx, +dh/dy_img, 1/fuerza).

Especular (0..1, gris):
  - crema / dorado metálico: alto (0.75–0.9)
  - negro del casco y juntas: muy alto (brillo de visera) — se separa de la
    tela negra por contexto (vecindad con metal vs. con verde/bordado) y altura
  - bordado naranja sobre tela: bajo (0.15)
  - tela verde: casi nulo (0.05)

Salida (out/): color.png, normal.png, specular.png (mismo orden de celdas) y
sprites.json con tamaño de frame, pivote, fps y orden de direcciones.
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from common import ANIMS, BUILD, DIRS, FPS, NFRAMES, OUT, ROOT, frame_name

FRAMES = os.path.join(ROOT, "frames")
NDIR = os.path.join(BUILD, "maps")
os.makedirs(NDIR, exist_ok=True)

STRENGTH = 2.2   # pendiente: mayor = relieve más marcado


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def dome(dist, radius):
    """Perfil circular: 0 en el borde, 1 a 'radius' px hacia dentro."""
    t = np.clip(dist / radius, 0, 1)
    return np.sqrt(1 - (1 - t) ** 2)


def height_map(rgba):
    alpha = rgba[..., 3].astype(np.float32) / 255
    solid = alpha > 0.5
    lab = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[..., 0] / 255.0
    # 1. bisel global
    d_out = ndi.distance_transform_edt(ndi.gaussian_filter(alpha, 1.0) > 0.5)
    h_global = dome(d_out, 16.0)
    # 2. pliegues: líneas oscuras finas dentro de la figura
    Ls = ndi.gaussian_filter(L, 0.7)
    tophat = ndi.grey_closing(Ls, size=(5, 5)) - Ls
    crease = (tophat > 0.10) & solid & (d_out > 2.5)
    crease = ndi.binary_opening(crease, structure=np.ones((1, 2))) | ndi.binary_opening(crease, structure=np.ones((2, 1)))
    d_part = ndi.distance_transform_edt(~crease & solid)
    h_part = dome(d_part, 6.0)
    # 3. detalle pintado (banda media, sin grano)
    dog = ndi.gaussian_filter(L, 1.2) - ndi.gaussian_filter(L, 6.0)
    h_detail = np.clip(dog, -0.25, 0.25)
    h = 0.55 * h_global + 0.30 * h_part + 0.55 * h_detail
    h = ndi.gaussian_filter(h, 0.9)
    h *= smoothstep(0.0, 0.5, alpha)
    return h, alpha


def normal_from_height(h, alpha):
    # Sobel normalizado (derivada en px)
    dx = ndi.sobel(h, axis=1) / 8.0
    dy = ndi.sobel(h, axis=0) / 8.0
    nx = -dx * STRENGTH * 10
    ny = dy * STRENGTH * 10          # verde hacia ARRIBA (Unity / OpenGL)
    nz = np.ones_like(h)
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # fuera de la figura: normal plana (0,0,1) -> (128,128,255)
    flat = np.array([0, 0, 1], np.float32)
    w = smoothstep(0.02, 0.35, alpha)[..., None]
    n = n * w + flat * (1 - w)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def specular_map(rgba):
    alpha = rgba[..., 3].astype(np.float32) / 255
    solid = alpha > 0.5
    lab = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    ch = np.hypot(A, B)
    warm = smoothstep(8, 16, ch) * smoothstep(1, 5, A) * smoothstep(4, 10, B)
    green = smoothstep(3, 7, -A) * smoothstep(4, 8, ch)
    black = smoothstep(14, 8, ch) * smoothstep(90, 60, L) * (1 - warm) * (1 - green)
    # bordado naranja: cálido muy saturado y de luz media, rodeado de tela
    orange = warm * smoothstep(45, 60, ch) * smoothstep(215, 190, L)

    def near(m, r):
        return ndi.gaussian_filter(m * solid, r) / np.maximum(ndi.gaussian_filter(solid.astype(np.float32), r), 1e-3)

    cloth_ctx = near(green + orange, 5.0)
    metal_ctx = near(warm * (1 - orange), 5.0)
    ys, xs = np.nonzero(solid)
    top, bot = ys.min(), ys.max()
    yrel = (np.arange(rgba.shape[0])[:, None] - top) / max(bot - top, 1)
    upper = smoothstep(0.50, 0.30, yrel) * np.ones_like(L)
    orange_is_cloth = smoothstep(0.1, 0.35, cloth_ctx)
    orange_final = orange * orange_is_cloth
    metal = warm * (1 - orange_final)
    # negro brillante (casco, juntas) vs tela negra
    black_gloss = np.clip(0.3 * upper + 1.8 * (metal_ctx - cloth_ctx) + 0.15, 0, 1)
    spec = (metal * (0.62 + 0.2 * smoothstep(150, 240, L))
            + orange_final * 0.15
            + green * 0.05
            + black * (0.12 + 0.8 * black_gloss))
    rest = np.clip(1 - (metal + orange_final + green + black), 0, 1)
    spec += rest * 0.3
    spec = ndi.gaussian_filter(spec, 0.6)
    spec = np.clip(spec, 0, 1) * (alpha > 0.02)
    return spec


def build():
    names = [(an, d, i) for an in ANIMS for d in DIRS for i in range(NFRAMES)]
    first = np.asarray(Image.open(os.path.join(FRAMES, frame_name(*names[0]) + ".png")))
    FH, FW = first.shape[:2]
    # Atlas: orden lineal anim -> dirección -> frame, 16 celdas por fila
    # (3840×3264: cabe en texturas de 4096 px, límite de iPhones antiguos)
    COLS, ROWS = 16, 12
    atlas = {k: np.zeros((ROWS * FH, COLS * FW, c), np.uint8) for k, c in (("color", 4), ("normal", 3), ("specular", 1))}
    atlas["normal"][..., 0:2] = 128
    atlas["normal"][..., 2] = 255
    rects = {}
    for an, d, i in names:
        n = frame_name(an, d, i)
        rgba = np.asarray(Image.open(os.path.join(FRAMES, n + ".png")))
        h, alpha = height_map(rgba)
        nrm = normal_from_height(h, alpha)
        spec = specular_map(rgba)
        nrgb = np.clip((nrm * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
        srgb = np.clip(spec * 255 + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(nrgb).save(os.path.join(NDIR, n + "_n.png"))
        Image.fromarray(srgb).save(os.path.join(NDIR, n + "_s.png"))
        Image.fromarray(np.clip(h * 255, 0, 255).astype(np.uint8)).save(os.path.join(NDIR, n + "_h.png"))
        ai, di = ANIMS.index(an), DIRS.index(d)
        k = (ai * len(DIRS) + di) * NFRAMES + i
        r, c = divmod(k, COLS)
        y, x = r * FH, c * FW
        atlas["color"][y:y + FH, x:x + FW] = rgba
        atlas["normal"][y:y + FH, x:x + FW] = nrgb
        atlas["specular"][y:y + FH, x:x + FW, 0] = srgb
        rects[n] = [x, y, FW, FH]
    Image.fromarray(atlas["color"], "RGBA").save(os.path.join(OUT, "color.png"), optimize=True)
    Image.fromarray(atlas["normal"], "RGB").save(os.path.join(OUT, "normal.png"), optimize=True)
    Image.fromarray(atlas["specular"][..., 0], "L").save(os.path.join(OUT, "specular.png"), optimize=True)
    nm = json.load(open(os.path.join(BUILD, "norm_meta.json")))
    meta = {
        "images": {"color": "color.png", "normal": "normal.png", "specular": "specular.png"},
        "atlas_size": [COLS * FW, ROWS * FH],
        "frame_size": [FW, FH],
        "pivot": nm["pivot"],
        "pivot_normalized_unity": [nm["pivot"][0] / FW, 1 - nm["pivot"][1] / FH],
        "pixels_per_unit_hint": nm["target_h"],
        "standing_height_px": nm["target_h"],
        "normal_map_convention": "tangent space, OpenGL / Unity (+X right, +Y up = green up), RGB = n*0.5+0.5",
        "directions": DIRS,
        "direction_angles_deg": {d: k * 45 for k, d in enumerate(DIRS)},
        "direction_note": "ángulo en pantalla medido desde S (abajo) en sentido horario: S=0, SW=45, W=90, NW=135, N=180, NE=225, E=270, SE=315",
        "animations": {an: {"fps": FPS[an], "frames": NFRAMES, "loop": an != "jump"} for an in ANIMS},
        "layout": "índice k = (anim_index*8 + dir_index)*6 + frame; fila = k // 16, columna = k % 16",
        "columns": COLS,
        "frames": rects,
        "corrections": nm["corrections"],
    }
    # altura del pie por frame (px de textura por encima del pivote; >0 = en el aire).
    # La demo la usa para sustituir la subida "pintada" del salto por una física suave.
    import json as _j
    vs = _j.load(open(os.path.join(BUILD, "verify_stats.json")))
    meta["foot_lift"] = {k: [max(0, -b) for b in v["B"]] for k, v in vs.items()}
    json.dump(meta, open(os.path.join(OUT, "sprites.json"), "w"), indent=1)
    print("atlas", meta["atlas_size"], "frame", meta["frame_size"])


if __name__ == "__main__":
    build()
