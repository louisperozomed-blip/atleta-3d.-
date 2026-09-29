#!/bin/sh
# Una iteración de revisión: construir + validar + renderizar + comparar.
# Uso: sh scripts/iter.sh <etapa> <etiqueta> [zmin zmax]
cd "$(dirname "$0")/.."
xvfb-run -a blender -b -P scripts/build.py -- "$1" "$2" 2>&1 | sed -n '/^VALIDATE/,/^Blender quit/p' | grep -v "Blender quit"
python3 scripts/compare.py "$1" "$2" ${3:-0} ${4:-1.75}
