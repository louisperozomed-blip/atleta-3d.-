"""Renderiza FRONT / SIDE / BACK con cámara ortográfica y fondo gris, con el mismo
encuadre que los recortes de reference/ (560x940 px, 512 px = 1 m).

Uso:  xvfb-run -a blender -b export/atleta.blend -P scripts/render_views.py -- <tag> [engine] [pose]
"""
import os, sys  # noqa: E401
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import math
import os
import sys
import common as C

VIEWS = {
    'front': ((0.0, -6.0), (math.radians(90), 0, 0)),
    'side': ((-6.0, 0.0), (math.radians(90), 0, math.radians(-90))),
    'back': ((0.0, 6.0), (math.radians(90), 0, math.radians(180))),
}


def setup_render(engine='BLENDER_EEVEE', w=C.CROP_W, h=C.CROP_H):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    bg = [C.srgb_to_linear(c) for c in C.BG_RGB]
    sc.world.color = bg
    if engine == 'BLENDER_WORKBENCH':
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.studio_light = 'Default'
        sh.color_type = 'TEXTURE'
        sh.show_cavity = False
        sh.show_object_outline = False
        sh.show_specular_highlight = False
        sc.display.render_aa = '8'
    else:
        sc.world.use_nodes = True
        nt = sc.world.node_tree
        bgn = nt.nodes.get('Background')
        bgn.inputs[0].default_value = (*bg, 1)
        bgn.inputs[1].default_value = 1.0
        sc.eevee.taa_render_samples = 32
        if 'KeySun' not in bpy.data.objects:
            sun = bpy.data.lights.new('KeySun', 'SUN')
            sun.energy = 2.2
            sun.angle = math.radians(20)
            so = bpy.data.objects.new('KeySun', sun)
            so.rotation_euler = (math.radians(50), math.radians(-10), math.radians(-30))
            sc.collection.objects.link(so)


def get_camera():
    cam = bpy.data.objects.get('RefCam')
    if cam is None:
        cd = bpy.data.cameras.new('RefCam')
        cam = bpy.data.objects.new('RefCam', cd)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = C.CROP_H / C.PX_PER_M
    cam.data.clip_end = 50
    bpy.context.scene.camera = cam
    return cam


def render_views(tag, engine='BLENDER_EEVEE', views=('front', 'side', 'back'), outdir=None):
    outdir = outdir or os.path.join(C.RENDERS, 'iter')
    os.makedirs(outdir, exist_ok=True)
    setup_render(engine)
    cam = get_camera()
    zc = (C.GROUND_PX - C.CROP_H / 2) / C.PX_PER_M
    paths = []
    for v in views:
        (x, y), rot = VIEWS[v]
        cam.location = (x, y, zc)
        cam.rotation_euler = rot
        p = os.path.join(outdir, f'{tag}_{v}.png')
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    tag = argv[0] if argv else 'test'
    engine = argv[1] if len(argv) > 1 else 'BLENDER_EEVEE'
    render_views(tag, engine)
