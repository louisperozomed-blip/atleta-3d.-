"""Primer plano de la cara (frente y perfil) comparado con la referencia ampliada.

Uso: xvfb-run -a blender -b export/atleta_model.blend -P scripts/render_face.py -- <tag>
Salida: renders/iter/<tag>_face_front.png, _face_side.png (luego compare_face.py monta la comparativa)
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math  # noqa: E402
import bpy  # noqa: E402
import common as C  # noqa: E402
import render_views as RV  # noqa: E402

SIZE = 0.30          # metros visibles (ortho)
CENTER_Z = 1.575


def main(tag):
    out = os.path.join(C.RENDERS, 'iter')
    os.makedirs(out, exist_ok=True)
    RV.setup_render('BLENDER_EEVEE', 600, 600)
    cam = RV.get_camera()
    cam.data.ortho_scale = SIZE
    views = {'front': ((0.0, -3.0, CENTER_Z), (math.radians(90), 0, 0)),
             'side': ((-3.0, -0.10, CENTER_Z), (math.radians(90), 0, math.radians(-90)))}
    for v, (loc, rot) in views.items():
        cam.location = loc
        cam.rotation_euler = rot
        bpy.context.scene.render.filepath = os.path.join(out, f'{tag}_face_{v}.png')
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['face']
    main(argv[0])
