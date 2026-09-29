"""Construye el visor de variantes del walk (un único HTML con el atlas del walk embebido).

Atlas del walk a resolución completa: 8 direcciones × 6 frames de 240×272 (6 columnas × 8 filas).
uso: python3 walk/build_viewer.py [salida.html] [--fragment salida_artifact.html]
"""
import base64, io, json, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FR = os.path.join(os.path.dirname(ROOT), "frames")
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]


def b64(im, fmt="WEBP", **kw):
    b = io.BytesIO(); im.save(b, fmt, **kw)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(b.getvalue()).decode()


def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else os.path.join(HERE, "viewer.html")
    frag = args[args.index("--fragment") + 1] if "--fragment" in args else None
    atlas = Image.new("RGBA", (6 * 240, 8 * 272), (0, 0, 0, 0))
    for r, d in enumerate(DIRS):
        for i in range(6):
            atlas.paste(Image.open(os.path.join(FR, f"walk_{d}_{i}.png")), (i * 240, r * 272))
    data = {
        "atlas": b64(atlas, quality=92, alpha_quality=100, method=6),
        "walk": json.load(open(os.path.join(ROOT, "assets", "walk_variants.json"))),
        "measureImg": b64(Image.open(os.path.join(HERE, "measure.png")).convert("RGB"), quality=90),
        "inbImg": b64(Image.open(os.path.join(HERE, "inbetween_eval.png")).convert("RGB"), quality=88),
    }
    data["walk"].pop("raw", None)
    html = open(os.path.join(HERE, "viewer_template.html"), encoding="utf-8").read()
    html = html.replace("/*DATA*/null", json.dumps(data, separators=(",", ":")))
    open(out, "w", encoding="utf-8").write(html)
    print(out, round(os.path.getsize(out) / 1e6, 2), "MB")
    if frag:
        f = html
        for pat in (r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</?head>\s*", r"<body>\s*", r"</body>\s*", r"</html>\s*",
                    r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*'):
            f = re.sub(pat, "", f, flags=re.I)
        open(frag, "w", encoding="utf-8").write(f)


if __name__ == "__main__":
    main()
