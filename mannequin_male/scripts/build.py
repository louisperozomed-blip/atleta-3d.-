"""Construye el maniquí en Blender (headless), valida y renderiza.

Uso: RENDER_DIR=<carpeta> xvfb-run -a blender -b -P scripts/build.py -- <etiqueta> [--no-render] [--save]
- Media malla de figure.py con Mirror en X (clipping + merge), sombreado plano, sin subdivisión.
- Valida la malla completa (Mirror aplicado) con validate.py.
- Renderiza front/side/back: arcilla clara con aristas oscuras, arcilla sin aristas y máscara.
"""
import json
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
for mod in ('mesh', 'figure', 'render', 'validate'):
    sys.modules.pop(mod, None)
import figure as FIG     # noqa: E402
import render as RND     # noqa: E402
import validate as VAL   # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['test']
TAG = argv[0]
RENDER = '--no-render' not in argv
SAVE = '--save' in argv
OUT = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'test'))


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.armatures):
        for d in list(coll):
            coll.remove(d)


def build_object():
    f = FIG.Figure()
    m = f.m
    me = bpy.data.meshes.new('Mannequin')
    me.from_pydata([tuple(v) for v in m.V], [], [list(x) for x in m.F])
    me.update()
    obj = bpy.data.objects.new('Mannequin', me)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    mir = obj.modifiers.new('Mirror', 'MIRROR')
    mir.use_axis = (True, False, False)
    mir.use_clip = True
    mir.use_mirror_merge = True
    mir.merge_threshold = 1e-4
    for p in me.polygons:
        p.use_smooth = False                     # sombreado plano: cada cara es un plano
    obj.color = (*RND.CLAY, 1)
    full = full_bmesh(obj)
    vol = sum(fc.calc_center_median().dot(fc.normal) * fc.calc_area() for fc in full.faces) / 3.0
    full.free()
    if vol < 0:
        me.flip_normals()
    return obj, f


def full_bmesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = obj.evaluated_get(dg)
    bm = bmesh.new()
    bm.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    return bm


def main():
    clear_scene()
    obj, f = build_object()
    os.makedirs(OUT, exist_ok=True)
    bm = full_bmesh(obj)
    rep = VAL.validate(bm, expect_closed=True)
    bm.free()
    rep['tag'] = TAG
    rep['transitions'] = f.m.log
    rep['poles_by_design'] = {k: len(v) for k, v in f.poles.items()}
    with open(os.path.join(OUT, f'{TAG}_validate.json'), 'w') as fh:
        json.dump(rep, fh, indent=1, ensure_ascii=False)
    print(f'VALIDATE {TAG}\n' + VAL.summary(rep))
    if RENDER:
        RND.render_masks(obj, os.path.join(OUT, TAG + '_mask'))
        RND.render_views([obj], os.path.join(OUT, TAG + '_clay'))
        e = RND.edge_overlay(obj)
        RND.render_views([obj, e], os.path.join(OUT, TAG))
        bpy.data.objects.remove(e, do_unlink=True)
    if SAVE:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{TAG}.blend'))
    return obj, f


if __name__ == '__main__':
    main()
