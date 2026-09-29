#!/bin/sh
# Deja solo las comparativas (sidebyside/overlay/silhouette/validate) de las iteraciones
# intermedias y conserva los renders individuales de la iteración final de la etapa.
# Uso: sh scripts/prune.sh <etapa o carpeta de renders> <etiqueta_final>
cd "$(dirname "$0")/../renders" || exit 1
if [ -d "$1" ]; then cd "$1"; else cd "stage$1" || exit 1; fi
for f in *[0-9][a-z]_*front.png *[0-9][a-z]_*side.png *[0-9][a-z]_*back.png; do
  case "$f" in "$2"_*) ;; *) rm -f "$f" ;; esac
done
rm -f *_mask_*.png *_overlay.png *_sidebyside.png
# primeros planos: solo el montaje .jpg de las iteraciones intermedias
for f in *_face_*.png; do case "$f" in "$2"_*) ;; *) rm -f "$f" ;; esac; done
