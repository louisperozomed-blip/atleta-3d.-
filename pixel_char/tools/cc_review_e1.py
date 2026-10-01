"""COMBATE COMPLETO · Etapa 1 · Revisión de las hojas nuevas (heavy y spin del personaje, heavy del autómata):
antes (recorte de la hoja) | después (color, escala, pivote, direcciones corregidas), con los problemas marcados
((a) corregido con código, (b) regenerar), tamaño junto a idle/attack1, emisión y lista en JSON.

Salida en review/combate_completo/:
  E1_<anim>.png        antes | después (8 filas en el orden S, SW, W, NW, N, NE, E, SE)
  E1_tamano.png        las animaciones nuevas junto a idle y attack1 (personaje) / idle y attack2 (autómata)
  E1_emision.png       mapas de emisión de heavy y spin (cuchilla, arco del RELEASE, aro del SPIN, estallido)
  E1_revision.json     problemas, arreglos y lo que habría que regenerar
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

from common import ROOT

REV = os.path.join(ROOT, "review", "combate_completo")
os.makedirs(REV, exist_ok=True)
D8 = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
BG = (58, 68, 60, 255)
try:
    FONT = ImageFont.truetype("DejaVuSans.ttf", 13)
except OSError:
    FONT = ImageFont.load_default()
A_COL, B_COL = (255, 170, 40), (255, 60, 90)

PROBLEMS = [
    {"anim": "heavy", "dirs": D8, "tipo": "a", "problema": "maquetación en tarjetas (número en la esquina, no centrado encima) y rayas del título",
     "arreglo": "columnas por los bordes oscuros de las tarjetas y recorte por dentro de cada tarjeta (combat_extract.card_columns)"},
    {"anim": "spin", "dirs": D8, "tipo": "a", "problema": "igual que heavy (tarjetas) y una raya de título más fina que la tomaba por separador de banda",
     "arreglo": "las rayas por encima de y=50 no son separadores"},
    {"anim": "heavy", "dirs": D8, "tipo": "a", "problema": "llegó en JPEG (artefactos en el fondo oscuro)",
     "arreglo": "el clasificador de fondo adaptativo los absorbe; sin halo tras el matte"},
    {"anim": "heavy", "dirs": D8, "tipo": "a", "problema": "casco ~12 % mayor que idle a igual baldosa (como riposte/deathblow)", "arreglo": "escala casco/baldosa: ×1.07"},
    {"anim": "spin", "dirs": D8, "tipo": "a", "problema": "casco ~10 % mayor que idle", "arreglo": "escala casco/baldosa: ×1.06"},
    {"anim": "heavy", "dirs": D8, "tipo": "a", "problema": "el arco del RELEASE, la carga de la cuchilla y el aro del SPIN son amarillos (tono 54-95°), fuera de la regla de emisión de la cuchilla (≤ 68°)",
     "arreglo": "combat_emission(arcs=True): piezas amarillas claras grandes o que sobresalen; el bordado de la túnica (sin núcleo claro, L95 ≤ 172) no brilla"},
    {"anim": "heavy", "dirs": ["N", "NE", "NW"], "frames": [3], "tipo": "b",
     "problema": "en RELEASE, detrás del arco queda una cuña oscura (la capa al vuelo pintada casi negra)", "arreglo": "leve a la escala del juego; regenerar si molesta"},
    {"anim": "heavy", "dirs": D8, "frames": [1, 2], "tipo": "a", "problema": "CHARGE y CHARGE MAX casi no brillan en la hoja",
     "arreglo": "el brillo de la carga lo pone el juego y crece mientras se mantiene (etapa 3)"},
    {"anim": "heavy_automata", "dirs": ["E", "W"], "tipo": "a", "problema": "heavy_2 W está dibujada mirando a la derecha (ojo y cabeza a la derecha)",
     "arreglo": "esa fila es la E; la W es su espejo horizontal"},
    {"anim": "heavy_automata", "dirs": ["SE", "NE"], "tipo": "a", "problema": "no llegó heavy_1 (N, NE, E, SE)", "arreglo": "espejos horizontales de SW y NW"},
    {"anim": "heavy_automata", "dirs": ["N"], "tipo": "b", "problema": "sin fila N y no se deduce de ninguna otra", "arreglo": "provisional: la NW; regenerar heavy_1 del autómata (N, NE, E, SE)"},
    {"anim": "heavy_automata", "dirs": D8, "tipo": "a", "problema": "maquetación distinta (fase «1. WIND UP» bajo la figura, sin números grises) y garras de RAISE/HOLD que suben hasta el título",
     "arreglo": "enemy_grid.grid_c: solo se quita el texto real y la primera fila empieza arriba del todo"},
    {"anim": "heavy_automata", "dirs": D8, "frames": [4], "tipo": "a", "problema": "en IMPACT los escombros tapan la baldosa (no se puede medir el suelo)",
     "arreglo": "la posición de esa columna se interpola de sus vecinas"},
    {"anim": "heavy_automata", "dirs": D8, "tipo": "a", "problema": "algo más claro y con menos croma que idle/walk (croma 22 frente a 28 del resto de ataques ya igualados)",
     "arreglo": "color por zonas hacia idle/walk/run (enemy_color), como attack1/2"},
    {"anim": "heavy_automata", "dirs": D8, "frames": [3], "tipo": "b", "problema": "las rayas de movimiento del SLAM quedan siempre a la izquierda de la figura",
     "arreglo": "leve (y con el espejo pasan a la derecha en W/SE/NE, lo correcto en esas); regenerar si se quiere exacto"},
]


def cell(img, w, h):
    im = img.copy(); im.thumbnail((w - 6, h - 6))
    c = Image.new("RGBA", (w, h), BG); c.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2)); return c


def before_after(anim, raw_dir, fix_dir, rows_raw, out, title, notes):
    cw, chh = 120, 130
    W_ = 6 * cw * 2 + 40
    H_ = 8 * chh + 60
    img = Image.new("RGBA", (W_, H_), (24, 28, 30, 255)); d = ImageDraw.Draw(img)
    d.text((10, 8), title, font=FONT, fill=(255, 240, 210)); d.text((10, 26), "antes (recorte de la hoja)", font=FONT, fill=(200, 200, 200)); d.text((6 * cw + 40, 26), "después (en el atlas)", font=FONT, fill=(200, 200, 200))
    for r, dd in enumerate(D8):
        y = 50 + r * chh
        d.text((W_ // 2 - 14, y + chh // 2 - 6), dd, font=FONT, fill=(255, 255, 255))
        for i in range(6):
            p = os.path.join(raw_dir, f"{anim}_{dd}_{i}.png")
            if dd in rows_raw and os.path.exists(p):
                img.alpha_composite(cell(Image.open(p).convert("RGBA"), cw, chh), (i * cw, y))
            else:
                d.rectangle([i * cw + 4, y + 4, i * cw + cw - 4, y + chh - 4], outline=(70, 70, 70)); d.text((i * cw + 30, y + chh // 2), "(no llegó)", font=FONT, fill=(120, 120, 120))
            img.alpha_composite(cell(Image.open(os.path.join(fix_dir, f"{anim}_{dd}_{i}.png")).convert("RGBA"), cw, chh), (6 * cw + 40 + i * cw, y))
        for nb in notes.get(dd, []):
            kind, fr = nb
            col = A_COL if kind == "a" else B_COL
            for i in fr:
                x0 = 6 * cw + 40 + i * cw
                d.rectangle([x0 + 1, y + 1, x0 + cw - 2, y + chh - 2], outline=col, width=3)
    img.convert("RGB").save(out)


def main():
    from combat_common import CBUILD
    from enemy_extract import EBUILD
    # personaje
    for an in ("heavy", "spin"):
        notes = {}
        if an == "heavy":
            for dd in ("N", "NE", "NW"): notes.setdefault(dd, []).append(("b", [3]))
            for dd in D8: notes.setdefault(dd, []).append(("a", [1, 2]))
        before_after(an, os.path.join(CBUILD, "raw"), os.path.join(CBUILD, "fixed"), D8, os.path.join(REV, f"E1_{an}.png"),
                     f"{an.upper()} del personaje · naranja = (a) corregido con código · rosa = (b) regenerar", notes)
    # autómata (heavy_2 solo trae S, SW, W, NW)
    notes = {"E": [("a", range(6))], "W": [("a", range(6))], "SE": [("a", range(6))], "NE": [("a", range(6))], "N": [("b", range(6))]}
    before_after("heavy", os.path.join(EBUILD, "raw"), os.path.join(EBUILD, "fixed"), ["S", "SW", "W", "NW"], os.path.join(REV, "E1_heavy_automata.png"),
                 "HEAVY del autómata · E = fila W de la hoja (mira a la derecha) · W, SE, NE = espejos · N = NW provisional (b)", notes)
    # tamaño: personaje (idle, attack1, heavy, spin) y autómata (idle, attack2, heavy), dirección S, misma escala
    out = Image.new("RGBA", (1400, 420), (24, 28, 30, 255)); d = ImageDraw.Draw(out)
    x = 10
    for lab, p in [("idle", os.path.join(ROOT, "build", "norm", "idle_S_0.png")), ("attack1", os.path.join(CBUILD, "fixed", "attack1_S_3.png")),
                   ("heavy", os.path.join(CBUILD, "fixed", "heavy_S_5.png")), ("spin", os.path.join(CBUILD, "fixed", "spin_S_0.png"))]:
        if not os.path.exists(p): continue
        im = Image.open(p).convert("RGBA"); out.alpha_composite(im, (x, 400 - im.height)); d.text((x + 10, 8), lab, font=FONT, fill=(255, 240, 210)); x += im.width - 20
    for lab, p in [("autómata idle", os.path.join(EBUILD, "fixed", "idle_S_0.png")), ("attack2", os.path.join(EBUILD, "fixed", "attack2_S_0.png")),
                   ("heavy", os.path.join(EBUILD, "fixed", "heavy_S_5.png"))]:
        im = Image.open(p).convert("RGBA"); im = im.resize((im.width * 2 // 3, im.height * 2 // 3)); out.alpha_composite(im, (x, 400 - im.height)); d.text((x + 10, 8), lab, font=FONT, fill=(180, 230, 255)); x += im.width - 30
    d.text((10, 404), "personaje a escala del atlas; autómata a 2/3 (en el juego mide 1,4 veces el personaje)", fill=(170, 170, 170))
    out.convert("RGB").save(os.path.join(REV, "E1_tamano.png"))
    # emisión
    em = Image.new("RGB", (256 * 6 // 2, 288 * 4 // 2), (0, 0, 0))
    for k, an in enumerate(["heavy", "spin"]):
        c = Image.open(os.path.join(ROOT, "out", "combat", f"{an}_color.png")).crop((0, 0, 256 * 6, 288)).convert("RGBA")
        e = Image.open(os.path.join(ROOT, "out", "combat", f"{an}_emit.png")).crop((0, 0, 256 * 6, 288)).convert("RGB")
        bg = Image.new("RGBA", c.size, (40, 50, 40, 255)); bg.alpha_composite(c)
        em.paste(bg.convert("RGB").resize((c.width // 2, c.height // 2)), (0, k * 288)); em.paste(e.resize((c.width // 2, c.height // 2)), (0, k * 288 + 144))
    em.save(os.path.join(REV, "E1_emision.png"))
    json.dump({"problemas": PROBLEMS, "regenerar_b": [p for p in PROBLEMS if p["tipo"] == "b"]}, open(os.path.join(REV, "E1_revision.json"), "w"), indent=1, ensure_ascii=False)
    print("ok")


if __name__ == "__main__":
    main()
