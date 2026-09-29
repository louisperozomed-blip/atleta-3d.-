"""Empaqueta el mundo en un único HTML: scripts de src/ en orden + atlas WebP en base64.

uso: python3 tools/build.py [salida.html] [--fragment salida_artifact.html]
"""
import base64, io, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ["core.js", "terrain.js", "props.js", "effects.js", "player.js", "walk.js", "character.js", "interact.js", "nav.js", "controls.js", "main.js"]


def webp(path, **kw):
    im = Image.open(path)
    if im.mode == "L": im = im.convert("RGB")
    b = io.BytesIO(); im.save(b, "WEBP", method=6, **kw)
    return "data:image/webp;base64," + base64.b64encode(b.getvalue()).decode()


def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else os.path.join(ROOT, "dist", "index.html")
    frag = args[args.index("--fragment") + 1] if "--fragment" in args else None
    os.makedirs(os.path.dirname(out), exist_ok=True)
    A = os.path.join(ROOT, "assets")
    assets = {
        "color": webp(os.path.join(A, "color.png"), quality=92, alpha_quality=100),
        "normal": webp(os.path.join(A, "normal.png"), quality=92),
        "spec": webp(os.path.join(A, "spec.png"), quality=88),
        "meta": json.load(open(os.path.join(A, "atlas.json"))),
    }
    extra = os.path.join(A, "walk_variants.json")
    if os.path.exists(extra): assets["walk"] = json.load(open(extra))
    scripts = []
    for f in ORDER:
        p = os.path.join(ROOT, "src", f)
        if os.path.exists(p):
            scripts.append(f"<script>/* {f} */\n" + open(p, encoding="utf-8").read() + "\n</script>")
    html = open(os.path.join(ROOT, "template.html"), encoding="utf-8").read()
    extra_btn = open(os.path.join(ROOT, "src", "buttons.html"), encoding="utf-8").read() if os.path.exists(os.path.join(ROOT, "src", "buttons.html")) else ""
    html = html.replace("<!--EXTRA_BUTTONS-->", extra_btn)
    html = html.replace("<!--SCRIPTS-->", "\n".join(scripts))
    html = html.replace("/*ASSETS*/null", json.dumps(assets, separators=(",", ":")))
    open(out, "w", encoding="utf-8").write(html)
    print(out, round(os.path.getsize(out) / 1e6, 2), "MB")
    if frag:
        f = html
        for pat in (r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</?head>\s*", r"<body>\s*", r"</body>\s*", r"</html>\s*",
                    r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*'):
            f = re.sub(pat, "", f, flags=re.I)
        open(frag, "w", encoding="utf-8").write(f)
        print(frag, round(os.path.getsize(frag) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
