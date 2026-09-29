"""Mapa cenital del terreno: color de baldosa sombreado por altura + navegación."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1])); N = d["N"]
H = np.array(d["H"]).reshape(N, N); col = np.array(d["col"]).reshape(N, N)
S = 8
img = np.zeros((N * S, N * S, 3), np.uint8)
for ix in range(N):
    for iz in range(N):
        c = col[ix, iz]; rgb = np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], float)
        rgb *= 0.6 + 0.4 * min(1, (H[ix, iz] - 0.5) / 3.5)
        img[iz * S:(iz + 1) * S, ix * S:(ix + 1) * S] = rgb.clip(0, 255)
im = Image.fromarray(img); dr = ImageDraw.Draw(im)
# escalones: líneas donde el desnivel > 0.5 (acantilado)
for ix in range(N):
    for iz in range(N):
        if ix + 1 < N and abs(H[ix, iz] - H[ix + 1, iz]) > 0.51: dr.line([((ix + 1) * S, iz * S), ((ix + 1) * S, (iz + 1) * S)], fill=(255, 60, 60))
        if iz + 1 < N and abs(H[ix, iz] - H[ix, iz + 1]) > 0.51: dr.line([(ix * S, (iz + 1) * S), ((ix + 1) * S, (iz + 1) * S)], fill=(255, 60, 60))
n = int(len(d["nav"]) ** 0.5); cs = N * S / n
seen = np.array(d["seen"]).reshape(n, n); nav = np.array(d["nav"]).reshape(n, n)
ov = Image.new("RGBA", im.size, (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
for cx in range(n):
    for cz in range(n):
        if nav[cx, cz]: od.rectangle([cx * cs, cz * cs, (cx + 1) * cs - 1, (cz + 1) * cs - 1], fill=(0, 0, 0, 90))
        elif not seen[cx, cz]: od.rectangle([cx * cs, cz * cs, (cx + 1) * cs - 1, (cz + 1) * cs - 1], fill=(255, 0, 0, 110))
for o in d["obstacles"]:
    x, z, r = (o["x"] + N / 2) * S, (o["z"] + N / 2) * S, o["r"] * S
    od.ellipse([x - r, z - r, x + r, z + r], outline=(255, 255, 255, 200))
im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
im.save(sys.argv[2]); print(sys.argv[2])
