"""Test TEMPORAL de deformación (no forma parte del entregable: no hay rig en esta fase).

Uso: RENDER_DIR=<carpeta> xvfb-run -a blender -b -P scripts/deform_test.py -- <etiqueta>
Crea un esqueleto simple, lo emparenta con pesos automáticos y prueba varias poses:
  codos_rodillas  codos y rodillas 90°, hombros 30°+20°, caderas 35°
  brazo_arriba    brazo levantado 180° (clavícula 25° + húmero 138° desde la A-pose)
  brazo_adelante  brazo hacia delante 90°
  columna_cuello  columna doblada 30° hacia delante y 10° de lado, cuello 25° y cabeza 15°
  cadera_90       cadera flexionada 90° con la rodilla a 90° (sentada)
Pesos automáticos (bone heat) suavizados 3 veces (factor 0.5), el paso estándar al preparar un rig.
Para cada pose mide sobre la jaula deformada las auto-intersecciones (pares de caras que se
cruzan) y las caras aplastadas (área < 25 % de la de reposo), renderiza front/side/3-4 y
primeros planos con wireframe. Al final BORRA el esqueleto; no guarda el .blend.
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
DTAG = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'deform'
sys.argv = [sys.argv[0], '--', '5', 'deform', '--no-render']
exec(open(os.path.join(HERE, 'build.py')).read())
import render as RND  # noqa: E402

OUT = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 'stage5'))
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.startswith(f'{DTAG}_') or f == 'deform_validate.json':
        os.remove(os.path.join(OUT, f))
obj = bpy.data.objects['BaseMesh']
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.modifier_apply(modifier='Mirror')

# ---------------------------------------------------------------- esqueleto temporal
arm_data = bpy.data.armatures.new('TempRig')
rig = bpy.data.objects.new('TempRig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, h, t, parent=None, connect=False):
    b = eb.new(name)
    b.head, b.tail = Vector(h), Vector(t)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b


bone('hips', (0, 0, 0.88), (0, 0, 1.00))
bone('spine', (0, 0, 1.00), (0, 0, 1.20), 'hips', True)
bone('chest', (0, 0, 1.20), (0, 0, 1.40), 'spine', True)
bone('neck', (0, 0.01, 1.42), (0, 0.0, 1.50), 'chest')
bone('head', (0, 0.0, 1.50), (0, 0.0, 1.69), 'neck', True)
for s, sx in (('L', 1), ('R', -1)):
    bone(f'shoulder.{s}', (0.03 * sx, -0.01, 1.39), (0.14 * sx, -0.008, 1.38), 'chest')
    bone(f'upper_arm.{s}', (0.160 * sx, -0.008, 1.36), (0.228 * sx, 0.002, 1.135), f'shoulder.{s}')
    bone(f'forearm.{s}', (0.228 * sx, 0.002, 1.135), (0.310 * sx, -0.004, 0.960), f'upper_arm.{s}', True)
    bone(f'hand.{s}', (0.310 * sx, -0.004, 0.960), (0.345 * sx, -0.012, 0.790), f'forearm.{s}', True)
    bone(f'thigh.{s}', (0.093 * sx, -0.005, 0.86), (0.092 * sx, 0.006, 0.59), 'hips')
    bone(f'shin.{s}', (0.092 * sx, 0.006, 0.59), (0.095 * sx, 0.043, 0.17), f'thigh.{s}', True)
    bone(f'foot.{s}', (0.095 * sx, 0.043, 0.17), (0.102 * sx, -0.08, 0.03), f'shin.{s}', True)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
md = [m for m in obj.modifiers if m.type == 'ARMATURE'][0]
bpy.context.view_layer.objects.active = obj
while obj.modifiers.find(md.name) > 0:
    bpy.ops.object.modifier_move_up(modifier=md.name)
# suavizado de pesos (paso estándar después de los pesos automáticos) para no medir los
# escalones del bone heat en vez de la topología
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=3, expand=0.0)
bpy.ops.object.mode_set(mode='OBJECT')
empty_groups = [g.name for g in obj.vertex_groups
                if not any(g.index in [x.group for x in v.groups] for v in obj.data.vertices)]
print('grupos sin pesos:', empty_groups)
rest_area = [p.area for p in obj.data.polygons]

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
pose = rig.pose.bones


def reset():
    for pb in pose:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def rot(name, axis, deg):
    """Rota el hueso alrededor de un eje del mundo que pasa por su cabeza."""
    pb = pose[name]
    head = pb.head.copy()
    R = Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized())
    pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def both(fn):
    for s, sx in (('L', 1), ('R', -1)):
        fn(s, sx)


def p_codos(s, sx):
    rot(f'upper_arm.{s}', (0, 1, 0), -30 * sx)
    rot(f'upper_arm.{s}', (1, 0, 0), -20)
    fa = pose[f'forearm.{s}']
    rot(f'forearm.{s}', (fa.tail - fa.head).normalized().cross(Vector((0, -1, 0))), 90)
    rot(f'thigh.{s}', (1, 0, 0), -35)
    rot(f'thigh.{s}', (0, 1, 0), -12 * sx)
    rot(f'shin.{s}', (1, 0, 0), 90)


def p_arriba(s, sx):
    rot(f'shoulder.{s}', (0, 1, 0), -25 * sx)
    rot(f'upper_arm.{s}', (0, 1, 0), -138 * sx)


def p_adelante(s, sx):
    rot(f'shoulder.{s}', (1, 0, 0), -10)
    rot(f'upper_arm.{s}', (1, 0, 0), -80)
    rot(f'upper_arm.{s}', (0, 1, 0), 12 * sx)          # la A-pose ya abre el brazo 17°


def p_columna(s, sx):
    if s == 'L':
        rot('spine', (1, 0, 0), 15)
        rot('chest', (1, 0, 0), 15)
        rot('chest', (0, 1, 0), 10)
        rot('neck', (1, 0, 0), 25)
        rot('head', (1, 0, 0), 15)


def p_cadera(s, sx):
    rot(f'thigh.{s}', (1, 0, 0), -90)
    rot(f'shin.{s}', (1, 0, 0), 90)


POSES = [('codos_rodillas', p_codos, [('elbow', 'forearm.L', 0.30, 'out'), ('knee', 'shin.L', 0.40, 'out')]),
         ('brazo_arriba', p_arriba, [('hombro', 'upper_arm.L', 0.36, 'front'), ('hombro_back', 'upper_arm.L', 0.36, 'back')]),
         ('brazo_adelante', p_adelante, [('hombro', 'upper_arm.L', 0.36, 'out'), ('axila', 'upper_arm.L', 0.36, 'front')]),
         ('columna_cuello', p_columna, [('cuello', 'neck', 0.40, 'out')]),
         ('cadera_90', p_cadera, [('cadera', 'thigh.L', 0.50, 'out'), ('gluteo', 'thigh.L', 0.50, 'back')])]
CAM = {'front': ((0, -3, 0), (math.pi / 2, 0, 0)), 'back': ((0, 3, 0), (math.pi / 2, 0, math.pi)),
       'out': ((3, 0, 0), (math.pi / 2, 0, math.pi / 2))}


def measure(joint):
    obj.modifiers['Subdivision'].show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    bm = bmesh.new()
    bm.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    obj.modifiers['Subdivision'].show_viewport = True
    bm.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    pairs = [(a, b) for a, b in bvh.overlap(bvh) if a < b and not (
        set(v.index for v in bm.faces[a].verts) & set(v.index for v in bm.faces[b].verts))]
    crushed = sum(1 for f, a0 in zip(bm.faces, rest_area) if f.calc_area() < 0.25 * a0)
    near = sum(1 for a, _ in pairs if (bm.faces[a].calc_center_median() - joint).length < 0.15)
    where = [[round(c, 3) for c in bm.faces[a].calc_center_median()] for a, _ in pairs[:8]]
    bm.free()
    return dict(self_intersections=len(pairs), near_joint=near, crushed_faces=crushed, where=where)


cam = RND.setup_scene()
sc = bpy.context.scene
rig.hide_render = True
results = {}
bpy.ops.object.mode_set(mode='OBJECT')
for name, fn, shots in POSES:
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    reset()
    both(fn)
    bpy.ops.object.mode_set(mode='OBJECT')
    j = rig.matrix_world @ pose[shots[0][1]].head
    results[name] = measure(j)
    print('POSE', name, results[name])
    sc.render.resolution_x, sc.render.resolution_y = RND.W, RND.H
    cam.data.ortho_scale = RND.ORTHO
    for o in sc.objects:
        o.hide_render = o not in (obj, cam)
    RND.render_views([obj], os.path.join(OUT, f'{DTAG}_{name}'), views=('front', 'side'), setup=False)
    cam.location = (-2.2, -3.2, 1.0)
    cam.rotation_euler = (math.radians(85), 0, math.radians(-34))
    sc.render.filepath = os.path.join(OUT, f'{DTAG}_{name}_34.png')
    bpy.ops.render.render(write_still=True)
    w = RND.make_wire_overlay(obj, thickness=0.0010)
    obj.modifiers['Subdivision'].show_render = False
    sc.render.resolution_x = sc.render.resolution_y = 600
    for sname, target, scale, view in shots:
        c = rig.matrix_world @ pose[target].head
        d, r = CAM[view]
        cam.data.ortho_scale = scale
        cam.location = (c.x + d[0], c.y + d[1], c.z + d[2])
        cam.rotation_euler = r
        for o in sc.objects:
            o.hide_render = o not in (obj, w, cam)
        sc.render.filepath = os.path.join(OUT, f'{DTAG}_{name}_{sname}_wire.png')
        bpy.ops.render.render(write_still=True)
    obj.modifiers['Subdivision'].show_render = True
    bpy.data.objects.remove(w, do_unlink=True)

with open(os.path.join(OUT, f'{DTAG}_deform.json'), 'w') as fh:
    json.dump(results, fh, indent=1)

# ---------------------------------------------------------------- borrar el esqueleto
obj.modifiers.remove(md)
obj.vertex_groups.clear()
obj.parent = None
bpy.data.objects.remove(rig, do_unlink=True)
bpy.data.armatures.remove(arm_data)
print('ARMATURE BORRADO:', 'TempRig' not in bpy.data.objects, 'modificadores:', [m.type for m in obj.modifiers])
