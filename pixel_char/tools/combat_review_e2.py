"""COMBATE · Etapa 2 · Revisión de mapas: color, normal, especular, emisión e iluminado.
Iluminado 'de noche': luz ambiente muy baja + una luz puntual cálida que rodea al personaje, más la
emisión (la cuchilla brilla aunque no le llegue luz). Salida: review/combat/E2_mapas.png"""
import os

import numpy as np
from PIL import Image, ImageDraw

from combat_common import CREVIEW
from common import DIRS, OUT

COUT = os.path.join(OUT, "combat")
SEL = [("attack1", "S", 3), ("attack3", "SE", 3), ("parry", "E", 2), ("block", "SW", 3), ("dodge", "W", 2),
       ("hit", "NE", 0), ("death", "S", 5), ("attack2", "N", 3)]


def cell(an, m, d, i):
    im = Image.open(os.path.join(COUT, f"{an}_{m}.png"))
    y, x = DIRS.index(d) * 288, i * 256
    return np.asarray(im.crop((x, y, x + 256, y + 288))).astype(np.float32) / 255


def lit(col, nrm, spec, em, ang):
    n = nrm * 2 - 1
    l = np.array([np.cos(ang) * 0.7, 0.45, 0.55]); l /= np.linalg.norm(l)
    h = l + np.array([0, 0, 1.0]); h /= np.linalg.norm(h)
    nd = np.clip((n * l).sum(-1), 0, 1)[..., None]
    sp = (np.clip((n * h).sum(-1), 0, 1) ** 24)[..., None] * spec[..., None]
    rgb = col[..., :3] ** 2.2
    out = rgb * (0.05 + 0.55 * nd * np.array([1.0, 0.8, 0.6])) + sp * 0.6 * np.array([1.0, 0.85, 0.7])
    out += rgb * em[..., None] * 1.6 + em[..., None] * np.array([1.0, 0.45, 0.12]) * 0.35
    return np.clip(out, 0, 1) ** (1 / 2.2)


def main():
    rows = []
    for an, d, i in SEL:
        col = cell(an, "color", d, i); nrm = cell(an, "normal", d, i)
        spec = cell(an, "spec", d, i); em = cell(an, "emit", d, i)
        a = col[..., 3:4]
        bg = np.array([0.06, 0.07, 0.09])
        tiles = [col[..., :3] * a + bg * (1 - a), nrm, np.repeat(spec[..., None], 3, -1),
                 np.repeat(em[..., None], 3, -1) * np.array([1, 0.6, 0.2]),
                 lit(col, nrm, spec, em, 0.3) * a + np.array([0.01, 0.012, 0.02]) * (1 - a),
                 lit(col, nrm, spec, em, 2.6) * a + np.array([0.01, 0.012, 0.02]) * (1 - a)]
        rows.append(np.concatenate([(t * 255).astype(np.uint8) for t in tiles], 1))
    img = np.concatenate(rows, 0)
    im = Image.fromarray(img)
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    head = Image.new("RGB", (im.width, 24), (14, 14, 18))
    dr = ImageDraw.Draw(head)
    for k, t in enumerate(["color", "normal (OpenGL)", "especular", "emisión", "noche, luz izq.", "noche, luz der."]):
        dr.text((k * 128 + 4, 6), t, fill=(255, 255, 255))
    out = Image.new("RGB", (im.width, im.height + 24)); out.paste(head, (0, 0)); out.paste(im, (0, 24))
    out.save(os.path.join(CREVIEW, "E2_mapas.png"))


if __name__ == "__main__":
    main()
