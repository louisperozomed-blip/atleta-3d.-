"""Hojas de contacto de los frames de combate (8 direcciones x 6 frames por animación)."""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

from common import DIRS, NFRAMES

ORDER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def grid(src, anim, out, cell=(150, 150), bg=(90, 60, 90), dirs=ORDER, notes=None, meta=None, scale=0.5,
         anchor=(0.5, 0.86)):
    """meta: {frame: {"box":..., "tile":{cx,cy}}} -> todos a la misma escala, anclados en el centro
    de la baldosa (así se ve el tamaño real de cada frame). Sin meta: lienzos normalizados."""
    cw, chh = cell
    im = Image.new("RGB", (40 + cw * NFRAMES, 20 + chh * len(dirs)), (20, 20, 24))
    d = ImageDraw.Draw(im)
    d.text((4, 4), anim, fill=(255, 255, 255))
    for r, dr in enumerate(dirs):
        d.text((6, 20 + r * chh + chh // 2), dr, fill=(255, 255, 200))
        for i in range(NFRAMES):
            p = os.path.join(src, f"{anim}_{dr}_{i}.png")
            x0, y0 = 40 + i * cw, 20 + r * chh
            tile = Image.new("RGBA", (cw - 2, chh - 2), bg + (255,))
            if os.path.exists(p):
                f = Image.open(p).convert("RGBA")
                n = f"{anim}_{dr}_{i}"
                if meta is not None and n in meta and meta[n].get("tile"):
                    t = meta[n]["tile"]; ax, ay = t["cx"], t["cy"]
                else:
                    ax, ay = f.width / 2, f.height * 0.92
                f = f.resize((max(1, int(f.width * scale)), max(1, int(f.height * scale))), Image.LANCZOS)
                ox = int(tile.width * anchor[0] - ax * scale); oy = int(tile.height * anchor[1] - ay * scale)
                layer = Image.new("RGBA", tile.size, (0, 0, 0, 0))
                layer.paste(f, (ox, oy))
                tile.alpha_composite(layer)
            im.paste(tile.convert("RGB"), (x0, y0))
            if notes and (dr, i) in notes:
                col, txt = notes[(dr, i)]
                d.rectangle([x0, y0, x0 + cw - 3, y0 + chh - 3], outline=col, width=3)
                d.text((x0 + 4, y0 + 3), txt, fill=col)
    im.save(out)
    return im


if __name__ == "__main__":
    import json
    src, out = sys.argv[1], sys.argv[2]
    mp = os.path.join(os.path.dirname(src.rstrip("/")), "raw_meta.json")
    meta = json.load(open(mp)) if os.path.exists(mp) and src.rstrip("/").endswith("raw") else None
    for a in sys.argv[3:]:
        grid(src, a, os.path.join(out, f"{a}.png"), meta=meta, scale=0.5 if meta else 0.55)
