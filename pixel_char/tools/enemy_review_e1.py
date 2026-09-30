"""ENEMIGO · Etapa 1 · Hojas de revisión: problemas marcados ((a) corregido con código, (b) regenerar),
antes/después, color y tamaño. Salida en review/enemy/:
  E1_<anim>.png      antes (recorte original sin corregir) | después (color, pivote y direcciones)
  E1_color.png       antes/después del color por zonas, junto a la referencia (walk)
  E1_tamano.png      siluetas superpuestas contra idle y grosor de piernas por hoja
  E1_revision.json   lista de problemas y de lo que hay que regenerar
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

from combat_contact import grid
from common import ROOT
from enemy_extract import EBUILD, ERAW
from enemy_normalize import ANIMS, EFIX, MIRROR, warp

REV = os.path.join(ROOT, "review", "enemy")
os.makedirs(REV, exist_ok=True)
A, B = (255, 170, 40), (255, 60, 90)
D8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def problems():
    P = []
    for an, d, san, sd, _, kind, why in MIRROR:
        P.append({"anim": an, "dirs": [d], "frames": list(range(6)), "tipo": kind, "problema": why, "arreglo": f"espejo horizontal de {san} {sd}"})
    P.append({"anim": "hit", "dirs": ["N"], "frames": [4, 5], "tipo": "b", "problema": "hit_1 N: RECOVER y READY de frente (se ve el ojo)",
              "arreglo": "provisional: STAGGER sostenido y READY = idle N reposo; regenerar la fila N de hit"})
    P.append({"anim": "hit", "dirs": ["NE", "E", "SE"], "frames": list(range(6)), "tipo": "b",
              "problema": "hit_1 entera no coincide con sus direcciones y tiene otro estilo (piezas más claras y redondas)",
              "arreglo": "corregido con espejos de hit_2; regenerar hit_1 si se quiere la animación propia de esas direcciones"})
    for an in ("attack1", "attack2", "parry"):
        P.append({"anim": an, "dirs": D8, "frames": list(range(6)), "tipo": "a",
                  "problema": "más naranja y saturado (croma 35-39 frente a 28), musgo amarillento (tono 82-84°): parece menos musgo",
                  "arreglo": "color por zonas: tono por cuantiles (el musgo vuelve a verde), croma por familia, luz al 75 %"})
    for an in ("hit", "block", "dodge", "death"):
        P.append({"anim": an, "dirs": D8, "frames": list(range(6)), "tipo": "a",
                  "problema": "más pálido y gris (croma 22-25; death además oscuro, L 53-56 frente a 70)",
                  "arreglo": "color por zonas hacia idle/walk/run"})
    P.append({"anim": "block", "dirs": D8, "frames": list(range(6)), "tipo": "b",
              "problema": "hit_2, block, dodge y death tienen el ojo más pequeño (0.068 frente a 0.099 del ancho de baldosa)",
              "arreglo": "diferencia de diseño; a la escala del juego apenas se nota. Regenerar si se quiere exacto"})
    P.append({"anim": "walk", "dirs": ["NE"], "frames": [2, 5], "tipo": "b",
              "problema": "walk NE frames 3 y 6: la cabeza gira y deja ver el ojo en una vista de espaldas", "arreglo": "leve; se deja"})
    P.append({"anim": "idle", "dirs": ["N", "NE"], "frames": [2], "tipo": "a",
              "problema": "idle N/NE frame 3 (PEAK): gira la cabeza y enseña el ojo", "arreglo": "es un gesto de mirar alrededor coherente con la pose; se deja"})
    return P


def notes_for(an, P):
    n = {}
    for p in P:
        if p["anim"] != an:
            continue
        for d in p["dirs"]:
            for i in p["frames"]:
                col = A if p["tipo"].startswith("a") else B
                if (d, i) in n and n[(d, i)][0] == B:
                    continue
                n[(d, i)] = (col, p["tipo"][0])
    return n


def before(tmp):
    """Antes: el recorte original (sin color ni correcciones de dirección), colocado por su baldosa."""
    fm = json.load(open(os.path.join(EBUILD, "fixed_meta.json")))
    os.makedirs(tmp, exist_ok=True)
    for n, (px, py) in fm["pivots"].items():
        img = np.asarray(Image.open(os.path.join(ERAW, n + ".png"))).astype(np.float32)
        Image.fromarray(warp(img, 1.0, px, py)).save(os.path.join(tmp, n + ".png"))


def main():
    P = problems()
    tmp = os.path.join(EBUILD, "before")
    before(tmp)
    for an in ANIMS:
        mine = [p for p in P if p["anim"] == an]
        kw = dict(scale=0.44, cell=(160, 150), anchor=(0.5, 0.93), dirs=D8)
        g1 = grid(tmp, an, os.path.join(tmp, "_a.png"), notes=notes_for(an, P), **kw)
        g2 = grid(EFIX, an, os.path.join(tmp, "_b.png"), **kw)
        im = Image.new("RGB", (g1.width + g2.width + 10, g1.height + 50 + 30 * len(mine) + 10), (14, 14, 18))
        im.paste(g1, (0, 50)); im.paste(g2, (g1.width + 10, 50))
        d = ImageDraw.Draw(im)
        d.text((10, 8), f"{an.upper()} - ANTES (recorte original)", fill=(255, 255, 255))
        d.text((g1.width + 20, 8), "DESPUES (color por zonas, pivote en los pies, direcciones corregidas)", fill=(255, 255, 255))
        d.text((10, 28), "marco naranja = (a) corregido con codigo  |  marco rojo = (b) regenerar", fill=(255, 200, 120))
        y = g1.height + 60
        for p in mine:
            col = A if p["tipo"].startswith("a") else B
            fr = ",".join(str(i + 1) for i in p["frames"])
            d.text((10, y), f"({p['tipo']}) {'/'.join(p['dirs'])} frames {fr}: {p['problema']}", fill=col)
            d.text((30, y + 13), f"-> {p['arreglo']}", fill=(200, 200, 200)); y += 30
        im.save(os.path.join(REV, f"E1_{an}.png"))
    # color
    sel = [("walk", "S", 0), ("attack1", "S", 0), ("attack2", "E", 1), ("parry", "SE", 0), ("hit", "SW", 4), ("block", "SE", 1), ("dodge", "S", 0), ("death", "S", 0)]
    cw, ch = 210, 250
    im = Image.new("RGB", (cw * len(sel), 2 * ch + 44), (14, 14, 18)); d = ImageDraw.Draw(im)
    d.text((6, 4), "arriba: ANTES   abajo: DESPUES   (walk = referencia, no se toca)", fill=(255, 220, 160))
    for j, (a, dr, f) in enumerate(sel):
        d.text((j * cw + 6, 22), f"{a} {dr} f{f + 1}", fill=(255, 255, 255))
        for r, src in enumerate((tmp, EFIX)):
            fr = Image.open(os.path.join(src, f"{a}_{dr}_{f}.png")).convert("RGBA")
            bb = fr.getbbox(); fr = fr.crop(bb); s = min((cw - 8) / fr.width, (ch - 8) / fr.height)
            fr = fr.resize((int(fr.width * s), int(fr.height * s)), Image.LANCZOS)
            t = Image.new("RGBA", (cw - 2, ch - 2), (32, 36, 42, 255)); t.alpha_composite(fr, ((cw - 2 - fr.width) // 2, ch - 2 - fr.height))
            im.paste(t.convert("RGB"), (j * cw, 40 + r * ch))
    im.save(os.path.join(REV, "E1_color.png"))
    # tamaño: siluetas contra idle
    tiles = []
    for an, dr, f in (("walk", "S", 0), ("attack1", "S", 5), ("block", "S", 1), ("dodge", "S", 5), ("death", "S", 0), ("hit", "S", 5)):
        idle = np.asarray(Image.open(os.path.join(EFIX, f"idle_{dr}_0.png")))[..., 3] > 127
        m = np.asarray(Image.open(os.path.join(EFIX, f"{an}_{dr}_{f}.png")))[..., 3] > 127
        can = np.zeros(idle.shape + (3,), np.uint8) + 30
        can[m] = (230, 140, 40); can[idle & ~m] = (40, 200, 230); can[idle & m] = (250, 240, 200)
        t = Image.fromarray(can); ImageDraw.Draw(t).text((6, 6), f"{an} S{f + 1} vs idle", fill=(255, 255, 255)); tiles.append(t)
    w, h = tiles[0].size
    im = Image.new("RGB", (w * len(tiles), h + 30), (14, 14, 18))
    ImageDraw.Draw(im).text((8, 8), "cian = idle, naranja = animacion, crema = coinciden. Misma escala: solo cambia la pose", fill=(255, 255, 255))
    for k, t in enumerate(tiles):
        im.paste(t, (k * w, 30))
    im.save(os.path.join(REV, "E1_tamano.png"))
    regen = [p for p in P if p["tipo"].startswith("b") or "b" in p["tipo"]]
    json.dump({"problemas": P, "regenerar": regen}, open(os.path.join(REV, "E1_revision.json"), "w"), indent=1, ensure_ascii=False)
    print(len(P), "problemas;", len(regen), "a regenerar / revisar")


if __name__ == "__main__":
    main()
