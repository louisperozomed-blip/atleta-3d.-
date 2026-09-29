"""Etapa 3: armadura compatible con Unity Humanoid, skinning y animaciones.

Uso: xvfb-run -a blender -b export/atleta_model.blend -P scripts/rig_animate.py
Genera export/atleta.blend con:
  * Armature (nombres de huesos de Unity Humanoid + Ponytail1..4)
  * Malla única 'Atleta' (cuerpo + ropa + pelo + accesorios) con pesos
  * Acciones: APose, Idle, Walk, Run, Jump
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector, Euler, Quaternion  # noqa: E402
import common as C  # noqa: E402
import anatomy  # noqa: E402
import meshutil as mu  # noqa: E402

FPS = 30
# v3: 4 huesos en cadena para la coleta (el último punto solo sirve para los pesos de las puntas)
PONY = [(-0.010, 0.020, 1.692), (-0.028, 0.090, 1.730), (-0.042, 0.130, 1.690), (-0.055, 0.145, 1.600),
        (-0.066, 0.140, 1.490), (-0.076, 0.125, 1.290)]
NPONY = len(PONY) - 2


# ------------------------------------------------------------------- armadura
def bone_specs():
    J = lambda n, s=1: Vector(anatomy.jl(n, s))  # noqa: E731
    specs = [  # (nombre, head, tail, padre)
        ('Hips', Vector((0, -0.015, 0.93)), Vector((0, -0.025, 1.02)), None),
        ('Spine', Vector((0, -0.025, 1.02)), Vector((0, -0.045, 1.12)), 'Hips'),
        ('Chest', Vector((0, -0.045, 1.12)), Vector((0, -0.045, 1.25)), 'Spine'),
        ('UpperChest', Vector((0, -0.045, 1.25)), Vector((0, -0.030, 1.385)), 'Chest'),
        ('Neck', Vector((0, -0.030, 1.405)), Vector((0, -0.055, 1.495)), 'UpperChest'),
        ('Head', Vector((0, -0.055, 1.495)), Vector((0, -0.070, 1.700)), 'Neck'),
    ]
    for s, side in ((1, 'Left'), (-1, 'Right')):
        clav = Vector((0.030 * s, -0.030, 1.385))
        specs += [
            (f'{side}Shoulder', clav, J('shoulder', s), 'UpperChest'),
            (f'{side}UpperArm', J('shoulder', s), J('elbow', s), f'{side}Shoulder'),
            (f'{side}LowerArm', J('elbow', s), J('wrist', s), f'{side}UpperArm'),
            (f'{side}Hand', J('wrist', s), J('knuckle', s), f'{side}LowerArm'),
            (f'{side}UpperLeg', J('hip', s), J('knee', s), 'Hips'),
            (f'{side}LowerLeg', J('knee', s), J('ankle', s), f'{side}UpperLeg'),
            (f'{side}Foot', J('ankle', s), J('ball', s), f'{side}LowerLeg'),
            (f'{side}Toes', J('ball', s), J('toe', s), f'{side}Foot'),
        ]
        names = {'thumb': 'Thumb', 'index': 'Index', 'middle': 'Middle', 'ring': 'Ring', 'pinky': 'Little'}
        for fk, fn in names.items():
            b, t, r = anatomy.FINGERS[fk]
            b = Vector(b); t = Vector(t)
            if s < 0:
                b.x = -b.x; t.x = -t.x
            pts = [b + (t - b) * f for f in (0.0, 0.45, 0.75, 1.0)]
            parent = f'{side}Hand'
            for i, seg in enumerate(('Proximal', 'Intermediate', 'Distal')):
                nm = f'{side}{fn}{seg}'
                specs.append((nm, pts[i], pts[i + 1], parent))
                parent = nm
    parent = 'Head'
    for i in range(len(PONY) - 2):
        nm = f'Ponytail{i + 1}'
        specs.append((nm, Vector(PONY[i]), Vector(PONY[i + 1]), parent))
        parent = nm
    return specs


def build_armature():
    arm = bpy.data.armatures.new('Armature')
    ob = bpy.data.objects.new('Armature', arm)
    bpy.context.scene.collection.objects.link(ob)
    arm.display_type = 'STICK'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    for name, h, t, parent in bone_specs():
        eb = arm.edit_bones.new(name)
        eb.head = h
        eb.tail = t
        # roll: eje Z local hacia delante (-Y) en cuerpo, piernas y brazos
        eb.align_roll(Vector((0, -1, 0)) if abs((t - h).normalized().y) < 0.9 else Vector((0, 0, 1)))
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = (eb.head - arm.edit_bones[parent].tail).length < 1e-4
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


# ------------------------------------------------------------------- pesos
def weight_body(body, arm_ob):
    """Pesos automáticos (bone heat) sobre el cuerpo; coleta sin influencia."""
    for b in arm_ob.data.bones:
        b.use_deform = not b.name.startswith('Ponytail')
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for b in arm_ob.data.bones:
        b.use_deform = True
    fix_weights(body, arm_ob)


def vg_weights(ob):
    names = [g.name for g in ob.vertex_groups]
    W = np.zeros((len(ob.data.vertices), len(names)))
    for v in ob.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    return names, W


def write_weights(ob, names, W, prune=0.01, max_inf=4):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = [ob.vertex_groups.new(name=n) for n in names]
    for i in range(len(W)):
        row = W[i].copy()
        if max_inf and (row > 0).sum() > max_inf:
            row[np.argsort(row)[:-max_inf]] = 0
        row[row < prune] = 0
        s = row.sum()
        if s <= 0:
            continue
        row /= s
        for j in np.nonzero(row)[0]:
            groups[j].add([i], float(row[j]), 'REPLACE')


def smooth_weights(ob, names, W, iters=2, lam=0.5, mask=None):
    E = mu.edges_np(ob)
    for _ in range(iters):
        M = np.zeros_like(W)
        cnt = np.zeros(len(W))
        np.add.at(M, E[:, 0], W[E[:, 1]])
        np.add.at(M, E[:, 1], W[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1)
        np.add.at(cnt, E[:, 1], 1)
        M /= np.maximum(cnt, 1)[:, None]
        Wn = W + lam * (M - W)
        if mask is not None:
            W[mask] = Wn[mask]
        else:
            W = Wn
    return W


def fix_weights(body, arm_ob):
    """Correcciones: cabeza rígida, vértices sin peso, suavizado en articulaciones."""
    names, W = vg_weights(body)
    all_bones = [b.name for b in arm_ob.data.bones]
    for b in all_bones:
        if b not in names:
            names.append(b)
            W = np.hstack([W, np.zeros((len(W), 1))])
    idx = {n: i for i, n in enumerate(names)}
    co = mu.get_co(body)
    # cabeza: por encima de la mandíbula todo al hueso Head
    head = co[:, 2] > 1.50
    W[head] = 0
    W[head, idx['Head']] = 1
    # cuello: mezcla Neck/Head/UpperChest según altura
    neck = (co[:, 2] > 1.40) & (co[:, 2] <= 1.50) & (np.abs(co[:, 0]) < 0.08)
    t = np.clip((co[neck, 2] - 1.40) / 0.10, 0, 1)
    W[neck] = 0
    W[neck, idx['Neck']] = 1 - np.abs(t - 0.5)
    W[neck, idx['Head']] = np.clip(t - 0.5, 0, 1)
    W[neck, idx['UpperChest']] = np.clip(0.5 - t, 0, 1)
    # vértices sin peso -> hueso más cercano
    empty = W.sum(1) < 1e-4
    if empty.any():
        near = nearest_bone(co[empty], arm_ob, exclude='Ponytail')
        for k, i in enumerate(np.nonzero(empty)[0]):
            W[i, idx[near[k]]] = 1
    # los muslos no deben influir en el otro lado ni en el torso alto
    for side, other in (('Left', 'Right'), ('Right', 'Left')):
        s = 1 if side == 'Left' else -1
        wrong = co[:, 0] * s > 0.02
        for part in ('UpperLeg', 'LowerLeg', 'Foot', 'Toes', 'UpperArm', 'LowerArm', 'Hand', 'Shoulder'):
            W[wrong, idx[f'{other}{part}']] = 0
    # axilas/dorsales: el brazo solo influye más allá del plano del hombro
    for side, s in (('Left', 1), ('Right', -1)):
        sh, el = anatomy.jl('shoulder', s), anatomy.jl('elbow', s)
        d = (el - sh) / np.linalg.norm(el - sh)
        t = (co - sh) @ d
        fac = np.clip((t + 0.015) / 0.055, 0, 1)
        for bn in ('UpperArm', 'LowerArm', 'Hand'):
            j = idx[f'{side}{bn}']
            lost = W[:, j] * (1 - fac)
            W[:, j] *= fac
            tgt = np.where(co[:, 2] > 1.30, idx[f'{side}Shoulder'], idx['Chest'])
            np.add.at(W, (np.arange(len(W)), tgt), lost * np.where(co[:, 2] > 1.30, 1.0, 0.0))
            W[:, idx['UpperChest']] += lost * np.where(co[:, 2] > 1.30, 0.0, 0.5)
            W[:, idx['Chest']] += lost * np.where(co[:, 2] > 1.30, 0.0, 0.5)
    W = smooth_weights(body, names, W, iters=2, lam=0.4, mask=~head)
    write_weights(body, names, W)


def nearest_bone(P, arm_ob, exclude=None):
    out = []
    bones = [b for b in arm_ob.data.bones if not (exclude and b.name.startswith(exclude))]
    for p in P:
        best, bn = 1e9, None
        for b in bones:
            a, c = np.array(b.head_local), np.array(b.tail_local)
            v = c - a
            t = np.clip(((p - a) @ v) / (v @ v), 0, 1)
            d = np.linalg.norm(p - (a + t * v))
            if d < best:
                best, bn = d, b.name
        out.append(bn)
    return out


def transfer_weights(src, dst):
    m = dst.modifiers.new('DT', 'DATA_TRANSFER')
    m.object = src
    m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}
    m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'
    m.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.datalayout_transfer(modifier='DT')
    bpy.ops.object.modifier_apply(modifier='DT')


def rigid(ob, bone):
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')


def weight_shoe(ob, side):
    co = mu.get_co(ob)
    heel = np.array(anatomy.jl('ankle', 1 if side == 'Left' else -1))
    ball = np.array(anatomy.jl('ball', 1 if side == 'Left' else -1))
    d = ball - heel
    d[2] = 0
    t = ((co - heel) * np.array([1, 1, 0])) @ d / (d @ d)
    wt = np.clip((t - 0.8) / 0.4, 0, 1)
    gf = ob.vertex_groups.new(name=f'{side}Foot')
    gt = ob.vertex_groups.new(name=f'{side}Toes')
    for i, w in enumerate(wt):
        if w < 1:
            gf.add([i], float(1 - w), 'REPLACE')
        if w > 0:
            gt.add([i], float(w), 'REPLACE')


def weight_hair(ob):
    """Casquete/flequillo -> Head; coleta -> cadena Ponytail por proyección sobre la curva."""
    co = mu.get_co(ob)
    P = np.array(PONY)
    nb = len(P) - 2
    names = ['Head'] + [f'Ponytail{i + 1}' for i in range(nb)]
    W = np.zeros((len(co), len(names)))
    # distancia a la curva de la coleta y parámetro a lo largo
    best_d = np.full(len(co), 1e9)
    best_s = np.zeros(len(co))
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        v = b - a
        t = np.clip(((co - a) @ v) / (v @ v), 0, 1)
        d = np.linalg.norm(co - (a + t[:, None] * v), axis=1)
        m = d < best_d
        best_d[m] = d[m]
        best_s[m] = i + t[m]
    # fuera del volumen del cráneo (el casquete y el flequillo quedan rígidos a Head)
    head_c = np.array([0.0, -0.072, 1.618])
    outside_skull = np.linalg.norm((co - head_c) / np.array([0.125, 0.13, 0.12]), axis=1) > 1.0
    on_tail = (best_d < 0.12) & outside_skull & (co[:, 1] > 0.03)
    for i in range(len(co)):
        if not on_tail[i]:
            W[i, 0] = 1
            continue
        s = best_s[i]  # 0..len(P)-1 ; hueso k cubre [k, k+1]
        # interpolación suave entre huesos vecinos (centros en k+0.5)
        x = np.clip(s - 0.5, 0, nb - 1)
        k0 = int(np.floor(x))
        f = x - k0
        k1 = min(k0 + 1, nb - 1)
        if s < 0.6:  # base de la coleta mezclada con la cabeza
            W[i, 0] = 0.6 - s
        W[i, 1 + k0] += 1 - f
        W[i, 1 + k1] += f
    write_weights(ob, names, W)


# ---------------------------------------------------------------- animación
def rest_rot(arm_ob, bone):
    return arm_ob.data.bones[bone].matrix_local.to_3x3()


def local_q(arm_ob, bone, euler_deg, order='XYZ'):
    """Rotación dada en ejes del espacio de armadura (reposo) -> cuaternión local del hueso."""
    R = Euler([math.radians(a) for a in euler_deg], order).to_matrix()
    B = rest_rot(arm_ob, bone)
    return (B.inverted() @ R @ B).to_quaternion()


class Anim:
    def __init__(self, arm_ob, name, frames, loop=True):
        self.ob = arm_ob
        self.act = bpy.data.actions.new(name)
        self.act.use_fake_user = True
        self.frames = frames
        self.loop = loop
        arm_ob.animation_data_create()
        arm_ob.animation_data.action = self.act
        for pb in arm_ob.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)

    def key(self, f, rots, hips_loc=(0, 0, 0), scales=None):
        for pb in self.ob.pose.bones:
            e = rots.get(pb.name, (0, 0, 0))
            pb.rotation_quaternion = local_q(self.ob, pb.name, e)
            pb.keyframe_insert('rotation_quaternion', frame=f)
        hips = self.ob.pose.bones['Hips']
        B = rest_rot(self.ob, 'Hips')
        hips.location = B.inverted() @ Vector(hips_loc)
        hips.keyframe_insert('location', frame=f)
        if scales:
            for bn, sc in scales.items():
                pb = self.ob.pose.bones[bn]
                pb.scale = sc
                pb.keyframe_insert('scale', frame=f)

    def finish(self):
        self.act.frame_range = (1, self.frames)
        for fc in self.act.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
            if self.loop:
                fc.modifiers.new('CYCLES')
        self.act['loop'] = self.loop


def arms_base(adduct=0.0):
    """A-pose relajada: rotación de los brazos hacia el cuerpo (grados)."""
    return {'LeftUpperArm': (0, adduct, 0), 'RightUpperArm': (0, -adduct, 0)}


def pony(rots, phase, amp, lag=0.9, yaw_amp=0.0, base=(0, 0, 0)):
    """Balanceo suave de la coleta para Idle (onda con retraso creciente por hueso)."""
    for i in range(NPONY):
        a = amp * (0.6 + 0.15 * i)
        ph = phase - lag * (i + 1)
        rots[f'Ponytail{i + 1}'] = (base[0] + a * math.sin(ph), base[1] + yaw_amp * (0.5 + 0.3 * i) * math.sin(ph - 0.5), base[2])


def spring_chain(drive, fps, freq=1.6, zeta=0.22, gain=18.0, cycles=4, clip=14.0):
    """v3: movimiento secundario de la coleta = muelle amortiguado por hueso.

    drive: aceleración (m/s²) del punto de anclaje en cada fotograma. Cada hueso es un
    oscilador con rigidez decreciente hacia la punta: se retrasa y rebota. Para bucles se
    simulan varios ciclos y se devuelve el último (resultado periódico).
    """
    dt = 1.0 / fps
    out = []
    for i in range(NPONY):
        w = 2 * math.pi * freq * (1.0 - 0.12 * i)
        k, c = w * w, 2 * zeta * w
        g = gain * (0.55 + 0.25 * i)
        th = v = 0.0
        res = []
        for _ in range(cycles):
            res = []
            for a in drive:
                acc = -k * th - c * v - g * k * a / 9.81
                v += acc * dt
                th += v * dt
                res.append(max(-clip, min(clip, th)))
        out.append(res)
    return np.array(out)          # (NPONY, frames) en grados


def second_diff(x, fps):
    x = np.asarray(x, float)
    return (np.roll(x, -1) - 2 * x + np.roll(x, 1)) * fps * fps


def make_apose(arm_ob):
    a = Anim(arm_ob, 'APose', 2, loop=False)
    a.key(1, {})
    a.key(2, {})
    a.finish()
    return a.act


def make_idle(arm_ob):
    n = 60
    a = Anim(arm_ob, 'Idle', n + 1)
    for f in range(0, n + 1, 3):
        ph = 2 * math.pi * f / n
        b = math.sin(ph)
        r = arms_base(8 + 1.5 * b)
        r['LeftUpperArm'] = (1.5 * b, 8 + 1.5 * b, 0)
        r['RightUpperArm'] = (1.5 * b, -8 - 1.5 * b, 0)
        r['LeftLowerArm'] = (-6, 0, 0)
        r['RightLowerArm'] = (-6, 0, 0)
        r['Chest'] = (-1.5 * b, 0, 0)
        r['UpperChest'] = (-1.2 * b, 0, 0)
        r['LeftShoulder'] = (0, 0, 1.5 * b)
        r['RightShoulder'] = (0, 0, -1.5 * b)
        r['Neck'] = (1.0 * b, 0, 0)
        r['Head'] = (0.8 * b, 1.0 * math.sin(ph * 0.5), 0)
        r['Spine'] = (0.6 * b, 0, 0)
        for s in ('Left', 'Right'):
            for fg in ('Index', 'Middle', 'Ring', 'Little'):
                for seg in ('Proximal', 'Intermediate', 'Distal'):
                    r[f'{s}{fg}{seg}'] = (-12, 0, 0)
        pony(r, ph, 2.5, yaw_amp=2.0)
        a.key(f + 1, r, hips_loc=(0, 0, -0.004 + 0.004 * b),
              scales={'Chest': (1 + 0.012 * (b + 1), 1 + 0.018 * (b + 1), 1)})
    a.finish()
    return a.act


def gait(arm_ob, name, n, hip_amp, knee_amp, arm_amp, elbow, lean, bob, stride_knee_front,
         pony_amp, arm_add, foot_amp):
    a = Anim(arm_ob, name, n + 1)
    # v3: coleta con retraso y rebote simulados a partir del bote de la cadera y del giro
    frames = np.arange(n)
    zc = bob * np.cos(4 * math.pi * frames / n)
    yaw = (6 if name == 'Walk' else 9) * np.sin(2 * math.pi * frames / n)
    sim = spring_chain(second_diff(zc, FPS), FPS, gain=pony_amp * 3.0)
    simy = spring_chain(second_diff(np.radians(yaw) * 0.15, FPS), FPS, freq=1.3, gain=pony_amp * 2.0)
    sim_pitch = np.concatenate([sim, sim[:, :1]], 1)
    sim_yaw = np.concatenate([simy, simy[:, :1]], 1)
    for f in range(0, n + 1, 2):
        ph = 2 * math.pi * f / n
        s = math.sin(ph)
        r = {}
        # piernas (izquierda en fase ph, derecha en contrafase)
        for side, sg in (('Left', 1), ('Right', -1)):
            p = ph if sg > 0 else ph + math.pi
            thigh = -hip_amp * math.sin(p)                       # flexión (negativo = adelante)
            swing = max(0.0, math.sin(p - math.pi * 0.35))     # fase aérea
            knee = stride_knee_front + knee_amp * swing ** 1.3
            foot = -foot_amp * math.sin(p + 0.6)
            r[f'{side}UpperLeg'] = (thigh - 0.5 * knee * 0.3, 0, 0)
            r[f'{side}LowerLeg'] = (knee, 0, 0)
            r[f'{side}Foot'] = (foot - knee * 0.15, 0, 0)
            # brazos en oposición
            arm_sw = arm_amp * math.sin(p)
            r[f'{side}UpperArm'] = (arm_sw, arm_add * sg, 0)
            r[f'{side}LowerArm'] = (-elbow - 0.25 * elbow * max(0, math.sin(p)), 0, 0)
            r[f'{side}Hand'] = (-5, 0, 0)
            for fg in ('Index', 'Middle', 'Ring', 'Little'):
                for seg in ('Proximal', 'Intermediate', 'Distal'):
                    r[f'{side}{fg}{seg}'] = (-25 if name == 'Run' else -12, 0, 0)
        r['Hips'] = (0, 0, 6 * s if name == 'Walk' else 9 * s)
        r['Spine'] = (lean * 0.4, 0, -3 * s)
        r['Chest'] = (lean * 0.3, 0, -4 * s)
        r['UpperChest'] = (lean * 0.3, 0, -3 * s)
        r['Neck'] = (-lean * 0.5, 0, 2 * s)
        r['Head'] = (-lean * 0.3, 0, 2 * s)
        z = bob * math.cos(2 * ph) - bob * 0.5
        for i in range(NPONY):
            r[f'Ponytail{i + 1}'] = (lean * 0.25 + float(sim_pitch[i, f]), float(sim_yaw[i, f]), 0)
        a.key(f + 1, r, hips_loc=(0, 0, z))
    a.finish()
    return a.act


def make_jump(arm_ob):
    n = 44
    a = Anim(arm_ob, 'Jump', n, loop=False)
    # (frame, agachado 0..1, altura cadera, brazos arriba 0..1)
    keys = [(1, 0.0, 0.0, 0.0), (8, 0.9, -0.16, -0.4), (12, 0.2, 0.02, 1.0), (16, 0.0, 0.22, 1.0),
            (22, -0.1, 0.34, 0.8), (28, 0.1, 0.22, 0.6), (33, 0.2, 0.0, 0.3), (37, 0.85, -0.15, -0.3),
            (44, 0.0, 0.0, 0.0)]
    for i, (f, c, h, up) in enumerate(keys):
        r = {}
        for side, sg in (('Left', 1), ('Right', -1)):
            r[f'{side}UpperLeg'] = (-70 * c, 0, 0)
            r[f'{side}LowerLeg'] = (120 * c, 0, 0)
            r[f'{side}Foot'] = (-45 * c + (25 if 0 < h else 0), 0, 0)
            r[f'{side}UpperArm'] = (-105 * up, -20 * up * sg, 0)
            r[f'{side}LowerArm'] = (-25 - 20 * max(0, -up), 0, 0)
        r['Spine'] = (22 * c, 0, 0)
        r['Chest'] = (12 * c, 0, 0)
        r['Neck'] = (-15 * c, 0, 0)
        for k in range(NPONY):
            r[f'Ponytail{k + 1}'] = (0.0, 0, 0)
        a.key(f, r, hips_loc=(0, 0.0, h - 0.29 * c * 0.3))
    # v3: coleta simulada fotograma a fotograma (retraso al despegar, rebote al aterrizar)
    fr = np.arange(1, n + 1)
    kf = np.array([k[0] for k in keys]); kh = np.array([k[2] - 0.29 * k[1] * 0.3 for k in keys])
    hz = np.interp(fr, kf, kh)
    hz = np.convolve(np.pad(hz, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    acc = np.gradient(np.gradient(hz)) * FPS * FPS
    sim = spring_chain(acc, FPS, gain=4.0, cycles=1, clip=11.0)   # 4 huesos: ≤44° en la punta
    for idx, f in enumerate(fr):
        for k in range(NPONY):
            pb = arm_ob.pose.bones[f'Ponytail{k + 1}']
            pb.rotation_quaternion = local_q(arm_ob, pb.name, (float(sim[k, idx]), 0, 0))
            pb.keyframe_insert('rotation_quaternion', frame=int(f))
    a.finish()
    return a.act


# ------------------------------------------------------------------- main
def main():
    scene = bpy.context.scene
    scene.render.fps = FPS
    arm_ob = build_armature()
    obs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
    body = obs['Body']
    weight_body(body, arm_ob)
    for n in ('KneePad_L', 'KneePad_R', 'Wristband_L', 'Wristband_R'):
        transfer_weights(body, obs[n])
    weight_shoe(obs['Shoe_L'], 'Left')
    weight_shoe(obs['Shoe_R'], 'Right')
    weight_hair(obs['Hair'])
    rigid(obs['FaceDecals'], 'Head')
    rigid(obs['HairTie'], 'Head')
    # unir todo en una sola malla con un solo material
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs.values():
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        o.parent = None
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    atleta = bpy.context.view_layer.objects.active
    atleta.name = 'Atleta'
    atleta.data.name = 'Atleta'
    atleta.parent = arm_ob
    mod = atleta.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_ob
    # acciones
    acts = [make_apose(arm_ob), make_idle(arm_ob),
            gait(arm_ob, 'Walk', 32, hip_amp=24, knee_amp=55, arm_amp=18, elbow=15, lean=4,
                 bob=0.018, stride_knee_front=6, pony_amp=3, arm_add=22, foot_amp=12),
            gait(arm_ob, 'Run', 20, hip_amp=42, knee_amp=100, arm_amp=45, elbow=75, lean=14,
                 bob=0.04, stride_knee_front=12, pony_amp=5, arm_add=28, foot_amp=22),
            make_jump(arm_ob)]
    # cada acción en su propia pista NLA (para exportar tomas separadas)
    ad = arm_ob.animation_data
    for act in acts:
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, 1, act)
        st.mute = False
        tr.mute = True
    ad.action = bpy.data.actions['APose']
    scene.frame_start, scene.frame_end = 1, 60
    print('TRIS', mu.tri_count(atleta))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.EXPORT, 'atleta.blend'))


if __name__ == '__main__':
    main()
