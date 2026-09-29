"""Pies por frame (walk y run, 8 direcciones, 6 frames) para el anclaje ("root motion").

Sobre los frames a resolución completa (240×272, pivote (120, 250)):
  - botas = píxeles crema cálidos en los 75 px de abajo; se agrupan en manchas; se quedan las 2
    mayores (si solo hay una, los pies están juntos)
  - suela de cada bota = píxel opaco más bajo en sus columnas (la suela es oscura, bajo el crema)
  - punto de contacto de cada bota = (x media de la suela, y de la suela)
  - pie de apoyo = la bota más baja; "en el suelo" si su suela está a <= 4 px del suelo del ciclo
    (en run hay frames en el aire)
  - identidad de las botas entre frames: emparejamiento de menor desplazamiento total
  - píxel opaco más bajo de TODO el frame (para comprobar que el pie queda sobre la superficie)
Todo en píxeles de la hoja completa, relativo al pivote (x a la derecha, y hacia abajo).
Salida: world/assets/feet.json y world/walk/feet_debug.png
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FR = os.path.join(os.path.dirname(ROOT), "frames")
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
PVX, PVY = 120, 250


def boots(img):
    """Botas a partir del perfil inferior de la silueta: para cada columna, el píxel opaco más bajo.
    Las botas son los tramos de columnas cuyo borde inferior está a <= 22 px del punto más bajo
    del frame; cada tramo da un punto de contacto (x media de sus columnas más bajas, y más baja)."""
    op = img[..., 3] > 128
    H, Wd = op.shape
    bot = np.full(Wd, -1)
    for x in range(Wd):
        ys = np.nonzero(op[:, x])[0]
        if len(ys):
            bot[x] = ys.max()
    low = bot.max()
    cand = bot >= low - 22
    # tramos contiguos (se permiten huecos de 2 columnas)
    runs, cur, gap = [], [], 0
    for x in range(Wd):
        if cand[x]:
            cur.append(x); gap = 0
        elif cur:
            gap += 1
            if gap > 2:
                runs.append(cur); cur = []; gap = 0
    if cur:
        runs.append(cur)
    feet = []
    for r in runs:
        r = np.array(r)
        yb = bot[r].max()
        if len(r) < 4:
            continue
        base = r[bot[r] >= yb - 2]                     # columnas de la suela
        feet.append({"n": int(len(r)), "x": float(base.mean() - PVX), "y": float(yb - PVY), "w": int(len(r))})
    # como mucho 2 botas: las 2 más bajas (a igualdad, las más anchas)
    feet = sorted(feet, key=lambda f: (-f["y"], -f["n"]))[:2]
    if len(feet) == 1:
        feet = [feet[0], dict(feet[0])]
    return sorted(feet, key=lambda f: f["x"])


def lowest_opaque(img):
    ys = np.nonzero((img[..., 3] > 128).any(1))[0]
    return float(ys.max() - PVY)


def main():
    out = {}
    dbg_rows = []
    for anim in ("walk", "run"):
        for d in DIRS:
            frames = [np.asarray(Image.open(os.path.join(FR, f"{anim}_{d}_{i}.png"))) for i in range(6)]
            F = [boots(f) for f in frames]
            ground = max(max(b["y"] for b in fb) for fb in F)       # suelo del ciclo (y de la suela más baja)
            # identidad de botas: la bota 0 del frame 0 es "A"; se propaga por emparejamiento
            ids = [[0, 1]]
            for i in range(1, 6):
                a, b = F[i - 1], F[i]
                pa = [(a[ids[-1].index(0)]), (a[ids[-1].index(1)])]
                keep = sum(abs(pa[k]["x"] - b[k]["x"]) + abs(pa[k]["y"] - b[k]["y"]) for k in range(2))
                swap = sum(abs(pa[k]["x"] - b[1 - k]["x"]) + abs(pa[k]["y"] - b[1 - k]["y"]) for k in range(2))
                ids.append([0, 1] if keep <= swap else [1, 0])
            recs = []
            for i in range(6):
                fb = F[i]
                # reordena para que feet[0] sea siempre la bota "A"
                order = [ids[i].index(0), ids[i].index(1)]
                feet = [fb[order[0]], fb[order[1]]]
                plant = 0 if feet[0]["y"] >= feet[1]["y"] else 1
                grounded = feet[plant]["y"] >= ground - 4
                recs.append({"feet": [{"x": round(f["x"], 1), "y": round(f["y"], 1)} for f in feet], "plant": plant,
                             "grounded": bool(grounded), "lowest": lowest_opaque(frames[i])})
            out[f"{anim}_{d}"] = {"frames": recs, "ground": ground}
            print(anim, d, "apoyo", [("AB"[r["plant"]] if r["grounded"] else "-") for r in recs],
                  "suela apoyo", [r["feet"][r["plant"]]["y"] for r in recs], "píxel más bajo", [r["lowest"] for r in recs])
            if d in ("E", "NE", "S", "SW"):
                dbg_rows.append((f"{anim} {d}", frames, recs))
    # transiciones i -> i+1 para el anclaje: "stance" (el mismo pie apoyado retrocede en el sprite),
    # "switch" (el pie apoyado nuevo está delante: cambio de apoyo, el cuerpo no se mueve),
    # "air" (algún frame sin pie en el suelo: se usa el avance medio de las fases de apoyo)
    ISO = 0.64
    for key, rec in out.items():
        anim, d = key.split("_")
        a = DIRS.index(d) * np.pi / 4
        mv = np.array([-np.sin(a), np.cos(a) * ISO]); mv /= np.linalg.norm(mv)
        fr = rec["frames"]
        trans = []
        for i in range(6):
            f0, f1 = fr[i], fr[(i + 1) % 6]
            c0 = np.array([f0["feet"][f0["plant"]]["x"], f0["feet"][f0["plant"]]["y"]])
            c1 = np.array([f1["feet"][f1["plant"]]["x"], f1["feet"][f1["plant"]]["y"]])
            dl = c1 - c0
            along = float(dl @ mv)
            if not (f0["grounded"] and f1["grounded"]):
                kind = "air"
            elif along < -1.0:
                kind = "stance"
            else:
                kind = "switch"
            trans.append({"kind": kind, "dx": round(float(dl[0]), 1), "dy": round(float(dl[1]), 1), "along": round(-along, 1)})
        rec["trans"] = trans
        st = [t["along"] for t in trans if t["kind"] == "stance"]
        rec["stance_mean"] = float(np.mean(st)) if st else 8.0
        total = sum(st) + rec["stance_mean"] * sum(t["kind"] == "air" for t in trans)
        print(f"{key:8s}", " ".join(f"{t['kind'][:2]}{t['along']:+.0f}" for t in trans), f" avance/ciclo {total:.0f} px (pantalla del sprite)")
    # --- apoyos y avance del pie dibujado, en la cámara del MUNDO -----------------------------
    # apoyo nuevo en cada frame de contacto (walk: contactos de walk_variants; run: frames en el suelo);
    # el pie apoyado es el de delante; su retroceso dentro del apoyo es lo que el dibujo "anda".
    EL = np.arctan(0.5)
    TEX = 1.7 * np.cos(EL) / 206.0                       # u de pantalla por texel de la hoja completa
    WV = json.load(open(os.path.join(ROOT, "assets", "walk_variants.json")))
    for key, rec in out.items():
        anim, d = key.split("_")
        a = DIRS.index(d) * np.pi / 4
        ms = np.array([-np.sin(a), np.cos(a) * np.sin(EL)]); f = float(np.linalg.norm(ms)); ms /= f
        fr = rec["frames"]
        contact = WV["contact"][d] if anim == "walk" else [int(x["grounded"]) for x in fr]
        if sum(contact) == 0: contact = [1, 0, 0, 1, 0, 0]
        sweep, anch = 0.0, None
        for i in range(12):                                  # dos vueltas: la primera sirve de arranque
            fi = fr[i % 6]
            pts = [np.array([q["x"], q["y"]]) for q in fi["feet"]]
            if contact[i % 6]:
                anch = max(pts, key=lambda p: p @ ms)       # el pie de delante toma el apoyo
            elif anch is not None:
                nxt = min(pts, key=lambda p: np.linalg.norm(p - anch))
                if i >= 6: sweep += max(0.0, -((nxt - anch) @ ms))
                anch = nxt
            if contact[i % 6] and i >= 6 and anch is not None:
                pass
        rec["contact"] = contact
        rec["stances"] = int(sum(contact))
        rec["f_screen"] = round(f, 4)
        rec["art_cycle_u"] = round(sweep * TEX / f, 4)       # avance por ciclo que da el dibujo (u de suelo)
        print(f"{key:8s} contactos {contact} apoyos/ciclo {rec['stances']}  el dibujo avanza {rec['art_cycle_u']:.2f} u/ciclo (f={f:.2f})")
    json.dump(out, open(os.path.join(ROOT, "assets", "feet.json"), "w"))
    # imagen de depuración
    im = Image.new("RGB", (6 * 160, len(dbg_rows) * 130), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    for r, (name, frames, recs) in enumerate(dbg_rows):
        for i in range(6):
            t = Image.fromarray(frames[i]).crop((40, 150, 200, 270))
            im.paste(t, (i * 160, r * 130 + 10), t)
            for k, f in enumerate(recs[i]["feet"]):
                x, y = f["x"] + PVX - 40 + i * 160, f["y"] + PVY - 150 + r * 130 + 10
                col = (255, 0, 0) if (k == recs[i]["plant"] and recs[i]["grounded"]) else (0, 120, 255)
                dr.ellipse([x - 4, y - 4, x + 4, y + 4], outline=col, width=2)
                dr.text((x + 5, y - 12), "AB"[k], fill=col)
            dr.line([(i * 160, PVY - 150 + r * 130 + 10), (i * 160 + 159, PVY - 150 + r * 130 + 10)], fill=(200, 200, 200))
            dr.text((i * 160 + 3, r * 130), f"{name} {i}", fill=(0, 0, 0))
    im.save(os.path.join(ROOT, "walk", "feet_debug.png"))


if __name__ == "__main__":
    main()
