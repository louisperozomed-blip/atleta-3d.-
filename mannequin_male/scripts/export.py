"""Exporta los entregables del maniquí masculino.

Uso: xvfb-run -a blender -b -P scripts/export.py
  export/mannequin_male.blend   una sola malla (Mirror aplicado), sombreado plano, SIN modificadores,
                                sin cámaras ni luces; origen entre los pies, metros
  export/mannequin_male.fbx     la misma malla (caras planas: normales por cara), Y arriba / -Z delante
  export/mannequin_male.glb     la misma malla en glTF binario (normales planas)
  export/mannequin_male_stats.json   validación final, polos, transiciones de la tabla
  web/mannequin_male.json       vértices + quads para el visor web
"""
import json
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0], '--', 'final', '--no-render']
os.environ.setdefault('RENDER_DIR', 's6_final')
for mod in ('build', 'figure', 'mesh', 'render', 'validate'):
    sys.modules.pop(mod, None)
import build as B       # noqa: E402
import validate as VAL  # noqa: E402

EXP = os.path.join(ROOT, 'export')
WEB = os.path.join(ROOT, 'web')
os.makedirs(EXP, exist_ok=True)
os.makedirs(WEB, exist_ok=True)

obj, fig = B.main()
obj.name = obj.data.name = 'mannequin_male'
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
# unión final: se aplica el Mirror -> una sola malla cerrada; no queda ningún modificador
bpy.ops.object.modifier_apply(modifier='Mirror')
assert not obj.modifiers
me = obj.data
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = False                       # facetado: cada cara es un plano
obj.color = (1, 1, 1, 1)
mat = bpy.data.materials.new('Clay')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.72, 0.71, 0.70, 1)
bsdf.inputs['Roughness'].default_value = 0.85
mat.diffuse_color = (0.72, 0.71, 0.70, 1)
me.materials.clear()
me.materials.append(mat)
for o in list(bpy.data.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)

bm = bmesh.new()
bm.from_mesh(me)
rep = VAL.validate(bm, expect_closed=True)
data = dict(v=[round(c, 5) for v in bm.verts for c in v.co], q=[v.index for f in bm.faces for v in f.verts])
bm.free()
with open(os.path.join(WEB, 'mannequin_male.json'), 'w') as fh:
    json.dump(data, fh, separators=(',', ':'))
keys = ['verts', 'edges', 'faces', 'quads', 'tris', 'ngons', 'tris_triangulated', 'poles_3', 'poles_5',
        'poles_gt5', 'boundary_edges', 'nonmanifold_edges', 'edges_gt2_faces', 'loose_edges', 'loose_verts',
        'duplicate_verts', 'duplicate_faces', 'internal_faces', 'degenerate_faces', 'self_intersections',
        'flipped_normals', 'normals_outward', 'symmetry_error', 'center_verts_off_plane', 'bbox']
out = {'mesh': {k: rep[k] for k in keys}, 'modifiers': [m.name for m in obj.modifiers],
       'smooth_faces': sum(p.use_smooth for p in me.polygons),
       'poles_in_joint_zone': rep['poles_in_joint_zone'], 'pole_list_5': rep['pole_list_5'],
       'pole_list_3': rep['pole_list_3'], 'transitions': fig.m.log,
       'poles_by_design': {k: len(v) for k, v in fig.poles.items()}}
with open(os.path.join(EXP, 'mannequin_male_stats.json'), 'w') as fh:
    json.dump(out, fh, indent=1, ensure_ascii=False)
print('STATS', json.dumps(out['mesh'], indent=1))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(EXP, 'mannequin_male.blend'), compress=True)
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.ops.export_scene.fbx(
    filepath=os.path.join(EXP, 'mannequin_male.fbx'), use_selection=True, object_types={'MESH'},
    apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', global_scale=1.0,
    axis_forward='-Z', axis_up='Y', bake_space_transform=True,
    use_mesh_modifiers=False, mesh_smooth_type='FACE', use_tspace=False)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(EXP, 'mannequin_male.glb'), export_format='GLB', use_selection=True,
    export_apply=False, export_normals=True, export_texcoords=False, export_materials='EXPORT')
print('EXPORT OK')
