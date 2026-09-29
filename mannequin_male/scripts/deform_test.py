"""Test TEMPORAL de deformación: esqueleto provisional, poses extremas, medidas y renders; al final se
borra el esqueleto (el entregable no lleva rig).

Uso: RENDER_DIR=<carpeta> xvfb-run -a blender -b -P scripts/deform_test.py -- <etiqueta>
Poses:
  codos_rodillas  codos y rodillas a 90°
  brazo_arriba    brazo levantado 180° (clavícula 25° + húmero desde la A-pose)
  cadera_90       cadera flexionada 90° (rodilla recta) y la otra pierna con rodilla a 90° (sentado)
  torsion         torsión de columna 35° (lumbar 15° + torácica 20°) con el cuello girado 20°
Pesos automáticos (bone heat) suavizados (factor 0.5, 3 pasadas). En cada pose se mide sobre la malla
deformada: autointersecciones (pares de caras sin vértices comunes que se cruzan) y cuántas caen cerca
de la articulación, caras aplastadas (área < 25 % de la de reposo), cambio de volumen total y grosor
mínimo del miembro en la articulación (pinzamiento). Se guardan renders y <tag>_deform.json.
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
sys.argv = [sys.argv[0], '--', DTAG + '_rest', '--no-render']
for mod in ('build', 'figure', 'mesh', 'render', 'validate'):
    sys.modules.pop(mod, None)
import build as B      # noqa: E402
import render as RND   # noqa: E402

OUT = os.path.join(ROOT, 'renders', os.environ.get('RENDER_DIR', 's7_deform'))
os.makedirs(OUT, exist_ok=True)
obj, fig = B.main()
T = fig.T
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.modifier_apply(modifier='Mirror')

# ---------------------------------------------------------------- esqueleto temporal
A = T['arm']
SH, EL, WR = (Vector(A[k]) for k in ('shoulder', 'elbow', 'wrist'))
TIP = Vector((0.335, -0.030, 0.76))
LEG = {round(r[0], 2): r for r in T['leg']}
HIP = Vector((0.098, 0.030, 0.90))
KNEE = Vector((LEG[0.55][1], LEG[0.55][2], 0.55))
ANK = Vector((LEG[0.15][1], LEG[0.15][2], 0.13))
TOE = Vector((0.225, -0.085, 0.03))

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


def mx(v, sx):
    return Vector((v.x * sx, v.y, v.z))


bone('hips', (0, 0.03, 0.92), (0, 0.03, 1.04))
bone('spine', (0, 0.03, 1.04), (0, 0.03, 1.22), 'hips', True)
bone('chest', (0, 0.03, 1.22), (0, 0.03, 1.44), 'spine', True)
bone('neck', (0, 0.04, 1.50), (0, 0.03, 1.60), 'chest')
bone('head', (0, 0.03, 1.60), (0, 0.02, 1.78), 'neck', True)
for s, sx in (('L', 1), ('R', -1)):
    bone(f'shoulder.{s}', (0.03 * sx, 0.03, 1.45), mx(SH, sx), 'chest')
    bone(f'upper_arm.{s}', mx(SH, sx), mx(EL, sx), f'shoulder.{s}', True)
    bone(f'forearm.{s}', mx(EL, sx), mx(WR, sx), f'upper_arm.{s}', True)
    bone(f'hand.{s}', mx(WR, sx), mx(TIP, sx), f'forearm.{s}', True)
    bone(f'thigh.{s}', mx(HIP, sx), mx(KNEE, sx), 'hips')
    bone(f'shin.{s}', mx(KNEE, sx), mx(ANK, sx), f'thigh.{s}', True)
    bone(f'foot.{s}', mx(ANK, sx), mx(TOE, sx), f'shin.{s}', True)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
SMOOTH = int(os.environ.get('SMOOTH', '6'))
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=SMOOTH, expand=0.0)
bpy.ops.object.mode_set(mode='OBJECT')
empty_groups = [g.name for g in obj.vertex_groups
                if not any(g.index in [x.group for x in v.groups] for v in obj.data.vertices)]
print('grupos sin pesos:', empty_groups)
rest_area = [p.area for p in obj.data.polygons]


def evaluated_bm():
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = obj.evaluated_get(dg)
    bm = bmesh.new()
    bm.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    bm.faces.ensure_lookup_table()
    return bm


def volume(bm):
    return sum(f.calc_center_median().dot(f.normal) * f.calc_area() for f in bm.faces) / 3.0


bm0 = evaluated_bm()
REST_VOL = volume(bm0)
bm0.free()

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


def bend_axis(name, toward):
    """Eje de flexión: perpendicular al hueso y a la dirección hacia la que se dobla."""
    pb = pose[name]
    return (pb.tail - pb.head).normalized().cross(Vector(toward)).normalized()


def p_codos(s, sx):
    rot(f'forearm.{s}', bend_axis(f'forearm.{s}', (0, -1, 0)), 90)      # antebrazo hacia delante
    rot(f'shin.{s}', bend_axis(f'shin.{s}', (0, 1, 0)), 90)             # pierna hacia atrás


def p_arriba(s, sx):
    rot(f'shoulder.{s}', (0, 1, 0), -25 * sx)
    ua = pose[f'upper_arm.{s}']
    cur = math.degrees((ua.tail - ua.head).angle(Vector((0, 0, -1))))    # apertura de la A-pose
    rot(f'upper_arm.{s}', (0, 1, 0), -(180 - 25 - cur) * sx)


def p_cadera(s, sx):
    rot(f'thigh.{s}', (1, 0, 0), -90)
    if s == 'R':
        rot(f'shin.{s}', (1, 0, 0), 90)


def p_torsion(s, sx):
    if s == 'L':
        rot('spine', (0, 0, 1), 15)
        rot('chest', (0, 0, 1), 20)
        rot('neck', (0, 0, 1), 20)


POSES = [
    ('codos_rodillas', p_codos, [('codo', 'forearm.L', 'out', 0.40), ('codo_delante', 'forearm.L', 'front', 0.30),
                                 ('rodilla', 'shin.L', 'out', 0.45)],
     [('forearm.L', 'upper_arm.L'), ('shin.L', 'thigh.L')]),
    ('brazo_arriba', p_arriba, [('hombro', 'upper_arm.L', 'front', 0.50), ('hombro_detras', 'upper_arm.L', 'back', 0.50)],
     [('upper_arm.L', 'shoulder.L')]),
    ('cadera_90', p_cadera, [('cadera', 'thigh.L', 'out', 0.60), ('gluteo', 'thigh.L', 'back', 0.60)],
     [('thigh.L', 'hips')]),
    ('torsion', p_torsion, [('torso', 'spine', 'front', 0.90), ('torso_34', 'spine', 'q34', 0.90)],
     [('spine', 'hips'), ('chest', 'spine')]),
]
CAMS = {'front': ((0, -3, 0), (math.pi / 2, 0, 0)), 'back': ((0, 3, 0), (math.pi / 2, 0, math.pi)),
        'out': ((3, 0, 0), (math.pi / 2, 0, math.pi / 2)),
        'q34': ((2.2, -2.2, 0), (math.pi / 2, 0, math.pi / 4))}


def thickness(bm, joint, axis):
    """Grosor mínimo del miembro en un disco alrededor de la articulación (pinzamiento): para cada
    dirección radial perpendicular al eje, la distancia entre las caras más lejanas en esa dirección
    y la opuesta, tomando solo vértices a menos de 3 cm del plano de la articulación."""
    axis = axis.normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    pts = [p.co - joint for p in bm.verts if abs((p.co - joint).dot(axis)) < 0.03 and (p.co - joint).length < 0.15]
    if not pts:
        return None
    best = 1e9
    for k in range(12):
        a = math.pi * k / 12
        d = u * math.cos(a) + v * math.sin(a)
        proj = [p.dot(d) for p in pts]
        best = min(best, max(proj) - min(proj))
    return round(best, 4)


def measure(joint, pairs_of_bones):
    bm = evaluated_bm()
    bvh = BVHTree.FromBMesh(bm)
    pairs = [(a, b) for a, b in bvh.overlap(bvh) if a < b and not (
        set(v.index for v in bm.faces[a].verts) & set(v.index for v in bm.faces[b].verts))]
    crushed = sum(1 for f, a0 in zip(bm.faces, rest_area) if f.calc_area() < 0.25 * a0)
    near = sum(1 for a, _ in pairs if (bm.faces[a].calc_center_median() - joint).length < 0.15)
    where = [[round(c, 3) for c in bm.faces[a].calc_center_median()] for a, _ in pairs[:8]]
    vol = volume(bm)
    thick = {}
    for child, parent in pairs_of_bones:
        pc, pp = pose[child], pose[parent]
        jw = rig.matrix_world @ pc.head
        ax = ((pc.tail - pc.head).normalized() + (pp.tail - pp.head).normalized())
        thick[child] = thickness(bm, jw, ax if ax.length > 1e-3 else (pc.tail - pc.head))
    bm.free()
    return dict(self_intersections=len(pairs), near_joint=near, crushed_faces=crushed,
                volume_change_pct=round(100 * (vol - REST_VOL) / REST_VOL, 2), joint_thickness=thick,
                where=where)


# grosor de reposo en las mismas articulaciones, para comparar
bpy.ops.object.mode_set(mode='OBJECT')
reset()
bm = evaluated_bm()
rest_thick = {}
for _n, _f, _s, pb_pairs in POSES:
    for child, parent in pb_pairs:
        pc, pp = pose[child], pose[parent]
        ax = ((pc.tail - pc.head).normalized() + (pp.tail - pp.head).normalized())
        rest_thick[child] = thickness(bm, rig.matrix_world @ pc.head, ax)
bm.free()

cam = RND.setup_eevee()
sc = bpy.context.scene
rig.hide_render = True
edges = RND.edge_overlay(obj)
RND.use_materials([obj, edges])
results = {'rest_volume_m3': round(REST_VOL, 5), 'rest_thickness': rest_thick, 'empty_groups': empty_groups}
for name, fn, shots, pb_pairs in POSES:
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    reset()
    for s, sx in (('L', 1), ('R', -1)):
        fn(s, sx)
    bpy.ops.object.mode_set(mode='OBJECT')
    j = rig.matrix_world @ pose[shots[0][1]].head
    results[name] = measure(j, pb_pairs)
    print('POSE', name, results[name])
    if os.environ.get('NO_RENDER'):
        continue
    # cuerpo entero en 3/4 y primeros planos de las articulaciones
    for o in sc.objects:
        o.hide_render = o.name not in (obj.name, edges.name, cam.name, 'KeySun', 'FillSun')
    sc.render.resolution_x, sc.render.resolution_y = 700, 1000
    cam.data.ortho_scale = 2.3
    cam.location = Vector((2.2, -2.2, 0.95))
    cam.rotation_euler = (math.pi / 2, 0, math.pi / 4)
    sc.render.filepath = os.path.join(OUT, f'{DTAG}_{name}_full.png')
    bpy.ops.render.render(write_still=True)
    for label, bname, view, scale in shots:
        jj = rig.matrix_world @ pose[bname].head
        loc, r = CAMS[view]
        cam.location = jj + Vector(loc)
        cam.rotation_euler = r
        cam.data.ortho_scale = scale
        sc.render.resolution_x, sc.render.resolution_y = 700, 700
        sc.render.filepath = os.path.join(OUT, f'{DTAG}_{name}_{label}.png')
        bpy.ops.render.render(write_still=True)

with open(os.path.join(OUT, f'{DTAG}_deform.json'), 'w') as fh:
    json.dump(results, fh, indent=1, ensure_ascii=False)

# fin del test: se borra el esqueleto y los pesos; la malla vuelve a reposo
bpy.context.view_layer.objects.active = obj
for m in list(obj.modifiers):
    if m.type == 'ARMATURE':
        obj.modifiers.remove(m)
obj.vertex_groups.clear()
obj.parent = None
bpy.data.objects.remove(rig, do_unlink=True)
bpy.data.objects.remove(edges, do_unlink=True)
print('esqueleto temporal borrado; objetos:', [o.name for o in bpy.data.objects])
