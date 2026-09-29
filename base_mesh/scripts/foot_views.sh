#!/bin/sh
# Pie: hoja (FRONT / SIDE) contra el modelo en la misma ventana + primeros planos con wireframe.
# Uso: RENDER_DIR=... sh scripts/foot_views.sh <etiqueta>
cd "$(dirname "$0")/.."
D=renders/${RENDER_DIR:-stage5}
xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_foot_out.png 0.10 0 0.07 0.28 out >/dev/null 2>&1
xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_foot_34.png 0.10 0 0.07 0.28 34 >/dev/null 2>&1
rm -f $D/closeup_validate.json
python3 - "$D" "$1" <<'PY'
import sys
from PIL import Image
d, t = sys.argv[1], sys.argv[2]
P = 921 / 1.7
def crop(p, cx, cz, h=0.26):
    im = Image.open(p); c = 200 + cx * P; r = 940 - cz * P; s = h * P
    return im.crop((int(c - s / 2), int(r - s / 2), int(c + s / 2), int(r + s / 2))).resize((330, 330))
row = [crop('reference/ref_front.png', 0.10, 0.10), crop(f'{d}/{t}_front.png', 0.10, 0.10),
       crop('reference/ref_side.png', 0.0, 0.10), crop(f'{d}/{t}_side.png', 0.0, 0.10)]
W = Image.new('RGB', (1320 + 20, 330 + 450), (30, 30, 30))
for i, x in enumerate(row):
    W.paste(x, (335 * i, 0))
for i, v in enumerate(('out', '34')):
    W.paste(Image.open(f'{d}/{t}_foot_{v}.png').resize((450, 450)), (450 * i, 330))
W.save(f'{d}/{t}_foot.jpg', quality=88)
PY
