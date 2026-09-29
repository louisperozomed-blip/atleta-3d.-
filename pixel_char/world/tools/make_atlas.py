"""Atlas del personaje para el mundo a media resolución (color, normal, especular).

Parte de pixel_char/out/ (atlas 3840x3264, frames 240x272). Reduce a 0.5:
- color: premultiplicado -> Lanczos -> des-premultiplicado (sin halos)
- normal: se promedian los vectores y se renormalizan (no el RGB directo)
- especular: Lanczos
Salida: world/assets/{color,normal,spec}.png y atlas.json
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), "out")
DST = os.path.join(ROOT, "assets")
SC = 0.5

meta = json.load(open(os.path.join(OUT, "sprites.json")))
W0, H0 = meta["atlas_size"]
W1, H1 = int(W0 * SC), int(H0 * SC)

def rs(a):
    return np.stack([np.asarray(Image.fromarray(a[..., c].astype(np.float32), "F").resize((W1, H1), Image.LANCZOS)) for c in range(a.shape[2])], -1)

c = np.asarray(Image.open(os.path.join(OUT, "color.png"))).astype(np.float32) / 255
pm = c.copy(); pm[..., :3] *= pm[..., 3:4]
r = rs(pm).clip(0, 1)
al = r[..., 3:4]
rgb = np.where(al > 1e-3, r[..., :3] / np.maximum(al, 1e-3), 0).clip(0, 1)
Image.fromarray((np.dstack([rgb, al]) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(DST, "color.png"))

n = np.asarray(Image.open(os.path.join(OUT, "normal.png"))).astype(np.float32) / 255 * 2 - 1
n = rs(n)
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGB").save(os.path.join(DST, "normal.png"))

s = np.asarray(Image.open(os.path.join(OUT, "specular.png"))).astype(np.float32)[..., None] / 255
s = rs(s)[..., 0].clip(0, 1)
Image.fromarray((s * 255 + 0.5).astype(np.uint8), "L").save(os.path.join(DST, "spec.png"))

m = {k: meta[k] for k in ("directions", "animations", "columns", "standing_height_px")}
m["frame_size"] = [int(meta["frame_size"][0] * SC), int(meta["frame_size"][1] * SC)]
m["pivot"] = [meta["pivot"][0] * SC, meta["pivot"][1] * SC]
m["atlas_size"] = [W1, H1]
m["standing_height_px"] = meta["standing_height_px"] * SC
m["foot_lift"] = {k: [v * SC for v in vals] for k, vals in meta["foot_lift"].items()}
m["scale_from_full"] = SC
json.dump(m, open(os.path.join(DST, "atlas.json"), "w"))
print(W1, H1, m["frame_size"], m["pivot"])
