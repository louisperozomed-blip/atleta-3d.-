#!/usr/bin/env bash
# Reconstruye la versión v3 desde cero (Blender 4.x en modo headless).
set -euo pipefail
cd "$(dirname "$0")"
BL="xvfb-run -a blender -b"
python3 scripts/crop_reference.py                          # recortes y siluetas de referencia
python3 scripts/face_paint.py                              # textura pintada de la cara -> export/face_paint.png
$BL -P scripts/build_model.py -- v3                        # malla + ropa + pelo + colores -> export/atleta_model.blend
python3 scripts/compare.py v3                              # renders/compare_v3.png, sidebyside_v3.png
$BL export/atleta_model.blend -P scripts/render_face.py -- v3
python3 scripts/compare_face.py v3                         # renders/face_v3.png (primer plano frente/perfil)
$BL export/atleta_model.blend -P scripts/rig_animate.py    # rig + pesos + acciones -> export/atleta.blend
$BL export/atleta.blend -P scripts/export_unity.py         # export/atleta.fbx, export/atleta.glb (+ verificación)
$BL export/atleta.blend -P scripts/render_anim.py          # renders/anim_*.png, renders/deform_poses.png
