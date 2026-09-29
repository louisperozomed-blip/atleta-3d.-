# PROGRESS — pixel_char (personaje isométrico con sprites 2D pintados)

Referencias: `ref/sheets/{idle,walk,run,jump}_{1,2}.png` (8 hojas; 7 de 1225×1284 y
`run_2` de 1254×1254). Las `_1` tienen filas N, NE, E, SE; las `_2`, S, SW, W, NW; 6 frames por fila.

Reconstruir todo: `cd tools && python3 extract.py && python3 normalize.py && python3 colormatch.py`
(etapa 1) — ver etapas siguientes para el resto.

## Etapa 1 — Recorte y limpieza

Salida: `frames/<anim>_<dir>_<i>.png` (192 RGBA, lienzo 224×272, pivote en (112, 250)),
`review/stage1_contact_{white,magenta}.png` y `review/stage1_measurements.txt`.

| Problema encontrado | Corrección |
|---|---|
| Rejilla: las hojas no tienen la misma geometría (`run_2` es de otro tamaño y sus filas están desplazadas) | Filas por las 4 líneas separadoras oscuras (perfil de luminancia); columnas por los números 1–6 de cada fila. |
| En los saltos NE/E/SE un puño toca el número «4»/«3», que no se detecta o se pega al casco | Números = componentes pequeñas alineadas en la misma línea base; si falta uno se toma la columna de la fila anterior. La zona de cada número se borra siempre de la silueta. |
| Primer recorte: el negro del casco y la tela verde oscura se confundían con el fondo (agujeros) | El fondo es gris **azulado-verdoso** (G−R≈7, B−R≈10) y el negro del personaje es neutro/cálido y el verde tiene G≥B: el clasificador exige ese tinte frío. Los huecos interiores solo se quitan si son fondo «seguro» (entre brazo y cuerpo). |
| Baldosa gris, rejilla de la baldosa y sombras pintadas | Son grises neutros: se eliminan con el fondo (incluida la sombra elíptica bajo los saltos). |
| Bordes dentados y motas oscuras (artefactos de compresión del original) | Silueta suavizada (blur + umbral + apertura), alfa de borde de ~1.5 px y color del anillo de borde tomado del interior cercano: sin halo azulado/oscuro, pero se conserva el contorno pintado. |
| Escala inconsistente: la baldosa mide igual en todas las hojas (semieje ≈92 px) pero el personaje de pie mide de 194 a 226 px según la fila (idle SE 226, idle N 194…) | Escala por fila combinando altura de pie (idle/walk) y radio del casco (transformada de distancia; constante por dirección entre idle/walk/run). Salto: casco del frame menos tapado, ajuste limitado a ±6 %. Factores 0.92–1.08. |
| Pies a distinta altura respecto a la baldosa según la fila (31–48 px) | Pivote = centro de la baldosa de cada frame (estable ±0.5 px dentro de una fila, conserva el bob pintado y la altura del salto) + desfase por fila para que el pie apoyado caiga en el pivote. Centros de baldosa suavizados con el patrón de columnas común a las 4 filas. |
| Pies del idle bailando ±2 px | Corrección subpíxel por frame en idle para plantar los pies (variación final 0 px). |
| **JUMP SW** muestra al personaje de espaldas | Sustituido por el espejo horizontal de JUMP SE. |
| **JUMP S** tiene el diseño espejado (panel con bordado naranja a la izquierda; en idle/walk/run S está a la derecha) | Espejado sobre sí mismo (sigue mirando al S). |
| Tonos distintos entre hojas (verde más claro en jump, negro L 16–25, dorado más saturado en jump S) | Corrección por material (cálido crema/dorado, verde, negro) y por fila: curva monótona de L por percentiles + desplazamiento a/b por tramo de L (no aplana el sombreado). Dispersión entre filas: a/b del dorado 1.8/3.1 → 1.2/1.3, L del negro 2.2 → 0.8. |

Resultado de la medición (`review/stage1_measurements.txt`): altura de pie idle 194–212 px y walk 192–216 px
(antes 194–226); planta del pie en idle a 0 px del pivote en todos los frames, walk −5..+2 px
(salvo los frames con un pie levantado en N/NE/SE, que es el dibujo); centro del cuerpo estable ±3 px.

Avisos (sin corregir, no son direcciones equivocadas):
- `jump_NW` también tiene el panel bordado en el lado contrario al de walk/idle NW; no se puede
  espejar sin convertirlo en NE, así que se deja.
- Al espejar JUMP SE para crear SW, el panel bordado cambia de lado respecto a walk/idle SW
  (consecuencia inevitable del espejo pedido).
- El resto de filas (N, NE, E, SE, S, SW, W, NW de idle/walk/run y N, NE, E, SE, W, NW de jump)
  miran a la dirección de su etiqueta.
