#!/bin/sh
# Deja solo las comparativas (sidebyside/overlay/silhouette/validate) de las iteraciones
# intermedias y conserva los renders individuales de la iteración final de la etapa.
# Uso: sh scripts/prune.sh <etapa> <etiqueta_final>
cd "$(dirname "$0")/../renders/stage$1" || exit 1
for f in s[0-9][a-z]_*front.png s[0-9][a-z]_*side.png s[0-9][a-z]_*back.png; do
  case "$f" in "$2"_*) ;; *) rm -f "$f" ;; esac
done
rm -f *_mask_*.png *_overlay.png *_sidebyside.png
