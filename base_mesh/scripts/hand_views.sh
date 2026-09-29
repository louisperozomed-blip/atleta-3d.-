#!/bin/sh
# Mano: hoja (front/side/back) contra el modelo en la misma ventana, más primeros planos con
# wireframe (dorso y perfil). Uso: RENDER_DIR=... sh scripts/hand_views.sh <etiqueta>
cd "$(dirname "$0")/.."
D=renders/${RENDER_DIR:-stage5}
xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_hand_out.png 0.33 0 0.87 0.2 out >/dev/null 2>&1
xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_hand_front.png 0.33 0 0.87 0.2 front >/dev/null 2>&1
rm -f $D/closeup_validate.json
python3 - "$D" "$1" <<'PY'
import sys
from PIL import Image
d, t = sys.argv[1], sys.argv[2]
P = 921 / 1.7
def crop(p, cx, cz, h=0.22):
    im = Image.open(p); c = 200 + cx * P; r = 940 - cz * P; s = h * P
    return im.crop((int(c - s / 2), int(r - s / 2), int(c + s / 2), int(r + s / 2))).resize((330, 330))
row = [crop('reference/ref_front.png', 0.325, 0.88), crop(f'{d}/{t}_front.png', 0.325, 0.88),
       crop('reference/ref_side.png', 0.0, 0.88), crop(f'{d}/{t}_side.png', 0.0, 0.88),
       crop('reference/ref_back.png', -0.325, 0.88), crop(f'{d}/{t}_back.png', -0.325, 0.88)]
W = Image.new('RGB', (330 * 6, 330 + 500), (30, 30, 30))
for i, x in enumerate(row):
    W.paste(x, (330 * i, 0))
for i, v in enumerate(('out', 'front')):
    W.paste(Image.open(f'{d}/{t}_hand_{v}.png').resize((500, 500)), (500 * i, 330))
W.save(f'{d}/{t}_hand.jpg', quality=88)
PY
