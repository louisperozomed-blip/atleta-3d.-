"""ETAPA 3 (opcional) · Intermedios del walk con flujo óptico: 6 -> 12 frames.

Para cada par (i, i+1) de cada dirección:
  - flujo DIS de OpenCV en ambos sentidos (gris, fondo transparente rellenado con gris medio)
  - frame intermedio = mezcla de I0 deformado medio camino hacia I1 y de I1 deformado medio camino
    hacia I0 (RGBA premultiplicado)
Evaluación de fantasmas y deformaciones:
  - "fantasma": píxeles de alfa intermedio (0.15–0.85) en el interior del personaje -> dos siluetas
    semitransparentes superpuestas; se compara con los frames originales
  - "desgarro": diferencia entre I0 deformado e I1 deformado en las zonas opacas (si el flujo fuese
    correcto, ambas mitades coincidirían)
Salida: world/walk/inbetween_eval.png (tira comparativa) y walk/inbetween.json (métricas)
"""
import json, os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FR = os.path.join(os.path.dirname(ROOT), "frames")
OUT = os.path.join(ROOT, "walk")
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]


def load(d, i):
    return np.asarray(Image.open(os.path.join(FR, f"walk_{d}_{i}.png"))).astype(np.float32) / 255


def gray(im):
    g = (im[..., :3] @ np.array([0.299, 0.587, 0.114]))
    g = np.where(im[..., 3] > 0.5, g, 0.5)
    return (g * 255).astype(np.uint8)


def warp(im, flow, t):
    h, w = im.shape[:2]
    xx, yy = np.meshgrid(np.arange(w), np.arange(h))
    mx = (xx - t * flow[..., 0]).astype(np.float32)
    my = (yy - t * flow[..., 1]).astype(np.float32)
    pm = im.copy(); pm[..., :3] *= pm[..., 3:4]
    return cv2.remap(pm, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def main():
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    metrics = {}
    strips = []
    for d in DIRS:
        fr = [load(d, i) for i in range(6)]
        ghost_orig = np.mean([((f[..., 3] > 0.15) & (f[..., 3] < 0.85)).sum() / max((f[..., 3] > 0.5).sum(), 1) for f in fr])
        gs, tears = [], []
        mids = []
        for i in range(6):
            a, b = fr[i], fr[(i + 1) % 6]
            f01 = dis.calc(gray(a), gray(b), None)
            f10 = dis.calc(gray(b), gray(a), None)
            wa = warp(a, f10, -0.5)       # I0 llevado a mitad de camino (flujo en el destino, aproximado)
            wb = warp(b, f01, -0.5)
            mid = 0.5 * wa + 0.5 * wb
            al = mid[..., 3]
            core = al > 0.02
            gs.append(((al > 0.15) & (al < 0.85)).sum() / max((al > 0.5).sum(), 1))
            both = (wa[..., 3] > 0.9) & (wb[..., 3] > 0.9)
            tears.append(float(np.abs(wa[..., :3] - wb[..., :3])[both].mean()) if both.any() else 1.0)
            rgb = np.where(al[..., None] > 1e-3, mid[..., :3] / np.maximum(al[..., None], 1e-3), 0)
            mids.append(np.dstack([rgb, al]))
        metrics[d] = {"semitransparente_originales": round(float(ghost_orig), 3),
                      "semitransparente_intermedios": round(float(np.mean(gs)), 3),
                      "desacuerdo_color_medio": round(float(np.mean(tears)), 3)}
        print(d, metrics[d])
        if d in ("E", "S", "NE"):
            strips.append((d, fr, mids))
    json.dump(metrics, open(os.path.join(OUT, "inbetween.json"), "w"), indent=1)
    # tira: original i, intermedio i+½, original i+1 ... (fondo blanco)
    fnt = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    Wc, Hc = 240, 272
    im = Image.new("RGB", (12 * Wc // 2, len(strips) * (Hc // 2 + 20)), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    for r, (d, fr, mids) in enumerate(strips):
        for i in range(6):
            for j, src in enumerate((fr[i], mids[i])):
                t = Image.fromarray((src * 255).clip(0, 255).astype(np.uint8), "RGBA").resize((Wc // 2, Hc // 2), Image.LANCZOS)
                x = (2 * i + j) * Wc // 2
                im.paste(t, (x, r * (Hc // 2 + 20) + 18), t)
                dr.text((x + 4, r * (Hc // 2 + 20) + 2), f"{d} {i}" if j == 0 else f"{i}½ (flujo)", fill=(0, 0, 0) if j == 0 else (200, 40, 40), font=fnt)
    im.save(os.path.join(OUT, "inbetween_eval.png"))


if __name__ == "__main__":
    main()
