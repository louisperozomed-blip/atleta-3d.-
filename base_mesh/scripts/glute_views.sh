#!/bin/sh
# Primeros planos de la pelvis (detrás / lado, wireframe y arcilla) junto a la hoja (BACK y SIDE).
# Uso: RENDER_DIR=... sh scripts/glute_views.sh <etiqueta>
cd "$(dirname "$0")/.."
D=renders/${RENDER_DIR:-stage5}
for v in back out; do
  xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_glute_$v.png 0.0 0.0 0.93 0.42 $v >/dev/null 2>&1
  xvfb-run -a blender -b -P scripts/closeup.py -- 5 $D/$1_glute_${v}_s.png 0.0 0.0 0.93 0.42 $v 1 >/dev/null 2>&1
done
rm -f $D/closeup_validate.json
python3 - "$D" "$1" <<'PY'
import sys
from PIL import Image
d, t = sys.argv[1], sys.argv[2]
P = 921 / 1.7
ims = [Image.open(f'{d}/{t}_glute_{v}{s}.png').resize((400, 400)) for v in ('back', 'out') for s in ('', '_s')]
# misma ventana (0.42 m centrada en z 0.93) recortada de la hoja
refs = []
for v, cx in (('back', 200), ('side', 200)):
    r = Image.open(f'reference/ref_{v}.png')
    h = 0.42 * P
    top = 940 - (0.93 + 0.21) * P
    c = r.crop((int(cx - h / 2), int(top), int(cx + h / 2), int(top + h))).resize((400, 400))
    refs.append(c.transpose(Image.FLIP_LEFT_RIGHT) if v == 'side' else c)   # misma orientación que la vista 'out'
W = Image.new('RGB', (400 * 3, 800), (30, 30, 30))
for k, im in enumerate([ims[0], ims[1], refs[0], ims[2], ims[3], refs[1]]):
    W.paste(im, (400 * (k % 3), 400 * (k // 3)))
W.save(f'{d}/{t}_glute.jpg', quality=88)
PY
