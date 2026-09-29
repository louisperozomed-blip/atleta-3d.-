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

## Etapa 4: manos y pies (`renders/s4_hands_feet/`)

`scripts/zoom.py` acepta ahora un rango `x0:x1` para encuadrar la mano o el pie.
En SIDE el eje horizontal es −y: la mano se encuadra con −0.12:0.12 y el pie con −0.18:0.22.

### Mano

- **Orientación.**
  - En la etapa 1 la mano iba pronada 35° para imitar la «C» que se ve en FRONT.
  - La vista SIDE de la hoja lo desmiente: se ve el dorso con los 4 dedos paralelos, así que el dorso mira hacia fuera.
  - La «C» de FRONT sale de los dedos curvados hacia la palma y del pulgar delante.
  - `HAND_TWIST` pasa a 5°.
- **Dedos.**
  - Curvatura hacia la palma −0.75·w (antes −0.35).
  - Sección más gruesa: base 1.0 y afilado 15 % (antes 0.92 y 25 %), como los dedos en bloque de la hoja.
  - Siguen separados por las 3 membranas de la Parallel Division.
- **Pulgar.**
  - Sale de la cara delantera del lado de la palma (se puntúa `f − 0.6·w`).
  - Primer tramo recto según la normal de esa cara (`lead=True`); después gira hacia abajo, delante y dentro (`0.4f + 0.5h − 0.6w`).
  - Largo 7 cm.
  - Sin el tramo recto, cualquier dirección metida hacia la palma cortaba la cara vecina (8–14 autointersecciones en los barridos).

### Pie: bloque de zapato

Seis secciones: talón a 35° y 60°, empeine, metatarsos, caja de los dedos y punta. La puntera se tapa con Grid Division 2 × 3.
- Secciones casi rectangulares (superelipse e = 0.4) y en trapecio: 40 % más estrechas arriba, como la puntera achaflanada de la hoja.
- Talón plano y trasera vertical: los vértices de abajo y detrás de las secciones inclinadas bajan a z = 0.
- Empeine en rampa continua desde el tobillo (z 0.13) hasta la puntera (z 0.06), sin pico en la unión.
- Arco interno abombado hacia dentro (maléolo) en las secciones del talón.
- Pierde una sección respecto a la etapa 1: 7 → 6 (−20 quads en la malla completa).

### Iteraciones

| iter | front | side | back | cambio |
|---|---|---|---|---|
| h4a | 0.926 / 92 % | 0.926 / 89 % | 0.894 / 87 % | Punto de partida (l3g). |
| h4b | 0.924 / 92 % | 0.924 / 88 % | 0.893 / 87 % | Dorso hacia fuera, dedos curvados y gruesos. Pulgar aún en gancho hacia delante. |
| h4c | 0.923 / 92 % | 0.925 / 88 % | 0.893 / 87 % | Pulgar metido delante de la palma con tramo recto de salida. |
| h4d | 0.923 / 92 % | 0.924 / 88 % | 0.892 / 86 % | Pulgar de 7 cm (antes 5.5). |
| h4e–h4f | – | – | – | Pie rehecho como zapato. La rampa tallada en la espinilla se descartó (12 autointersecciones con el pie). |
| h4g | 0.925 / 91 % | 0.937 / 89 % | 0.888 / 84 % | Secciones en trapecio; talón más estrecho y hacia fuera; arco interno. |
| h4h | 0.924 / 91 % | 0.933 / 88 % | 0.888 / 84 % | Talón plano sobre el suelo con trasera vertical: ya no se ve la suela desde BACK. |
| h4i | **0.924 / 91 %** | **0.932 / 88 %** | **0.889 / 85 %** | El vértice alto de la sección de 60° hacía un pico sobre el tobillo; rampa continua. |

Pie en FRONT, z 0–0.12: bordes a ±1…2 cm.
- En la hoja la suela entera cae hacia fuera (0.17–0.27) y el tobillo hacia dentro (0.134 a z 0.07). Es el pie abierto en V de la foto, que tiene algo de perspectiva.
- Un bloque recto y simétrico solo lo aproxima. En SIDE el pie cercano coincide en largo (talón y = 0.165, punta −0.09) y en alto de la puntera.

Validación de h4i:
- 1314 quads, 0 triángulos, 0 n-gons, 0 polos de más de 5;
- 0 autointersecciones, 0 aristas abiertas, simetría exacta.

Total de caras: 1314, por debajo del objetivo de 1 500–3 000. Se sube en la etapa 5 con los planos de la cabeza y, si hace falta, con un loop más de nudillos en la etapa 6.

## Etapa 5: cuello y cabeza (`renders/s5_head/`)

### Topología

- **Cuello y cabeza.**
  - El medio anillo pasa de 6 a 8 aristas (16 alrededor).
  - Ranuras: línea media (barbilla y nariz), cara, pómulo/mandíbula, sien/ángulo de la mandíbula, oreja, detrás de la oreja, parietal, occipital y nuca.
  - Así la cara tiene sus planos (frente, pómulo, lateral) sin ojos ni boca, como pide la hoja.
- **Torso → cuello.**
  - Linear Stepping 10 → 8 con un solo FourPointTriangle en la clavícula (`qqfqqqqqq`); antes eran dos (10 → 6).
  - El polo de 5 queda en la base del cuello, delante: al girar o inclinar la cabeza trabaja el esternocleidomastoideo, por encima. Por eso no está en zona de pliegue.
- **Coronilla.**
  - Grid Division 2 × 3: medio anillo de 8 aristas más un vértice sobre el eje.
  - Dos vértices interiores bajo la cima, para una tapa plana y achaflanada como la de la hoja.

### Forma (`head_carve`, `neck_carve`, tablas de cuello y cabeza)

- **Mandíbula.**
  - El último anillo del cuello ya no es horizontal: delante sube a z 1.61, bajo la mandíbula y detrás de la barbilla.
  - El plano inferior de la mandíbula baja de ese anillo a la barbilla (z 1.593, y −0.042), como en la vista SIDE de la hoja.
  - El borde de la mandíbula sube hacia el ángulo, bajo la oreja. El reparto es +1 cm en el anillo de la barbilla y +0.8 cm en el siguiente: si todo lo subía un solo anillo, se cruzaba con el de encima (8 autointersecciones en n5c).
- **Anchos del cuello.**
  - El anillo alto del cuello es más estrecho (0.049) que la mandíbula (0.0555): en n5c era más ancho y cortaba la mandíbula por los lados.
  - La nuca sigue el perfil trasero de la hoja: y 0.117 → 0.101 → 0.097.
- **Cara**:
  - plano frontal (ranuras de cara y pómulo adelantadas 3–6 mm);
  - pómulo +5 mm;
  - arco superciliar +7 mm;
  - cuña de la nariz +12 mm;
  - sienes planas (−4 mm).
- **Cráneo** más cúbico: superelipse de potencia 3.6 en los anillos altos.
- **Cuello**: esternocleidomastoideo +4 mm y tráquea +3 mm.

### Iteraciones

IoU / % dentro de ±1 cm. n5a–n5d se midieron en la zona de la cabeza (1.44–1.82); n5e en el cuerpo entero.

| iter | caras | front | side | back | cambio |
|---|---|---|---|---|---|
| n5a | 1314 | 0.965 / 97 % | 0.955 / 93 % | 0.873 / 83 % | Punto de partida: medio anillo de 6 y cabeza redonda. |
| n5b | 1356 | 0.970 / 97 % | 0.946 / 92 % | 0.906 / 75 % | Medio anillo de 8, paso torso → cuello 10 → 8, coronilla 2 × 3 y talla de la cara. |
| n5c | 1356 | 0.969 / 97 % | 0.933 / 92 % | 0.899 / 75 % | Cuello inclinado bajo la mandíbula. 6 autointersecciones (cuello más ancho que la mandíbula). |
| n5d | 1356 | 0.968 / 97 % | 0.934 / 92 % | 0.895 / 72 % | Cuello más estrecho; subida del ángulo de la mandíbula repartida entre dos anillos. 0 autointersecciones. |
| n5e | **1356** | **0.923 / 91 %** | **0.928 / 88 %** | **0.888 / 84 %** | Perfil de la nuca y cráneo más cúbico (cuerpo entero). |

- BACK en la zona de la cabeza baja al 72–75 %: la hoja dibuja la nuca y el trapecio más anchos en BACK que en FRONT, la misma diferencia de la etapa 1.
- Validación de n5e:
  - 1356 quads, 0 triángulos, 0 n-gons, 0 polos de más de 5;
  - 0 autointersecciones, simetría exacta.

## Etapa 6: unión, limpieza y validación (`renders/s6_final/`)

### Densidad: de 1 356 a 1 566 caras

Se añade densidad donde sirve para deformar, no por relleno.
- **Brazo de 8 a 12 aristas.**
  - Bíceps, tríceps, deltoides y antebrazo tienen ranuras propias. El codo y la muñeca conservan sus 4 y 3 loops.
  - El agujero del brazo pasa a 12 aristas: anillos 9–12 (axila z 1.37 → acromion) y ranuras 66°–130°. Así abarca los pliegues axilares delantero (pectoral) y trasero (dorsal).
  - `arm_carve` se aplica por ángulo (k·45° ± 22.5°), así que la talla de la etapa 3 sirve igual con 12 ranuras.
- **Palma → muñeca.**
  - Antes: nudillos 16 → palma 12 → muñeca 8 (4 FourPointTriangles).
  - Ahora: 16 → 12 (2 FourPointTriangles) y un Bridge 12 = 12 hasta la muñeca, con un loop intermedio en la base de la palma. Hay 2 polos menos en la mano.
- **Dedos.**
  - De 4 a 6 anillos por dedo: base, dos loops en el nudillo medio (0.38 / 0.52) y dos en el distal (0.70 / 0.80).
  - El pulgar alarga su tramo recto de salida (0.18 del largo) para no rozar la palma. Dirección final: 0.4f + 0.4h − 0.7w, la más recogida de las 4 probadas sin autointersecciones.
- `fit.py arm` recoloca los anillos del brazo contra la silueta tras el cambio.

### Validación de la malla completa (f6b)

Validación sobre la malla completa, con el Mirror aplicado en memoria (`validate.py`).

| comprobación | resultado |
|---|---|
| vértices / aristas / caras | 1568 / 3132 / 1566 (V − A + C = 2: una superficie cerrada de género 0) |
| quads / triángulos / n-gons | 1566 / 0 / 0 |
| aristas abiertas / no manifold / con más de 2 caras | 0 / 0 / 0 |
| vértices o aristas sueltos | 0 / 0 |
| vértices y caras duplicados | 0 / 0 |
| caras internas / degeneradas | 0 / 0 |
| normales invertidas | 0 (todas hacia fuera, volumen con signo +0.067 m³) |
| autointersecciones (BVH) | 0 |
| simetría (vértice espejo más lejano) | 0.0 |
| vértices del eje fuera de x = 0 | 0 |
| polos de más de 5 | 0 |
| polos en zonas de articulación | 0 |
| caja | x ±0.3465, z 0 … 1.797 m |

No quedan triángulos en ninguna parte: la tabla los permite en zonas planas, pero todas las transiciones se resolvieron con quads.

### Polos y su justificación

Por lado; el Mirror los duplica: 23 + 23 de valencia 5 y 27 + 27 de valencia 3.

| polo | nº por lado | valencia | por qué está ahí y por qué no molesta |
|---|---|---|---|
| esquinas del agujero del brazo | 4 | 5 | Axila delantera y trasera (z 1.37) y dos en el acromion (z 1.50). Los 4 caen a 2.7–10 cm del centro del hombro: en el borde de los pliegues axilares, no en su centro. Es donde un base mesh de hombro suele concentrar sus polos. |
| FourPointTriangles pelvis → muslo | 2 | 5 | Ingle delante y pliegue del glúteo detrás, a 2.8–3.1 cm fuera de la zona de cadera. Marcan el borde de los pliegues. |
| FourPointTriangle torso → cuello | 1 | 5 | Base del cuello, sobre la clavícula: fuera del giro del esternocleidomastoideo. |
| membranas entre dedos | 10 | 5 | Anillo de nudillos (Parallel Division): cada base de dedo comparte vértices con la membrana. Están en la palma, rígida, a 7 cm de la muñeca. |
| base del pulgar | 4 | 5 | Esquinas de la cara extruida en el lateral de la palma, a 4–5 cm de la muñeca. |
| FourPointTriangles dorso y palma | 2 | 5 | Centro del dorso y de la palma (16 → 12). Metacarpos: zona plana y rígida. |
| puntas de los dedos | 20 | 3 | Tapa Parallel Division de cada dedo (anillo de 4 → 1 quad). El validador las etiqueta «pierna» por su altura (z 0.75–0.86). |
| puntera del pie | 4 | 3 | Esquinas de la Grid Division 2 × 3 del bloque de zapato: no se deforma. |
| coronilla | 2 | 3 | Grid Division 2 × 3 sobre la cabeza: no se deforma. |
| FourPointTriangle del cuello | 1 | 3 | Vértice central del FourPointTriangle (lo propio del patrón). |

### Diferencias que quedan (se documentan, no se corrigen)

- **Axila trasera.** Un pequeño pliegue oscuro donde el dorsal se une al brazo (z ≈ 1.37). Es el pliegue axilar posterior, algo más marcado que en la hoja.
- **Hombros.** Las esquinas superiores del agujero se ven en FRONT como un leve saliente sobre el trapecio.
- **Siluetas de la malla final:** front 0.926 / 92 %, side 0.929 / 88 %, back 0.891 / 85 % dentro de ±1 cm. El 8–15 % restante son:
  - la espalda más ancha en BACK;
  - la perspectiva del pie en SIDE;
  - el hueco de la axila (etapa 1).

## Etapa 7: deformación, exportación, visor y README

### Test de deformación con esqueleto temporal (`scripts/deform_test.py`, `renders/s7_deform/`)

**Esqueleto provisional.**
- Huesos: cadera, 2 de columna, cuello, cabeza, y por lado clavícula, húmero, antebrazo, mano, muslo, pierna y pie.
- Las articulaciones se sacan de `tables.json` (hombro, codo, muñeca, rodilla a z 0.55, tobillo a z 0.13).
- Pesos automáticos (bone heat) suavizados: factor 0.5, 6 pasadas. Probé 3, 6 y 10 pasadas: los cruces del codo bajan de 28 a 24 y a 20, y a partir de 6 la cadera pierde más volumen (−4.9 % → −5.6 %).
- Al terminar se borran el esqueleto, el modificador y los grupos de vértices: el entregable no lleva rig.

**Medidas en cada pose.**
- Autointersecciones: pares de caras sin vértices comunes que se cruzan.
- Caras aplastadas: área menor que el 25 % de la de reposo.
- Cambio de volumen total.
- Grosor mínimo del miembro en un disco de ±3 cm alrededor de la articulación, para detectar pinzamientos.

| pose | autointersecciones | aplastadas | volumen | grosor (reposo → pose) |
|---|---|---|---|---|
| codos y rodillas a 90° | 24: 12 por codo, 0 en rodillas | 2 | −1.8 % | codo 7.7 → 11.0 cm · rodilla 10.3 → 11.3 cm |
| brazo arriba 180° (clavícula 25° + húmero) | 0 | 0 | +1.7 % | hombro 17.2 → 10.3 cm (plano oblicuo del hombro, no pérdida: el volumen sube) |
| cadera a 90° (una pierna recta, la otra con rodilla a 90°) | 0 | 1 | −4.9 % | muslo 19.8 → 18.8 cm |
| torsión 35° (lumbar 15° + torácica 20°, cuello 20°) | 0 | 0 | −1.0 % | 20.4 → 20.8 cm |

- **Codo.** Los cruces están en el pliegue interior, donde el bíceps y el braquiorradial se tocan. Es lo propio del skinning lineal con pesos automáticos cuando el pivote va en el centro del brazo.
  - No hay pérdida de volumen ni estrechamiento: el disco del codo pasa de 7.7 a 11 cm.
  - Se deja para la fase de rig (pintar pesos o corrección de forma). La topología ya da 4 loops en el codo.
- **Torsión.** Se comprobó numéricamente que la pose se aplica: el pecho gira 0.611 rad (35°) y el hombro se desplaza 14 cm hacia atrás. En la vista 3/4 el torso girado queda casi de frente a la cámara.
- Montaje: `renders/s7_deform/d7b_montage.jpg` (cuerpo entero y primeros planos de cada pose).

### Exportación (`scripts/export.py`, `export/`)

- Se aplica el Mirror y se recalculan las normales. Sombreado plano y material de arcilla; no queda ningún modificador.
- Se borran cámaras y luces.
- La validación se repite sobre la malla final (`mannequin_male_stats.json`): 1 566 quads, 0 triángulos, 0 n-gons, 0 no manifold, 0 autointersecciones, simetría 0.
- **Comprobación reimportando** cada archivo en una escena vacía:
  - `.blend`: 1 566 quads, 1 568 vértices, alto 1.797 m, sin modificadores, 0 caras suaves, sin otros objetos.
  - `.fbx`: 1 566 quads, 1 568 vértices, sin modificadores, 0 caras suaves (Y arriba: 0.693 × 1.797 × 0.283 en ejes locales).
  - `.glb`: 3 132 triángulos. glTF solo guarda triángulos, y los vértices se separan (6 220) para mantener las normales planas. Mismas dimensiones.

### Visor web (`web/`)

- `template.html` más `mannequin_male.json`: `build_viewer.py` genera `index.html`, autocontenido (76 KB).
- **three.js r128.**
  - Arcilla con `flatShading`.
  - Aristas solo de los quads: 3 132 segmentos, sin las diagonales de la triangulación.
  - Luz principal arriba a la izquierda del espectador, como la hoja.
- **Cámaras.**
  - Frente, perfil y espalda son ortográficas, como las vistas de la hoja (el perfil mira desde −X y deja el frente a la derecha).
  - 3/4 en perspectiva, con órbita.
  - Regla de 8 cabezas vertical que gira para mirar a la cámara.
- La figura se encaja en el hueco libre entre los paneles de la interfaz, así que en móvil no la tapan.
- Colores como tokens para tema claro y oscuro.
- **Prueba con Playwright** (Chromium): escritorio 1280×800 en tema claro y móvil 390×844 táctil en tema oscuro, las 4 cámaras.
  - En ambos: 1 566 quads y 3 132 aristas cargados, sin desbordamiento horizontal y sin errores.
  - El único fallo de red era Google Fonts, bloqueado a propósito en la prueba: la red de este entorno no alcanza los CDN. three.js r128 se sirvió desde una copia de npm con la misma versión.
