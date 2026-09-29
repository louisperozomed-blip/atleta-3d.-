"""Proporciones del base mesh (1 unidad = 1 metro, Z arriba, mira hacia -Y, pies en Z=0).

Todas las medidas salen de reference/base_mesh_sheet.png (541.8 px = 1 m). Cambia estas
variables y vuelve a ejecutar build.py: la topología no cambia, solo las posiciones.
"""
HEIGHT = 1.70            # altura total (coronilla)
HEAD_H = 0.21            # barbilla -> coronilla (≈ 8 cabezas)
SHOULDER_W = 0.40        # ancho de hombros (deltoides a deltoides)
CHEST_W = 0.26           # caja torácica bajo la axila
BUST = 0.055             # proyección del pecho respecto a la caja torácica
WAIST_W = 0.184          # cintura (el punto más estrecho)
HIP_W = 0.376            # cadera (trocánteres)
GLUTE = 0.048            # proyección del glúteo hacia atrás
THIGH_R = 0.092          # radio del muslo arriba
CALF_R = 0.062           # radio de la pantorrilla
CROTCH_Z = 0.87          # altura de la entrepierna
ARM_LEN = 0.64           # hombro -> punta de los dedos
LEG_LEN = 0.87           # entrepierna -> suelo
ARM_ANGLE = 18.0         # grados del brazo respecto a la vertical (A-pose de la hoja)

# puntos de referencia derivados (lado izquierdo del personaje, +X)
S = HEIGHT / 1.70        # factor de escala global
