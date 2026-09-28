"""Etapa 4: exportación a FBX (Unity) y glTF binario.

Uso: xvfb-run -a blender -b export/atleta.blend -P scripts/export_unity.py
  * FBX: Y arriba, -Z adelante, escala 1 (FBX_SCALE_ALL), sin leaf bones,
    una toma por acción (APose, Idle, Walk, Run, Jump).
  * GLB: todas las acciones como animaciones separadas.
Después re-importa el FBX en una escena vacía y comprueba dimensiones y tomas.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import common as C  # noqa: E402

FBX = os.path.join(C.EXPORT, 'atleta.fbx')
GLB = os.path.join(C.EXPORT, 'atleta.glb')


def prepare():
    arm = bpy.data.objects['Armature']
    ad = arm.animation_data
    # durante la exportación las pistas NLA no deben mezclarse con la acción activa
    for tr in ad.nla_tracks:
        tr.mute = True
    ad.action = bpy.data.actions['APose']
    bpy.context.scene.frame_set(1)
    for o in bpy.data.objects:
        o.select_set(o.name in ('Armature', 'Atleta'))
    bpy.context.view_layer.objects.active = arm
    return arm


def export_fbx():
    bpy.ops.export_scene.fbx(
        filepath=FBX, use_selection=True, object_types={'ARMATURE', 'MESH'},
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', global_scale=1.0,
        axis_forward='-Z', axis_up='Y', bake_space_transform=False,
        use_mesh_modifiers=True, mesh_smooth_type='FACE', use_tspace=False,
        add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X',
        armature_nodetype='NULL', use_armature_deform_only=False,
        bake_anim=True, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=True, bake_anim_force_startend_keying=True,
        bake_anim_step=1.0, bake_anim_simplify_factor=0.0,
        path_mode='COPY', embed_textures=True, colors_type='SRGB')


def export_glb():
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_frame_range=False,
        export_skins=True, export_def_bones=False, export_colors=True,
        export_yup=True, export_apply=False)


def verify():
    # comprobación: re-importar el FBX en una escena limpia
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    n_act_before = set(a.name for a in bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=FBX)
    mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    dims = mesh.dimensions
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    new_acts = sorted(a.name for a in bpy.data.actions if a.name not in n_act_before)
    print('VERIFY_FBX mesh=%s dims=(%.3f, %.3f, %.3f) tris=%d bones=%d' % (
        mesh.name, dims.x, dims.y, dims.z, tris, len(arm.data.bones)))
    print('VERIFY_FBX actions=%s' % new_acts)
    print('VERIFY_FBX arm_scale=%s mesh_scale=%s' % (tuple(round(s, 3) for s in arm.scale),
                                                       tuple(round(s, 3) for s in mesh.scale)))


if __name__ == '__main__':
    prepare()
    export_fbx()
    export_glb()
    print('EXPORT_OK', os.path.getsize(FBX), os.path.getsize(GLB))
    verify()
