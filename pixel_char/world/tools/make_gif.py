"""Une los fotogramas de record_art.mjs en un GIF (paleta adaptativa, 15 fps).
uso: python3 make_gif.py <carpeta> <salida.gif> [escala] [cada]"""
import glob, sys
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
sc = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
every = int(sys.argv[4]) if len(sys.argv) > 4 else 1
fs = sorted(glob.glob(d + "/f*.png"))[::every]
frames = []
for f in fs:
    im = Image.open(f).convert("RGB")
    if sc != 1: im = im.resize((int(im.width * sc), int(im.height * sc)), Image.NEAREST)
    frames.append(im.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=67 * every, loop=0, optimize=True)
print(out, len(frames), "frames")
