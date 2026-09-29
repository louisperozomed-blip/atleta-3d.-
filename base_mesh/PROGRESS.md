# Base mesh femenino — registro de progreso

Proyecto: cuerpo base femenino (solo modelado) a partir de `reference/base_mesh_sheet.png`.
Todo se genera con scripts (`scripts/`), Blender 4.0.2 en modo headless.

## Método de revisión (igual en todas las etapas)

1. `sh scripts/iter.sh <etapa> <etiqueta> [zmin zmax]` construye la media malla (`body.py`),
   le pone Mirror X (clipping + merge) y Subdivision Surface 1, valida la malla completa con
   bmesh (`validate.py`) y renderiza front/side/back ortográficos en arcilla gris sobre fondo
   gris oscuro (61,61,61) como la hoja, con el mismo encuadre que los recortes de referencia
   (400×960 px, 541.8 px/m, suelo en la fila 940). También renderiza la jaula con wireframe y
   una máscara plana para medir la silueta.
2. `compare.py` genera `*_sidebyside.jpg` (referencia | render | wireframe), `*_overlay.jpg`
   (render al 50 % sobre la referencia + contorno naranja del modelo), `*_silhouette.png`
   (rojo = solo referencia, cian = solo modelo) y una tabla de bordes por altura en metros.
3. Anoto aquí las diferencias concretas, corrijo `body.py` / `params.py` y repito.

Notas de calibración (antes de la etapa 1):
- La luz de estudio de Workbench deja el borde derecho casi del color del fondo, así que la
  silueta medida sobre el render salía ~1 cm más estrecha por un lado. Se añadió un render de
  máscara plana (luz FLAT, blanco sobre negro) para medir.
- La figura FRONT de la hoja está ~4 px (7 mm) a la derecha del centro supuesto y la BACK ~2 px:
  recortes recentrados (x = 262 y 941) para que el eje del cuerpo coincida con la columna 200.
- En FRONT/BACK la tabla usa solo el tramo de silueta que contiene el eje (sin los brazos),
  porque en las etapas 1-2 el modelo aún no tiene brazos. El IoU de las etapas 1-4 incluye
  partes de la referencia que todavía no existen en el modelo, así que solo sirve para comparar
  iteraciones entre sí; la medida útil es la tabla de bordes.

---

## Etapa 1 — torso y pelvis

Topología: medio anillo de 16 aristas (32 alrededor del cuerpo). Agujero de la pierna = R0 +
cadena de 3 vértices de la entrepierna sobre el plano de simetría (20 vértices), agujero del
brazo 3×3 caras (12 vértices), borde superior abierto para el cuello.

### s1a — primer bloqueo (14 anillos, z 0.875–1.395)
- 400 quads (malla completa), 0 tris, 0 n-gons, 0 polos (todavía no hay uniones).
- Diferencias: pecho demasiado bajo (el pico de la proyección a z 1.25 en vez de 1.29-1.30, y
  3 cm por detrás de la hoja a 1.30); cintura y cadera 1-1.8 cm más anchas por lado entre
  z 1.00 y 1.15; glúteo 1.3 cm corto a z 1.00; el torso termina en 1.395 pero en la hoja el
  hombro/trapecio llega a 1.43 y la clavícula está a ~1.405; los anillos están muy separados
  (3.5-4 cm) para el presupuesto de 2.5k-3.5k quads.
- El agujero del brazo 4×2 era muy bajo (0.07 m) y profundo para un brazo redondo.

### s1b — rediseño de filas y medidas de la hoja
- 20 anillos (19 bandas, ~2.8 cm entre anillos); los 3 anillos superiores tienen z distinta
  delante y detrás (clavícula 1.407 / C7 1.44). Medidas de ancho y profundidad tomadas cada
  2 cm de las siluetas FRONT y SIDE.
- Agujero del brazo 3×3 (segmentos 7-10, filas 16-19): 12 vértices, más cuadrado. Las esquinas
  superiores coinciden con los vértices "special" de la reducción del cuello (32→16), así que
  no generan polos; las inferiores serán polos de 5 en la axila (delante/detrás).
- Pecho como relieve gaussiano centrado en z 1.292; glúteo con relieve en los cuadrantes traseros.
- Resultado: FRONT/BACK dentro de ±6 mm de 0.95 a 1.30. SIDE: pecho 1.5 cm corto a z 1.30 y
  1.5 cm a 1.35 (parte alta del pecho), glúteo 1.3 cm corto a z 1.00.

### s1c — pecho y glúteo
- BUST 0.040 → 0.055, relieve más estrecho (σθ 0.30), pliegue inferior más marcado (σz 0.024);
  GLUTE 0.040 → 0.048 y σz mayor por arriba (0.075) para que el glúteo suba hasta 1.05.
- SIDE a 1.30: −4 mm; glúteo a 1.00: −6 mm. Visualmente los pechos se ven como dos bultos
  pequeños y juntos (en la hoja son anchos y redondos) y la espalda baja no tiene la
  separación de los glúteos.

### s1d — forma del pecho y surco interglúteo
- Pecho más ancho (σθ 0.40, centro θ 0.55 ≈ pezón a x 0.055) y más lleno por arriba (σz 0.058).
- Surco interglúteo: relieve negativo de 1.6 cm en θ = π entre z 0.90 y 1.00.
- SIDE dentro de ±7 mm en toda la zona (1.30: 0 mm; 1.35: −7 mm). FRONT/BACK dentro de ±6 mm
  de 0.95 a 1.30. Entre 1.35 y 1.40 la hoja mide deltoides (±0.19): llegará con los brazos.
- IoU (zona 0.85-1.45, incluye brazos de la hoja): front 0.629, side 0.848, back 0.616.
- Validación (malla completa): 590 quads, 0 tris, 0 n-gons, 0 polos, 0 aristas con >2 caras,
  0 duplicados, 0 normales invertidas, volumen positivo (normales hacia fuera), error de
  simetría 0. Las 76 aristas de borde son los puertos abiertos (piernas, brazos, cuello).
- Loops: 3 anillos en la cintura (1.115-1.175), anillos concéntricos alrededor del pecho
  (1.235-1.312) y pliegue bajo el pecho en 1.235.

---

## Etapa 2 — piernas y pies

Topología: el agujero de 20 vértices (R0 + entrepierna) se reduce a un anillo de 16 con dos
quads de reducción (delante: ingle; detrás: pliegue del glúteo) → 2 polos de 5 por pierna en
zonas planas. Pierna de 16 vértices hasta el tobillo. Pie = tubo de 12 vértices a lo largo de Y
(arriba 4, lados 2, suela 4) con un agujero 4×4 en el empeine unido al tobillo por Bridge Edge
Loops y tapas de rejilla 4×2 en talón y puntera.

### s2a — primer bloqueo (17 anillos de pierna)
- 1394 quads totales, 0 tris / n-gons. Polos: 12 de 5 y 16 de 3.
- Diferencias (FRONT): pierna entera 6-9 mm demasiado hacia fuera (centro del muslo, rodilla y
  tobillo); muslo interno a z 0.75-0.80 con 1.1 cm más de hueco que la hoja (en la hoja los
  muslos casi se tocan); rodilla 5 mm más ancha por lado.
- SIDE: espinilla 1.1-1.5 cm por detrás entre z 0.35 y 0.45; empeine y puntera bajos (a z 0.05
  la puntera se queda 4 cm corta: el pie de la hoja es un bloque alto tipo zapatilla).
- BACK: la figura de espaldas de la hoja tiene las piernas ~1.7 cm más juntas que la de frente
  (inconsistencia del dibujo; se prioriza FRONT, que coincide con SIDE).
- Error: la tapa del talón usaba un orden de anillo que no empezaba en una esquina de la
  rejilla (esquinas desplazadas → polos de 3 en mitad de la tapa).
- Densidad: 17 anillos daban ~4 cm entre loops; poca resolución para 3 loops en la rodilla.

### s2b — ajuste a la silueta + densidad
- Nuevo `scripts/fit_leg.py`: mide centro/semiancho (FRONT) y bordes delante/detrás (SIDE) en
  cada anillo y propone la tabla corregida. La tabla LEG pasa a ser de claves, y los 27 anillos
  se interpolan con Catmull-Rom (3 loops en la rodilla 0.607/0.590/0.573 y 3 en el tobillo
  0.19/0.165/0.14).
- Pie recentrado (x 0.096-0.103) y empeine/puntera más altos; orden de la tapa del talón corregido.
- FRONT y SIDE dentro de ±2 mm de z 0.15 a 0.80 (ver `s2b_silhouette.png`). 1714 quads.
- Diferencias: escalón visible en la cadera (z 0.83-0.87) porque el anillo de transición L1
  estaba centrado en x 0.100 y el muslo en 0.093; los quads de la entrepierna muy pellizcados
  (vértice interior de L1 casi en x = 0); la rodilla no tiene la rótula de la hoja.

### s2c — cadera, entrepierna y rótula
- L1 se coloca sobre la forma del primer anillo del muslo (centro, radios delante/detrás) y su
  cara interna se limita a x ≥ 1.2 cm → transición cadera-muslo sin escalón.
- Rótula: relieve delantero de 7 mm en los 3 loops de la rodilla.
- Diferencias restantes: el pie visto de frente acaba en una punta redondeada (la Subdivision
  redondea la suela); en la hoja el pie es un bloque con la suela más ancha que el empeine y la
  puntera alta.

### s2d — pie tipo bloque
- Suela 8 % más ancha que el empeine, lados más bajos (36 % de la altura) y puntera más alta
  (4.2 cm). FRONT a z 0.05: ±2 mm; SIDE a 0.05: +6/+2 mm.
- IoU (zona 0-0.95): front 0.908, side 0.950, back 0.776 (back limitado por la inconsistencia
  de la hoja).
- Validación: 1714 quads, 0 tris, 0 n-gons, 0 polos >5, 0 aristas no manifold, 0 duplicados,
  0 normales invertidas, simetría 0. Ningún polo dentro de la zona de pliegue de cadera,
  rodilla o tobillo (`poles_in_joint_zone` vacío).
- Polos justificados (por pierna):
  - 2 polos de 5 en la reducción 20→16: ingle delantera (0.047, −0.094, 0.835) y pliegue del
    glúteo (0.032, 0.062, 0.834), a 4.6-5.5 cm fuera de la zona de pliegue de la cadera.
  - 4 polos de 5 en las esquinas del agujero del tobillo sobre el empeine (z ≈ 0.056), zona
    rígida del pie, a >8 cm del tobillo.
  - 8 polos de 3 en las esquinas de las tapas de talón y puntera (esquinas de un bloque, zona
    que no se deforma).

---

## Etapa 3 — brazos y manos

Topología: el agujero del torso (12 vértices) se extruye hacia fuera (A0) y el brazo es un tubo
de 12 vértices con Bridge Edge Loops (anillos perpendiculares al eje hombro-codo y codo-muñeca,
girados con `best_alignment` para no retorcer las aristas). Mano: anillo de nudillos de 16
vértices (dorso D0..D7 + palma P7..P0) reducido a 12 con dos quads de reducción (centro del
dorso y centro de la palma), 3 quads de membrana entre dedos, 4 dedos extruidos desde quads
del anillo de nudillos (4 segmentos + tapa) y el pulgar extruido desde la cara lateral de la
palma del lado del índice. `scripts/closeup.py` renderiza primeros planos con wireframe.

### s3a — primer bloqueo
- 2302 quads. **Error**: 8 aristas con 3 caras y 2 caras internas: el pulgar se extruía desde
  una cara existente sin borrarla (en los dedos no pasaba porque salen de un anillo abierto).
- Diferencias (FRONT): brazo 1-2.6 cm demasiado hacia fuera entre z 1.20 y 1.35 (brazo muy
  abierto arriba) y 0.7 cm demasiado grueso en el deltoides/bíceps; el hombro de la hoja es más
  vertical arriba y se abre en el codo (codo real ≈ (0.232, 1.135), muñeca ≈ (0.31, 0.96)).
- Pulgar casi horizontal hacia delante (en la hoja va pegado al índice, hacia abajo).

### s3b — ejes del brazo y extrusión correcta
- Hombro (0.160, 1.35), codo (0.232, 1.135), muñeca (0.31, 0.96) medidos en la hoja; brazo
  superior de 9 anillos y antebrazo de 8 (3 loops en el codo: t 0.91/1.00 del brazo y 0.08 del
  antebrazo; muñeca con los 2 últimos anillos + el anillo de la palma).
- `_finger` borra la cara base antes de extruir → 0 aristas no manifold, 0 caras internas.
- Diferencias: el hombro cae demasiado (a z 1.40 el modelo mide ±0.15 y la hoja ±0.175-0.19);
  el pulgar sigue siendo una lámina fina.

### s3c — hombro y pulgar
- A0 se extruye 2.6 cm hacia fuera y 4 mm hacia arriba; hombro en (0.162, 1.36); primer anillo
  del deltoides más ancho (4.1 cm). A z 1.40: ±0.165 (antes ±0.15).
- Dedos con curvatura hacia la palma (dedos relajados como en la hoja).
- Diferencia: el pulgar sale casi paralelo a su cara base, así que los anillos (que mantenían la
  orientación de la cara) quedaban cizallados → pulgar plano como una cuchilla.

### s3d — anillos de los dedos perpendiculares a su eje
- Cada anillo de dedo se rota (Rodrigues) para quedar perpendicular a la tangente local del
  dedo; el pulgar sale casi perpendicular al lado de la palma y se curva hacia abajo.
  Dedos un 10 % más gruesos (la Subdivision los adelgazaba). Ver `s3d_hand_wire.png` y
  `s3d_hand_smooth.png`.
- BACK: brazos dentro de ±6 mm de z 0.95 a 1.35. FRONT: ±1 cm en 1.20-1.35 — la figura FRONT
  de la hoja dibuja el brazo ~1 cm más estrecho que la BACK en esa zona (inconsistencia del
  dibujo); se deja un valor intermedio. La mano de la hoja tiene los dedos más abiertos
  (−2 cm a z 0.85-0.90).
- IoU (zona 0.70-1.45): front 0.902, side 0.941, back 0.896.
- Validación: 2396 quads, 0 tris, 0 n-gons, 0 polos >5, 0 aristas no manifold (aparte de los
  bordes abiertos del cuello), 0 caras internas, 0 duplicados, 0 normales invertidas,
  simetría 0. `poles_in_joint_zone` vacío.
- Polos nuevos justificados (por lado):
  - 2 polos de 5 en las esquinas inferiores del agujero del brazo = pliegue delantero y trasero
    de la axila (2-4 cm por debajo de la zona de giro del hombro). Es la solución estándar para
    sacar un tubo de 12 de una rejilla; las esquinas superiores no generan polo porque coinciden
    con los vértices de la reducción del cuello.
  - 2 polos de 5 de la reducción 16→12 de la mano (centro del dorso y de la palma, zona plana).
  - 2 polos de 5 en las esquinas de la base del pulgar (eminencia tenar, 1.6 cm fuera de la zona
    de la muñeca).
  - 10 polos de 5 en las membranas entre dedos (cada membrana une dos dedos de 4 lados).
  - 20 polos de 3 en las puntas de los dedos (tapa de un quad por dedo; puntas que no se deforman).

---

## Etapa 4 — cuello y cabeza

Topología: el borde superior del torso (medio anillo de 16 aristas) se reduce a 8 (16 alrededor)
con 4 quads de reducción (`NECK_SPECIALS` = 3, 7, 10, 14; 7 y 10 son las esquinas superiores
del agujero del brazo). Cuello de 4 anillos y cabeza de 9 anillos de 16 vértices, inclinados
(z distinta delante y detrás) para seguir la inclinación del cuello y la línea de la mandíbula.
Cráneo cerrado con una rejilla 2×4 sobre el último medio anillo + línea central. Oreja = cara
lateral extruida (bloque). Rasgos sugeridos moviendo vértices de los loops (nariz, puente,
cuencas, arco superciliar, barbilla, mandíbula).

### s4a — primer bloqueo
- 2602 quads. **Error**: 8 aristas de borde → `extrude_face` creaba los lados de la oreja pero
  no la tapa (agujero en la oreja). Corregido en `topo.py` (la extrusión añade la tapa).
- Diferencias: la cabeza es un huevo sin mandíbula (el cuello entra en la cabeza sin la cara
  inferior de la mandíbula; en SIDE la hoja tiene la barbilla a y −0.075 z 1.49 y el cuello
  delante a y −0.018); coronilla 2 cm demasiado ancha a z 1.70 (cabeza un poco alta); el cuello
  de la hoja sube inclinado hacia delante (nuca a y +0.07); orejas demasiado salientes en FRONT.

### s4b — mandíbula y cuello inclinado
- Anillos inclinados: cuello 1.428→1.481 delante / 1.458→1.514 detrás; H0 bajo la barbilla
  (z 1.487, y −0.064) sube hasta el ángulo de la mandíbula (z 1.53); barbilla H1 a 1.497.
  Superelipse 2.5 en la cabeza (plano de la cara más plano, como la hoja). Coronilla a 1.694.
- Malla cerrada: 0 aristas de borde. 2636 quads.
- Diferencias: frente 1.5 cm por detrás a z 1.65 (SIDE); trapecios estrechos (BACK a z 1.45:
  ±0.05 contra ±0.072) y hombro a z 1.40 aún 1-2 cm estrecho.

### s4c — frente, trapecios y hombros
- Frente más adelantada (H6-H8: y −0.089/−0.081/−0.060); base del cuello más ancha (5.8 cm);
  dos anillos superiores del torso más anchos (0.126 / 0.116) → hombro a z 1.40: ±0.17
  (FRONT de la hoja ±0.175).
- Cabeza dentro de ±7 mm en FRONT, SIDE y BACK de z 1.45 a 1.65.
- Diferencia: la oreja es un bulto pequeño; en la hoja es una placa plana más grande. Nariz
  demasiado afilada en el primer plano.

### s4d — oreja en placa y nariz
- Oreja: extrusión corta (6 mm) sin reducir la cara (placa); nariz 1.6 cm (antes 2.0).
  Primeros planos: `s4d_head_front.png`, `s4d_head_out.png`.
- IoU (zona 1.38-1.72): front 0.908, side 0.915, back 0.903.
- Validación: 2636 quads, 0 tris, 0 n-gons, 0 polos >5, **0 aristas de borde, 0 no manifold**,
  0 duplicados, 0 caras internas, 0 normales invertidas (volumen positivo), simetría 0.
- Polos nuevos justificados (por lado):
  - 4 polos de 5 en la base del cuello (reducción 32→16), sobre la clavícula/trapecio, y 2 polos
    de 3 donde la reducción deja un vértice del torso sin arista hacia arriba (clavícula delante
    y trapecio detrás). Zona plana entre cuello y hombro, a >8 cm del giro del hombro.
  - 4 polos de 5 en la base de la oreja y 4 de 3 en sus esquinas (bloque de la oreja, no se deforma).
  - 2 polos de 3 en las esquinas de la tapa del cráneo (coronilla, no se deforma).

---

## Etapa 5 — unión y limpieza final

La media malla ya es un único bloque continuo (torso → piernas/pies, brazos/manos, cuello/cabeza
unidos por Bridge Edge Loops y reducciones); en esta etapa se aplica el Mirror (clipping +
merge) y se valida la malla completa como sólido cerrado. Se añadió a `validate.py` un test de
auto-intersecciones con BVH (pares de caras que se cruzan sin compartir vértices).

### s5a — primera validación de la malla cerrada
- 2636 quads, 0 aristas de borde, 0 no manifold, 0 duplicados, 0 normales invertidas.
- **Error**: 4 auto-intersecciones (2 por mano): la primera sección del pulgar atravesaba la
  cara de la palma que tiene debajo, porque el anillo de nudillos (8 cm) era más ancho que la
  palma (5.8 cm) y esa cara se abría hacia delante justo bajo el pulgar.

### s5b — mano sin intersecciones
- Palma más ancha (6.6 cm, anatómicamente ≈ ancho de nudillos) y nudillos algo más estrechos
  del lado del índice; el pulgar sale casi perpendicular y se curva hacia abajo después.
  0 auto-intersecciones.
- Diferencia vista en BACK/SIDE: los glúteos se ven como una masa alta (máximo a z 0.955) que se
  funde con el muslo; en la hoja el máximo está más bajo (~0.93) y termina en un pliegue marcado
  a ~0.87. SIDE a z 0.90: −9 mm.

### s5c — glúteo más bajo y pliegue inferior
- Relieve del glúteo centrado en z 0.935, caída inferior corta (σ 0.042) y surco interglúteo
  hasta 0.87; R0/R1 1 cm más atrás y L1 más adentro por detrás (pliegue bajo el glúteo).
- SIDE a 0.90: 0 mm. Pero a 1.00 el glúteo quedó 1.3 cm corto (subía poco).

### s5d — parte alta del glúteo
- Caída superior del relieve más larga (σ 0.095): SIDE a 1.00 −9 mm → dentro del margen del resto.

### s5e — altura final
- La coronilla de la jaula estaba a 1.694 m y la del LOD0 a 1.693 (la Subdivision encoge): la
  tapa del cráneo sube a 1.704 → **LOD0 mide 1.701 m**.
- Silueta final (`renders/final_silhouette.png`): FRONT y SIDE dentro de ±2 mm en toda la
  pierna, ±7 mm en torso y cabeza; brazos ±1 cm (la hoja dibuja el brazo FRONT 1 cm más estrecho
  que el BACK). Diferencias que se aceptan: dedos más juntos que en la hoja (−2 cm de abertura a
  z 0.85-0.90), piernas BACK 1.5-2 cm más separadas porque la figura BACK de la hoja no coincide
  con la FRONT.
- IoU cuerpo entero: front 0.924, side 0.949, back 0.860.
- Validación final (jaula y LOD0, `export/base_mesh_stats.json`): 0 n-gons, 0 triángulos,
  0 polos >5, 0 aristas no manifold, 0 normales invertidas, 0 vértices/caras duplicados,
  0 caras internas o degeneradas, 0 auto-intersecciones, simetría 0 (LOD0 3.6e-7 m),
  ningún polo en zona de pliegue. 72 polos de 3 y 64 de 5, todos justificados en las etapas
  anteriores.
- Presupuesto: jaula 2 636 quads (objetivo 2 500-3 500), LOD0 10 544 quads = 21 088 triángulos
  (objetivo 20k-28k).
- Hard edges: ninguno. La malla es orgánica y todo el sombreado es suave; las aristas vivas de
  la hoja (estilo facetado) son del render de referencia, no de la topología.

### Test de deformación (temporal)
- Esqueleto de 19 huesos con pesos automáticos (ningún grupo quedó sin pesos). Pose: codos y
  rodillas a 90°, hombros 30° de abducción + 20° de flexión, caderas 35° de flexión + 12° de
  abducción. Renders: `renders/deform_test.png` (front / side / 3-4) y primeros planos del codo
  y la rodilla con la jaula deformada.
- Resultado: rodilla y codo se doblan sin pellizcos ni caras invertidas y mantienen el volumen
  (los 3 loops reparten el pliegue); la axila y la ingle estiran de forma uniforme. En el
  interior del codo la compresión es la normal de los pesos automáticos (se ajustaría al pintar
  pesos, fuera de esta fase).
- El esqueleto, el modificador Armature y los grupos de vértices se borran al final del script
  (comprobado en la salida: `ARMATURE BORRADO: True modificadores: ['SUBSURF']`); el script no
  guarda nada.

### Exportación
- `scripts/export.py`: aplica el Mirror, recalcula normales, guarda `export/base_mesh.blend` con la
  Subdivision nivel 1 sin aplicar, exporta LOD1 (jaula) y LOD0 (Subdivision aplicada) a FBX y
  GLB y los JSON del visor. Reimportados en Blender: LOD1 2 638 vértices / 2 636 caras, LOD0
  10 546 / 10 544 (FBX) y 5 272 / 21 088 triángulos (GLB), escala 1.
- Visor web nuevo: `web/visor_base_mesh.html` (LOD0/LOD1, arcilla / + wire / solo wire con las
  aristas de los quads, cámaras front/side/back/3-4 y regla de 8 cabezas).

---

# Iteración 2

Objetivo: topología facial y de deformación de nivel producción, manos y cadera más fieles a la
hoja, menos polos y UVs, manteniendo toda la validación en 0 y la jaula entre 2 500 y 3 500 quads.
Renders de cada etapa en `renders/it2_*`; `RENDER_DIR=<carpeta> sh scripts/iter.sh 5 <tag>`.

## It2 · Etapa 1 — cara

Rediseño completo de cuello y cabeza en un módulo nuevo, `scripts/head.py`:
- La cabeza es una rejilla de quads sobre una superficie paramétrica P(θ, zf) (θ = ángulo del
  medio anillo, zf = altura del anillo en el centro de la cara; los anillos suben hacia la nuca).
  Pasa de 16 a **24 vértices alrededor**, con los segmentos más densos delante
  (0-12-24-36-48-60-74-90… grados) y 16 anillos; tapa del cráneo = rejilla 3×6.
- El cuello también tiene 24 alrededor. La reducción del torso pasa de 32→16 (4 quads de
  reducción por lado) a **32→24 (2 por lado)**, y esos 2 coinciden con las esquinas superiores del
  agujero del brazo: 4 polos de 5 y 2 de 3 menos por lado.
- Nueva operación `HalfMesh.inset_region` en `topo.py` (Inset Faces de una región): crea un loop
  de quads alrededor de la región y respeta el plano de simetría (en el eje la región continúa en
  el lado espejo, así que el loop se abre allí y se cierra con el Mirror).
- **Ojo**: región 2×2 con 3 insets = **3 loops concéntricos** (órbita, párpados y borde del ojo) +
  el loop exterior de la órbita. **Boca**: región 2×2 sobre el eje con 3 insets = **3 loops
  concéntricos** (en la malla completa, de 12 vértices cada uno). **Loop nasolabial**: región de
  3×5 alrededor de nariz y boca con 1 inset, por dentro del cual están la nariz y los loops de la
  boca. Cada loop se recoloca en una elipse del espacio (θ, zf) y los vértices interiores de cada
  región se reparten dentro del loop más pequeño (cuadrado → disco).
- **Relieve** (desplazamiento por la normal, sin añadir geometría): puente y dorso de la nariz,
  punta, aletas, labio superior e inferior, línea de la boca, barbilla, cuenca del ojo, **arco de
  la ceja** y pómulo.
- **Oreja**: región 1×4 en el lateral con dos insets: el primero se saca hacia fuera y hacia atrás
  en C (**hélix**, más ancho arriba y detrás); el segundo vuelve hacia la cabeza (**concha**),
  excepto abajo, donde queda macizo (**lóbulo**).
- `scripts/head_profile.py` compara el perfil de la cabeza cada 1 cm (SIDE delante/detrás y FRONT
  semiancho); `scripts/face_views.sh` hace primeros planos front / lado / 3-4 con y sin wireframe
  junto al panel HEAD de la hoja (`*_face.jpg`).

### f1a — primera construcción
- 3 062 quads, todo quads. **Errores**: 1 vértice duplicado y 12 auto-intersecciones.
  - Duplicado: los vértices del eje de la cabeza tenían x = 1e-8…2e-7 (sin(π) y la normal) en vez
    de 0, y el Mirror (umbral 1e-4) fundía un par de forma inesperada → se fuerza x = 0 exacto.
  - Intersecciones: los loops interiores de la boca (radio 0.0125) salían de la región (media
    altura 0.010) y el loop nasolabial (0.028) pasaba por encima de su borde superior.

### f1b — loops dentro de sus regiones
- Radios de boca y nasolabial ajustados a su región; el loop exterior de la boca también se
  recoloca. Oreja rehecha como contorno en C (antes era un rectángulo).
- Quedan 2 auto-intersecciones (aleta de la nariz): los vértices interiores de la región
  nasolabial seguían en su posición de rejilla y el loop nasolabial pasaba por encima de ellos.
- Perfil: frente 4-7 mm por detrás entre z 1.61 y 1.68; bajo la barbilla la hoja es casi
  horizontal a z 1.495 y el modelo bajaba en rampa; coronilla demasiado plana.

### f1c — interiores de región, frente, barbilla y coronilla
- Vértices interiores de cada región → dentro de su loop más pequeño (mapa cuadrado → disco):
  **0 auto-intersecciones**.
- Filas de mandíbula y barbilla subidas (1.494 / 1.502); frente más adelantada; tapa del cráneo
  más redonda; nariz con el máximo a z 1.563.
- Perfil SIDE dentro de ±4 mm de 1.50 a 1.69 (antes hasta 7 mm). En los primeros planos, los ojos
  estaban demasiado separados (distancia entre pupilas 72 mm) y abultados, y la boca era
  demasiado ancha y de labios planos.

### f1d — ojos, boca y mandíbula
- Ojo en θ 21° (distancia entre pupilas ~62 mm), globo ocular menos saliente; boca de 44 mm con
  labios más marcados; mandíbula y barbilla más estrechas.

### f1e — arco de la ceja
- Ceja más marcada (6 mm, borde inferior más definido sobre el loop exterior del ojo).
- Validación: 3 062 quads, 0 tris, 0 n-gons, 0 polos >5, 0 no manifold, 0 duplicados,
  0 auto-intersecciones, 0 normales invertidas, simetría 0. IoU (1.40-1.72): front 0.909,
  side 0.947, back 0.907. Perfil SIDE de la cabeza dentro de ±4 mm (±6 mm en el borde de la
  barbilla).
- Polos de cara y cuello (por lado): 5 aristas: 2 en la base del cuello (antes 4), 4 en las
  esquinas exteriores del loop del ojo, 2 en las del loop exterior de la boca, 2 en las del
  nasolabial y 4 en la base de la oreja. 3 aristas: 4 en las esquinas del borde del ojo, 2 en las
  comisuras interiores de la boca, 2 en las esquinas interiores del nasolabial, 4 en la concha de
  la oreja y 2 en las esquinas de la tapa del cráneo. Todos están en la cara o la oreja, que no
  tienen articulación: son las esquinas de los insets que crean los loops concéntricos.

## It2 · Etapa 2 — hombro y axila

Test de deformación ampliado (`scripts/deform_test.py`, montaje con `scripts/deform_montage.py`):
5 poses (codos y rodillas a 90°; **brazo levantado 180°** = clavícula 25° + húmero 138° desde la
A-pose; **brazo hacia delante 90°**; **columna** 30° hacia delante y 10° de lado con **cuello**
25° y cabeza 15°; **cadera a 90°** sentada). Para cada pose mide sobre la jaula deformada las
auto-intersecciones (pares de caras que se cruzan; "junto a la articulación" = a menos de 15 cm)
y las caras aplastadas (área < 25 % de la de reposo). Los pesos automáticos se suavizan 3 veces
(factor 0.5), que es el paso estándar al preparar un rig; sin eso el test medía los escalones del
bone heat y no la topología. Resultados: `renders/it2_2_hombro/*_deform.json` y `*_deform.jpg`.

Referencia con la topología anterior (`d2base`, mismos pesos suavizados): brazo arriba 16
intersecciones (8 en el hombro) con un pliegue en V en la parte delantera del hombro; brazo
adelante 0; columna y cuello 0.

### h2a/d2a — medición inicial
- Sin suavizar pesos: brazo arriba 22 intersecciones (11 en el hombro). En los primeros planos,
  la raíz del brazo es un tubo recto que sale del agujero y gira de golpe hacia abajo: en reposo
  hay un escalón en la axila y, al levantar el brazo, la parte alta del deltoides se dobla
  en V contra el trapecio (entre el cuello y el brazo había una sola fila de caras).

### h2b — 3 loops extra en la raíz del brazo
- Tres anillos concéntricos entre el agujero y el brazo. Brazo arriba: 28 / 14. No ayuda: el
  pliegue está encima del agujero, no alrededor.

### h2c — agujero del brazo una fila más abajo
- El agujero pasa a las filas R15-R18 y el anillo R19 cruza por encima del hombro (trapecio →
  acromion); las filas del pecho alto se recolocan (axila a z 1.318). La reducción del cuello se
  mueve a la clavícula y al trapecio (segmentos 4 y 12, zonas planas).
- **Error**: 30 auto-intersecciones en reposo en la axila: el primer anillo del brazo seguía a
  z 1.36 y su parte baja quedaba por debajo del nuevo borde de la axila. Hombro bajado a z 1.345:
  0 intersecciones.

### h2d — deltoides por loft
- La raíz del brazo se rehace como un loft: 4 anillos entre el agujero y el primer anillo del
  húmero (t 0.24). Cada vértice sigue una curva de Bézier que sale perpendicular al torso y
  llega alineada con el brazo, con el relieve del deltoides arriba y fuera. Ya no hay escalón en
  la axila (primeros planos `h2i_hombro_*.png`).
- Test (pesos suavizados, `d2e`): brazo arriba 12 (6 en el hombro), adelante 0, columna 0.

### h2e/h2f — fila extra en el trapecio (descartada)
- Una fila de caras entre el borde del torso y la base del cuello no cambiaba el resultado
  (12 / 6) y costaba 32 quads: se quitó.

### h2g → h2i — silueta del hombro
- Con el loft, el hombro quedó 2-3 cm estrecho a z 1.40 (±0.157 frente a ±0.175 de la hoja).
  h2h lo ensanchó (más salida y relieve arriba): ±0.183, pero el brazo a 180° volvía a 24 / 12
  intersecciones (más volumen que choca con el trapecio). h2i es el punto intermedio: FRONT a
  z 1.40 ±0.176 (hoja ±0.175) y brazo arriba 16 / 8.
- **Resultado del test (d2i)**: brazo arriba 16 intersecciones (8 en el hombro), brazo adelante
  0, columna y cuello 0, 2 caras aplastadas. Mismo número que la topología anterior con el brazo
  arriba, pero sin el pliegue en V. Lo que queda es contacto entre el deltoides del brazo levantado
  y el trapecio, que en un rig de producción se corrige con pesos pintados o un corrective shape.
  Con el brazo adelante la axila se estira sin pellizcos.
- Validación: 3 086 quads, 0 tris, 0 n-gons, 0 polos >5, 0 no manifold, 0 duplicados,
  0 auto-intersecciones, 0 normales invertidas, simetría 0. IoU (0.9-1.5): front 0.917,
  side 0.954, back 0.929.
- Polos del hombro (por lado): 4 de 5 en las esquinas del agujero del brazo (axila delante y
  detrás a z 1.319; borde del acromion delante y detrás a z 1.40-1.41). Están a 2.8-6 cm fuera de
  la zona de giro del hombro. Base del cuello: 2 de 5 y 2 de 3 (la reducción ya no está en las
  esquinas del agujero). Es un polo más por lado que en la etapa 1 de esta iteración, a cambio
  de tener superficie de trapecio y acromion sobre el deltoides.

## It2 · Etapa 3 — cadera y glúteos

`scripts/glute_views.sh` hace primeros planos de la pelvis (detrás y lado, wireframe y arcilla)
junto a la misma ventana de la hoja (`*_glute.jpg`). Los glúteos se construyen con
`Body.glutes()`: dos insets de la región trasera de la pelvis, entre el borde de la pierna (R0) y
z 1.025 (hoyuelos lumbares) y de θ 112° (lateral de la cadera) hacia el eje.

### g3a — región hasta el eje, 2 insets
- El primer loop rodea los dos glúteos (se abre en el eje y se cierra con el Mirror) y su tramo
  inferior es el **pliegue del glúteo**; el segundo redondea el lóbulo. 3 154 quads, todo en 0.
- Diferencias con BACK: una sola masa ancha con un pliegue recto; la hoja tiene dos lóbulos
  redondos, una hendidura larga y un pliegue que sube hacia la hendidura y hacia fuera.

### g3b — volumen del lóbulo y pliegue curvo
- Relieve de lóbulo en los vértices interiores, pliegue que sube en los extremos, hendidura más
  profunda. El pliegue queda como un escalón horizontal.

### g3c — pliegue en sonrisa
- El pliegue sube 3.4 cm hacia la hendidura y 2.2 cm hacia fuera; volumen del lóbulo más bajo.
  Los lóbulos siguen sin separarse: el último segmento de la espalda mide 4.4 cm y la
  Subdivision convierte la hendidura en una V ancha.

### g3d — un loop cerrado por glúteo
- La región deja fuera el último segmento (la franja de la hendidura): los dos loops rodean cada
  glúteo por separado y uno pasa junto a la hendidura. Se ven **dos lóbulos con su pliegue
  curvo**. Coste: 4 polos más por lado (esquinas de la región).

### g3e/g3f — pared de la hendidura
- La hendidura era una rampa de 7 cm (del eje, y 0.077, al máximo del lóbulo, y 0.150). Se hunde
  más el eje (4.2 cm) y se levanta el borde interior de cada lóbulo 2.2 cm para que la pared sea
  casi vertical.
- SIDE: 0.90 −6 mm, 0.95 −7 mm, 1.00 +6 mm. Validación: 3 166 quads, 0 tris, 0 n-gons,
  0 polos >5, 0 no manifold, 0 duplicados, 0 auto-intersecciones, 0 normales invertidas,
  simetría 0.
- **Test de cadera a 90°** (sentada, con la rodilla también a 90°, `d3a_deform.jpg`): **0
  intersecciones en la cadera y el glúteo** (el glúteo se estira y conserva los lóbulos). Las 30
  intersecciones y las 12 caras aplastadas de la pose están detrás de la rodilla (pantorrilla contra
  muslo, a 23 cm de la cadera), no en la cadera. Es lo mismo que pasa con la rodilla a 90° en la
  pose de codos y rodillas.
- Polos de los glúteos (por lado): 4 de 5 en las esquinas exteriores del loop (pliegue a
  z 0.875 junto a la hendidura y al lateral; hoyuelos a z 1.025) y 4 de 3 en las esquinas
  interiores. Están en la superficie del glúteo, a más de 4 cm de la zona de giro de la cadera.
