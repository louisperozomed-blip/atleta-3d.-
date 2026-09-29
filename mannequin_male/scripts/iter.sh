#!/bin/sh
# Una iteración: construir + validar + renderizar + comparar con la hoja.
# Uso: RENDER_DIR=<carpeta> sh scripts/iter.sh <etiqueta> [zmin zmax] [-v]
cd "$(dirname "$0")/.."
xvfb-run -a blender -b -P scripts/build.py -- "$1" 2>&1 | sed -n '/^VALIDATE/,/^Blender quit/p' | grep -v "Blender quit\|Saved\|Time\|^$"
python3 scripts/compare.py "$1" ${2:-0} ${3:-1.80} $4
