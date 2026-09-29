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
