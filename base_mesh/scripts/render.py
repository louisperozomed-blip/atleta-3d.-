"""Renders ortográficos front / side / back con material de arcilla gris y fondo oscuro como la hoja.

El encuadre coincide con los recortes de reference/ref_*.png (400 x 960 px, 541.8 px/m,
suelo en la fila 940, eje de la figura en la columna 200), así las imágenes se pueden
superponer píxel a píxel con la referencia.
"""
import bpy
import numpy as np

PX_PER_M = 921 / 1.70
W, H = 400, 960
GROUND_ROW = 940
ORTHO = H / PX_PER_M                                   # alto visible en metros
CENTER_Z = (GROUND_ROW - H / 2) / PX_PER_M              # z del centro de la imagen
BG_SRGB = 61 / 255
CLAY = (0.62, 0.62, 0.62)
WIRE = (0.08, 0.08, 0.09)

# vista -> (posición de la cámara, rotación euler)
VIEWS = {
    'front': ((0, -5, CENTER_Z), (np.pi / 2, 0, 0)),
    'side': ((-5, 0, CENTER_Z), (np.pi / 2, 0, -np.pi / 2)),   # mira a +X: el frente (-Y) queda a la derecha
    'back': ((0, 5, CENTER_Z), (np.pi / 2, 0, np.pi)),
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'OBJECT'
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    sh.cavity_ridge_factor = 0.6
    sh.cavity_valley_factor = 0.8
    sh.show_object_outline = False
    sh.show_specular_highlight = True
    sc.display.render_aa = '8'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    lin = srgb_to_linear(BG_SRGB)
    sc.world.color = (lin, lin, lin)
    cam = bpy.data.objects.get('RenderCam')
    if cam is None:
        cd = bpy.data.cameras.new('RenderCam')
        cam = bpy.data.objects.new('RenderCam', cd)
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ORTHO
    cam.data.clip_start, cam.data.clip_end = 0.1, 20
    sc.camera = cam
    return cam


def render_views(objs_visible, prefix, views=('front', 'side', 'back'), setup=True):
    """objs_visible: objetos a mostrar (el resto se oculta en render)."""
    sc = bpy.context.scene
    cam = setup_scene() if setup else sc.camera
    keep = set(o.name for o in objs_visible) | {cam.name}
    for o in sc.objects:
        o.hide_render = o.name not in keep
    out = []
    for v in views:
        loc, rot = VIEWS[v]
        cam.location = loc
        cam.rotation_euler = rot
        sc.render.filepath = f'{prefix}_{v}.png'
        bpy.ops.render.render(write_still=True)
        out.append(sc.render.filepath)
    return out


def render_masks(obj, prefix):
    """Máscara plana (blanco sobre negro) para medir la silueta sin efectos de luz."""
    sc = bpy.context.scene
    setup_scene()
    sh = sc.display.shading
    old = (sh.light, sh.show_cavity, tuple(obj.color), tuple(sc.world.color), sh.show_specular_highlight)
    sh.light = 'FLAT'
    sh.show_cavity = False
    sh.show_specular_highlight = False
    obj.color = (1, 1, 1, 1)
    sc.world.color = (0, 0, 0)
    out = render_views([obj], prefix, setup=False)
    sh.light, sh.show_cavity = old[0], old[1]
    obj.color = old[2]
    sc.world.color = old[3]
    sh.show_specular_highlight = old[4]
    return out


def make_wire_overlay(obj, thickness=0.0022):
    """Copia del objeto con modificador Wireframe (aristas de la jaula) para el render de topología."""
    w = obj.copy()
    w.data = obj.data
    w.name = obj.name + '_wire'
    for md in list(w.modifiers):
        if md.type == 'SUBSURF':
            w.modifiers.remove(md)
    wm = w.modifiers.new('Wire', 'WIREFRAME')
    wm.thickness = thickness
    wm.offset = 1.0
    wm.use_even_offset = True
    wm.use_replace = True
    w.color = (*WIRE, 1)
    bpy.context.scene.collection.objects.link(w)
    return w
