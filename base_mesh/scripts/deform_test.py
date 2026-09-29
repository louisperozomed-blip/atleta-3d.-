"""Test TEMPORAL de deformación (no forma parte del entregable: no hay rig en esta fase).

Uso: xvfb-run -a blender -b -P scripts/deform_test.py
Crea un esqueleto simple, lo emparenta con pesos automáticos, dobla codos y rodillas 90°,
abduce los hombros y flexiona las caderas, renderiza y BORRA el esqueleto. No guarda el .blend.
Salida: renders/deform_test_{front,side,34}.png, renders/deform_test_{elbow,knee}_wire.png
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0], '--', '5', 'deform', '--no-render']
exec(open(os.path.join(HERE, 'build.py')).read())
import render as RND  # noqa: E402

for f in os.listdir(os.path.join(ROOT, 'renders', 'stage5')):
    if f.startswith('deform_'):
        os.remove(os.path.join(ROOT, 'renders', 'stage5', f))
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

# pesos automáticos (heat) y el Armature antes de la Subdivision
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
md = [m for m in obj.modifiers if m.type == 'ARMATURE'][0]
bpy.context.view_layer.objects.active = obj
while obj.modifiers.find(md.name) > 0:
    bpy.ops.object.modifier_move_up(modifier=md.name)
empty_groups = [g.name for g in obj.vertex_groups
                if not any(g.index in [x.group for x in v.groups] for v in obj.data.vertices)]
print('grupos sin pesos:', empty_groups)

# ---------------------------------------------------------------- pose de prueba
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')


def rotate_world(pb, axis, deg):
    """Rota el hueso alrededor de un eje del mundo que pasa por su cabeza."""
    head = pb.head.copy()
    R = Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized())
    pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


pose = rig.pose.bones
for s, sx in (('L', 1), ('R', -1)):
    rotate_world(pose[f'upper_arm.{s}'], (0, 1, 0), -30 * sx)       # hombro: abducción 30°
    rotate_world(pose[f'upper_arm.{s}'], (1, 0, 0), -20)            # y flexión 20°
    fa = pose[f'forearm.{s}']
    d = (fa.tail - fa.head).normalized()
    ax = d.cross(Vector((0, -1, 0)))
    rotate_world(fa, ax, 90)                                         # codo 90°
    rotate_world(pose[f'thigh.{s}'], (1, 0, 0), -35)                # cadera: flexión 35°
    rotate_world(pose[f'thigh.{s}'], (0, 1, 0), -12 * sx)           # y abducción 12°
    rotate_world(pose[f'shin.{s}'], (1, 0, 0), 90)                  # rodilla 90°
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- renders
out = os.path.join(ROOT, 'renders', 'stage5')
cam = RND.setup_scene()
sc = bpy.context.scene
rig.hide_render = True
RND.render_views([obj], os.path.join(out, 'deform_test'), views=('front', 'side'))
cam.location = (-2.2, -3.2, 1.0)
cam.rotation_euler = (math.radians(85), 0, math.radians(-34))
sc.render.filepath = os.path.join(out, 'deform_test_34.png')
bpy.ops.render.render(write_still=True)
# primeros planos con el wireframe de la jaula deformada (codo y rodilla)
w = RND.make_wire_overlay(obj, thickness=0.0010)
w.modifiers.remove(w.modifiers['Mirror']) if w.modifiers.get('Mirror') else None
obj.modifiers['Subdivision'].show_render = False
sc.render.resolution_x = sc.render.resolution_y = 700
for name, target, scale in (('elbow', 'forearm.L', 0.30), ('knee', 'shin.L', 0.40)):
    c = rig.matrix_world @ pose[target].head
    cam.data.ortho_scale = scale
    cam.location = (c.x + 3, c.y, c.z)
    cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    for o in sc.objects:
        o.hide_render = o not in (obj, w, cam)
    sc.render.filepath = os.path.join(out, f'deform_test_{name}_wire.png')
    bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------- borrar el esqueleto
bpy.data.objects.remove(w, do_unlink=True)
obj.modifiers.remove(md)
obj.vertex_groups.clear()
obj.parent = None
bpy.data.objects.remove(rig, do_unlink=True)
bpy.data.armatures.remove(arm_data)
print('ARMATURE BORRADO:', 'TempRig' not in bpy.data.objects, 'modificadores:', [m.type for m in obj.modifiers])
