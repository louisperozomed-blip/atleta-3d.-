"""Construye el base mesh en Blender (headless), valida y renderiza una etapa.

Uso:
  xvfb-run -a blender -b -P scripts/build.py -- <etapa 1..5> <etiqueta> [--save] [--no-render]

- Crea la media malla (x >= 0) desde body.py con Mirror en X (clipping + merge) y
  Subdivision Surface nivel 1 (LOD0), sombreado suave.
- Valida la malla completa (Mirror aplicado, sin subdivisión) con validate.py.
- Renderiza front/side/back en arcilla y con el wireframe de la jaula superpuesto.
"""
import json
import os
import sys

import bpy
import bmesh
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
for mod in ('params', 'topo', 'body', 'render', 'validate'):
    sys.modules.pop(mod, None)
import body as BODY          # noqa: E402
import render as RND         # noqa: E402
import validate as VAL       # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['5', 'test']
STAGE = int(argv[0])
TAG = argv[1] if len(argv) > 1 else f's{STAGE}'
SAVE = '--save' in argv
RENDER = '--no-render' not in argv


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.armatures):
        for d in list(coll):
            coll.remove(d)


def build_object(stage):
    b = BODY.Body(stage)
    m = b.m
    me = bpy.data.meshes.new('BaseMesh')
    me.from_pydata([tuple(v) for v in m.V], [], [list(f) for f in m.F])
    me.update()
    obj = bpy.data.objects.new('BaseMesh', me)
    bpy.context.scene.collection.objects.link(obj)
    # normales consistentes en la media malla
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
    sub = obj.modifiers.new('Subdivision', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    sub.quality = 3
    for p in me.polygons:
        p.use_smooth = True
    obj.color = (*RND.CLAY, 1)
    # orientación global: volumen con signo de la malla completa > 0 (normales hacia fuera)
    full = full_bmesh(obj)
    vol = sum(f.calc_center_median().dot(f.normal) * f.calc_area() for f in full.faces) / 3.0
    full.free()
    if vol < 0:
        me.flip_normals()
    tag_islands(obj, b)
    return obj, b


ISLANDS = {'torso_front': 1, 'torso_back': 2, 'neck': 3, 'head': 4, 'leg': 5, 'arm': 6,
           'hand_d': 7, 'hand_p': 8, 'foot': 9}


def tag_islands(obj, b):
    """Atributo de cara 'island' (isla UV) y costuras: las marcadas al modelar (costados, interior
    de brazos y piernas, nuca...) y todas las aristas entre caras de islas distintas. La mano se
    separa en dorso y palma según la normal de cada cara (los laterales de los dedos: el que mira
    al pulgar va con el dorso y el otro con la palma)."""
    me = obj.data
    m = b.m
    hf = getattr(b, 'hand_frame', None)
    codes = []
    for poly, tag in zip(me.polygons, m.FT):
        finger = tag.startswith('finger') if tag else False
        if tag in ('hand', 'hand_web') or finger:
            w, f = hf['w'], hf['f']
            n = np.array(poly.normal)
            dn = float(n @ w)
            dors = tag == 'hand_web' or dn > 0.45 or (abs(dn) <= 0.45 and float(n @ f) > 0)
            if tag == 'finger4':                         # pulgar: una sola isla (costura propia)
                codes.append(28)
                continue
            if finger:                                   # cada dedo: isla de dorso y de palma
                codes.append(20 + 2 * int(tag[6:]) + (0 if dors else 1))
                continue
            tag = 'hand_d' if dors else 'hand_p'
        codes.append(ISLANDS.get(tag, 0))
    attr = me.attributes.get('island') or me.attributes.new('island', 'INT', 'FACE')
    attr.data.foreach_set('value', codes)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    seams = {frozenset(e) for e in m.seams}
    n_seam = 0
    for e in bm.edges:
        key = frozenset(v.index for v in e.verts)
        fs = e.link_faces
        diff = len(fs) == 2 and codes[fs[0].index] != codes[fs[1].index]
        if key in seams or diff:
            e.seam = True
            n_seam += 1
    bm.to_mesh(me)
    bm.free()
    b.n_seam_half = n_seam


def full_bmesh(obj, subsurf=False):
    """bmesh de la malla completa evaluada (Mirror aplicado; Subdivision opcional)."""
    sub = obj.modifiers.get('Subdivision')
    old = sub.show_viewport if sub else None
    if sub:
        sub.show_viewport = subsurf
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = obj.evaluated_get(dg)
    bm = bmesh.new()
    bm.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    if sub:
        sub.show_viewport = old
    return bm


def main():
    clear_scene()
    obj, b = build_object(STAGE)
    out_dir = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', f'stage{STAGE}'))
    os.makedirs(out_dir, exist_ok=True)
    bm = full_bmesh(obj)
    rep = VAL.validate(bm, expect_closed=(STAGE == 5))
    bm.free()
    rep['stage'] = STAGE
    rep['tag'] = TAG
    rep['poles_expected'] = {k: len(v) for k, v in b.poles_expected.items()}
    with open(os.path.join(out_dir, f'{TAG}_validate.json'), 'w') as fh:
        json.dump(rep, fh, indent=1, ensure_ascii=False)
    print(f'VALIDATE stage {STAGE} {TAG}\n' + VAL.summary(rep))
    if RENDER:
        RND.render_views([obj], os.path.join(out_dir, TAG))
        RND.render_masks(obj, os.path.join(out_dir, TAG + '_mask'))
        w = RND.make_wire_overlay(obj)
        obj.modifiers['Subdivision'].show_render = False
        RND.render_views([obj, w], os.path.join(out_dir, TAG + '_wire'))
        obj.modifiers['Subdivision'].show_render = True
        bpy.data.objects.remove(w, do_unlink=True)
    if SAVE:
        os.makedirs(os.path.join(ROOT, 'export'), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'export', f'stage{STAGE}.blend'))


main()
