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
