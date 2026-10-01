"""COMBATE · Etapa 2 · Normal maps, especular + emisión, hojas de sprites, atlas y JSON.

Entrada: build/combat/fixed (256x288, pivote 128,264; ya recortados, sin halo, color igualado,
escala y pivote normalizados y direcciones corregidas; ver combat_normalize.py).
Mapas por frame (mismo método que normals.py para idle/walk/run/jump):
  - normal: altura = bisel global + bisel por pieza + detalle pintado -> Sobel, OpenGL (+Y arriba)
  - especular: por material (crema/dorado alto, negro del casco muy alto, bordado bajo, tela casi nulo)
  - emisión: cuchilla, estela, chispas y fuego (combat_emission.py): brillan en la oscuridad
Salida:
  out/combat/<anim>_{color,normal,spec,emit}.png   hojas a resolución completa: 8 filas (S, SW, W, NW,
                                                   N, NE, E, SE) x 6 frames de 256x288
  out/combat/combat.json                            fases, duraciones, ventanas, pivote, etc.
  world/assets/combat_{color,normal,spec}.png       atlas a media resolución para el mundo (128x144 por
                                                   celda, 32 columnas: 4096x1728). spec: R = especular,
                                                   G = emisión
  world/assets/combat_atlas.json
"""
import json
import os

import numpy as np
from PIL import Image

from combat_common import CBUILD, CFIX, labels
from combat_emission import emission
from common import DIRS, NFRAMES, OUT, ROOT, frame_name
from normals import height_map, normal_from_height, specular_map

ANIMS = ["attack1", "attack2", "attack3", "parry", "block", "dodge", "hit", "death", "riposte", "deathblow", "heavy", "spin"]
COUT = os.path.join(OUT, "combat")
WASSETS = os.path.join(ROOT, "world", "assets")
MAPS = os.path.join(CBUILD, "maps")
for p in (COUT, MAPS):
    os.makedirs(p, exist_ok=True)

# Duración de cada frame (ms). attack3 más lento y pesado; el frame activo (impacto) algo más largo
# para que se lea; parry rápido; death se queda en el último frame.
DUR = {
    "attack1": [80, 70, 55, 70, 90, 120],
    "attack2": [80, 70, 55, 70, 90, 120],
    "attack3": [130, 120, 110, 110, 130, 170],
    "parry":   [45, 55, 70, 80, 90, 110],
    "block":   [60, 90, 90, 110, 90, 80],
    "dodge":   [45, 55, 70, 70, 70, 90],
    "hit":     [60, 70, 80, 80, 90, 100],
    "death":   [90, 110, 130, 140, 160, 400],
    # Duelo 3: contraataque rápido tras el parry (encadenable hasta 3 veces) y remate con la cuchilla clavada
    "riposte":   [40, 45, 50, 60, 80, 110],
    "deathblow": [110, 140, 90, 170, 150, 190],
    # Combate completo: HEAVY = CROUCH (preparación) → CHARGE / CHARGE MAX (carga en bucle mientras se mantiene;
    # el brillo crece por código) → RELEASE (suelta, rápida) → IMPACT (golpe) → RECOVERY (larga)
    # SPIN (remate giratorio): WIND UP, TWIST → SPIN ×2 (activos en 360°) → SLASH END → RECOVERY larga y castigable
    "heavy":     [120, 130, 130, 60, 120, 210],
    "spin":      [80, 70, 70, 70, 90, 240],
}
# frames con emisión grande (arcos de luz, carga de la cuchilla): la regla de «piezas que sobresalen» la admite
BIGEMIT = {"heavy": [1, 2, 3, 4], "spin": [2, 3, 4]}
# Fases por frame: prep = preparación, activo, rec = recuperación. "cancel" = frames en los que se
# puede cancelar (esquiva, o encadenar el siguiente ataque del combo), "chain" = ventana de encadenado.
PHASES = {
    "attack1": {"fase": ["prep", "prep", "prep", "activo", "rec", "rec"], "activo": [3],
                "cancel": {"dodge": [4, 5], "chain": [3, 4, 5]}, "next": "attack2"},
    "attack2": {"fase": ["prep", "prep", "prep", "activo", "rec", "rec"], "activo": [3],
                "cancel": {"dodge": [4, 5], "chain": [3, 4, 5]}, "next": "attack3"},
    "attack3": {"fase": ["prep", "prep", "prep", "activo", "rec", "rec"], "activo": [3],
                "cancel": {"dodge": [4, 5]}, "next": None},
    "parry":   {"fase": ["prep", "activo", "activo", "rec", "rec", "rec"], "activo": [1, 2],
                "cancel": {"attack": [4, 5], "dodge": [4, 5]}, "next": None},
    "block":   {"fase": ["prep", "activo", "activo", "activo", "activo", "rec"], "activo": [1, 2, 3, 4],
                "loop": [1, 2], "reaccion": 3, "cancel": {"release": [1, 2, 3, 4], "dodge": [1, 2, 4]}, "next": None},
    "dodge":   {"fase": ["prep", "prep", "activo", "activo", "rec", "rec"], "activo": [2, 3],
                "invulnerable": [2, 3], "cancel": {"attack": [5], "dodge": [5]}, "next": None},
    "hit":     {"fase": ["activo", "rec", "rec", "rec", "rec", "rec"], "activo": [0],
                "cancel": {"dodge": [4, 5], "attack": [5]}, "next": None},
    "death":   {"fase": ["activo", "rec", "rec", "rec", "rec", "rec"], "activo": [0],
                "cancel": {}, "hold_last": True, "next": None},
    "riposte": {"fase": ["prep", "prep", "prep", "activo", "rec", "rec"], "activo": [3],
                "cancel": {"dodge": [4, 5], "chain": [3, 4, 5]}, "next": "riposte"},
    "deathblow": {"fase": ["prep", "prep", "prep", "activo", "rec", "rec"], "activo": [3],
                  "cancel": {}, "next": None},
    "heavy": {"fase": ["prep", "carga", "carga", "prep", "activo", "rec"], "activo": [4], "carga": [1, 2],
              "cancel": {"dodge": [5], "chain": [4, 5]}, "next": None},
    "spin": {"fase": ["prep", "prep", "activo", "activo", "rec", "rec"], "activo": [2, 3], "giro360": [2, 3],
             "cancel": {}, "next": None},
}
LOOP = {"block": True}
NAMES = {"prep": "preparación", "carga": "carga (bucle)", "activo": "activo", "rec": "recuperación"}


def main():
    L = labels()
    FW, FH = 256, 288
    fm = json.load(open(os.path.join(CBUILD, "fixed_meta.json")))
    SC = 0.5
    fw, fh = int(FW * SC), int(FH * SC)
    COLS = 32
    ROWS = (len(ANIMS) * len(DIRS) * NFRAMES + COLS - 1) // COLS
    W = {"color": np.zeros((ROWS * fh, COLS * fw, 4), np.float32),
         "normal": np.zeros((ROWS * fh, COLS * fw, 3), np.float32),
         "spec": np.zeros((ROWS * fh, COLS * fw, 3), np.float32)}
    W["normal"][..., 2] = 1.0
    root = {}
    for ai, an in enumerate(ANIMS):
        sheets = {k: np.zeros((len(DIRS) * FH, NFRAMES * FW, c), np.uint8)
                  for k, c in (("color", 4), ("normal", 3), ("spec", 1), ("emit", 1))}
        sheets["normal"][..., :2] = 128; sheets["normal"][..., 2] = 255
        for di, d in enumerate(DIRS):
            fx = []
            for i in range(NFRAMES):
                n = frame_name(an, d, i)
                rgba = np.asarray(Image.open(os.path.join(CFIX, n + ".png")))
                h, alpha = height_map(rgba)
                nrm = normal_from_height(h, alpha)
                spec = specular_map(rgba)
                em = emission(rgba, big_ok=i in PHASES[an]["activo"] or an == "attack3" or i in BIGEMIT.get(an, []), arcs=an in BIGEMIT)
                # lo que brilla no tiene brillo especular propio (ya emite)
                spec = spec * (1 - em)
                y, x = di * FH, i * FW
                sheets["color"][y:y + FH, x:x + FW] = rgba
                sheets["normal"][y:y + FH, x:x + FW] = np.clip((nrm * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
                sheets["spec"][y:y + FH, x:x + FW, 0] = np.clip(spec * 255 + 0.5, 0, 255).astype(np.uint8)
                sheets["emit"][y:y + FH, x:x + FW, 0] = np.clip(em * 255 + 0.5, 0, 255).astype(np.uint8)
                # atlas del mundo a media resolución
                k = (ai * len(DIRS) + di) * NFRAMES + i
                r, c = divmod(k, COLS)
                wy, wx = r * fh, c * fw
                col = rgba.astype(np.float32) / 255
                pm = col.copy(); pm[..., :3] *= pm[..., 3:4]
                W["color"][wy:wy + fh, wx:wx + fw] = half(pm)
                nh = half(nrm.astype(np.float32))
                nh /= np.linalg.norm(nh, axis=-1, keepdims=True) + 1e-6
                W["normal"][wy:wy + fh, wx:wx + fw] = nh
                W["spec"][wy:wy + fh, wx:wx + fw, 0] = half(spec[..., None].astype(np.float32))[..., 0]
                W["spec"][wy:wy + fh, wx:wx + fw, 1] = half(em[..., None].astype(np.float32))[..., 0]
                # desplazamiento pintado de los pies respecto al pivote (movimiento raíz de la animación)
                a = rgba[..., 3] > 127
                ys, xs = np.nonzero(a)
                feet = xs[ys >= ys.max() - 14]
                fx.append(round(float(feet.mean() - 128), 1) if len(feet) else 0.0)
            root[f"{an}_{d}"] = fx
        for k, img in sheets.items():
            mode = {"color": "RGBA", "normal": "RGB", "spec": "L", "emit": "L"}[k]
            arr = img if img.shape[2] > 1 else img[..., 0]
            Image.fromarray(arr, mode).save(os.path.join(COUT, f"{an}_{k}.png"), optimize=True)
        print(an, "ok")
    # atlas del mundo
    c = W["color"].clip(0, 1)
    al = c[..., 3:4]
    rgb = np.where(al > 1e-3, c[..., :3] / np.maximum(al, 1e-3), 0).clip(0, 1)
    Image.fromarray((np.dstack([rgb, al]) * 255 + 0.5).astype(np.uint8), "RGBA").save(
        os.path.join(WASSETS, "combat_color.png"), optimize=True)
    Image.fromarray(((W["normal"] * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGB").save(
        os.path.join(WASSETS, "combat_normal.png"), optimize=True)
    Image.fromarray((W["spec"].clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(
        os.path.join(WASSETS, "combat_spec.png"), optimize=True)

    anims = {}
    for an in ANIMS:
        ph = PHASES[an]
        lab = L["animations"][an]
        dur = DUR[an]
        frames = []
        t = 0
        for i in range(NFRAMES):
            frames.append({"frame": i, "etiqueta": lab[i], "fase": NAMES[ph["fase"][i]], "ms": dur[i],
                           "t0_ms": t, "activo": i in ph["activo"],
                           "cancelable": sorted(k for k, v in ph["cancel"].items() if i in v)})
            t += dur[i]
        a = {"frames": frames, "total_ms": t, "loop": LOOP.get(an, False), "activo": ph["activo"],
             "ventanas_cancelacion": ph["cancel"], "siguiente_combo": ph["next"],
             "etiquetas": lab}
        for k in ("loop", "reaccion", "invulnerable", "hold_last", "carga", "giro360"):
            if k in ph and k != "loop":
                a[k] = ph[k]
        if "loop" in ph:
            a["loop_frames"] = ph["loop"]
        anims[an] = a
    meta = {
        "frame_size": [FW, FH], "pivot": [128, 264],
        "pivot_nota": "punto de apoyo en el suelo; mismo criterio que idle/walk (lienzo 240x272, pivote 120,250), "
                      "lienzo mayor por la cuchilla levantada de attack3",
        "directions": DIRS,
        "sheet_layout": "cada hoja <anim>_<mapa>.png: fila = dirección (orden de 'directions'), columna = frame",
        "normal_map_convention": "tangent space, OpenGL / Unity (+X right, +Y up = green up), RGB = n*0.5+0.5",
        "specular": "gris 0..1 por material", "emission": "gris 0..1: cuchilla, estela, chispas y fuego",
        "fases": "preparación / activo (IMPACT, DEFLECT/SPARK, DASH...) / recuperación; 'cancelable' = qué se "
                 "puede hacer en ese frame (dodge: esquivar; chain: encadenar el siguiente ataque; attack: atacar; "
                 "release: soltar la guardia)",
        "animations": anims,
        "root_motion_px": root,
        "root_motion_nota": "x medio de los pies respecto al pivote por frame (px de la hoja completa): "
                            "desplazamiento pintado de la estocada/retroceso",
        "corrections": fm["fixes"],
    }
    json.dump(meta, open(os.path.join(COUT, "combat.json"), "w"), indent=1, ensure_ascii=False)
    wm = {"frame_size": [fw, fh], "pivot": [64, 132], "columns": COLS, "atlas_size": [COLS * fw, ROWS * fh],
          "directions": DIRS, "anims": ANIMS, "frames_per_anim": NFRAMES, "scale_from_full": SC,
          "layout": "k = (anim_index*8 + dir_index)*6 + frame; fila = k // 32, columna = k % 32",
          "spec_channels": "R = especular, G = emisión",
          "animations": {an: {"ms": DUR[an], "activo": PHASES[an]["activo"], "cancel": PHASES[an]["cancel"],
                              "fase": PHASES[an]["fase"], "loop": LOOP.get(an, False),
                              **({"loop_frames": PHASES[an]["loop"]} if "loop" in PHASES[an] else {}),
                              **({"invulnerable": PHASES[an]["invulnerable"]} if "invulnerable" in PHASES[an] else {}),
                              **({"reaccion": PHASES[an]["reaccion"]} if "reaccion" in PHASES[an] else {}),
                              **({"carga": PHASES[an]["carga"]} if "carga" in PHASES[an] else {}),
                              **({"giro360": PHASES[an]["giro360"]} if "giro360" in PHASES[an] else {}),
                              "next": PHASES[an]["next"], "etiquetas": L["animations"][an]} for an in ANIMS},
          "root_motion_px": {k: [round(v * SC, 1) for v in vals] for k, vals in root.items()}}
    json.dump(wm, open(os.path.join(WASSETS, "combat_atlas.json"), "w"), ensure_ascii=False)
    print("atlas mundo", wm["atlas_size"])


def half(a):
    h, w = a.shape[:2]
    return np.stack([np.asarray(Image.fromarray(a[..., c], "F").resize((w // 2, h // 2), Image.LANCZOS))
                     for c in range(a.shape[2])], -1)


if __name__ == "__main__":
    main()
