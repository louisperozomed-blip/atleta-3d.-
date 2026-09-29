"""ETAPA 3 · Medición del walk (6 frames × 8 direcciones) sobre los frames a resolución completa.

Primer intento (descartado): flujo óptico Farneback en la franja de pies -> daba zancadas de ~0.1 H
porque los pies se desplazan 20–40 px entre frames y el sprite pintado tiene poca textura.

Método final: seguimiento explícito de los dos pies.
  - franja de pies: 26 px por encima de la planta (pivote y=250) hasta la planta
  - los píxeles de esa franja se proyectan sobre la dirección de avance en pantalla (la del suelo con el
    achatamiento 0.64 de las hojas) y se separan en 2 grupos (k-means 1D) = pie trasero y delantero
  - separación de pies = distancia entre los dos grupos -> contactos (máx.) y pasos (mín.)
  - entre frames se emparejan los pies con el menor desplazamiento total; el pie apoyado es el que va
    hacia atrás: avance del cuerpo en ese frame = su retroceso
  - a distancia en el suelo (componente vertical / 0.64) y en alturas de personaje (206 px)
Salida: world/walk/measure.json y world/walk/measure.png
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FR = os.path.join(os.path.dirname(ROOT), "frames")
OUT = os.path.join(ROOT, "walk")
os.makedirs(OUT, exist_ok=True)
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
PVY, STAND, ISO = 250, 206.0, 0.64


def feet(img, mv):
    """Los dos zapatos: píxeles crema (claros y cálidos) en los 45 px de abajo, en 2 manchas.
    Devuelve [(posición a lo largo del avance, y más baja), ...] ordenado por posición."""
    from scipy import ndimage as ndi
    y0 = PVY - 45
    reg = img[y0:PVY + 12]
    r, g, b, al = reg[..., 0], reg[..., 1], reg[..., 2], reg[..., 3]
    lum = (r + g + b) / 3
    shoe = (al > 128) & (lum > 120) & (r > g) & (g > b) & (r - b > 40)
    shoe = ndi.binary_closing(shoe, np.ones((3, 3)))
    lab, n = ndi.label(ndi.binary_dilation(shoe, np.ones((3, 3))))
    blobs = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero((lab == k) & shoe)
        if len(xs) < 25: continue
        p = xs.mean() * mv[0] + (ys.mean() + y0) * mv[1]
        blobs.append((len(xs), p, ys.max() + y0))
    blobs = sorted(blobs, reverse=True)[:2]
    if len(blobs) == 1:
        blobs = [blobs[0], blobs[0]]
    return sorted([(p, yb) for _, p, yb in blobs])


def measure():
    """Separación de pies a lo largo de la marcha (en píxeles de pantalla del sprite) y, a partir de ella:
      - contactos: frames con separación >= mín + 60 % del rango
      - avance por frame ∝ |Δ separación| entre el frame y el siguiente (el pie apoyado retrocede lo mismo
        que se cierra/abre la separación): reparto de la duración del ciclo
      - zancada por ciclo = 2 pasos × separación en el contacto, convertida a la cámara del MUNDO:
        un avance Δ en el suelo en la dirección d se ve en pantalla con longitud Δ·f(d),
        f(d) = sqrt(sin²a + (cos a · sen EL)²), EL = atan(0.5); 1 texel = CHAR_H·cos EL / 206."""
    EL = np.arctan(0.5)
    res = {}
    for k, d in enumerate(DIRS):
        a = k * np.pi / 4
        mv = np.array([-np.sin(a), np.cos(a) * ISO]); mv /= np.linalg.norm(mv)
        F = [feet(np.asarray(Image.open(os.path.join(FR, f"walk_{d}_{i}.png"))).astype(np.float32), mv) for i in range(6)]
        sep = np.array([abs(f[1][0] - f[0][0]) for f in F])
        rng = sep.max() - sep.min()
        contact = [int(v >= sep.min() + 0.6 * rng) for v in sep]
        dsep = np.abs(np.roll(sep, -1) - sep)
        share = (dsep + 0.08 * dsep.sum() / 6) / (dsep + 0.08 * dsep.sum() / 6).sum()
        sep_contact = float(np.mean(sorted(sep)[-2:]))
        f = np.sqrt(np.sin(a) ** 2 + (np.cos(a) * np.sin(EL)) ** 2)
        stride_H = 2 * sep_contact * np.cos(EL) / STAND / f
        res[d] = {"spread": sep.round(1).tolist(), "contact": contact, "advance_share": share.round(4).tolist(),
                  "sep_contact_px": round(sep_contact, 1), "stride_H": round(float(stride_H), 3)}
        print(f"{d:3s} separación {sep.round(1)}  contactos {contact}  reparto {share.round(2)}  zancada/ciclo {stride_H:.2f} H")
    return res


def main():
    res = measure()
    json.dump(res, open(os.path.join(OUT, "measure.json"), "w"), indent=1)
    # datos para el mundo (assets/walk_variants.json)
    # Regularización (el dibujo generado no es un ciclo físicamente limpio y en diagonales los pies
    # se solapan en la proyección): media con la dirección espejo, zancada en [0.35, 0.7] H, contactos
    # medidos solo si hay 2-3 (si no, patrón 1,0,1,0,1,0), reparto 50 % medido + 50 % regla de contacto
    # (1.3 / 0.85) con un mínimo de 0.1 del ciclo por frame.
    MIR = {"S": "S", "N": "N", "E": "W", "W": "E", "NE": "NW", "NW": "NE", "SE": "SW", "SW": "SE"}
    wv = {"stride": {}, "contact": {}, "advance": {}, "spread": {}, "raw": res}
    for d in DIRS:
        st = 0.5 * (res[d]["stride_H"] + res[MIR[d]]["stride_H"])
        wv["stride"][d] = round(float(np.clip(st, 0.35, 0.7)), 3)
        c = res[d]["contact"] if sum(res[d]["contact"]) in (2, 3) else [1, 0, 1, 0, 1, 0]
        wv["contact"][d] = c
        rule = np.array([1.3 if k else 0.85 for k in c]); rule /= rule.sum()
        sh = 0.5 * np.array(res[d]["advance_share"]) + 0.5 * rule
        sh = np.maximum(sh, 0.1); sh /= sh.sum()
        wv["advance"][d] = sh.round(4).tolist()
        wv["spread"][d] = res[d]["spread"]
        print(f"{d:3s} final: zancada {wv['stride'][d]:.2f} H  contactos {c}  reparto {sh.round(2)}")
    json.dump(wv, open(os.path.join(ROOT, "assets", "walk_variants.json"), "w"))
    fnt = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    im = Image.new("RGB", (8 * 150 + 20, 300), (250, 250, 250)); dr = ImageDraw.Draw(im)
    for k, d in enumerate(DIRS):
        x0 = 10 + k * 150
        dr.text((x0, 5), d, fill=(0, 0, 0), font=fnt)
        sp, ad, ct = res[d]["spread"], res[d]["advance_share"], res[d]["contact"]
        for i in range(6):
            h = sp[i] / max(sp) * 100
            dr.rectangle([x0 + i * 22, 130 - h, x0 + i * 22 + 9, 130], fill=(200, 80, 60) if ct[i] else (90, 120, 200))
            h2 = ad[i] / max(ad) * 100
            dr.rectangle([x0 + i * 22 + 10, 250 - h2, x0 + i * 22 + 19, 250], fill=(220, 150, 60))
            dr.text((x0 + i * 22 + 4, 254), str(i), fill=(0, 0, 0), font=fnt)
        dr.text((x0, 272), f"{res[d]['stride_H']:.2f} H/ciclo", fill=(0, 0, 0), font=fnt)
    dr.text((10, 135), "separación de pies (rojo = contacto, azul = paso)   naranja: parte del ciclo que dura cada frame",
            fill=(0, 0, 0), font=fnt)
    im.save(os.path.join(OUT, "measure.png"))


if __name__ == "__main__":
    main()
