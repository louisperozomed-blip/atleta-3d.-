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
    'q34': ((6 * np.sin(np.pi / 4), -6 * np.cos(np.pi / 4), CENTER_Z), (np.pi / 2, 0, np.pi / 4)),  # 3/4 delante-derecha
}


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def setup_scene(w=W, h=H, ortho=ORTHO):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    if sc.world is not None:
        sc.world.use_nodes = False
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sh = sc.display.shading
    # matcap gris con luz lateral (relativa a la cámara): cada vista se lee igual y los planos
    # facetados se distinguen, como en la hoja. El color de objeto tiñe el matcap (aristas oscuras).
    sh.light = 'MATCAP'
    sh.studio_light = 'basic_side.exr'
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


def material(name, rgb, rough=0.85):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = 0.2
    return m


def setup_eevee():
    """EEVEE con luz de la hoja: sol principal arriba a la izquierda y delante de la cámara, relleno
    suave del lado contrario. Las luces cuelgan de la cámara, así todas las vistas se iluminan
    igual respecto al espectador."""
    sc = bpy.context.scene
    cam = setup_scene()
    sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 16
    sc.view_settings.view_transform = 'Standard'
    if sc.world.use_nodes is False:
        sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (lin(BG),) * 3 + (1,)
    bg.inputs['Strength'].default_value = 1.0
    for name, rot, energy in (('KeySun', (-0.75, -0.55, 0.0), 1.7), ('FillSun', (-0.2, 0.9, 0.0), 0.35)):
        o = bpy.data.objects.get(name)
        if o is None:
            o = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
            sc.collection.objects.link(o)
        o.data.energy = energy
        o.data.angle = 0.1
        o.parent = cam
        o.location = (0, 0, 0)
        o.rotation_euler = rot            # en el marco de la cámara: -Z mira hacia la escena
    return cam


def use_materials(objs):
    """Materiales de arcilla (objeto) y aristas (copia wireframe), enlazados al objeto."""
    for o in objs:
        if o.type != 'MESH':
            continue
        if not o.material_slots:
            o.data.materials.append(None)
        o.material_slots[0].link = 'OBJECT'
        edge = o.name.endswith('_edges')
        o.material_slots[0].material = material('Edge' if edge else 'Clay', EDGE if edge else CLAY)


def render_views(objs, prefix, views=('front', 'side', 'back'), setup=True, eevee=False):
    sc = bpy.context.scene
    if eevee:
        cam = setup_eevee()
        use_materials(objs)
    else:
        cam = setup_scene() if setup else sc.camera
    keep = {o.name for o in objs} | {cam.name, 'KeySun', 'FillSun'}
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
