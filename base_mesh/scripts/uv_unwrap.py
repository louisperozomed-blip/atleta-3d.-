"""Desenvuelve la jaula, mide las UVs y renderiza con una textura de cuadrícula.

Uso: RENDER_DIR=<carpeta> xvfb-run -a blender -b -P scripts/uv_unwrap.py -- <etiqueta>
Salida en renders/<carpeta>/: <tag>_uv.json (estadísticas), <tag>_uvpolys.json (polígonos UV para
dibujar el mapa con uv_layout.py) y <tag>_checker_{front,side,back,face,34}.png.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
UTAG = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'uv'
sys.argv = [sys.argv[0], '--', '5', 'uvbuild', '--no-render']
exec(open(os.path.join(HERE, 'build.py')).read())
import render as RND  # noqa: E402
import uv as UV       # noqa: E402

OUT = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'stage5'))
for f in ('uvbuild_validate.json',):
    if os.path.exists(os.path.join(OUT, f)):
        os.remove(os.path.join(OUT, f))
obj = bpy.data.objects['BaseMesh']
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.modifier_apply(modifier='Mirror')
labels = UV.unwrap(obj)
st = UV.stats(obj, labels)
print('UVSTATS', json.dumps({k: v for k, v in st.items() if k != 'texel_density'}))
for k, v in st['texel_density'].items():
    print('  ', k, v)
with open(os.path.join(OUT, f'{UTAG}_uv.json'), 'w') as fh:
    json.dump(st, fh, indent=1)
with open(os.path.join(OUT, f'{UTAG}_uvpolys.json'), 'w') as fh:
    json.dump(dict(labels=labels, polys=[[[round(float(c), 5) for c in q] for q in P] for P in UV.uv_polys(obj.data)]), fh)

# ---------------------------------------------------------------- render con cuadrícula
# textura de cuadrícula: 32 × 32 celdas blanco/gris con 8 × 8 zonas de color (para ver estiramiento
# y densidad de texel) -- la misma que usa el visor web
import numpy as np  # noqa: E402
N = 1024
yy, xx = np.mgrid[0:N, 0:N]
cell = ((xx // 32 + yy // 32) % 2).astype(float)
zone_h = ((xx // 128) * 3 + (yy // 128) * 5) % 8 / 8.0
import colorsys  # noqa: E402
pal = np.array([colorsys.hsv_to_rgb(h, 0.55, 0.95) for h in np.arange(8) / 8.0])
rgb = pal[(zone_h * 8).astype(int)] * (0.55 + 0.45 * cell)[..., None]
rgb[(xx % 32 == 0) | (yy % 32 == 0)] = 0.15
img = bpy.data.images.new('UVGrid', N, N)
px = np.concatenate([rgb, np.ones((N, N, 1))], 2).astype(np.float32)
img.pixels.foreach_set(px.ravel())
img.pack()
mat = bpy.data.materials.new('UVGrid')
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
nt.nodes.active = tex
obj.data.materials.clear()
obj.data.materials.append(mat)
cam = RND.setup_scene()
sc = bpy.context.scene
sc.display.shading.color_type = 'TEXTURE'
sc.display.shading.show_cavity = False
RND.render_views([obj], os.path.join(OUT, f'{UTAG}_checker'), setup=False)
sc.render.resolution_x = sc.render.resolution_y = 700
for name, loc, rot, scale, target in (
        ('face', (0, -3, 1.59), (math.pi / 2, 0, 0), 0.26, None),
        ('34', (2.2, -2.2, 1.0), (math.pi / 2, 0, math.pi / 4), 1.9, None),
        ('hand', (3.3, 0, 0.87), (math.pi / 2, 0, math.pi / 2), 0.22, None)):
    cam.location = loc
    cam.rotation_euler = rot
    cam.data.ortho_scale = scale
    sc.render.filepath = os.path.join(OUT, f'{UTAG}_checker_{name}.png')
    bpy.ops.render.render(write_still=True)
print('UV OK')
