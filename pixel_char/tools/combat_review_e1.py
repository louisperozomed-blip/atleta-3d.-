"""COMBATE · Etapa 1 · Hojas de revisión: problemas marcados (a = arreglado con código,
b = hay que regenerar), antes/después y lista de regeneración.

Salida en review/combat/:
  E1_<anim>.png          antes (recorte original, a la escala de idle) | después, con los problemas marcados
  E1_color.png           parry/block/dodge/hit/death antes y después del color, junto a walk y attack1
  E1_tamano.png          siluetas superpuestas contra idle (antes/después de la escala)
  E1_death.png           death_1 contra death_2 y death_2_alt (final de la caída)
  E1_revision.json       lista completa de problemas y regeneraciones
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

from combat_common import CBUILD, CFIX, CRAW, CREVIEW
from combat_contact import ORDER, grid
from common import BUILD, DIRS, NFRAMES, frame_name

COLOR = os.path.join(CBUILD, "color")
NORM = os.path.join(BUILD, "norm")
A, B = (255, 170, 40), (255, 60, 90)   # (a) naranja, (b) rojo

ANIMS = ["attack1", "attack2", "attack3", "parry", "block", "dodge", "hit", "death"]
RECOLOR = ["parry", "block", "dodge", "hit", "death"]


def problems():
    P = []
    P.append({"anim": "attack1", "dirs": ["SW"], "frames": list(range(6)), "tipo": "a",
              "problema": "fila SW de espaldas (se ve la mochila)", "arreglo": "espejo horizontal de attack1 SE"})
    P.append({"anim": "attack3", "dirs": ["N", "NE", "E", "W", "NW"], "frames": [3], "tipo": "b",
              "problema": "IMPACT de frente en filas de espaldas y de lado",
              "arreglo": "provisional: pose FOLLOW THROUGH de la misma fila + estallido de fuego del IMPACT S; "
                         "regenerar para tener el golpe con la cuchilla clavada mirando en la dirección de la fila"})
    P.append({"anim": "attack3", "dirs": ["SE", "SW"], "frames": [3], "tipo": "b",
              "problema": "IMPACT mira al frente (S) en vez de en diagonal",
              "arreglo": "se conserva (se lee bien desde delante); regenerar si se quiere la diagonal exacta"})
    P.append({"anim": "attack3", "dirs": ["SW"], "frames": [5], "tipo": "a",
              "problema": "RECOVERY de espaldas (mochila)", "arreglo": "espejo horizontal de attack3 SE RECOVERY"})
    for an in RECOLOR:
        P.append({"anim": an, "dirs": DIRS, "frames": list(range(6)), "tipo": "a",
                  "problema": "más rojo, saturado y brillante; cuchilla roja; reborde rojo encendido",
                  "arreglo": "color por zonas: rojos -> naranja de referencia, cuchilla -> cuantiles de la de "
                             "attack1-3, crema -7° y -10 % croma, reborde del cuerpo -> contorno cálido oscuro"})
    for an, pct, red in (("block", 10, 4.6), ("dodge", 12, 5.9), ("hit", 9, 5.0), ("death", 7, 3.3)):
        P.append({"anim": an, "dirs": DIRS, "frames": list(range(6)), "tipo": "a",
                  "problema": f"personaje dibujado más grande (casco ~{pct} % mayor que en idle/walk a igual baldosa)",
                  "arreglo": f"escala = media geométrica casco/baldosa: se reduce un {red} %"})
    for an in ("parry", "dodge", "hit", "death"):
        P.append({"anim": an, "dirs": DIRS, "frames": list(range(6)), "tipo": "b",
                  "problema": "proporciones más rechonchas: cabeza grande y cuerpo corto (alto/ancho de los frames "
                              "erguidos 13-20 % menor que idle con el casco igualado)",
                  "arreglo": "no se corrige con código sin deformar el casco; aceptable a la escala del juego, "
                             "regenerar con las proporciones de idle si se quiere exactitud"})
    P.append({"anim": "parry", "dirs": ["SE", "NW"], "frames": [1, 2], "tipo": "a",
              "problema": "en la hoja la cuchilla de DEFLECT toca las chispas de SPARK (frames pegados)",
              "arreglo": "corte por la línea media entre columnas"})
    P.append({"anim": "death", "dirs": ["S", "SW", "W", "NW"], "frames": list(range(6)), "tipo": "a",
              "problema": "death_2 frente a death_2_alt",
              "arreglo": "se usa death_2: cae de bruces hacia delante como death_1; death_2_alt termina con la "
                         "cabeza hacia atrás y salta de COLLAPSE a DOWN"})
    return P


def notes_for(an, P):
    n = {}
    for p in P:
        if p["anim"] != an:
            continue
        for d in p["dirs"]:
            for i in p["frames"]:
                col = A if p["tipo"] == "a" else B
                if (d, i) in n and n[(d, i)][0] == B:
                    continue
                n[(d, i)] = (col, p["tipo"])
    return n


def before_frames(tmp):
    """'Antes': el recorte original (sin corregir color, escala ni dirección) puesto en el lienzo con la
    escala de baldosa de idle (así se ve si es más grande)."""
    meta = json.load(open(os.path.join(CBUILD, "raw_meta.json")))
    fm = json.load(open(os.path.join(CBUILD, "fixed_meta.json")))
    old = json.load(open(os.path.join(BUILD, "norm_meta.json")))["rows"]
    from combat_normalize import warp
    os.makedirs(tmp, exist_ok=True)
    for an in ANIMS:
        for d in DIRS:
            s_idle = old[f"idle_{d}"]["scale"]
            for i in range(NFRAMES):
                n = frame_name(an, d, i)
                img = np.asarray(Image.open(os.path.join(CRAW, n + ".png"))).astype(np.float32)
                px, py, _ = fm["pivots"][n]
                hw_ratio = 92.0 / meta[n]["tile"]["hw"]      # misma baldosa -> mismo tamaño de dibujo
                Image.fromarray(warp(img, s_idle * hw_ratio, px, py)).save(os.path.join(tmp, n + ".png"))


def side_by_side(an, P, tmp):
    notes = notes_for(an, P)
    g1 = grid(tmp, an, os.path.join(tmp, "_a.png"), notes=notes, scale=0.5)
    g2 = grid(CFIX, an, os.path.join(tmp, "_b.png"), scale=0.5)
    mine = [p for p in P if p["anim"] == an]
    W, H = g1.width + g2.width + 10, g1.height + 50 + 30 * len(mine) + 10
    im = Image.new("RGB", (W, H), (14, 14, 18))
    im.paste(g1, (0, 50)); im.paste(g2, (g1.width + 10, 50))
    d = ImageDraw.Draw(im)
    d.text((10, 8), f"{an.upper()} - ANTES (recorte original, escala de baldosa de idle)", fill=(255, 255, 255))
    d.text((g1.width + 20, 8), "DESPUES (color, escala, pivote y direcciones corregidos)", fill=(255, 255, 255))
    d.text((10, 28), "marco naranja = (a) arreglado con codigo  |  marco rojo = (b) regenerar", fill=(255, 200, 120))
    y = g1.height + 60
    for p in mine:
        col = A if p["tipo"] == "a" else B
        fr = ",".join(str(i + 1) for i in p["frames"])
        d.text((10, y), f"({p['tipo']}) {'/'.join(p['dirs'])} frames {fr}: {p['problema']}", fill=col)
        d.text((30, y + 13), f"-> {p['arreglo']}", fill=(200, 200, 200))
        y += 30
    im.save(os.path.join(CREVIEW, f"E1_{an}.png"))


def strip(pairs, out, h=230, labels=None, bg=(38, 40, 48)):
    ims = []
    for p in pairs:
        f = Image.open(p).convert("RGBA")
        s = h / f.height
        f = f.resize((int(f.width * s), h), Image.LANCZOS)
        t = Image.new("RGBA", f.size, bg + (255,)); t.alpha_composite(f); ims.append(t)
    W = sum(i.width for i in ims)
    im = Image.new("RGB", (W, h + 22), (14, 14, 18))
    x = 0
    d = ImageDraw.Draw(im)
    for k, i in enumerate(ims):
        im.paste(i.convert("RGB"), (x, 22))
        if labels:
            d.text((x + 4, 5), labels[k], fill=(255, 255, 255))
        x += i.width
    im.save(out)
    return im


def main():
    tmp = os.path.join(CBUILD, "before")
    before_frames(tmp)
    P = problems()
    for an in ANIMS:
        side_by_side(an, P, tmp)
    # color: walk / attack1 / antes-después de cada animación recoloreada (misma dirección y pose parecida)
    rows = []
    sel = {"parry": ("S", 5), "block": ("SE", 1), "dodge": ("SW", 5), "hit": ("E", 5), "death": ("N", 1)}
    for an, (d, i) in sel.items():
        rows.append(strip([os.path.join(NORM, f"walk_{d}_0.png"), os.path.join(CFIX, f"attack1_{d}_0.png"),
                           os.path.join(tmp, f"{an}_{d}_{i}.png"), os.path.join(CFIX, f"{an}_{d}_{i}.png")],
                          os.path.join(tmp, f"_c_{an}.png"),
                          labels=[f"walk {d}", f"attack1 {d}", f"{an} ANTES", f"{an} DESPUÉS"]))
    W = max(r.width for r in rows); H = sum(r.height for r in rows)
    im = Image.new("RGB", (W, H), (14, 14, 18)); y = 0
    for r in rows:
        im.paste(r, (0, y)); y += r.height
    im.save(os.path.join(CREVIEW, "E1_color.png"))
    # tamaño: silueta de idle (cian) contra la animación (naranja) antes y después
    tiles = []
    for an, d, i in (("hit", "S", 5), ("block", "SE", 1), ("dodge", "S", 5), ("death", "N", 0), ("parry", "S", 5)):
        for src, lab in ((tmp, "antes"), (CFIX, "después")):
            idle = np.asarray(Image.open(os.path.join(NORM, f"idle_{d}_0.png")))
            a = np.asarray(Image.open(os.path.join(src, f"{an}_{d}_{i}.png")))
            can = np.zeros((288, 256, 3), np.uint8) + 30
            ia = np.zeros((288, 256), bool); ia[264 - 250:264 - 250 + 272, 8:248] = idle[..., 3] > 127
            m = a[..., 3] > 127
            can[m] = (230, 140, 40); can[ia & ~m] = (40, 200, 230); can[ia & m] = (250, 240, 200)
            t = Image.fromarray(can); ImageDraw.Draw(t).text((6, 6), f"{an} {d}{i} {lab}", fill=(255, 255, 255))
            tiles.append(t)
    im = Image.new("RGB", (256 * 5, 288 * 2 + 30), (14, 14, 18))
    ImageDraw.Draw(im).text((8, 8), "cian = idle (referencia) · naranja = combate · crema = coinciden; fila de arriba antes, abajo después",
                            fill=(255, 255, 255))
    for k, t in enumerate(tiles):
        im.paste(t, ((k // 2) * 256, 30 + (k % 2) * 288))
    im.save(os.path.join(CREVIEW, "E1_tamano.png"))
    # death: final de la caída por dirección
    pairs, labels = [], []
    for d in ("N", "E", "SE"):
        pairs += [os.path.join(COLOR, f"death_{d}_{k}.png") for k in (2, 3, 5)]
        labels += [f"death_1 {d} f{k + 1}" for k in (2, 3, 5)]
    strip(pairs, os.path.join(tmp, "_d1.png"), h=200, labels=labels)
    pairs2, labels2 = [], []
    for d in ("S", "SW", "W"):
        pairs2 += [os.path.join(COLOR, f"death_{d}_{k}.png") for k in (2, 3, 5)]
        labels2 += [f"death_2 {d} f{k + 1}" for k in (2, 3, 5)]
    pairs3, labels3 = [], []
    for d in ("S", "SW", "W"):
        pairs3 += [os.path.join(COLOR, f"deathalt_{d}_{k}.png") for k in (2, 3, 5)]
        labels3 += [f"death_2_alt {d} f{k + 1}" for k in (2, 3, 5)]
    r1 = strip(pairs, os.path.join(tmp, "_d1.png"), h=200, labels=labels)
    r2 = strip(pairs2, os.path.join(tmp, "_d2.png"), h=200, labels=labels2)
    r3 = strip(pairs3, os.path.join(tmp, "_d3.png"), h=200, labels=labels3)
    W = max(r.width for r in (r1, r2, r3))
    im = Image.new("RGB", (W, r1.height * 3), (14, 14, 18))
    for k, r in enumerate((r1, r2, r3)):
        im.paste(r, (0, k * r1.height))
    im.save(os.path.join(CREVIEW, "E1_death.png"))
    regen = [p for p in P if p["tipo"] == "b"]
    json.dump({"problemas": P, "regenerar": regen}, open(os.path.join(CREVIEW, "E1_revision.json"), "w"),
              indent=1, ensure_ascii=False)
    print(len(P), "problemas;", len(regen), "a regenerar")


if __name__ == "__main__":
    main()
