#!/usr/bin/env bash
# Iteración rápida: construye el modelo, renderiza las 3 vistas y compara con la referencia.
set -euo pipefail
cd "$(dirname "$0")"
xvfb-run -a blender -b -P scripts/build_model.py -- "$1" 2>&1 | grep -E "TOTAL|rror|Traceback" || true
python3 scripts/compare.py "$1"
python3 scripts/compare.py "$1" rows > "renders/iter/rows_$1.txt"
