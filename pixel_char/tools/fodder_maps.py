"""RELLENO · Etapa 1d · normal maps, especular, cabeza (para el brillo de los ojos), pies, atlas y JSON con fases.

Entrada: build/fodder/fixed (lienzo 440x320, pivote 220,280) -> recorte a la extensión real de cada criatura.
  - normal: mismo método que el personaje (normals.py), OpenGL +Y arriba
  - especular: hueso 0.30-0.45 según su luz, setas (rojo, croma alto) 0.5 (húmedas), musgo 0.05; sin emisión pintada
    (G = 0: los ojos del zombi se «encienden» en el juego con un halo sobre la cabeza, head_px)
  - head_px: centro de la parte más alta de la silueta por frame (cabeza / orejas), respecto al pivote
  - pies: garras / patas en contacto por frame (formato de feet.json) para anclarlas
  - frame IMPACT de attack en cada dirección = índice 3 (el de la hoja: IMPACT / BITE): todo el ritmo se ancla a él
Escala al mundo (en el atlas): el zombi a SCALE["zombie"] y el perro a SCALE["dog"] de la hoja completa; el juego
los dibuja a 1,05x y 0,6x la altura del personaje (W.FODDER), así que su densidad de píxeles es ~0,8 y ~1x la del
personaje (la página tiene 16 MB de tope: ver PROGRESS).
Salida:
  world/assets/fodder_<tipo>_{color,normal,spec}.png  (k = (anim*8 + dir)*6 + frame; fila = k // columnas)
  world/assets/fodder_<tipo>_atlas.json
  out/fodder/<tipo>.json  (fases por frame, correcciones, extensión)
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

import enemy_maps as EM
from common import OUT, ROOT
from enemy_maps import half as _half, lab, sm
from fodder_extract import FBUILD
from fodder_normalize import ANIMS, DIRS, FFIX, PIVOT
from normals import height_map, normal_from_height

FOUT = os.path.join(OUT, "fodder")
WASSETS = os.path.join(ROOT, "world", "assets")
os.makedirs(FOUT, exist_ok=True)
SCALE = {"zombie": 0.42, "dog": 0.36}
COLS = {"zombie": 24, "dog": 24}
# duración de cada frame (ms). attack: la preparación la gobierna el plan del juego (WINDUP exacto); desde el
# IMPACT (frame 3) hasta el final = la recuperación (zombi 1000 ms, perro 900 ms)
DUR = {
    "zombie": {"idle": [170] * 6, "walk": [150] * 6, "attack": [310, 310, 180, 120, 330, 550],
               "hit": [70, 90, 110, 110, 120, 130], "death": [110, 130, 160, 180, 220, 700]},
    "dog": {"idle": [150] * 6, "walk": [95] * 6, "attack": [210, 210, 180, 100, 300, 500],
            "hit": [60, 80, 100, 100, 110, 120], "death": [100, 120, 150, 170, 200, 700]},
}
PH = {
    "idle": (["rec"] * 6, []), "walk": (["rec"] * 6, []),
    "attack": (["prep", "prep", "prep", "activo", "rec", "rec"], [3]),
    "hit": (["activo", "rec", "rec", "rec", "rec", "rec"], [0]),
    "death": (["activo", "rec", "rec", "rec", "rec", "rec"], [0]),
}
NAMES = {"prep": "preparación (WINDUP)", "activo": "activo", "rec": "recuperación"}
LABELS = {
    "zombie": {"idle": ["NEUTRAL", "INHALE", "PEAK", "EXHALE", "SWAY", "RETURN"],
               "walk": ["CONTACT L", "DOWN L", "PASS L", "CONTACT R", "DOWN R", "PASS R"],
               "attack": ["ANTICIPATION", "WIND UP", "SWING", "IMPACT", "FOLLOW THROUGH", "RECOVERY"],
               "hit": ["IMPACT", "RECOIL", "STAGGER", "BRACE", "RECOVER", "READY"],
               "death": ["HIT", "STAGGER", "KNEES", "COLLAPSE", "DOWN", "STILL"]},
    "dog": {"idle": ["NEUTRAL", "INHALE", "PEAK", "EXHALE", "SWAY", "RETURN"],
            "walk": ["CONTACT A", "WEIGHT A", "PASS A", "CONTACT B", "WEIGHT B", "PASS B"],
            "attack": ["CROUCH", "WIND UP", "LUNGE", "BITE", "LAND", "RECOVERY"],
            "hit": ["IMPACT", "RECOIL", "STAGGER", "BRACE", "RECOVER", "READY"],
            "death": ["HIT", "STAGGER", "BUCKLE", "COLLAPSE", "DOWN", "STILL"]},
}
LOOP = {"idle": True, "walk": True}


def specular(rgba):
    al = rgba[..., 3].astype(np.float32) / 255
    L, C, H = lab(rgba[..., :3])
    shroom = sm(22, 32, C) * sm(55, 45, H)                       # setas rojas
    moss = sm(8, 14, C) * sm(80, 90, H) * sm(160, 150, H)
    bone = np.clip(1 - shroom - moss, 0, 1)
    spec = bone * (0.3 + 0.15 * sm(110, 220, L)) + shroom * 0.5 + moss * 0.05
    return np.clip(ndi.gaussian_filter(spec, 0.6) * (al > 0.02), 0, 1)


def scale_img(a, s):
    h, w = a.shape[:2]
    W_, H_ = max(1, round(w * s)), max(1, round(h * s))
    return np.stack([np.asarray(Image.fromarray(a[..., c].astype(np.float32), "F").resize((W_, H_), Image.LANCZOS))
                     for c in range(a.shape[2])], -1)


def main():
    fm = json.load(open(os.path.join(FBUILD, "fixed_meta.json")))
    for kind in ("zombie", "dog"):
        e = fm["extent_px"][kind]           # izq, der, arriba, abajo (px de hoja)
        x0, x1 = int(PIVOT[0] - e[0] - 4), int(PIVOT[0] + e[1] + 5)
        y0, y1 = int(PIVOT[1] - e[2] - 4), int(PIVOT[1] + e[3] + 5)
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(fm["canvas"][0], x1), min(fm["canvas"][1], y1)
        FW, FH = x1 - x0, y1 - y0
        PVX, PVY = PIVOT[0] - x0, PIVOT[1] - y0
        EM.PVX, EM.PVY = PVX, PVY           # boots()/feet_rec() de enemy_maps usan el pivote del módulo
        SC = SCALE[kind]; cols = COLS[kind]
        fw, fh = round(FW * SC), round(FH * SC)
        n = len(ANIMS) * 8 * 6
        rows = (n + cols - 1) // cols
        Wc = np.zeros((rows * fh, cols * fw, 4), np.float32)
        Wn = np.zeros((rows * fh, cols * fw, 3), np.float32); Wn[..., 2] = 1
        Ws = np.zeros((rows * fh, cols * fw, 3), np.float32)
        feet, heads, stand = {}, {}, []
        for ai, an in enumerate(ANIMS):
            for di, d in enumerate(DIRS):
                frames, hd = [], []
                for i in range(6):
                    rgba = np.asarray(Image.open(os.path.join(FFIX, f"{kind}_{an}_{d}_{i}.png")))[y0:y1, x0:x1].copy()
                    frames.append(rgba)
                    h, alpha = height_map(rgba)
                    nrm = normal_from_height(h, alpha)
                    spec = specular(rgba)
                    op = rgba[..., 3] > 127
                    ys, xs = np.nonzero(op)
                    top, bot = ys.min(), ys.max()
                    band = op & (np.arange(FH)[:, None] <= top + max(6, (bot - top) * 0.15))
                    yy, xx = np.nonzero(band)
                    hd.append([round(float(xx.mean() - PVX), 1), round(float(top + (bot - top) * 0.06 - PVY), 1)])
                    if an == "idle":
                        stand.append(bot - top)
                    k = (ai * 8 + di) * 6 + i
                    r, c = divmod(k, cols)
                    wy, wx = r * fh, c * fw
                    col = rgba.astype(np.float32) / 255; pm = col.copy(); pm[..., :3] *= pm[..., 3:4]
                    Wc[wy:wy + fh, wx:wx + fw] = scale_img(pm, SC)
                    nh = scale_img(nrm.astype(np.float32), SC); nh /= np.linalg.norm(nh, axis=-1, keepdims=True) + 1e-6
                    Wn[wy:wy + fh, wx:wx + fw] = nh
                    Ws[wy:wy + fh, wx:wx + fw, 0] = scale_img(spec[..., None].astype(np.float32), SC)[..., 0]
                feet[f"{an}_{d}"] = EM.feet_rec(frames, an)
                heads[f"{an}_{d}"] = hd
        c = Wc.clip(0, 1); al = c[..., 3:4]
        rgb = np.where(al > 1e-3, c[..., :3] / np.maximum(al, 1e-3), 0).clip(0, 1)
        Image.fromarray((np.dstack([rgb, al]) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(WASSETS, f"fodder_{kind}_color.png"), optimize=True)
        Image.fromarray(((Wn * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGB").save(os.path.join(WASSETS, f"fodder_{kind}_normal.png"), optimize=True)
        Image.fromarray((Ws.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(WASSETS, f"fodder_{kind}_spec.png"), optimize=True)
        standing = float(np.median(stand))
        anims = {}
        for an in ANIMS:
            fase, act = PH[an]; t = 0; fr = []
            for i in range(6):
                fr.append({"frame": i, "etiqueta": LABELS[kind][an][i], "fase": NAMES[fase[i]], "ms": DUR[kind][an][i], "t0_ms": t, "activo": i in act})
                t += DUR[kind][an][i]
            anims[an] = {"frames": fr, "total_ms": t, "loop": LOOP.get(an, False), "activo": act, "impacto": act[0] if an == "attack" else None}
        fixes = [f for f in fm["fixes"] if f["frames"].startswith(kind + "_")]
        json.dump({"frame_size_full": [FW, FH], "pivot_full": [PVX, PVY], "directions": DIRS, "standing_height_px_full": standing,
                   "impact_frame": {d: 3 for d in DIRS}, "animations": anims, "corrections": fixes,
                   "head_px_full": heads}, open(os.path.join(FOUT, f"{kind}.json"), "w"), indent=1, ensure_ascii=False)
        wm = {"frame_size": [fw, fh], "pivot": [PVX * SC, PVY * SC], "columns": cols, "atlas_size": [cols * fw, rows * fh],
              "directions": DIRS, "anims": ANIMS, "frames_per_anim": 6, "scale_from_full": SC,
              "standing_height_px": standing * SC,
              "layout": "k = (anim_index*8 + dir_index)*6 + frame; fila = k // columns, columna = k % columns",
              "spec_channels": "R = especular, G = emisión (vacía)",
              "animations": {an: {"ms": DUR[kind][an], "activo": PH[an][1], "fase": PH[an][0], "loop": LOOP.get(an, False),
                                  "etiquetas": LABELS[kind][an]} for an in ANIMS},
              "impact_frame": 3,
              "eye_px": {k: [[p[0] * SC, p[1] * SC] for p in v] for k, v in heads.items()},
              "feet": {k: {"frames": [{"feet": f["feet"], "grounded": f["grounded"], "lowest": f["lowest"]} for f in v["frames"]],
                           "contact": v["contact"], "f": v["f_screen"], "art": v["art_cycle_u"]} for k, v in feet.items()}}
        json.dump(wm, open(os.path.join(WASSETS, f"fodder_{kind}_atlas.json"), "w"), ensure_ascii=False)
        print(kind, "atlas", wm["atlas_size"], "frame", [fw, fh], "de pie", round(standing * SC, 1), "px")


if __name__ == "__main__":
    main()
