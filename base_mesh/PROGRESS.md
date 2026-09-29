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
