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

## Etapa 2: torso y pelvis (`renders/s2_torso/`)

Hitos anatómicos leídos en la hoja con `scripts/grid_ref.py` (rejilla métrica sobre la vista, en m):

| hito | z |
|---|---|
| clavícula | 1.50 |
| borde inferior del pectoral | 1.37 en el centro, 1.41 junto a la axila |
| intersecciones del recto | 1.29, 1.22, 1.16 |
| ombligo | ≈ 1.10 |
| V inguinal | de (0.10, 1.09) a (0.04, 0.97) |
| pliegue del glúteo | ≈ 0.84 |

La V inguinal va de (x, z) = (0.10, 1.09) a (0.04, 0.97).

### Talla por planos

`tables.json` → `carve` y `leg_carve`: cada vértice de un anillo se desplaza según la normal del anillo y/o en z.
- Se usan los mismos anillos y ranuras con nombre anatómico de la etapa 1, así que la topología no cambia.
- Tras tallar, `fit.py torso` recoloca la línea media para que el perfil siga dentro de la silueta.

| zona | anillos (z) / ranuras | desplazamiento |
|---|---|---|
| pectoral: placa y borde en voladizo | 9–11 (1.37–1.46) / recto, pezón, serrato | +20…22 mm |
| pliegue del pectoral | 9 / serrato | sube 25 mm hacia la axila |
| esternón | 9–11 / línea media | +10 mm (surco entre pectorales) |
| caja torácica bajo el pectoral | 8 (1.325) | −16 mm (escalón del pliegue) |
| recto abdominal | 3–7 / línea media y recto | +3…6 mm; bloques +8 mm |
| intersecciones tendinosas | 4, 6 (1.13, 1.23) | −13 mm |
| línea semilunar | ranura 26° | −8 mm |
| oblicuo externo | ranura 44° | −12 mm (plano lateral); +6 mm sobre la cresta ilíaca |
| surco inguinal | 1 (0.98) | −5 mm |
| columna / erectores | 1–11 / 180°; 1–4 / 166° | −8 mm; +8 mm |
| escápula / infraespinoso | 8–11 / 130°, 150° | +14 mm |
| dorsal ancho | 5–8 / 110° | +10 mm |
| glúteo mayor | torso 0–1 y pierna 0.86–0.90 detrás | +14…22 mm |
| pliegue del glúteo | pierna 0.80–0.84 detrás | −10 mm |
| pliegue interglúteo | 0 / 180° | −12 mm |

### Cambio de topología: el agujero del brazo sube al anillo superior

- En t2a–t2b el agujero ocupaba los anillos 9–11: el trapecio y el acromion pasaban por encima del brazo como una repisa, con un pico en el deltoides.
- Desde t2c el agujero va de 10 a 12 (axila z 1.39 → anillo superior), sigue en las ranuras 66°–110° y conserva sus 8 aristas.
- Su borde superior es ahora el mismo que usa el Linear Stepping torso → cuello. Las caras del trapecio (quads del paso `qqfqqqfq`) llegan directamente a la cúpula del deltoides, igual que en la hoja.
- La arista es manifold: una cara de trapecio y una del loft del deltoides.
- El tirador Bézier del loft ya no se levanta más de 4 cm, así que no hay pico.

### Render

- En la etapa 1 las renders usaban Workbench con luz de estudio de frente, que aplana los planos.
- Desde t2e, `render.py` usa EEVEE:
  - sol principal arriba a la izquierda, relleno suave del otro lado;
  - las dos luces cuelgan de la cámara, así las 4 vistas se iluminan igual que la hoja;
  - arcilla gris clara (0.72) y aristas oscuras (Wireframe).
- Nueva vista 3/4 (`q34`) para leer volúmenes.
- Las máscaras de silueta siguen en Workbench (sin luz).
- `scripts/zoom.py` compone hoja (arriba) y modelo (abajo) de una zona con la misma cámara.

### Iteraciones

| iter | front | side | back | cambio |
|---|---|---|---|---|
| t2a | 0.925 / 94 % | 0.920 / 86 % | 0.895 / 88 % | Primera talla. Detectado: la normal en la línea media daba NaN (22 aristas abiertas); corregido. |
| t2b | 0.925 / 92 % | 0.917 / 85 % | 0.893 / 87 % | Menos ondulación en el abdomen; pectoral y espalda más marcados. |
| t2c | 0.926 / 93 % | 0.918 / 87 % | 0.894 / 86 % | Agujero del brazo a los anillos 10–12: trapecio → deltoides continuo. |
| t2d | 0.926 / 93 % | 0.928 / 90 % | 0.894 / 86 % | Pectoral como placa (+2 cm), columna del recto; `fit.py torso` recupera el perfil. |
| t2e | 0.926 / 93 % | 0.930 / 90 % | 0.895 / 86 % | Escalón bajo el pectoral (−16 mm), intersecciones y serrato. Renders en EEVEE con la luz de la hoja. |
| t2f | 0.924 / 93 % | 0.930 / 90 % | 0.894 / 87 % | Amplitudes ×2 en abdomen, oblicuos, dorsal, escápula y glúteo. |
| t2g | **0.924 / 93 %** | **0.927 / 88 %** | **0.894 / 87 %** | `leg_carve`: el glúteo baja a la pierna (0.86–0.90), pliegue del glúteo a 0.82, ingle retirada. Las intersecciones cruzan también la línea semilunar. |

Validación de t2g:
- 1314 quads, 0 triángulos, 0 n-gons, 0 polos de más de 5, 0 polos en zonas de articulación;
- 0 aristas abiertas o no manifold, 0 autointersecciones;
- simetría exacta.

La etapa no añade caras: solo mueve vértices y cambia qué anillo cierra el agujero. El total sube en las etapas 3–5 (dedos, pies, cabeza) hacia 1 500–3 000.

Pendiente para etapas siguientes:
- Los bloques del recto se leen menos que en la hoja: sus planos son más grandes que los 5 cm entre anillos. Se reforzará al revisar la densidad del torso en la etapa 6 si hace falta.
- Deltoides y brazo más finos de volumen que en la hoja (etapa 3).

## Etapa 3: brazos y piernas (`renders/s3_limbs/`)

### Talla por planos de los miembros

Como el torso: los vértices de cada anillo se desplazan sin cambiar la topología.
- **Brazo** (`arm_carve`): anillos de 8 ranuras; k = 0 delante, 2 fuera, 4 detrás, 6 dentro.
- **Pierna** (`leg_carve`): rango de z y de ángulo; 0° delante, 90° fuera, 180° detrás, 270° dentro.

| músculo / hito | dónde | desplazamiento |
|---|---|---|
| deltoides: cúpula y masa lateral | húmero t 0.16–0.28, ranuras 1–3 | +6…8 mm |
| inserción del deltoides (V) | t 0.48, fuera | −4 mm |
| bíceps y su pico / tendón | t 0.48–0.68 delante; t 0.86 | +8 (+4) mm; −4 mm |
| tríceps (herradura) | t 0.28–0.68 detrás | +8 (+4) mm |
| codo estrecho / olécranon | t 0.94–1.0 a los lados; detrás | −4 mm; +4 mm |
| braquiorradial y flexores | antebrazo t 0.07–0.45, fuera-delante / dentro | reparto 3-7-3 mm y 2-6 mm |
| antebrazo hacia la muñeca | t 0.70–0.88 | −2 mm |
| recto femoral / vasto lateral | z 0.62–0.80 delante / fuera | +6 / +4 mm |
| vasto medial (lágrima) | z 0.58–0.66 dentro | +8 mm |
| rótula plana, rodilla estrecha | z 0.50–0.57 | −4 mm |
| tendón rotuliano / hueco poplíteo | z 0.46–0.50 delante / 0.53–0.57 detrás | −6 / −8 mm |
| gemelo y cabeza interna | z 0.38–0.47 detrás / detrás-dentro | +10 / +6 mm |
| cresta de la tibia / tendón de Aquiles | z 0.20–0.45 delante / 0.20–0.28 detrás | +3 / −6 mm |

Tras la talla se ajustan radios y centros de brazo y pierna contra las siluetas con `fit.py leg,arm` (dos pasadas).

### Loops en articulaciones

Anillos cuyo centro cae cerca del centro articular:

| articulación | loops | radio de búsqueda |
|---|---|---|
| hombro | 4 | 7 cm |
| codo | 4 | 5 cm |
| muñeca | 3 | 3.5 cm |
| rodilla | 3 (0.59, 0.55, 0.51) | 5 cm |
| tobillo | 3 (0.17, 0.15, 0.13) | 5 cm |

El tobillo tenía 2 loops: en l3e se añadió el anillo de z 0.15 (+20 quads en la malla completa).

### Iteraciones

| iter | caras | front | side | back | cambio |
|---|---|---|---|---|---|
| l3a | 1314 | 0.924 / 93 % | 0.927 / 88 % | 0.894 / 87 % | Punto de partida (t2g). |
| l3b | 1314 | 0.919 / 90 % | 0.917 / 86 % | 0.894 / 84 % | Primera talla de brazo y pierna, sin reajustar. |
| l3c | 1314 | 0.925 / 92 % | 0.925 / 88 % | 0.893 / 87 % | Dos pasadas de `fit.py leg,arm`. (El json guardado es de un recálculo posterior.) |
| l3d | 1314 | – | – | – | Glúteo algo menos saliente (en SIDE sobraban 1.4–2 cm a z 0.86–0.92). Medido solo en la zona 0.80–0.96. |
| l3e | 1334 | 0.925 / 92 % | 0.925 / 88 % | 0.894 / 86 % | Anillo extra de tobillo (z 0.15): 3 loops. |
| l3f | 1334 | 0.925 / 92 % | 0.926 / 89 % | 0.894 / 86 % | Muslo: el anillo de 0.76 tenía radio delantero 0.098 entre 0.092 y 0.068 (valor de la etapa 1 fuera del ajuste). Hacía un escalón en el cuádriceps y los +3 cm de SIDE a 0.74–0.76; ahora baja suave. |
| l3g | **1334** | **0.926 / 92 %** | **0.926 / 89 %** | **0.894 / 87 %** | Braquiorradial repartido en 3 anillos: desaparece el «puño» bajo el codo. |

Validación de l3g:
- 1334 quads, 0 triángulos, 0 n-gons, 0 polos de más de 5;
- 0 polos en zonas de articulación, 0 autointersecciones, 0 aristas abiertas;
- simetría exacta.
