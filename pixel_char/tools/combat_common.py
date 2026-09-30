"""Constantes de las animaciones de combate (hojas en ref/sheets_combate)."""
import json
import os

from common import BUILD, ROOT

CREF = os.path.join(ROOT, "ref", "sheets_combate")
CBUILD = os.path.join(BUILD, "combat")
CRAW = os.path.join(CBUILD, "raw")
CFIX = os.path.join(CBUILD, "fixed")
CREVIEW = os.path.join(ROOT, "review", "combat")
for p in (CBUILD, CRAW, CFIX, CREVIEW):
    os.makedirs(p, exist_ok=True)

CANIMS = ["attack1", "attack2", "attack3", "parry", "block", "dodge", "hit", "death"]
# hoja -> animación (death_2_alt es la variante de death_2: se extrae aparte como "deathalt")
CSHEETS = {f"{a}_{p}": (a, p) for a in CANIMS for p in (1, 2)}
CSHEETS["death_2_alt"] = ("deathalt", 2)
CFPS = {"attack1": 14, "attack2": 14, "attack3": 11, "parry": 16, "block": 12,
        "dodge": 16, "hit": 14, "death": 9}


def labels():
    with open(os.path.join(CREF, "labels.json")) as f:
        return json.load(f)


def rows_of(sheet):
    return labels()["sheets"][sheet]["rows"]
