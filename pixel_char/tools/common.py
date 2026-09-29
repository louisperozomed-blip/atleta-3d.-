"""Constantes compartidas por las herramientas de pixel_char."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "ref", "sheets")
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(ROOT, "out")
REVIEW = os.path.join(ROOT, "review")

ANIMS = ["idle", "walk", "run", "jump"]
# Orden de filas en las hojas originales
SHEET_DIRS = {1: ["N", "NE", "E", "SE"], 2: ["S", "SW", "W", "NW"]}
# Orden de direcciones en el atlas final: empezando en S y girando en sentido
# horario en pantalla (S, SW, W, NW, N, NE, E, SE) -> índice = round(ángulo/45)
DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
NFRAMES = 6
FPS = {"idle": 6, "walk": 10, "run": 12, "jump": 10}


def frame_name(anim, d, i):
    return f"{anim}_{d}_{i}"


for p in (BUILD, OUT, REVIEW):
    os.makedirs(p, exist_ok=True)
