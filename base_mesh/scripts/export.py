"""Exporta los entregables del base mesh.

Uso: xvfb-run -a blender -b -P scripts/export.py
  export/base_mesh.blend      malla completa (Mirror aplicado), Subdivision nivel 1 SIN aplicar
  export/base_mesh_LOD1.fbx/.glb  jaula (quads)
  export/base_mesh_LOD0.fbx/.glb  Subdivision nivel 1 aplicada
  export/base_mesh_stats.json    conteos de cada LOD + validación final + estadísticas UV
  web/base_mesh_LOD0.json / _LOD1.json   vértices + quads + UV por esquina para el visor web
"""
import json
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0], '--', '5', 'final', '--no-render']
exec(open(os.path.join(HERE, 'build.py')).read())
import validate as VAL  # noqa: E402

EXP = os.path.join(ROOT, 'export')
WEB = os.path.join(ROOT, 'web')
os.makedirs(EXP, exist_ok=True)
os.makedirs(WEB, exist_ok=True)
for f in os.listdir(os.path.join(ROOT, 'renders', 'stage5')):
    if f.startswith('final_'):
        os.remove(os.path.join(ROOT, 'renders', 'stage5', f))

obj = bpy.data.objects['BaseMesh']
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
# 1) unión final: aplicar el Mirror -> una sola malla continua y cerrada
bpy.ops.object.modifier_apply(modifier='Mirror')
me = obj.data
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
obj.color = (1, 1, 1, 1)
mat = bpy.data.materials.new('Clay')
mat.diffuse_color = (0.62, 0.62, 0.62, 1)
mat.roughness = 0.8
if mat.node_tree is None:
    mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
if bsdf:
    bsdf.inputs['Base Color'].default_value = (0.62, 0.62, 0.62, 1)
    bsdf.inputs['Roughness'].default_value = 0.8
me.materials.append(mat)
# 2) UVs de la jaula (el LOD0 las hereda de la Subdivision)
import uv as UV  # noqa: E402
labels = UV.unwrap(obj)
uv_stats = UV.stats(obj, labels)
print('UV', {k: v for k, v in uv_stats.items() if k != 'texel_density'})
for c in ('RenderCam',):
    o = bpy.data.objects.get(c)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)


def stats(subsurf):
    bm = bmesh.new()
    if subsurf:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        bm.from_mesh(ev.to_mesh())
        ev.to_mesh_clear()
    else:
        bm.from_mesh(me)
    r = VAL.validate(bm, expect_closed=True)
    r['triangles_when_triangulated'] = sum(len(f.verts) - 2 for f in bm.faces)
    uvl = bm.loops.layers.uv.active
    data = dict(v=[round(c, 5) for v in bm.verts for c in v.co],
                q=[v.index for f in bm.faces for v in f.verts],
                uv=[round(c, 4) for f in bm.faces for lo in f.loops for c in lo[uvl].uv])
    bm.free()
    return r, data


sub = obj.modifiers['Subdivision']
sub.show_viewport = False
lod1, web1 = stats(False)
sub.show_viewport = True
lod0, web0 = stats(True)
for name, d in (('LOD1', web1), ('LOD0', web0)):
    with open(os.path.join(WEB, f'base_mesh_{name}.json'), 'w') as fh:
        json.dump(d, fh, separators=(',', ':'))
keys = ['verts', 'faces', 'quads', 'tris', 'ngons', 'triangles_when_triangulated', 'poles_3', 'poles_5',
        'poles_gt5', 'boundary_edges', 'nonmanifold_edges', 'duplicate_verts', 'duplicate_faces',
        'internal_faces', 'degenerate_faces', 'self_intersections', 'flipped_normals', 'normals_outward',
        'symmetry_error', 'bbox']
out = {'LOD1_cage': {k: lod1[k] for k in keys}, 'LOD0_subdiv1': {k: lod0[k] for k in keys},
       'poles_in_joint_zone': lod1['poles_in_joint_zone'],
       'pole_list_5': lod1['pole_list_5'], 'pole_list_3': lod1['pole_list_3'], 'uv': uv_stats}
with open(os.path.join(EXP, 'base_mesh_stats.json'), 'w') as fh:
    json.dump(out, fh, indent=1, ensure_ascii=False)
print('STATS', json.dumps({k: out[k] for k in ('LOD1_cage', 'LOD0_subdiv1')}, indent=1))

# 3) .blend con la Subdivision sin aplicar
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(EXP, 'base_mesh.blend'))


def export(name, apply_mods):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(EXP, f'base_mesh_{name}.fbx'), use_selection=True, object_types={'MESH'},
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', global_scale=1.0,
        axis_forward='-Z', axis_up='Y', bake_space_transform=True,
        use_mesh_modifiers=apply_mods, mesh_smooth_type='FACE', use_tspace=False)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(EXP, f'base_mesh_{name}.glb'), export_format='GLB', use_selection=True,
        export_apply=apply_mods, export_normals=True, export_texcoords=True, export_materials='EXPORT')


export('LOD1', False)
export('LOD0', True)
print('EXPORT OK')
