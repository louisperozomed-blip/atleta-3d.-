#!/usr/bin/env bash
# Reconstruye todo el personaje desde cero (Blender 4.x en modo headless).
set -euo pipefail
cd "$(dirname "$0")"
BL="xvfb-run -a blender -b"
python3 scripts/crop_reference.py                                    # recortes y siluetas de referencia
$BL -P scripts/build_model.py -- final                              # malla + ropa + pelo + colores -> export/atleta_model.blend
python3 scripts/compare.py final                                     # renders/compare_final.png, sidebyside_final.png
$BL export/atleta_model.blend -P scripts/rig_animate.py             # rig + pesos + acciones -> export/atleta.blend
$BL export/atleta.blend -P scripts/export_unity.py                  # export/atleta.fbx, export/atleta.glb (+ verificación)
$BL export/atleta.blend -P scripts/render_anim.py                   # renders/anim_*.png, renders/deform_poses.png
