"""Previsualización con luz (Lambert + Blinn-Phong) para revisar normal/especular."""
import sys
import numpy as np
from PIL import Image


def lit(name, ang_deg, folder_maps="../build/maps", elev=0.55):
    c = np.asarray(Image.open(f"../frames/{name}.png")).astype(np.float32) / 255
    n = np.asarray(Image.open(f"{folder_maps}/{name}_n.png")).astype(np.float32) / 255 * 2 - 1
    s = np.asarray(Image.open(f"{folder_maps}/{name}_s.png")).astype(np.float32) / 255
    a = np.radians(ang_deg)
    # luz en espacio tangente (+y arriba)
    Ld = np.array([np.cos(a), np.sin(a), elev]); Ld /= np.linalg.norm(Ld)
    ndl = np.clip((n * Ld).sum(-1), 0, 1)
    H = Ld + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
    ndh = np.clip((n * H).sum(-1), 0, 1)
    spec = s * ndh ** (8 + 40 * s)
    rgb = c[..., :3] * (0.45 + 0.9 * ndl[..., None] * np.array([1.0, 0.95, 0.85])) + spec[..., None] * 0.8
    out = np.dstack([np.clip(rgb, 0, 1), c[..., 3:]])
    return Image.fromarray((out * 255).astype(np.uint8))


if __name__ == "__main__":
    names = sys.argv[2:]
    angs = [150, 90, 30, -60]
    W, H = 240, 272
    sheet = Image.new("RGB", (W * (len(angs) + 1), H * len(names)), (255, 255, 255))
    for r, n in enumerate(names):
        c = Image.open(f"../frames/{n}.png")
        sheet.paste(c, (0, r * H), c)
        for k, a in enumerate(angs):
            im = lit(n, a)
            sheet.paste(im, ((k + 1) * W, r * H), im)
    sheet.save(sys.argv[1])
