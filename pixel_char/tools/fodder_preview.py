"""Vista rápida de los frames recortados (fondo gris medio, rombo de la baldosa en magenta)."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from fodder_extract import FBUILD, FRAW, ROWS


def sheet_view(n, out, src=FRAW, tiles=True):
    meta = json.load(open(os.path.join(FBUILD, "raw_meta.json")))
    kind, anim, half = n.split("_")
    cells = []
    for d in ROWS[half]:
        row = []
        for i in range(6):
            nm = f"{kind}_{anim}_{d}_{i}"
            im = Image.open(os.path.join(src, nm + ".png")).convert("RGBA")
            bgc = Image.new("RGBA", im.size, (92, 96, 92, 255)); bgc.alpha_composite(im)
            if tiles and nm in meta:
                t = meta[nm]["tile"]; dr = ImageDraw.Draw(bgc)
                cx, cy, hw, hh = t["cx"], t["cy"], t["hw"], t["hh"]
                dr.polygon([(cx - hw, cy), (cx, cy - hh), (cx + hw, cy), (cx, cy + hh)], outline=(255, 0, 255))
            row.append(bgc)
        cells.append(row)
    w = max(c.width for r in cells for c in r); h = max(c.height for r in cells for c in r)
    cs = Image.new("RGB", (w * 6, h * 4), (40, 40, 40))
    for r, row in enumerate(cells):
        for i, c in enumerate(row):
            cs.paste(c.convert("RGB"), (i * w, r * h))
    cs.save(out)


if __name__ == "__main__":
    for n in sys.argv[2:]:
        sheet_view(n, os.path.join(sys.argv[1], f"p_{n}.png"))
