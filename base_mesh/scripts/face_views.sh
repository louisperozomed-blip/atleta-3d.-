#!/bin/sh
# Primeros planos de la cabeza (front / lado / 3-4, con y sin wireframe) para revisar la cara.
# Uso: sh scripts/face_views.sh <etiqueta>   (salida en renders/$RENDER_DIR/<etiqueta>_face_*.png)
cd "$(dirname "$0")/.."
D=renders/${RENDER_DIR:-stage5}
for v in front out 34; do
  xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_face_$v.png 0.0 -0.02 1.595 0.26 $v >/dev/null 2>&1
  xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_face_${v}_s.png 0.0 -0.02 1.595 0.26 $v 1 >/dev/null 2>&1
done
rm -f $D/closeup_validate.json
python3 - "$D" "$1" <<'PY'
import sys
from PIL import Image
d, t = sys.argv[1], sys.argv[2]
ims = [Image.open(f'{d}/{t}_face_{v}{s}.png').resize((420, 420)) for s in ('', '_s') for v in ('front', 'out', '34')]
ref = Image.open('reference/panel_head.png')
ref = ref.resize((int(ref.width * 420 / ref.height), 420))
W = Image.new('RGB', (420 * 3 + ref.width, 840), (30, 30, 30))
for i, im in enumerate(ims):
    W.paste(im, (420 * (i % 3), 420 * (i // 3)))
W.paste(ref, (1260, 0))
W.save(f'{d}/{t}_face.jpg', quality=88)
PY
