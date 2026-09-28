"""Hojas de fotogramas de cada animación y test de poses extremas (deformación).

Uso: xvfb-run -a blender -b export/atleta.blend -P scripts/render_anim.py
Salida: renders/anim_<Accion>.png y renders/deform_poses.png
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math  # noqa: E402
import bpy  # noqa: E402
import common as C  # noqa: E402
import render_views as RV  # noqa: E402
import rig_animate as RA  # noqa: E402

TMP = os.path.join(C.RENDERS, 'iter', 'anim')


def cam_three_quarter(dist=5.0, z=0.95, yaw=-35):
    cam = RV.get_camera()
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.2
    a = math.radians(yaw)
    cam.location = (dist * math.sin(a), -dist * math.cos(a), z)
    cam.rotation_euler = (math.radians(90), 0, a)
    return cam


def render_frames(action, frames, tag, yaw=-35, size=(300, 420)):
    arm = bpy.data.objects['Armature']
    arm.animation_data.action = bpy.data.actions[action]
    sc = bpy.context.scene
    RV.setup_render('BLENDER_EEVEE', *size)
    cam = cam_three_quarter(yaw=yaw)
    cam.data.ortho_scale = 2.3
    cam.location.z = 1.0
    paths = []
    for f in frames:
        sc.frame_set(f)
        p = os.path.join(TMP, f'{tag}_{f:03d}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append((f, p))
    return paths


def sheet(paths, out, title, cols=8):
    """Compone la hoja con numpy puro (el Python de Blender no trae PIL)."""
    import numpy as np
    imgs = []
    for f, p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        a = np.array(im.pixels[:]).reshape(h, w, 4)[::-1]
        imgs.append(a)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = (len(imgs) + cols - 1) // cols
    S = np.ones((rows * h, cols * w, 4))
    for i, a in enumerate(imgs):
        r, c = divmod(i, cols)
        S[r * h:(r + 1) * h, c * w:(c + 1) * w] = a
        S[r * h:(r + 1) * h, c * w:c * w + 1, :3] = 0.5
    img = bpy.data.images.new(title, cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(S[::-1].astype('float32').ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()


def deform_tests():
    """Poses extremas para revisar hombros, codos, caderas y rodillas."""
    arm = bpy.data.objects['Armature']
    poses = [
        {},
        {'LeftUpperArm': (0, -55, 0), 'RightUpperArm': (0, 55, 0)},                       # T-pose
        {'LeftUpperArm': (0, -120, 0), 'RightUpperArm': (0, 120, 0)},                      # brazos arriba
        {'LeftUpperArm': (-80, 20, 0), 'RightUpperArm': (-80, -20, 0),
         'LeftLowerArm': (-120, 0, 0), 'RightLowerArm': (-120, 0, 0)},                     # codos 120°
        {'LeftUpperLeg': (-95, 0, 0), 'LeftLowerLeg': (110, 0, 0)},                        # rodilla alta
        {'LeftUpperLeg': (-90, 0, 0), 'RightUpperLeg': (-90, 0, 0),
         'LeftLowerLeg': (130, 0, 0), 'RightLowerLeg': (130, 0, 0),
         'LeftFoot': (-40, 0, 0), 'RightFoot': (-40, 0, 0), 'Spine': (25, 0, 0)},          # sentadilla
        {'LeftUpperLeg': (0, -40, 0), 'RightUpperLeg': (0, 40, 0)},                        # apertura
        {'Spine': (0, 0, 35), 'Chest': (0, 0, 20), 'Head': (0, 0, 40), 'LeftUpperLeg': (30, 0, 0)},
    ]
    hips = [(0, 0, 0)] * 5 + [(0, 0, -0.38)] + [(0, 0, -0.02), (0, 0, 0)]
    a = RA.Anim(arm, '_DeformTest', len(poses))
    for i, (p, h) in enumerate(zip(poses, hips)):
        a.key(i + 1, p, hips_loc=h)
    paths = []
    name = a.act.name
    for yaw in (0, -60):
        paths += render_frames(name, range(1, len(poses) + 1), f'deform{yaw}', yaw=yaw)
    sheet(paths, os.path.join(C.RENDERS, 'deform_poses.png'), 'deform', cols=len(poses))
    bpy.data.actions.remove(a.act)


def main():
    os.makedirs(TMP, exist_ok=True)
    arm = bpy.data.objects['Armature']
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    specs = {'APose': [1], 'Idle': list(range(1, 61, 4))[:16], 'Walk': list(range(1, 33, 2)),
             'Run': [1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20], 'Jump': list(range(1, 45, 3))[:16]}
    for act, frames in specs.items():
        paths = render_frames(act, frames, act, yaw=-50 if act in ('Walk', 'Run', 'Jump') else -30)
        sheet(paths, os.path.join(C.RENDERS, f'anim_{act}.png'), act, cols=8)
    deform_tests()
    arm.animation_data.action = bpy.data.actions['APose']


if __name__ == '__main__':
    main()
