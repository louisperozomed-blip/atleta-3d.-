"""Primer plano de una zona (mano, cabeza...) con wireframe, para revisar la topología.
Uso: blender -b -P scripts/closeup.py -- <etapa> <salida.png> cx cy cz escala vista [subsurf]"""
import os, sys
import bpy
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.argv_saved = sys.argv
a = sys.argv[sys.argv.index('--') + 1:]
sys.argv = [sys.argv[0], '--', a[0], 'closeup', '--no-render']
exec(open(os.path.join(HERE, 'build.py')).read())
import render as RND
import numpy as np
obj = bpy.data.objects['BaseMesh']
out, cx, cy, cz, sc, view = a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]), a[6]
cam = RND.setup_scene()
bpy.context.scene.render.resolution_x = bpy.context.scene.render.resolution_y = 700
cam.data.ortho_scale = sc
dirs = {'front': ((0, -1, 0), (np.pi / 2, 0, 0)), 'side': ((-1, 0, 0), (np.pi / 2, 0, -np.pi / 2)),
        'back': ((0, 1, 0), (np.pi / 2, 0, np.pi)), 'out': ((1, 0, 0), (np.pi / 2, 0, np.pi / 2)),
        '34': ((0.7071, -0.7071, 0), (np.pi / 2, 0, np.pi / 4)),
        'in': ((-1, 0, 0), (np.pi / 2, 0, -np.pi / 2))}
d, rot = dirs[view]
cam.location = (cx + 3 * d[0], cy + 3 * d[1], cz + 3 * d[2])
cam.rotation_euler = rot
if view == 'in':
    obj.modifiers['Mirror'].show_render = False
clay = len(a) > 7
w = RND.make_wire_overlay(obj, thickness=0.0008)
obj.modifiers['Subdivision'].show_render = clay
if clay:
    w.hide_render = True
for o in bpy.context.scene.objects:
    o.hide_render = o not in ((obj, cam) if clay else (obj, w, cam))
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
