"""Renders ortográficos front / side / back con el mismo encuadre que ref/ref_*.png (600×1080 px,
560 px/m, suelo en la fila 1040, eje en la columna 300): arcilla gris clara, sombreado plano y
aristas oscuras como en la hoja; fondo casi negro.
"""
import bpy
import numpy as np

P = 560.0
W, H = 600, 1080
GROUND = 1040
ORTHO = H / P
CENTER_Z = (GROUND - H / 2) / P
CLAY = (0.72, 0.71, 0.70)
EDGE = (0.05, 0.05, 0.055)
BG = 20 / 255
VIEWS = {
    'front': ((0, -6, CENTER_Z), (np.pi / 2, 0, 0)),
    'side': ((-6, 0, CENTER_Z), (np.pi / 2, 0, -np.pi / 2)),     # el frente (-Y) queda a la derecha
    'back': ((0, 6, CENTER_Z), (np.pi / 2, 0, np.pi)),
}


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def setup_scene(w=W, h=H, ortho=ORTHO):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'OBJECT'
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sc.display.render_aa = '8'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.color = (lin(BG),) * 3
    cam = bpy.data.objects.get('RenderCam')
    if cam is None:
        cam = bpy.data.objects.new('RenderCam', bpy.data.cameras.new('RenderCam'))
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ortho
    cam.data.clip_start, cam.data.clip_end = 0.1, 30
    sc.camera = cam
    return cam


def render_views(objs, prefix, views=('front', 'side', 'back'), setup=True):
    sc = bpy.context.scene
    cam = setup_scene() if setup else sc.camera
    keep = {o.name for o in objs} | {cam.name}
    for o in sc.objects:
        o.hide_render = o.name not in keep
    for v in views:
        cam.location, cam.rotation_euler = VIEWS[v]
        sc.render.filepath = f'{prefix}_{v}.png'
        bpy.ops.render.render(write_still=True)


def edge_overlay(obj, thickness=0.0012):
    """Aristas oscuras: copia con Wireframe (desplazada hacia fuera para que no se tape)."""
    w = obj.copy()
    w.data = obj.data
    w.name = obj.name + '_edges'
    wm = w.modifiers.new('Wire', 'WIREFRAME')
    wm.thickness = thickness
    wm.offset = 1.0
    wm.use_even_offset = True
    wm.use_replace = True
    w.color = (*EDGE, 1)
    bpy.context.scene.collection.objects.link(w)
    return w


def render_masks(obj, prefix):
    sc = bpy.context.scene
    setup_scene()
    sh = sc.display.shading
    sh.light = 'FLAT'
    old = tuple(obj.color)
    obj.color = (1, 1, 1, 1)
    sc.world.color = (0, 0, 0)
    render_views([obj], prefix, setup=False)
    obj.color = old
