"""Verificación de la normalización: altura, pies y centro por frame."""
import json, os, sys
import numpy as np
from PIL import Image
from common import ANIMS, BUILD, DIRS, NFRAMES, frame_name
folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BUILD, "norm")
nm = json.load(open(os.path.join(BUILD, "norm_meta.json")))
px, py = nm["pivot"]
lines = ["anim  dir | alto (min-max) | pie y rel. pivote (min..max) | centro x rel. pivote (min..max) | casco-top"]
stats = {}
for an in ANIMS:
    for d in DIRS:
        H, B, C, T = [], [], [], []
        for i in range(NFRAMES):
            a = np.asarray(Image.open(os.path.join(folder, frame_name(an, d, i) + ".png")))[..., 3] > 127
            ys, xs = np.nonzero(a)
            top, bot = ys.min(), ys.max()
            up = a.copy(); up[top + int((bot - top) * 0.55):] = False
            H.append(bot - top); B.append(bot - py); C.append(np.nonzero(up)[1].mean() - px); T.append(top)
        stats[f"{an}_{d}"] = dict(H=[int(h) for h in H], B=[int(b) for b in B], C=[round(c, 1) for c in C])
        lines.append(f"{an:5s} {d:3s} | {min(H):3d}-{max(H):3d} | {min(B):+4d}..{max(B):+4d} | {min(C):+5.1f}..{max(C):+5.1f} | {min(T)}")
print("\n".join(lines))
json.dump(stats, open(os.path.join(BUILD, "verify_stats.json"), "w"))
