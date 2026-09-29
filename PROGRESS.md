# PROGRESS — Atleta low poly

Registro del bucle de revisión (referencia vs render) y de los problemas resueltos.
Comparativas en `renders/compare_<tag>.png` (ref | modelo | mezcla 50 % | diferencia de silueta:
rojo = falta en el modelo, azul = sobra) y `renders/sidebyside_<tag>.png`.
El IoU de silueta lo calcula `scripts/compare.py`; `python3 scripts/compare.py <tag> rows`
imprime, altura por altura, los tramos de silueta ref/modelo en metros (así se ajustan las medidas).

## Entorno (problemas y soluciones)

| Problema | Solución |
|---|---|
| `download.blender.org` bloqueado por el proxy (403) | Blender **4.0.2** desde apt de Ubuntu 24.04 (`apt-get install blender`). |
| Blender sin pantalla: `libEGL.so.1` no encontrado, Eevee/Workbench no renderizan con `-b` | `xvfb-run -a blender -b ...` (Xvfb + Mesa llvmpipe). |
| El Python de Blender (3.12 del sistema) no tenía numpy | `apt-get install python3-numpy`. PIL/scipy solo se usan fuera de Blender (`compare.py`, `crop_reference.py`). |
| `bpy.ops.wm.read_factory_settings()` dentro de un script → «Critical data corruption: conflicts in data-block names» al guardar | `meshutil.clear_scene()` borra objetos/mallas/materiales en lugar de recargar la fábrica. |
| UVs ignoradas tras crear el atributo de color | Añadir una capa de datos invalida las referencias previas: se crean las capas primero y luego se piden `uv_layers[...]`/`color_attributes[...]`. |
| Atlas más oscuro de lo esperado | Una imagen de 8 bits guarda valores sRGB: se escriben `c/255` (no lineales). La fila 0 de la imagen es la inferior. |
| `foreach_set` rechaza arrays float64 | `astype(np.float32)`. |

## Etapa 1 — cuerpo base (renders `body0..body7`, sin ropa)

Método: Skin modifier sobre un esqueleto de vértices → Subdivision nivel 1 → subdivisión
selectiva (todo menos manos) → proyección sobre un **campo SDF anatómico** (torso con perfil
elíptico medido de las siluetas, extremidades con perfiles asimétricos interior/exterior y
~30 elipsoides musculares: deltoides, trapecio, dorsales, bíceps, tríceps, braquiorradial,
pectoral/pecho, abdominales, oblicuos, glúteos, cuádriceps (vasto medial/lateral, recto),
gemelos) → relajación.

| Iter | IoU F/S/B | Diferencias observadas | Corrección |
|---|---|---|---|
| body0 | 0.66/0.67/0.67 (máscara defectuosa) | La silueta de referencia rellenaba el hueco entre piernas por la sombra del suelo. | Nueva máscara: descarta la sombra gris neutra y solo rellena huecos pequeños. |
| body1 | 0.79/0.69/0.79 | Pinchos desde las manos; manos diezmadas en puntas. | Paso de Newton limitado (max 12 mm). |
| body2→3 | 0.79→0.82 | Hombros 2-3 cm demasiado altos/anchos; brazos desplazados hacia fuera; cara 1.5 cm atrasada; pecho y gemelos cortos; mano estrecha; codo a z=1.10 (ref 1.15). | Articulaciones reajustadas con la tabla `rows`; perfiles asimétricos (gemelo lateral), mano girada 45° con dedos abiertos. |
| body4 | — | La proyección de Newton deslizaba vértices por los bultos: sin vértices delante del pecho. | Proyección radial desde el hueso → grietas donde cambia el hueso asignado. |
| body5 | 0.82/0.69/0.81 | Pecho correcto; pliegues en axilas y dientes de sierra en gemelos. | Proyección por **disparo según la normal** de la malla Skin. |
| body6-7 | 0.83/0.70/0.82 | Rodilla con pliegue entre segmentos; alas en dorsales. | Disparo con orientación coherente (desde fuera solo hacia dentro), rellenos esféricos en rodilla/codo/tobillo, dorsales más estrechos, brazo enganchado al vértice superior del tronco. |

## Etapa 2 — modelo completo (renders `it1..`)

Ropa por **cortes implícitos** sobre la malla del cuerpo (`meshutil.implicit_cut`: parte las
aristas donde g(p)=0, así los bordes del top, del short, los ribetes coral/blanco, la banda
inferior y las rayas de los calcetines son filas reales de caras, sin dientes de sierra) e
inflado de la zona de ropa (5-6 mm, 0 en el borde → sin huecos). Rodilleras y muñequeras son
tubos ajustados a la superficie (anillos radiales sobre el SDF) y se borra la piel que tapan.
Zapatillas por loft de secciones; pelo con casquete facetado + mechones (tubos irregulares
terminados en punta) + coleta; ojos/cejas/boca como polígonos proyectados sobre la cara.
Color: atlas 32×64 (16 colores × 8 tonos) + color de vértice; cada cara recibe un tono
aleatorio (aspecto «pintado»).

| Iter | Tris | IoU F/S/B | Diferencias observadas | Corrección |
|---|---|---|---|---|
| it1 | 11 605 | 0.82/0.73/0.84 | Workbench mucho más oscuro que la referencia; rodilleras finas; zapatilla tipo bota; tirantes sin colorear (etiquetados como brazo); pelo sin volumen lateral; ojos pequeños; demasiados triángulos (manos 2×1 087, rodilleras 2×704). | Máscara del top por posición además de etiqueta; rodilleras/muñequeras procedurales (180/80 tris); pelo y zapatillas rehechos; ojos más grandes. |
| it2 | 8 011 | 0.77/0.74/0.80 | Rodilleras gigantes (bug: `np.asarray` normalizaba el eje del llamador *in situ*); manos en cono. | Copia del eje. Render con **Eevee** (colores mucho más fieles que Workbench). |
| it3 | 7 967 | 0.82/0.77/0.83 | Cuadros navy de la rodillera en el lateral (ángulo 0 = delante, no −90°); picos de coronilla como antenas; manos en cono: el ratio de Decimate es global y solo podía quitar caras de la mano. | Ángulos corregidos; mechones de coronilla tumbados; ratio calculado = (N − (1−r)·N_mano)/N. |
| it4 | 9 095 | 0.83/0.81/0.82 | Ribete falso por el centro del top (el polígono se cerraba por x=0) → escote en V; coleta demasiado alta y atrás arriba, poco gruesa abajo. | Polígono completo reflejado; trayectoria y radios de la coleta según la tabla `rows`. |
| it5 | 9 205 | 0.83/0.81/0.84 | Flequillo plano; franjas laterales del short poco visibles desde delante/detrás; zapatilla estrecha; dedos cortos; deltoides altos. | Flequillo más ancho y adelantado; panel lateral φ<0.48 blanco, 0.48-0.66 coral; suela más ancha, empeine más estrecho; dedos +15 %; deltoides −1 cm; muslo exterior −8 mm; gemelo interno más grueso. |
| it6 | 9 305 | 0.81/0.81/0.85 | Pliegues (caras volteadas) en la axila posterior: aletas de piel sobre la espalda del top, visibles al levantar los brazos; franjas de piel en los laterales del top. | Paso `untangle`: caras cuya normal se opone al gradiente del SDF → vértices a la media de vecinos y reproyección; máscara del top por posición (|x|<0.15, 1.15<z<1.47). |
| it7 | 9 305 | 0.82/0.82/0.84 | Pelo estrecho en la vista frontal; coleta alta por arriba y corta por abajo; cuello de la zapatilla alto. | Casquete más ancho (rx 0.118), coleta 1-2 cm más baja con puntas más largas; cuello de la zapatilla 1.5 cm más bajo. |
| it8 / final | 9 329 | 0.82/0.83/0.84 | Flequillo tapaba los ojos; ojos pequeños y juntos; barbilla baja. | Flequillo de 8 picos más corto (hasta las cejas); ojos ±0.040, más grandes; cejas y boca recolocadas; mandíbula/barbilla +1 cm. |

El IoU se estabiliza en ~0.82-0.85: el resto de diferencia viene de detalles de la ilustración
(mechones sueltos, sombra pintada, dedos abiertos) y de que la máscara automática trata como fondo
parte de los blancos (rodilleras/calcetines/zapatillas) iluminados en gris.

## Etapa 3 — rig, pesos y animaciones

| Problema | Solución |
|---|---|
| Hoja de poses extremas vacía: `bpy.data.actions.new('_DeformTest')` + `Anim` creaba `_DeformTest.001` y se renderizaba la acción vacía. | Se usa el nombre real de la acción creada. |
| Aletas bajo la axila en T-pose / brazos arriba. | Era geometría plegada (resuelto con `untangle`); además el peso del brazo se limita más allá del plano del hombro y el sobrante pasa a Shoulder/Chest. |
| En la carrera la coleta pasaba por delante de la cara. | Las rotaciones se acumulan en la cadena de 5 huesos: amplitud por hueso reducida; el casquete y el flequillo (dentro del elipsoide del cráneo) quedan rígidos a `Head`, solo la coleta pesa a `Ponytail1..5`. |
| Salto con brazos poco expresivos. | Brazos a −105° en el aire. |

Poses extremas revisadas en `renders/deform_poses.png` (T-pose, brazos arriba, codos 120°,
rodilla alta, sentadilla, apertura de piernas, torsión): hombros, codos, caderas y rodillas
deforman sin roturas; la rodillera sigue la rodilla (pesos transferidos del cuerpo).

## Etapa 4 — exportación

`scripts/export_unity.py` exporta y **re-importa** el FBX para verificarlo:
`dims=(1.050, 0.497, 1.764) m, tris=9329, bones=57, escala 1`, 5 tomas
(APose, Idle, Jump, Run, Walk). El GLB re-importado contiene las mismas 5 animaciones.

---

# v3 — refinamiento por zonas (desde v2)

Carpeta `v3/` (copia de `v2/`). Cada iteración: `v3/iter.sh <tag>` construye el modelo, renderiza
front/side/back ortográficos con el encuadre y el fondo de la referencia y genera
`v3/renders/compare_<tag>.png` (ref | modelo | mezcla 50 % | diferencia de silueta) y
`v3/renders/sidebyside_<tag>.png`; la tabla `v3/renders/iter/rows_<tag>.txt` da los tramos de
silueta en metros altura por altura.

## Zona 1 — silueta y proporciones (z1a → z1e)

| Iter | IoU F/S/B | Diferencias vistas (tabla `rows` + solape) | Corrección |
|---|---|---|---|
| z1a | 0.843/0.845/0.847 | Hombros 3 cm estrechos a z=1.385 (trapecio bajo); torso 1-2 cm ancho a z=1.20 (dorsales) → el brazo se pega al costado en la axila (ref separada a z=1.244); cintura 1.5 cm ancha a z=1.10; muslo exterior 2 cm corto (z 0.68-0.73); rodillera 3 cm ancha. | — |
| z1b | 0.849/0.847/0.845 | Hombros y axila ya correctos; muslo +3 cm (el elipsoide del vasto lateral salta de forma no lineal); rodillera ancha a z 0.54. | Trapecio más alto/ancho, deltoides más arriba y 4 mm más ancho, dorsales más estrechos, torso z 1.08-1.20 −1 cm, oblicuos menores, rodillera menos abombada (2.1 cm). |
| z1c | 0.852/0.851/0.857 | Muslo −2 cm; rodillera sigue ancha a z 0.54 por la cabeza lateral del gemelo. | Perfil de espinilla superior −8 mm. |
| z1d | 0.853/0.847/0.849 | Muslo +2.5 cm (mismo salto del elipsoide). | Gemelo lateral más bajo (z 0.44) y corto. |
| z1e | **0.859/0.841/0.861** | Muslo ±1 cm, hombros ±1 cm, cintura ±1 cm, axila separada como en la ref; manos a medio muslo (puntas z≈0.80). | El ancho del muslo se controla con el perfil del `Limb` (lineal) en vez del elipsoide. |

Rig re-hecho sobre la malla nueva; hojas de Walk/Run revisadas: sin roturas.
(Este commit incluye ya las primeras ediciones de músculos de la zona 2, documentadas abajo.)

## Zona 2 — musculatura (z2a → z2c)

| Iter | Tris | IoU F/S/B | Diferencias vistas | Corrección |
|---|---|---|---|---|
| z2a | 9 413 | 0.860/0.837/0.860 | Espalda plana (sin columna ni erectores, sin V); gemelos sin forma de diamante desde atrás; sin lágrima del vasto medial; antebrazo poco grueso junto al codo. | Erectores, escápulas y aductores (elipsoides); surcos de columna, vasto medial y borde inferior del gemelo; braquiorradial más grueso, bíceps con más pico; subdivisión local de espalda y gemelos. |
| z2b | 9 405 | 0.856/0.843/0.858 | Espalda y gemelos ya se leen; glúteos como un solo bloque sin dos globos; deltoides y bíceps planos de frente. | Glúteos más altos, redondos y definidos (k menor); surco interglúteo y pliegue inferior; deltoides más grande (6.6×7 cm) y más nítido; vasto medial mayor. |
| z2c | 9 581 | 0.848/0.838/0.857 | Glúteo sobresale claramente de perfil; el surco central existe en el campo (2 cm) pero la malla del short lo suaviza; deltoides algo más redondo. | Subdivisión local de glúteos y del casquete del deltoides (radio 6 cm, +176 tris en lugar de +2 000 como en v2). |

Rig re-hecho; Run y poses extremas revisadas (T-pose, brazos arriba, sentadilla, zancada): sin roturas.

## Zona 3 — ropa (z3a → z3d)

| Iter | Tris | IoU F/S/B | Diferencias vistas | Corrección |
|---|---|---|---|---|
| z3a | 9 919 | 0.856/0.842/0.860 | Escote en V ancho y poco profundo (ref: U estrecha y profunda); espalda con muesca en V (ref: racerback que cubre el centro hasta el cuello con ribete coral/blanco por la sisa); franjas del short solo en el lateral (ref: visibles de frente y de espaldas, bajando en diagonal); cuadro de rodillera estrecho y sin franja trasera; muñequera fina con el cuadro delante; zapatilla plana y pequeña. | Polígonos nuevos del top (U y racerback); franjas del short por ángulo φ con término en z (diagonal), blanco 0.33-0.57 y coral 0.57-0.78; cuadro navy de rodillera ±35° y franja navy detrás; muñequera más gruesa/alta con el cuadro turquesa en la cara exterior (por normal); zapatilla +10 %, 19 secciones, suela 4.3 cm, cordones en filas alternas, bloques de color. |
| z3b | 10 131 | 0.854/0.842/0.864 | Faltan las franjas verticales de los paneles laterales del top; bloques de la zapatilla como rayas verticales; rodillera 20 cm de alto (ref ≈15). | Cortes φ en el lateral del top (coral 0.26-0.38, blanco 0.38-0.50); bloques inclinados; rodillera 0.478-0.652. |
| z3c | 10 127 | 0.859/0.843/0.860 | Zapatilla plana por arriba; de frente, la puntera navy sale en picos. | Puntera más alta y redondeada (0.052→0.112 m), cuello 1 cm más bajo. |
| z3d | 10 131 | 0.851/0.842/0.862 | Zapatilla con parches grandes como la ref (turquesa lateral, coral en el cuello, talón navy, cordones). | Sin puntera navy; parches grandes inclinados en lugar de zigzag. |

Rig re-hecho (rodilleras/muñequeras por transferencia de pesos, zapatillas a Foot/Toes); Walk y Run revisados.

## Zona 4 — pelo y coleta (z4a → z4c)

| Iter | Tris | IoU F/S/B | Diferencias vistas | Corrección |
|---|---|---|---|---|
| z4a | 10 243 | 0.852/0.798/0.868 | (antes: coleta como una lámina plana que salía hacia atrás, cintas casi invisibles, laterales en cortina). Nueva coleta: sube demasiado (≈1.83 m, ref 1.76) y de perfil es fina como una bandera; de espaldas, una línea. | Coleta = núcleo + 6 mechones facetados que se abren desde el arco y acaban en puntas separadas (z 1.29-1.42, hasta media espalda); goma más gruesa y dos cintas de 14 cm; flequillo en 8 picos con raya a x=+0.02; 7 picos irregulares en la coronilla; mechones delante de la oreja hasta la mandíbula (z≈1.49). |
| z4b | 10 293 | 0.849/0.804/0.865 | Ancho de espaldas ya ±2 cm; de perfil, la coleta queda 4-5 cm demasiado atrás (−0.26 m frente a −0.21) y separada de la nuca (ref: masa pegada, borde interior a −0.086). | Arco más bajo (1.735), núcleo y mechones más gruesos (r 0.086 / 0.056). |
| z4c | 10 289 | **0.860/0.852/0.866** | Silueta de perfil y de espaldas coincide (IoU de perfil 0.80 → 0.85). | Trayectoria de la coleta 3.5 cm más adelante y apertura de las puntas reducida. |

Nota: la coleta llega hasta z≈1.29 m (media espalda); la referencia termina en ≈1.33 m. La alargué un poco
más de lo que muestra la hoja porque así se pidió, pero no llegué a doblar su longitud para no romper la silueta.

**Rig de la coleta**: 4 huesos en cadena (`Ponytail1..4`, antes 5). El movimiento secundario ya no es
un seno: es un **muelle amortiguado por hueso** (frecuencia 1.6 Hz decreciente hacia la punta, ζ=0.22)
excitado por la aceleración vertical de la cadera y por el giro de la cadera; para Walk/Run se
simulan 4 ciclos y se usa el último (bucle continuo), para Jump se simula fotograma a fotograma
(retraso al despegar, rebote al aterrizar). La primera versión del salto hacía que la coleta pasara
por encima de la cara (los ángulos se acumulan en la cadena); se limitó a ±11° por hueso.

## Zona 5 — cabeza y cara (f0, z5a → z5g)

Primer plano con `v3/scripts/render_face.py` (ortográfica, 0.30 m, frente y perfil) comparado con
el recorte ampliado de la referencia a la misma escala (`v3/scripts/compare_face.py` →
`v3/renders/face_<tag>.png`).

| Iter | Tris | Diferencias vistas | Corrección |
|---|---|---|---|
| f0 (v2) | 10 289 | Cara estrecha en V; ojos con mucho blanco, caídos y con cara de preocupación; cejas tapadas por un flequillo que llega a los ojos; de perfil los mechones tapan toda la mejilla; ni oreja ni perfil de nariz y barbilla. | — |
| z5a | 10 492 | Rasgos **pintados en textura** (nuevo `face_paint.py`, PIL supermuestreado ×4): ojo almendrado, iris marrón grande con sombra superior, pupila, dos brillos, párpado superior grueso con pestañas en el extremo exterior, párpado inferior fino, ceja gruesa y recta más baja hacia el centro, nariz y boca. Probado primero en parches flotantes con UV propia → se ven rectángulos más claros (su sombreado no coincide con las facetas). | Atlas 512×512 (paleta + cara); mandíbula más ancha, ángulo mandibular y pómulos; esternocleidomastoideos en el cuello; flequillo por encima de las cejas. |
| z5b | 10 164 | Sin rectángulos: la textura (proyección frontal x∈[−0.08,0.08], z∈[1.48,1.64]) se asigna como UV plana a las **caras frontales de la propia cabeza**, que conservan las facetas. Falta flequillo (se ve mucha frente), ojos algo pequeños, nariz poco legible. | Parches flotantes eliminados. |
| z5c | 10 268 | Flequillo denso y ojos +14 %; de perfil los mechones laterales tapan oreja y mejilla. | Flequillo de 13 picos, sombra lateral de la nariz, nariz más saliente. |
| z5d | 10 272 | Mejilla y mandíbula visibles de perfil; la oreja aún no se lee. | Mechón fino delante de la oreja hasta la mandíbula, los de detrás por encima de la oreja; casquete recortado en la sien. |
| z5e | 10 272 | Oreja todavía invisible: la malla de la cabeza es demasiado gruesa para recoger el bulto. | Barbilla 5 mm más adelantada. |
| z5f | 10 316 | Oreja visible de perfil y asomando de frente. | Orejas como pieza propia (borde de piel + concha sombreada, 32 tris, rígidas a Head). |
| z5g | 10 316 | Boca y nariz se leen a distancia. | Labio más oscuro y grueso, sombra de la nariz mayor. |

En Unity los rasgos vienen de la textura del atlas (filtro Point); en el color de vértice esas
caras son piel lisa, por eso el visor web usa ahora la textura.

## v3 — resumen y entregables

| | v2 | **v3** |
|---|---|---|
| Triángulos | 9 085 | **10 320** (rango pedido 8 000-12 000) |
| IoU silueta F/S/B | 0.843/0.845/0.847 | **0.852/0.840/0.868** (máx. por zona: 0.861/0.852/0.868) |
| Huesos | 57 (5 de coleta) | 56 (4 de coleta, con muelle) |
| Cara | polígonos proyectados | textura pintada en el atlas sobre las caras de la cabeza |

- Zona 1: hombros, cintura, axila y muslos ajustados a ±1-2 cm de la referencia en las tres vistas.
- Zona 2: espalda (columna, erectores, escápulas, V), glúteos altos y redondos, gemelos en diamante, lágrima del vasto medial, deltoides y bíceps más marcados; subdivisión local donde hacía falta.
- Zona 3: escote en U, racerback, franjas laterales del top, short con franjas diagonales visibles de frente y de espaldas, rodilleras de 15 cm con cuadro grande y franja trasera, muñequeras gruesas con el cuadro fuera, zapatillas retro más grandes con cordones y parches.
- Zona 4: coleta de 6 mechones + núcleo con arco desde la coronilla, cintas, flequillo con raya, coronilla en picos; 4 huesos con muelle amortiguado.
- Zona 5: cara pintada (ojos almendrados, iris, brillo, párpado grueso, pestañas, cejas decididas, nariz, boca), mandíbula, pómulos, cuello con esternocleidomastoideos, orejas, perfil despejado.

Entregables: `export/atleta_v3.{blend,fbx,glb}` (+ `atleta_v3_atlas.png`), `renders/compare_v3.png`,
`renders/sidebyside_v3.png`, `renders/face_v3.png`, `renders/anim_v3_*.png`, `renders/deform_poses_v3.png`.
Reconstrucción: `v3/build_all.sh`. Visor web (`web/visor.html`): botones v3 / v2 / Original; para v3
decodifica la textura del atlas desde los bytes del modelo (`createImageBitmap`) para mostrar la cara pintada.
FBX re-importado: 1.789 m de alto (incluye la coleta), 56 huesos, 5 tomas, escala 1.
