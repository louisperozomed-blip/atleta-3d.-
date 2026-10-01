"""ENEMIGO · Etapa 2 · Normal maps, especular, emisión del ojo, pies, hojas, atlas del mundo y JSON.

Entrada: build/enemy/fixed (360x330, pivote 180,300) -> se recorta a 360x290 con pivote (180, 260).
  - normal: mismo método que el personaje (normals.py: biseles + detalle pintado, OpenGL +Y arriba)
  - especular por material: placas de metal oxidado (tono 25-75°, croma > 10) 0.45-0.8 según su luz;
    juntas y cables oscuros 0.3; musgo y raíces (tono > 75°) 0.04; ojo 0 (emite)
  - emisión: el ojo cian y su halo (brilla en la oscuridad); además su posición por frame, para colocar
    en el mundo una luz puntual cian que ilumina un poco el entorno
  - pies: garras en contacto con el suelo por frame (mismo formato que world/assets/feet.json: pies,
    pie de apoyo, en el suelo, píxel más bajo; contactos del ciclo en walk y run) para anclarlos
Salida:
  out/enemy/<anim>_{color,normal,spec,emit}.png   8 filas (S, SW, W, NW, N, NE, E, SE) x 6 frames de 360x290
  out/enemy/enemy.json
  world/assets/enemy_{color,normal,spec}.png      media resolución, celdas 180x145, 22 columnas;
                                                  spec: R = especular, G = emisión
  world/assets/enemy_atlas.json
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from common import OUT, ROOT
from enemy_extract import EBUILD, EREF
from enemy_normalize import ANIMS, DIRS, EFIX
from normals import height_map, normal_from_height

EOUT = os.path.join(OUT, "enemy")
WASSETS = os.path.join(ROOT, "world", "assets")
os.makedirs(EOUT, exist_ok=True)
Y0, Y1 = 40, 330
FW, FH = 360, Y1 - Y0
PVX, PVY = 180, 300 - Y0
SC = 0.5
COLS = 22

# duración de cada frame (ms): pesado; attack1 = zarpazo rápido, attack2 = barrido amplio (más lento)
DUR = {
    "idle": [170] * 6, "walk": [125] * 6, "run": [95] * 6,
    "attack1": [150, 140, 80, 80, 110, 160],
    "attack2": [170, 170, 110, 95, 140, 190],
    "parry": [60, 70, 90, 100, 110, 130],
    "block": [70, 110, 110, 120, 110, 90],
    "dodge": [70, 80, 90, 90, 100, 120],
    "hit": [70, 90, 110, 110, 120, 130],
    "death": [110, 130, 160, 180, 220, 700],
    # Duelo 3: desequilibrado ~0,7 s tras tu parry perfecto (CLASH, RECOIL, OFF BALANCE x2, REGAIN, READY);
    # counter = respuesta rápida a tu golpe desviado (SLASH activo a los ~220 ms)
    "deflected": [60, 100, 170, 170, 120, 90],
    "counter": [70, 80, 70, 75, 110, 140],
    # Combate completo: HEAVY = WIND UP, RAISE, HOLD (aviso largo: el juego lo sostiene), SLAM, IMPACT, RECOVERY
    "heavy": [170, 180, 260, 70, 130, 270],
}
PH = {
    "idle": (["rec"] * 6, []), "walk": (["rec"] * 6, []), "run": (["rec"] * 6, []),
    "attack1": (["prep", "prep", "prep", "activo", "rec", "rec"], [3]),
    "attack2": (["prep", "prep", "prep", "activo", "rec", "rec"], [3]),
    "parry": (["prep", "activo", "activo", "rec", "rec", "rec"], [1, 2]),
    "block": (["prep", "activo", "activo", "activo", "activo", "rec"], [1, 2, 3, 4]),
    "dodge": (["prep", "prep", "activo", "activo", "rec", "rec"], [2, 3]),
    "hit": (["activo", "rec", "rec", "rec", "rec", "rec"], [0]),
    "death": (["activo", "rec", "rec", "rec", "rec", "rec"], [0]),
    "deflected": (["activo", "rec", "rec", "rec", "rec", "rec"], [0]),
    "counter": (["prep", "prep", "prep", "activo", "rec", "rec"], [3]),
    "heavy": (["prep", "prep", "hold", "prep", "activo", "rec"], [4]),
}
NAMES = {"prep": "preparación", "hold": "retención (aviso largo)", "activo": "activo", "rec": "recuperación"}
LOOP = {"idle": True, "walk": True, "run": True}


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lab(rgb):
    l = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    A, B = l[..., 1] - 128, l[..., 2] - 128
    return l[..., 0], np.hypot(A, B), np.degrees(np.arctan2(B, A))


def eye_mask(rgba):
    rgb = rgba[..., :3].astype(np.float32)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    al = rgba[..., 3] > 100
    core = al & (B > 140) & (G > 130) & (R < 130) & (B - R > 60)
    return core


def split_cyan(rgba):
    """Ojo y estela cian (Duelo 3: la estela del SLASH de counter tiene el mismo cian que el ojo).
    Estela = piezas cian grandes (> 200 px agrupando a 2 px) o que sobresalen del cuerpo grueso; ojo = la
    pieza cian pequeña (< 200 px) con más núcleo que queda (los restos de la estela son más pequeños); así la luz del ojo no se va a la estela."""
    core = eye_mask(rgba)
    rgb = rgba[..., :3].astype(np.float32)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    al = rgba[..., 3] > 60
    cyan = al & (B > 110) & (G > 95) & (B - R > 45)
    solid = rgba[..., 3] > 127
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)).astype(bool)
    body = ndi.binary_opening(solid, disk)
    lb, n = ndi.label(ndi.binary_dilation(cyan, iterations=2))
    trail = np.zeros_like(cyan)
    eye = np.zeros_like(core)
    best = None
    for k in range(1, n + 1):
        m = (lb == k)
        cm, cc = (m & cyan), (m & core)
        out = (cm & ~ndi.binary_dilation(body, iterations=2)).sum()
        if cm.sum() > 200 or out > 25:
            trail |= cm
        elif cc.sum() >= 6:
            if best is None or cc.sum() > best[0]:
                best = (cc.sum(), cc)
    if best is not None:
        eye = best[1]
    return eye, trail


def specular(rgba, eye):
    al = rgba[..., 3].astype(np.float32) / 255
    L, C, H = lab(rgba[..., :3])
    metal = sm(8, 14, C) * sm(20, 28, H) * sm(80, 70, H)
    moss = sm(8, 14, C) * sm(72, 82, H) * sm(160, 150, H)
    dark = (1 - sm(8, 14, C)) * sm(90, 50, L)
    spec = metal * (0.45 + 0.35 * sm(60, 190, L)) + moss * 0.04 + dark * 0.3
    rest = np.clip(1 - metal - moss - dark, 0, 1)
    spec += rest * 0.2
    spec = ndi.gaussian_filter(spec, 0.6) * (1 - eye) * (al > 0.02)
    return np.clip(spec, 0, 1)


def emission(rgba, core, trail=None):
    al = rgba[..., 3].astype(np.float32) / 255
    L, C, H = lab(rgba[..., :3])
    near = ndi.binary_dilation(core, iterations=3)
    glow = near & (C > 12) & ((H < -90) | (H > 150)) & (al > 0.3)
    e = core.astype(np.float32) + glow * sm(40, 150, L) * 0.7
    if trail is not None and trail.any():
        # estela cian del zarpazo (counter): brilla entera, más en el núcleo claro
        e = np.maximum(e, trail * (0.6 + 0.4 * sm(120, 230, L)))
    return ndi.gaussian_filter(e, 0.7).clip(0, 1) * (al > 0.02)


def boots(img):
    op = img[..., 3] > 128
    H, W = op.shape
    bot = np.full(W, -1)
    for x in range(W):
        ys = np.nonzero(op[:, x])[0]
        if len(ys):
            bot[x] = ys.max()
    low = bot.max()
    cand = bot >= low - 26
    runs, cur, gap = [], [], 0
    for x in range(W):
        if cand[x]:
            cur.append(x); gap = 0
        elif cur:
            gap += 1
            if gap > 3:
                runs.append(cur); cur = []; gap = 0
    if cur:
        runs.append(cur)
    feet = []
    for r in runs:
        r = np.array(r)
        if len(r) < 5:
            continue
        yb = bot[r].max()
        base = r[bot[r] >= yb - 2]
        feet.append({"n": int(len(r)), "x": float(base.mean() - PVX), "y": float(yb - PVY)})
    feet = sorted(feet, key=lambda f: (-f["y"], -f["n"]))[:2]
    if not feet:
        feet = [{"x": 0.0, "y": 0.0, "n": 1}]
    if len(feet) == 1:
        feet = [feet[0], dict(feet[0])]
    return sorted(feet, key=lambda f: f["x"])


def feet_rec(frames, anim):
    F = [boots(f) for f in frames]
    ground = max(max(b["y"] for b in fb) for fb in F)
    ids = [[0, 1]]
    for i in range(1, 6):
        a, b = F[i - 1], F[i]
        pa = [a[ids[-1].index(0)], a[ids[-1].index(1)]]
        keep = sum(abs(pa[k]["x"] - b[k]["x"]) + abs(pa[k]["y"] - b[k]["y"]) for k in range(2))
        swap = sum(abs(pa[k]["x"] - b[1 - k]["x"]) + abs(pa[k]["y"] - b[1 - k]["y"]) for k in range(2))
        ids.append([0, 1] if keep <= swap else [1, 0])
    recs = []
    for i in range(6):
        order = [ids[i].index(0), ids[i].index(1)]
        ft = [F[i][order[0]], F[i][order[1]]]
        plant = 0 if ft[0]["y"] >= ft[1]["y"] else 1
        ys = np.nonzero((frames[i][..., 3] > 128).any(1))[0]
        recs.append({"feet": [{"x": round(f["x"], 1), "y": round(f["y"], 1)} for f in ft], "plant": plant,
                     "grounded": bool(ft[plant]["y"] >= ground - 5), "lowest": float(ys.max() - PVY)})
    rec = {"frames": recs, "ground": ground}
    if anim == "walk":
        # contactos: el frame RIGHT CONTACT (1) y LEFT CONTACT (4) de la hoja
        rec["contact"] = [1, 0, 0, 1, 0, 0]
    elif anim == "run":
        rec["contact"] = [1, 0, 0, 1, 0, 0]
    else:
        rec["contact"] = [int(r["grounded"]) for r in recs]
    rec["f_screen"] = 1.0
    rec["art_cycle_u"] = 0.0
    return rec


def half(a):
    h, w = a.shape[:2]
    return np.stack([np.asarray(Image.fromarray(a[..., c].astype(np.float32), "F").resize((w // 2, h // 2), Image.LANCZOS))
                     for c in range(a.shape[2])], -1)


def main():
    labels = json.load(open(os.path.join(EREF, "labels.json")))
    fw, fh = FW // 2, FH // 2
    ROWS = (len(ANIMS) * 8 * 6 + COLS - 1) // COLS
    Wc = np.zeros((ROWS * fh, COLS * fw, 4), np.float32)
    Wn = np.zeros((ROWS * fh, COLS * fw, 3), np.float32); Wn[..., 2] = 1
    Ws = np.zeros((ROWS * fh, COLS * fw, 3), np.float32)
    feet, eyes, stand = {}, {}, []
    for ai, an in enumerate(ANIMS):
        sheets = {k: np.zeros((8 * FH, 6 * FW, c), np.uint8) for k, c in (("color", 4), ("normal", 3), ("spec", 1), ("emit", 1))}
        sheets["normal"][..., :2] = 128; sheets["normal"][..., 2] = 255
        for di, d in enumerate(DIRS):
            frames = []
            ey = []
            for i in range(6):
                rgba = np.asarray(Image.open(os.path.join(EFIX, f"{an}_{d}_{i}.png")))[Y0:Y1].copy()
                frames.append(rgba)
                h, alpha = height_map(rgba)
                nrm = normal_from_height(h, alpha)
                # la estela cian solo existe en counter: en el resto, el ojo como siempre (mapas idénticos a los de antes)
                core, trail = split_cyan(rgba) if an == "counter" else (eye_mask(rgba), None)
                em = emission(rgba, core, trail)
                glow = core if trail is None else (core | trail)
                spec = specular(rgba, np.clip(ndi.gaussian_filter(glow.astype(np.float32), 1.5) * 3, 0, 1))
                if core.sum() >= 6:
                    yy, xx = np.nonzero(core)
                    ey.append([round(float(xx.mean() - PVX), 1), round(float(yy.mean() - PVY), 1)])
                else:
                    ey.append(None)
                if an in ("idle", "walk"):
                    ys = np.nonzero((rgba[..., 3] > 127).any(1))[0]; stand.append(ys.max() - ys.min())
                y, x = di * FH, i * FW
                sheets["color"][y:y + FH, x:x + FW] = rgba
                sheets["normal"][y:y + FH, x:x + FW] = np.clip((nrm * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
                sheets["spec"][y:y + FH, x:x + FW, 0] = np.clip(spec * 255 + 0.5, 0, 255).astype(np.uint8)
                sheets["emit"][y:y + FH, x:x + FW, 0] = np.clip(em * 255 + 0.5, 0, 255).astype(np.uint8)
                k = (ai * 8 + di) * 6 + i
                r, c = divmod(k, COLS)
                wy, wx = r * fh, c * fw
                col = rgba.astype(np.float32) / 255; pm = col.copy(); pm[..., :3] *= pm[..., 3:4]
                Wc[wy:wy + fh, wx:wx + fw] = half(pm)
                nh = half(nrm.astype(np.float32)); nh /= np.linalg.norm(nh, axis=-1, keepdims=True) + 1e-6
                Wn[wy:wy + fh, wx:wx + fw] = nh
                Ws[wy:wy + fh, wx:wx + fw, 0] = half(spec[..., None].astype(np.float32))[..., 0]
                Ws[wy:wy + fh, wx:wx + fw, 1] = half(em[..., None].astype(np.float32))[..., 0]
            if an == "counter":
                # coherencia de la fila: en las vistas de espaldas no hay ojo (un resto de estela no lo es) y un
                # ojo que salta lejos del de los demás frames es la estela
                ok = [e for e in ey if e is not None]
                if len(ok) <= 2:
                    ey = [None] * 6
                else:
                    mx, my = np.median([e[0] for e in ok]), np.median([e[1] for e in ok])
                    ey = [e if e is not None and abs(e[0] - mx) + abs(e[1] - my) < 25 else [round(float(mx), 1), round(float(my), 1)] for e in ey]
            feet[f"{an}_{d}"] = feet_rec(frames, an)
            eyes[f"{an}_{d}"] = ey
        for k, img in sheets.items():
            mode = {"color": "RGBA", "normal": "RGB", "spec": "L", "emit": "L"}[k]
            Image.fromarray(img if img.shape[2] > 1 else img[..., 0], mode).save(os.path.join(EOUT, f"{an}_{k}.png"), optimize=True)
        print(an, "ok")
    c = Wc.clip(0, 1); al = c[..., 3:4]
    rgb = np.where(al > 1e-3, c[..., :3] / np.maximum(al, 1e-3), 0).clip(0, 1)
    Image.fromarray((np.dstack([rgb, al]) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(WASSETS, "enemy_color.png"), optimize=True)
    Image.fromarray(((Wn * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGB").save(os.path.join(WASSETS, "enemy_normal.png"), optimize=True)
    Image.fromarray((Ws.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(WASSETS, "enemy_spec.png"), optimize=True)
    standing = float(np.median(stand))
    anims = {}
    for an in ANIMS:
        fase, act = PH[an]
        lab_ = labels["animations"][an]
        t = 0; frames = []
        for i in range(6):
            frames.append({"frame": i, "etiqueta": lab_[i], "fase": NAMES[fase[i]], "ms": DUR[an][i], "t0_ms": t, "activo": i in act})
            t += DUR[an][i]
        anims[an] = {"frames": frames, "total_ms": t, "loop": LOOP.get(an, False), "activo": act, "etiquetas": lab_}
    fm = json.load(open(os.path.join(EBUILD, "fixed_meta.json")))
    full = {"frame_size": [FW, FH], "pivot": [PVX, PVY], "directions": DIRS, "standing_height_px": standing,
            "sheet_layout": "cada hoja <anim>_<mapa>.png: fila = dirección (orden de 'directions'), columna = frame",
            "normal_map_convention": "tangent space, OpenGL / Unity (+X right, +Y up = green up), RGB = n*0.5+0.5",
            "specular": "gris 0..1: metal oxidado alto, juntas medio, musgo casi nulo", "emission": "gris 0..1: el ojo cian y la estela cian del counter",
            "animations": anims, "eye_px": eyes, "feet": feet, "corrections": fm["fixes"]}
    json.dump(full, open(os.path.join(EOUT, "enemy.json"), "w"), indent=1, ensure_ascii=False)
    wm = {"frame_size": [fw, fh], "pivot": [PVX * SC, PVY * SC], "columns": COLS, "atlas_size": [COLS * fw, ROWS * fh],
          "directions": DIRS, "anims": ANIMS, "frames_per_anim": 6, "scale_from_full": SC,
          "standing_height_px": standing * SC,
          "layout": "k = (anim_index*8 + dir_index)*6 + frame; fila = k // columns, columna = k % columns",
          "spec_channels": "R = especular, G = emisión (ojo)",
          "animations": {an: {"ms": DUR[an], "activo": PH[an][1], "fase": PH[an][0], "loop": LOOP.get(an, False),
                              "etiquetas": labels["animations"][an]} for an in ANIMS},
          "eye_px": {k: [None if e is None else [e[0] * SC, e[1] * SC] for e in v] for k, v in eyes.items()},
          "feet": {k: {"frames": [{"feet": fr["feet"], "grounded": fr["grounded"], "lowest": fr["lowest"]} for fr in v["frames"]],
                       "contact": v["contact"], "f": v["f_screen"], "art": v["art_cycle_u"]} for k, v in feet.items()}}
    json.dump(wm, open(os.path.join(WASSETS, "enemy_atlas.json"), "w"), ensure_ascii=False)
    print("atlas", wm["atlas_size"], "altura de pie", standing, "px")


if __name__ == "__main__":
    main()
