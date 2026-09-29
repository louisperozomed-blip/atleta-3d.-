"""Compone el GIF antes/después 2×2 (fila de lado y fila en diagonal) a partir de record.mjs.
uso: python3 gif_compare.py <prefijo> <salida.gif> "<título>" """
import json, sys
from PIL import Image, ImageDraw, ImageFont

prefix, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
R = json.load(open(prefix + "_frames.json"))
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
Fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
n = min(len(R[k][v]["files"]) for k in R for v in ("antes", "despues"))
W_, H_ = 320, 280
frames = []
for i in range(n):
    im = Image.new("RGB", (W_ * 2 + 12, (H_ + 22) * 2 + 34), (12, 20, 28))
    d = ImageDraw.Draw(im)
    d.text((8, 8), title, fill=(214, 243, 255), font=Fb)
    for r, name in enumerate(("lado", "diagonal")):
        for c, k in enumerate(("antes", "despues")):
            x, y = 4 + c * (W_ + 4), 34 + r * (H_ + 22)
            im.paste(Image.open(R[name][k]["files"][i]).convert("RGB"), (x, y + 20))
            s = R[name][k]["slip"]
            lab = f"{'ANTES' if k == 'antes' else 'DESPUÉS'} · {name}"
            if s: lab += f" · desliz. {s['media']:.2f} px/frame"
            d.text((x + 2, y + 2), lab, fill=(255, 210, 122) if k == "despues" else (200, 210, 220), font=F)
    frames.append(im.quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=67, loop=0, optimize=True)
# fotograma suelto de muestra
frames[n // 2].convert("RGB").save(out.replace(".gif", "_muestra.png"))
print(out, n, "frames")
