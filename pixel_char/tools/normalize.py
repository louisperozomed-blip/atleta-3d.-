"""ETAPA 1b · Normalización de escala y pivote, correcciones de dirección.

Mediciones de partida (build/raw_meta.json):
  - La baldosa gris mide lo mismo en todas las hojas (semieje ~92 px), pero el
    personaje NO: su altura de pie varía entre filas (194–226 px) y la
    posición de los pies respecto a la baldosa también (31–48 px).
  - Dentro de una fila la baldosa es muy estable (cy ±0.5 px), así que sirve
    como suelo de referencia frame a frame (conserva el bob pintado del paso y
    la altura real del salto).

Escala por fila:
  - R = radio inscrito del casco (máx. de la transformada de distancia en la
    parte superior de la silueta). Para una misma dirección es casi constante
    entre idle/walk/run, así que mide la escala de dibujo sin depender de la pose.
  - H = altura de pie (idle y walk).
  - Se iguala la altura de pie entre las 8 direcciones y dentro de cada
    dirección se reparten las diferencias entre casco y altura (media
    geométrica) para que al pasar de idle a walk no "crezca" nada.
Pivote: centro de la baldosa + desfase por fila para que los pies apoyados
caigan en el pivote (x: centro del cuerpo; y: planta del pie apoyado).
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from common import ANIMS, BUILD, DIRS, NFRAMES, frame_name

RAW = os.path.join(BUILD, "raw")
NORM = os.path.join(BUILD, "norm")
os.makedirs(NORM, exist_ok=True)

TARGET_H = 206.0     # altura de pie objetivo en px
CANVAS = (240, 272)  # ancho, alto del lienzo común
PIVOT = (120, 250)   # punto de apoyo en el suelo dentro del lienzo


def load(name):
    return np.asarray(Image.open(os.path.join(RAW, name + ".png"))).astype(np.float32)


def measures(rgba):
    a = rgba[..., 3] > 127
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max()
    dt = ndi.distance_transform_edt(a)
    z = dt.copy()
    z[top + 50:] = 0
    R = z.max()
    # centro del cuerpo: centroide de la mitad superior (casco+torso), que no
    # se ve afectado por las piernas o la capa que ondea
    upper = a.copy()
    upper[top + int((bot - top) * 0.55):] = False
    cxu = np.nonzero(upper)[1].mean()
    feet = a.copy()
    feet[:bot - 18] = False
    fyx = np.nonzero(feet)
    return dict(top=int(top), bot=int(bot), H=int(bot - top), R=float(R), cxu=float(cxu),
                feet_x=float(fyx[1].mean()),
                left=int(xs.min()), right=int(xs.max()))


def main():
    meta = json.load(open(os.path.join(BUILD, "raw_meta.json")))
    frames = {}
    M = {}
    for an in ANIMS:
        for d in DIRS:
            for i in range(NFRAMES):
                n = frame_name(an, d, i)
                frames[n] = load(n)
                M[n] = measures(frames[n])

    def row(an, d, key, fn=np.median, idx=range(NFRAMES)):
        return float(fn([M[frame_name(an, d, i)][key] for i in idx]))

    # --- escala -----------------------------------------------------------
    scale = {}
    report = {}
    for d in DIRS:
        R_ref = np.median([row(an, d, "R") for an in ("idle", "walk", "run")])
        H_ref = np.sqrt(row("idle", d, "H") * row("walk", d, "H"))
        g = TARGET_H / H_ref
        for an in ANIMS:
            if an in ("idle", "walk"):
                hn = row(an, d, "H") / H_ref
                rn = row(an, d, "R") / R_ref
                s_row = np.sqrt(hn * rn)
            elif an == "run":
                s_row = row(an, d, "R") / R_ref
            else:
                # salto: el casco se inclina y se tapa; el frame menos tapado
                # (máximo R) es el que mejor mide la escala. Se limita el ajuste.
                s_row = np.clip(row(an, d, "R", fn=np.max) / R_ref, 0.94, 1.06)
            scale[(an, d)] = g / s_row
            report[f"{an}_{d}"] = {"scale": round(g / s_row, 4)}

    # --- baldosas suavizadas ----------------------------------------------------
    # Las columnas de baldosas son comunes a las 4 filas de una hoja: patrón de
    # columna (mediana entre filas) + desfase/inclinación lineal por fila. Así el
    # ruido del ajuste de cada rombo (±1-2 px) no se convierte en temblor.
    from common import SHEET_DIRS
    for an in ANIMS:
        for p in (1, 2):
            X = np.array([[meta[frame_name(an, d, i)]["box"][0] + meta[frame_name(an, d, i)]["tile"]["cx"]
                           for i in range(NFRAMES)] for d in SHEET_DIRS[p]])
            Y = np.array([[meta[frame_name(an, d, i)]["box"][1] + meta[frame_name(an, d, i)]["tile"]["cy"]
                           for i in range(NFRAMES)] for d in SHEET_DIRS[p]])
            colpat = np.median(X, 0)
            ii = np.arange(NFRAMES)
            for r, d in enumerate(SHEET_DIRS[p]):
                kx = np.polyfit(ii, X[r] - colpat, 1)
                ky = np.polyfit(ii, Y[r], 1)
                for i in range(NFRAMES):
                    n = frame_name(an, d, i)
                    t = meta[n]["tile"]
                    t["cx"] = colpat[i] + np.polyval(kx, i) - meta[n]["box"][0]
                    t["cy"] = np.polyval(ky, i) - meta[n]["box"][1]

    # --- pivote por fila -----------------------------------------------------
    out_meta = {}
    for an in ANIMS:
        for d in DIRS:
            s = scale[(an, d)]
            names = [frame_name(an, d, i) for i in range(NFRAMES)]
            tiles = [meta[n]["tile"] for n in names]
            # suelo: planta del pie apoyado relativa al centro de la baldosa
            rel_bot = [M[n]["bot"] - t["cy"] for n, t in zip(names, tiles)]
            if an == "jump":
                grounded = [0, 5]            # impulso y aterrizaje
                dy = np.median([rel_bot[i] for i in grounded])
            elif an == "run":
                dy = np.max(rel_bot)          # el pie que apoya es el más bajo
            else:
                dy = np.percentile(rel_bot, 75)
            rel_cx = [M[n]["cxu"] - t["cx"] for n, t in zip(names, tiles)]
            # pivote x a medio camino entre torso y pies (medido en idle, donde
            # los pies están plantados) -> mismo criterio en todas las animaciones
            off_d = 0.5 * np.median([M[frame_name("idle", d, k)]["feet_x"] - M[frame_name("idle", d, k)]["cxu"]
                                     for k in range(NFRAMES)])
            dx = np.median(rel_cx) + off_d
            # idle: los pies no se mueven -> corrección residual por frame
            res_x = [0.0] * NFRAMES
            res_y = [0.0] * NFRAMES
            if an == "idle":
                fx = [M[n]["feet_x"] - t["cx"] for n, t in zip(names, tiles)]
                res_x = [f - np.median(fx) for f in fx]
                res_y = [b - np.median(rel_bot) for b in rel_bot]
            for i, n in enumerate(names):
                t = tiles[i]
                px, py = t["cx"] + dx + res_x[i], t["cy"] + dy + res_y[i]
                img = frames[n]
                # premultiplicado para remuestrear sin halos
                pm = img.copy()
                pm[..., :3] *= pm[..., 3:4] / 255.0
                Mx = np.array([[s, 0, PIVOT[0] - s * px], [0, s, PIVOT[1] - s * py]], np.float32)
                w = cv2.warpAffine(pm, Mx, CANVAS, flags=cv2.INTER_LANCZOS4,
                                   borderMode=cv2.BORDER_CONSTANT, borderValue=0)
                w = np.clip(w, 0, 255)
                al = w[..., 3:4]
                rgb = np.where(al > 0.5, w[..., :3] * 255.0 / np.maximum(al, 1e-3), 0)
                out = np.dstack([np.clip(rgb, 0, 255), al]).round().astype(np.uint8)
                out[out[..., 3] < 2] = 0
                out_meta[n] = out
    # --- correcciones de dirección -------------------------------------------
    corrections = []
    for i in range(NFRAMES):
        src = out_meta[frame_name("jump", "SE", i)]
        m = src[:, ::-1].copy()
        # el pivote está en el centro del lienzo -> el espejo lo conserva
        out_meta[frame_name("jump", "SW", i)] = m
    corrections.append("jump_SW <- espejo horizontal de jump_SE (la fila original mostraba la espalda)")
    for i in range(NFRAMES):
        n = frame_name("jump", "S", i)
        out_meta[n] = out_meta[n][:, ::-1].copy()
    corrections.append("jump_S <- espejo de sí mismo: el panel con bordado naranja estaba en el lado "
                       "contrario al de idle/walk/run S (la dirección S no cambia)")

    for n, img in out_meta.items():
        Image.fromarray(img).save(os.path.join(NORM, n + ".png"))
    json.dump({"canvas": CANVAS, "pivot": PIVOT, "target_h": TARGET_H, "rows": report,
               "corrections": corrections},
              open(os.path.join(BUILD, "norm_meta.json"), "w"), indent=1)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
