"""Hojas de contacto de revisión: todos los frames sobre un color de fondo.

uso: python3 contact.py <carpeta_frames> <salida_prefijo> [escala]
Genera <prefijo>_white.png y <prefijo>_magenta.png (filas = anim×dir, 6 columnas)
"""
import os
import sys

from PIL import Image, ImageDraw

from common import ANIMS, DIRS, NFRAMES, frame_name


def contact(folder, prefix, scale=1.0, bgs=(("white", (255, 255, 255)), ("magenta", (255, 0, 255))),
            anims=ANIMS, guides=False, meta=None):
    frames = {}
    cw = ch = 0
    for an in anims:
        for d in DIRS:
            for i in range(NFRAMES):
                n = frame_name(an, d, i)
                im = Image.open(os.path.join(folder, n + ".png")).convert("RGBA")
                if scale != 1:
                    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
                frames[n] = im
                cw, ch = max(cw, im.width), max(ch, im.height)
    lab = 70
    out = []
    for bname, bcol in bgs:
        W = lab + NFRAMES * (cw + 4)
        H = len(anims) * len(DIRS) * (ch + 4)
        sheet = Image.new("RGB", (W, H), bcol)
        dr = ImageDraw.Draw(sheet)
        tc = (0, 0, 0) if bname != "black" else (255, 255, 255)
        r = 0
        for an in anims:
            for d in DIRS:
                y = r * (ch + 4)
                dr.text((4, y + ch // 2 - 6), f"{an}\n{d}", fill=tc)
                for i in range(NFRAMES):
                    im = frames[frame_name(an, d, i)]
                    x = lab + i * (cw + 4)
                    sheet.paste(im, (x, y), im)
                    if guides and meta is not None:
                        px, py = meta["pivot"]
                        px, py = px * scale, py * scale
                        dr.line([(x + px - 6, y + py), (x + px + 6, y + py)], fill=(0, 160, 255))
                        dr.line([(x + px, y + py - 6), (x + px, y + py + 6)], fill=(0, 160, 255))
                r += 1
        p = f"{prefix}_{bname}.png"
        sheet.save(p)
        out.append(p)
    return out


if __name__ == "__main__":
    print(contact(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0))
