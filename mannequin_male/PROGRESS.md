# Maniquí base masculino, registro de progreso

Proyecto nuevo, hecho desde cero: no reutiliza nada del base mesh femenino.
- Referencias: `ref/hoja_maniqui.jpg` (vistas front/side/back y bloques) y `ref/tabla_poligonos.jpg`
  (tabla de Pedro Amaro Santos: Linear Stepping, FourPointTriangle, Trapezium, divisiones Central, Parallel y Grid).
- Estilo: low/mid poly facetado, sombreado plano, sin Subdivision y sin suavizado.
- Topología: media malla con Mirror en X (clipping y merge 1e-4); se aplica en la etapa 6.

## Flujo de trabajo

| script | qué hace |
|---|---|
| `scripts/crop_reference.py` | Recorta la hoja en `ref/ref_{front,side,back}.png` (y los paneles de bloques). Saca las siluetas `sil_*.png` y calibra cada vista al mismo lienzo. |
| `scripts/measure_ref.py` | Mide las siluetas: anchos por altura (front/back) y perfil delantero/trasero (side). |
| `scripts/tables.json` | Medidas de cada anillo: torso, pierna, cuello, cabeza y brazo. |
| `scripts/mesh.py` | `HalfMesh`: anillos, bridge y Linear Stepping (`step` con q/f/t). También las tapas Grid y Parallel y la extrusión. Cada transición queda en un log. |
| `scripts/figure.py` | Construye la figura por bloques: torso+pelvis, piernas+pies, brazos+manos, cuello+cabeza. |
| `scripts/build.py` | Blender headless: construye, valida (`validate.py`) y renderiza (`render.py`). |
| `scripts/compare.py` | Compara render y hoja con la misma cámara. Da IoU, error por borde cada 2 cm y % de bordes dentro de ±1 cm. Genera `sidebyside`, `overlay` y `silhouette`. |
| `scripts/fit.py` | Ajuste automático de semianchos y radios contra las siluetas. Tiene exclusiones donde la hoja tapa un miembro con otro. |
| `scripts/iter.sh` | Hace build + compare en un solo paso. |

Renders:
- Cámara ortográfica fija de 600×1080 px, 560 px/m, suelo en la fila 1040.
- Arcilla gris clara con aristas oscuras.
- La hoja se reescala al mismo lienzo, así que cada `*_sidebyside.jpg` compara píxel a píxel.

## Calibración de la hoja

| vista | cabeza (px) | suelo (px) | px/m | eje |
|---|---|---|---|---|
| front | 30 | 1082 | 584.4 | x 334.5 (línea media) |
| side | 37 | 1080 | 579.4 | x 726 (mitad del pie, a 2 cm del suelo) |
| back | 37 | 1069 | 573.3 | x 1060 |

- La altura total es 1.80 m en las tres vistas.
- La regla «HEADS» de la hoja no está equiespaciada: las marcas miden entre 0.19 y 0.26 m en el lienzo. Por eso se calibra con la altura total.
- La cabeza mide unos 0.22 m (barbilla ≈ 1.58 m, coronilla 1.80 m), es decir unas 8 cabezas: el canon heroico.
- Hitos medidos: axila 1.37, pezón ≈ 1.32, cintura ≈ 1.13, entrepierna 0.90, rodilla 0.55, tobillo 0.13–0.17 (en m).
- Los ejes de las vistas 3D en Blender son:
  - +X a la derecha del espectador en FRONT;
  - −Y hacia delante;
  - Z hacia arriba;
  - origen entre los pies.

## Etapa 1: blockout de proporciones (`renders/s1_blockout/`)

La malla es de quads desde el principio: cada bloque ya tiene los anillos anatómicos que luego se esculpen por planos.

- **Torso**
  - 13 anillos de 11 ranuras, de la línea media delante (0°) a la columna (180°).
  - Ranuras: recto abdominal, pezón, serrato, costado, dorsal, escápula y erectores.
  - Superelipse de potencia 2.4.
- **Agujero del brazo**
  - Entre los anillos 9 y 11 (axila z 1.37, acromion z 1.46) y las ranuras 4 a 6: 8 aristas, igual que el brazo.
  - El deltoides es un loft Bézier de 2 anillos desde el agujero hasta el primer anillo del húmero.
- **Entrepierna**
  - Cadena de 3 vértices sobre el eje. El agujero de la pierna tiene 14 aristas.
- **Pierna**
  - 10 aristas; anillos en ingle, muslo (3), rodilla (3), gemelo, tobillo (2).
  - Pie: 7 anillos que pasan de horizontal (tobillo) a vertical (empeine → puntera).
- **Brazo**
  - 8 aristas; anillos en deltoides, bíceps, codo (3), antebrazo y muñeca (2).
- **Mano**
  - Nudillos 16 → palma 12 → muñeca 8.
  - 4 dedos de 4 segmentos y pulgar separado.
  - Pronación de 35° como en la hoja.
- **Cuello y cabeza**
  - Medio anillo de 6 aristas, 3 anillos de cuello (trapecio), 7 de cabeza y coronilla.

### Transiciones de densidad (patrones de la tabla)

| transición | patrón | detalle | polos que deja (justificación) |
|---|---|---|---|
| pelvis → muslo | Linear Stepping, 2 FourPointTriangles (`fqqqqqqqqfqq`) | 14 → 10 aristas | 2 polos de 5: pliegue inguinal delante y pliegue del glúteo detrás. No se doblan al flexionar la cadera (son el borde del pliegue, no su centro). |
| nudillos → palma → muñeca | 2 + 2 FourPointTriangles (`qqqfqqqqqqqfqq`, `qfqqqqfqqq`) | 16 → 12 → 8 | 4 polos de 5 en el centro del dorso y de la palma: zona plana y rígida (metacarpos). |
| palma → dedos | Parallel Division | el anillo de 16 da 4 bases de dedo + 3 membranas | ninguno |
| torso → cuello | 2 FourPointTriangles (`qqfqqqfq`) | 10 → 6 aristas | 2 polos de 5: clavícula y trapecio superior, fuera del pliegue del cuello. |
| puntera | Grid Division 2 × 3 | anillo de 10 | ninguno (polos de 3 en las esquinas del bloque de zapato, que no se deforma) |
| coronilla | Grid Division 2 × 2 | medio anillo de 6 + eje | ninguno en zona de deformación |
| punta de dedo | Parallel Division | anillo de 4 → 1 quad | ninguno |

### Iteraciones

IoU / % de bordes dentro de ±1 cm, comparando cada 2 cm de altura. El total de caras es tras el Mirror.

| iter | caras | autointersecciones | front | side | back | cambio |
|---|---|---|---|---|---|---|
| b1a | 1292 | 18 | 0.846 / 77 % | 0.890 / 78 % | 0.822 / 76 % | Primer blockout con las medidas de `measure_ref.py`. La entrepierna daba polos de 6: se cambió a una cadena de 3 vértices con 2 FourPointTriangles. |
| b1b–b1c | 1294 | 18 → 10 | 0.851 / 80 % | 0.891 / 78 % | 0.834 / 79 % | Hombro más fuera (0.215, 0.05, 1.40), loft del deltoides más ancho. |
| b1d–b1g | 1294 | 10 | 0.885 / 86 % | 0.925 / 89 % | 0.856 / 83 % | Primer `fit.py`. Contaminó cuello, cabeza, muslo y muñeca con otros miembros; se corrigió a mano y el fitter quedó restringido. |
| b1h–b1i | 1314 | 2 | 0.883 / 88 % | 0.925 / 89 % | 0.849 / 84 % | Fila extra de torso: agujero del brazo a las filas 9–11. Pie rehecho (más corto y alto). Coronilla a 1.795. |
| b1j | 1314 | **0** | 0.883 / 88 % | 0.925 / 89 % | 0.848 / 83 % | El loft de la axila se plegaba contra el costado. El tirador Bézier ahora no pasa de la mitad del hueco torso → brazo. |
| b1k–b1l | 1314 | 0 | 0.909 / 88 % | 0.924 / 89 % | 0.873 / 84 % | Trapecio y deltoides como en la hoja: filas 11–12 más altas y anchas, cuello ancho en la base, cúpula del deltoides, hombro a z 1.415. En la zona 1.30–1.62 el front pasa a 100 % dentro de ±1 cm. |
| b1m–b1n | 1314 | 0 | 0.923 / 93 % | 0.926 / 88 % | 0.894 / 86 % | Dedos 15 % más cortos, pulgar paralelo a los dedos y mano pronada 35°, con la punta más hacia el muslo. La mano en side pasa a 94 % (0.70–1.00 m). |
| b1o–b1p | 1314 | 0 | **0.925 / 94 %** | **0.928 / 90 %** | **0.895 / 88 %** | Perfil del cuello, pies 1 cm más fuera y más anchos, coronilla a 1.797 (altura 1.798 m). |

Las filas de b1l y b1m se midieron solo en la zona de trabajo (1.30–1.62 y 0.70–1.00). Por eso no se comparan con el resto.

Validación de b1p (malla completa):
- 1314 quads, 0 triángulos, 0 n-gons;
- 0 polos de más de 5; 0 polos en zonas de articulación;
- 0 aristas no manifold, 0 duplicados, 0 caras internas, 0 autointersecciones;
- normales hacia fuera, simetría exacta (error 0).

### Diferencias que quedan fuera de ±1 cm (y por qué)

- **BACK, trapecio y hombro (z 1.40–1.58).**
  - La hoja dibuja la espalda 1.5–3 cm más ancha que la vista FRONT a la misma altura.
  - Con una malla simétrica no se pueden cumplir las dos. Se toma FRONT como referencia de anchos (queda dentro de ±1 cm).
  - Lo mismo pasa con la cintura: BACK es ~1 cm más estrecho que FRONT.
- **SIDE, pies (z < 0.16).**
  - La vista lateral de la hoja tiene perspectiva: el pie lejano asoma por encima y por detrás del cercano.
  - Esos bordes no son de este pie. El pie cercano coincide en largo y altura.
- **FRONT, pie (z 0.02–0.10).**
  - El borde interior es 1.3–2 cm distinto: la hoja lo dibuja vertical y el bloque de zapato está inclinado.
  - Se retoca en la etapa 4 (pies).
- **Axila (z 1.38–1.40).**
  - La hoja deja un hueco de 1 cm entre brazo y torso. En el modelo el brazo toca el dorsal.
  - Se abre en la etapa 3.
- **Hombro (z 1.50).**
  - Muesca de 7 mm entre el trapecio y la cúpula del deltoides.
  - Se funde en la etapa 2 al esculpir el trapecio.
- **Mano (z 0.78–0.92).**
  - La hoja muestra el pulgar como un tramo separado. El modelo aún lo pega a la palma en FRONT.
  - Es etapa 4.

Renders guardados:
- b1p completo: `b1p_front/side/back.png`, `b1p_overlay.jpg`, `b1p_silhouette.png`.
- Todas las iteraciones: `*_sidebyside.jpg`, `*_compare.json`, `*_validate.json`.
