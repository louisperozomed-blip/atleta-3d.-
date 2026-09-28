"""Constantes y utilidades compartidas por todos los scripts de Blender.

Convenciones del modelo (Blender):
  * Unidades en metros, Z arriba, el personaje mira hacia -Y, pies en Z=0.
  * +X es el lado IZQUIERDO del personaje (a la derecha de la imagen FRONT).
  * Escala de la hoja de referencia: 512 px = 1 m; suelo en y=921 px.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'scripts')
EXPORT = os.path.join(ROOT, 'export')
RENDERS = os.path.join(ROOT, 'renders')
REFERENCE = os.path.join(ROOT, 'reference')
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

PX_PER_M = 512.0
GROUND_PX = 921.0
CROP_W, CROP_H = 560, 940
BG_RGB = (198, 198, 201)

# Paleta (sRGB 0-255) muestreada de la hoja de referencia.
PALETTE = [
    ('skin',        (222, 138, 74)),
    ('teal',        (34, 174, 181)),
    ('teal_dark',   (18, 116, 124)),
    ('white',       (236, 222, 214)),
    ('coral',       (246, 112, 92)),
    ('navy',        (58, 56, 84)),
    ('hair',        (124, 60, 33)),
    ('hair_dark',   (86, 42, 25)),
    ('eye_white',   (248, 240, 232)),
    ('iris',        (118, 56, 26)),
    ('lash',        (44, 24, 20)),
    ('brow',        (78, 38, 24)),
    ('lips',        (184, 94, 62)),
    ('skin_shadow', (196, 114, 60)),
    ('shoe_white',  (242, 232, 226)),
    ('teal_short',  (22, 146, 154)),
]
CKEY = {name: i for i, (name, _) in enumerate(PALETTE)}
N_SHADES = 8
SHADE_FACTORS = [0.93, 0.955, 0.975, 0.99, 1.0, 1.015, 1.035, 1.06]


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def shade_rgb(ckey, shade):
    r, g, b = PALETTE[ckey][1]
    f = SHADE_FACTORS[shade]
    # variación ligera de tono además de brillo: sombras algo más cálidas/rojizas
    warm = (shade - 3.5) / 3.5 * 3
    return (min(255, max(0, r * f + warm)), min(255, max(0, g * f)), min(255, max(0, b * f - warm)))
