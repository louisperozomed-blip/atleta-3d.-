"""ENEMIGO · Etapa 2 · Revisión de mapas: color, normal, especular, emisión e iluminado de noche.
Salida: review/enemy/E2_mapas.png"""
import os
import numpy as np
from PIL import Image, ImageDraw
from common import OUT, ROOT
from enemy_normalize import DIRS

EOUT = os.path.join(OUT, "enemy"); REV = os.path.join(ROOT, "review", "enemy")
FW, FH = 360, 290
SEL = [("idle", "S", 0), ("walk", "SE", 2), ("attack1", "E", 3), ("attack2", "SW", 3), ("parry", "S", 2), ("block", "W", 1), ("dodge", "S", 2), ("death", "SE", 5)]


def cell(an, m, d, i):
    im = Image.open(os.path.join(EOUT, f"{an}_{m}.png")); y, x = DIRS.index(d) * FH, i * FW
    return np.asarray(im.crop((x, y, x + FW, y + FH))).astype(np.float32) / 255


def lit(col, nrm, spec, em, ang):
    n = nrm * 2 - 1
    l = np.array([np.cos(ang) * 0.7, 0.45, 0.55]); l /= np.linalg.norm(l)
    h = l + np.array([0, 0, 1.0]); h /= np.linalg.norm(h)
    nd = np.clip((n * l).sum(-1), 0, 1)[..., None]
    sp = (np.clip((n * h).sum(-1), 0, 1) ** 20)[..., None] * spec[..., None]
    rgb = col[..., :3] ** 2.2
    out = rgb * (0.05 + 0.55 * nd * np.array([0.9, 0.95, 1.0])) + sp * 0.7 * np.array([1, 0.95, 0.85])
    out += (rgb * 1.2 + np.array([0.2, 0.9, 1.0]) * 0.6) * em[..., None]
    return np.clip(out, 0, 1) ** (1 / 2.2)


rows = []
for an, d, i in SEL:
    col = cell(an, "color", d, i); nrm = cell(an, "normal", d, i); spec = cell(an, "spec", d, i); em = cell(an, "emit", d, i)
    a = col[..., 3:4]; bg = np.array([0.06, 0.07, 0.09]); nb = np.array([0.01, 0.012, 0.02])
    t = [col[..., :3] * a + bg * (1 - a), nrm, np.repeat(spec[..., None], 3, -1), np.repeat(em[..., None], 3, -1) * np.array([0.3, 0.9, 1]),
         lit(col, nrm, spec, em, 0.3) * a + nb * (1 - a), lit(col, nrm, spec, em, 2.6) * a + nb * (1 - a)]
    rows.append(np.concatenate([(x * 255).astype(np.uint8) for x in t], 1))
im = Image.fromarray(np.concatenate(rows, 0)); im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
head = Image.new("RGB", (im.width, 24), (14, 14, 18)); dr = ImageDraw.Draw(head)
for k, t in enumerate(["color", "normal (OpenGL)", "especular", "emisión (ojo)", "noche, luz izq.", "noche, luz der."]):
    dr.text((k * 180 + 4, 6), t, fill=(255, 255, 255))
out = Image.new("RGB", (im.width, im.height + 24)); out.paste(head, (0, 0)); out.paste(im, (0, 24))
out.save(os.path.join(REV, "E2_mapas.png"))
