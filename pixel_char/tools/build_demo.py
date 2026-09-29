"""ETAPA 3 · Empaqueta la demo en un único HTML (texturas WebP en base64)."""
import base64
import io
import json
import os

from PIL import Image

from common import OUT, ROOT

DEMO = os.path.join(ROOT, "demo")


def webp_b64(img, **kw):
    buf = io.BytesIO()
    img.save(buf, "WEBP", method=6, **kw)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    meta = json.load(open(os.path.join(OUT, "sprites.json")))
    slim = {k: meta[k] for k in ("frame_size", "pivot", "atlas_size", "columns", "standing_height_px",
                                 "directions", "animations", "foot_lift")}
    color = webp_b64(Image.open(os.path.join(OUT, "color.png")), quality=92, alpha_quality=100)
    normal = webp_b64(Image.open(os.path.join(OUT, "normal.png")), quality=92)
    spec = webp_b64(Image.open(os.path.join(OUT, "specular.png")).convert("RGB"), quality=85)
    html = open(os.path.join(DEMO, "template.html"), encoding="utf-8").read()
    html = html.replace("/*META*/null", json.dumps(slim, separators=(",", ":")))
    html = html.replace('"/*IMG_COLOR*/"', json.dumps(color))
    html = html.replace('"/*IMG_NORMAL*/"', json.dumps(normal))
    html = html.replace('"/*IMG_SPEC*/"', json.dumps(spec))
    out = os.path.join(DEMO, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print(out, round(os.path.getsize(out) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
