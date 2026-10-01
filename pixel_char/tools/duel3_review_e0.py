"""DUELO 3 · Etapa 0 · Revisión de las hojas nuevas (riposte y deathblow del personaje; deflected y counter
del autómata): antes (recorte original) | después (color, escala, pivote y direcciones), con los problemas
marcados ((a) corregido con código, (b) regenerar), tamaño frente a idle/attack1 y lista en JSON.

Salida en review/duel3/:
  E0_<anim>.png        antes | después de cada animación nueva
  E0_tamano.png        las cuatro animaciones nuevas junto a idle y attack1 de la misma dirección
  E0_emision.png       mapas de emisión (estela naranja de riposte, cuchilla del deathblow, estela cian del counter)
  E0_revision.json     problemas, arreglos y lo que habría que regenerar
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

import combat_review_e1 as CR
import enemy_review_e1 as ER
from combat_contact import grid
from common import OUT, ROOT
from enemy_extract import EBUILD
from enemy_normalize import EFIX, MIRROR

REV = os.path.join(ROOT, "review", "duel3")
os.makedirs(REV, exist_ok=True)
A, B = (255, 170, 40), (255, 60, 90)
D8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def problems():
    P = [
        {"anim": "riposte", "dirs": ["SW"], "frames": list(range(6)), "tipo": "a",
         "problema": "fila SW igual que la S (de frente, sin girar a la izquierda)", "arreglo": "espejo horizontal de riposte SE"},
        {"anim": "riposte", "dirs": ["NW"], "frames": list(range(6)), "tipo": "a",
         "problema": "fila NW corta hacia atrás a la derecha (como NE)", "arreglo": "espejo horizontal de riposte NE"},
        {"anim": "riposte", "dirs": ["SW", "NW"], "frames": list(range(6)), "tipo": "b",
         "problema": "con el espejo la cuchilla pasa a la otra mano", "arreglo": "leve a la escala del juego (igual que attack1 SW); regenerar SW y NW si se quiere exacto"},
        {"anim": "riposte", "dirs": D8, "frames": list(range(6)), "tipo": "a",
         "problema": "hoja de 1312x1199 (las demás 1225x1284) y personaje algo más pequeño (casco -11 %)",
         "arreglo": "se reescala x0.934 al leerla y la escala final sale del casco y la baldosa como en las demás"},
        {"anim": "deathblow", "dirs": D8, "frames": list(range(6)), "tipo": "a",
         "problema": "la hoja cierra la última fila con una raya (5 separadores)", "arreglo": "la hoja se corta en esa raya"},
        {"anim": "deathblow", "dirs": D8, "frames": list(range(6)), "tipo": "a",
         "problema": "casco ~13 % más pequeño que idle a igual baldosa", "arreglo": "escala casco/baldosa (+8 %)"},
    ]
    for an, d, san, sd, _, kind, why in MIRROR:
        if an in ("deflected", "counter"):
            P.append({"anim": an, "dirs": [d], "frames": list(range(6)), "tipo": kind, "problema": why, "arreglo": f"espejo horizontal de {san} {sd}"})
    P.append({"anim": "deflected", "dirs": D8, "frames": [0], "tipo": "a",
              "problema": "las chispas del CLASH son motas sueltas y se pierden al recortar (y en la hoja asoman sobre el rótulo)",
              "arreglo": "las chispas las pone el juego en el punto de choque (doradas en el parry perfecto)"})
    P.append({"anim": "deflected", "dirs": D8, "frames": list(range(6)), "tipo": "a",
              "problema": "maquetación distinta: sin cabecera de números (número gris en cada celda, fase debajo)",
              "arreglo": "cuadrícula por las líneas de etiquetas (enemy_grid.grid_b) y el texto se quita por cajas"})
    P.append({"anim": "counter", "dirs": D8, "frames": [3], "tipo": "a",
              "problema": "la estela cian del SLASH tiene el mismo color que el ojo (la luz del ojo saltaba a la estela)",
              "arreglo": "enemy_maps.split_cyan: estela = piezas cian grandes o fuera del cuerpo (emiten); ojo = la pequeña más alta"})
    P.append({"anim": "counter", "dirs": D8, "frames": list(range(6)), "tipo": "a",
              "problema": "más cobrizo y con menos musgo que idle/walk (croma 34-36 frente a 28)", "arreglo": "color por zonas hacia idle/walk/run"})
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
                if len(p["dirs"]) == 8 and len(p["frames"]) == 6 and (d, i) not in n:
                    continue                                  # problemas de toda la hoja: solo en la lista
                n[(d, i)] = (col, p["tipo"][0])
    return n


def panel(an, g1, g2, mine, title_b):
    im = Image.new("RGB", (g1.width + g2.width + 10, g1.height + 50 + 30 * len(mine) + 10), (14, 14, 18))
    im.paste(g1, (0, 50)); im.paste(g2, (g1.width + 10, 50))
    d = ImageDraw.Draw(im)
    d.text((10, 8), f"{an.upper()} - ANTES (recorte original)", fill=(255, 255, 255))
    d.text((g1.width + 20, 8), title_b, fill=(255, 255, 255))
    d.text((10, 28), "marco naranja = (a) corregido con codigo  |  marco rojo = (b) regenerar", fill=(255, 200, 120))
    y = g1.height + 60
    for p in mine:
        col = A if p["tipo"].startswith("a") else B
        fr = ",".join(str(i + 1) for i in p["frames"])
        d.text((10, y), f"({p['tipo']}) {'/'.join(p['dirs'])} frames {fr}: {p['problema']}", fill=col)
        d.text((30, y + 13), f"-> {p['arreglo']}", fill=(200, 200, 200))
        y += 30
    im.save(os.path.join(REV, f"E0_{an}.png"))


def main():
    P = problems()
    # personaje: «antes» = recorte original a la escala de baldosa de idle (como review/combat/E1_*)
    CR.ANIMS = ["riposte", "deathblow"]
    tmp = os.path.join(ROOT, "build", "combat", "before")
    CR.before_frames(tmp)
    from combat_common import CFIX
    for an in ("riposte", "deathblow"):
        g1 = grid(tmp, an, os.path.join(tmp, "_a.png"), notes=notes_for(an, P), scale=0.5)
        g2 = grid(CFIX, an, os.path.join(tmp, "_b.png"), scale=0.5)
        panel(an, g1, g2, [p for p in P if p["anim"] == an], "DESPUES (escala, pivote y direcciones corregidos)")
    # autómata
    etmp = os.path.join(EBUILD, "before")
    ER.before(etmp)
    for an in ("deflected", "counter"):
        kw = dict(scale=0.44, cell=(160, 150), anchor=(0.5, 0.93), dirs=D8)
        g1 = grid(etmp, an, os.path.join(etmp, "_a.png"), notes=notes_for(an, P), **kw)
        g2 = grid(EFIX, an, os.path.join(etmp, "_b.png"), **kw)
        panel(an, g1, g2, [p for p in P if p["anim"] == an], "DESPUES (color por zonas, pivote en los pies, direcciones corregidas)")
    # tamaño: misma dirección, frames de pie, todo a la escala del juego
    rows = []
    NORM = os.path.join(ROOT, "build", "norm")
    for d in ("S", "E", "NW"):
        cells = [(os.path.join(NORM, f"idle_{d}_0.png"), "idle"), (os.path.join(CFIX, f"attack1_{d}_0.png"), "attack1"),
                 (os.path.join(CFIX, f"riposte_{d}_0.png"), "riposte"), (os.path.join(CFIX, f"deathblow_{d}_0.png"), "deathblow"),
                 (os.path.join(EFIX, f"idle_{d}_0.png"), "aut. idle"), (os.path.join(EFIX, f"deflected_{d}_2.png"), "deflected"),
                 (os.path.join(EFIX, f"counter_{d}_5.png"), "counter")]
        rows.append(CR.strip([c[0] for c in cells], os.path.join(tmp, f"_t{d}.png"), h=210, labels=[f"{c[1]} {d}" for c in cells]))
    Wd = max(r.width for r in rows)
    im = Image.new("RGB", (Wd, sum(r.height for r in rows)), (14, 14, 18)); y = 0
    for r in rows:
        im.paste(r, (0, y)); y += r.height
    im.save(os.path.join(REV, "E0_tamano.png"))
    # emisión: color | emisión de los frames activos
    tiles = []
    for an, src, d, i in (("riposte", "combat", "E", 3), ("riposte", "combat", "S", 3), ("deathblow", "combat", "E", 3),
                          ("counter", "enemy", "E", 3), ("counter", "enemy", "S", 3)):
        FW, FH = (256, 288) if src == "combat" else (360, 290)
        D = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"].index(d)
        col = Image.open(os.path.join(OUT, src, f"{an}_color.png")).crop((i * FW, D * FH, (i + 1) * FW, (D + 1) * FH))
        em = Image.open(os.path.join(OUT, src, f"{an}_emit.png")).crop((i * FW, D * FH, (i + 1) * FW, (D + 1) * FH))
        bg = Image.new("RGBA", col.size, (30, 30, 36, 255)); bg.alpha_composite(col.convert("RGBA"))
        e3 = Image.merge("RGB", (em, em, em))
        t = Image.new("RGB", (FW * 2, FH + 18), (14, 14, 18)); t.paste(bg.convert("RGB"), (0, 18)); t.paste(e3, (FW, 18))
        ImageDraw.Draw(t).text((4, 3), f"{an} {d} f{i + 1}: color | emision", fill=(255, 255, 255))
        tiles.append(t.resize((t.width * 210 // t.height, 210)))
    im = Image.new("RGB", (max(t.width for t in tiles) * 2 + 10, 215 * ((len(tiles) + 1) // 2)), (14, 14, 18))
    for k, t in enumerate(tiles):
        im.paste(t, ((k % 2) * (im.width // 2), (k // 2) * 215))
    im.save(os.path.join(REV, "E0_emision.png"))
    regen = [p for p in P if p["tipo"].startswith("b")]
    json.dump({"problemas": P, "regenerar": regen}, open(os.path.join(REV, "E0_revision.json"), "w"), indent=1, ensure_ascii=False)
    print(len(P), "problemas;", len(regen), "a regenerar")


if __name__ == "__main__":
    main()
