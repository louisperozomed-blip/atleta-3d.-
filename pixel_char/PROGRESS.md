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

Ajuste posterior (en la etapa 2): la capa de `run_NE_2/3` y `run_E_2` se salía de su celda y el límite
entre columnas la cortaba → las celdas se recortan ahora con 45 px de solape y el personaje se elige por
tener el centro dentro de su celda; el lienzo pasa a 240×272 (pivote 120, 250) y ningún frame toca el borde.

## Etapa 2 — Volumen

Herramienta: `tools/normals.py` (y `tools/review_stage2.py` para las comparativas).
Salida: `out/color.png`, `out/normal.png`, `out/specular.png` (atlas 2880×4352, celdas de 240×272,
mismo orden en los tres) y `out/sprites.json` (tamaño de frame, pivote en px y normalizado para Unity,
fps por animación, orden y ángulo de direcciones, rectángulo de cada frame, correcciones aplicadas).
Orden: fila = anim×4 + dir//2, columna = (dir%2)×6 + frame; anims idle, walk, run, jump;
direcciones S, SW, W, NW, N, NE, E, SE. Comparativas: `review/stage2_compare_{idle,walk,run,jump}.png`
(sprite | normal | especular | iluminado).

| Paso | Detalle |
|---|---|
| Altura | 0.55 × bisel global (transformada de distancia, perfil circular de 16 px) + 0.30 × bisel por pieza (las líneas de contorno oscuras interiores, detectadas con black-top-hat, hacen de pliegue; perfil de 6 px) + 0.55 × detalle pintado (diferencia de gaussianas σ1.2−σ6 de la luminancia). Suavizado σ0.9 antes de derivar. |
| Normal | Sobel sobre la altura; convención OpenGL/Unity, **verde hacia arriba** (+Y arriba): n = normalize(−∂h/∂x, +∂h/∂y_img, 1). Fuera de la figura, normal plana (128,128,255). |
| Primer intento | El especular del pecho negro salía casi tan alto como el casco (el refuerzo por «parte superior» pesaba mucho) y el crema parecía cromado → más peso al contexto (vecindad con metal vs. con tela verde/bordado) y crema 0.62–0.82. |
| Especular | Crema/dorado metálico 0.62–0.82, negro de casco y juntas hasta 0.92 (se separa de la tela negra por el contexto), bordado naranja 0.15, tela verde 0.05. |

Cambio de disposición del atlas (hecho al empezar la etapa 3): 16 celdas por fila en orden lineal
anim → dirección → frame (3840×3264), para que quepa en texturas de 4096 px (iPhones antiguos).
`sprites.json` incluye además `foot_lift` (altura del pie pintada en cada frame, usada por el salto).

## Etapa 3 — Demo (HTML + WebGL, un solo archivo)

Fuente: `demo/template.html`; empaquetado: `tools/build_demo.py` → `demo/index.html` (6.4 MB, texturas
WebP en base64: color q92 con alfa, normal q92, especular q85).

- Render WebGL2 (con respaldo WebGL1), todo en alfa premultiplicado, mipmaps limitados a 3 niveles para
  no mezclar frames vecinos. `highp` en los fragment shaders: con `mediump` las UV de un atlas de 3840 px
  tienen error de varios texels (además Chrome lo rechazaba: precisión distinta de `uRect` en VS/FS).
- Luz por píxel: difusa envolvente (respeta el sombreado pintado), ambiente hemisférico, Blinn-Phong con
  dureza según la máscara especular, luz de borde fina en el lado que mira a la luz. Luz cálida que gira
  14°/s; al tocar el ángulo se fija.
- Sombra proyectada: la silueta del frame actual se tumba en el suelo en dirección opuesta a la luz
  (paralelogramo afín, UV exactas), difuminado creciente con la distancia a los pies (9 muestras) y más
  clara lejos de ellos; más una sombra de contacto elíptica. En el salto ambas se quedan en el suelo,
  se encogen y se aclaran con la altura.
- Suelo en perspectiva isométrica: pantalla = (x, z·0.64), la misma proporción que las baldosas de las
  hojas, así las diagonales NE/NW/SE/SW coinciden con las de los sprites.
- Movimiento en coordenadas continuas con dt: aceleración 5 H/s², frenado v = √(2·a·d), giro máx.
  11 rad/s (frena en giros cerrados), marcha 1.05 H/s, carrera 2.7 H/s; correr si el punto está a más de
  4 H y pasar a andar a 2.2 H. Anticipación de 0.1 s al arrancar desde parado (gira en el sitio).
- Fase de la animación = distancia recorrida / zancada (0.72 H andando, 1.35 H corriendo) → los pies no
  patinan a ninguna velocidad. Bob vertical de 2 golpes por ciclo.
- Dirección: la más cercana de 8 con histéresis de 8°, y los cambios avanzan de una en una cada 40 ms.
- Salto: impulso (frame 0) → vuelo de 0.62 s con altura parabólica (0.5 H) → aterrizaje con squash.
  La subida pintada en los frames (`foot_lift`) se descuenta y se sustituye por la física, así la
  subida es continua. En el sitio si está parado, hacia delante si se mueve.
- Doble toque: si el primer toque había arrancado desde parado, se anula ese paseo (vuelve al punto de
  partida, < 0.1 H gracias a la anticipación) y salta en el sitio.
- Mantener pulsado (> 170 ms o arrastrar > 12 px): sigue al dedo (corre a > 1.2 H, anda a < 0.7 H,
  se para a 0.18 H); al soltar termina en el último punto.
- Panel plegable «Ajustes»: normal maps on/off, luz girando, ángulo, intensidad, escala, velocidad, fps.
- Móvil: `touch-action: none`, viewport sin zoom, `gesturestart`/`dblclick`/`contextmenu` bloqueados,
  sin selección ni menú de pulsación larga, `100dvh`, áreas seguras; canvas a devicePixelRatio (máx. 3).

Correcciones tras las pruebas (etapa 4, aplicadas aquí):
| Problema | Corrección |
|---|---|
| Seguir al dedo se quedaba 1.5–3 H por detrás (solo corría a > 3 H) | Umbrales de seguimiento 1.2 H / 0.7 H. |
| Doble toque parado se desplazaba ~11 px antes de saltar | Anticipación de 0.1 s + vuelta al punto de partida al anular. |
| Se detenía hasta 4 px antes del punto | Radio de llegada 0.004 H y encaje exacto al parar. |
| En iPhone el personaje ocupaba el 45 % del ancho y rozaba el borde | 36 % del ancho, margen lateral 0.48 H. |

## Etapa 4 — Pruebas y publicación

Pruebas: `tests/e2e.mjs` (Playwright + Chromium; WebGL por SwiftShader en headless):
`cd tests && ln -s $(npm root -g) node_modules && node e2e.mjs ../demo/index.html <salida>`.
Dos perfiles: escritorio 1280×800 a 2x con ratón, e iPhone 13 (390×844 a 3x, táctil real: `touchscreen.tap`
y `Input.dispatchTouchEvent` de CDP para la pulsación mantenida). Resultado final: **54/54 OK**
(`review/stage4/e2e_log.txt`, `results.json`).

Comprueba: canvas a devicePixelRatio; toque cercano → camina, llega al punto exacto y queda en idle mirando
a donde iba; toque lejano (> 4 H) → idle → walk → run → walk → idle; velocidades 1.05 / 2.7 H/s; aceleración
acotada; las 8 direcciones (en marcha y al parar) sin parpadeo; giro de 180° pasando por las intermedias
(SE → E → NE → N → NW); mantener pulsado sigue al dedo (distancia < 1.5 H) y al soltar llega al último punto;
doble toque parado salta en el sitio (0 px de desplazamiento, 0.34–0.40 H de altura); SALTAR en marcha salta
hacia delante; sin scroll ni zoom; sin errores JS; panel plegable; normal maps on/off.

Capturas: `review/stage4/*.png` (inicio, tras carrera, direcciones SW/NE, siguiendo el dedo, luz a 220°,
sin normal maps) y GIF: `review/stage4_demo.gif` (carrera NE → salto → aterrizaje → marcha SW).

| Fallo encontrado por las pruebas | Causa / corrección |
|---|---|
| Error de compilación en Chrome: precisión distinta de `uRect` en VS/FS | `highp` en los fragment shaders (también necesario para UV exactas en el atlas). |
| Seguir al dedo quedaba 1.5–3 H atrás | Umbrales de seguimiento más cortos (ver etapa 3). |
| Doble toque parado se desplazaba 11 px | Anticipación de 0.1 s y vuelta al punto de partida. |
| Paraba 3.7 px antes del objetivo | Radio de llegada mínimo y encaje exacto. |
| iPhone: personaje demasiado grande, un brazo cortado en el borde; y la pantalla no llegaba a 4 H, nunca corría | Alto = 36 % del ancho y margen lateral mayor; ahora en iPhone un toque lejano (4.5 H) corre. |
| Errores del propio test (posición leída antes del render tras teletransportar; toques fuera de pantalla; objetivo recortado a los márgenes) | Corregidos en `e2e.mjs`. |
| Rendimiento: 26–28 fps en headless a 2x/3x | Es render por CPU (SwiftShader); a 1x va a 60 fps. El coste por frame es de 4 quads (sombra con 9 muestras, contacto, marcador, sprite), holgado para la GPU de un iPhone; el contador de fps del panel permite verificarlo en el dispositivo. |

Publicación: `tools/build_demo.py` genera además una variante sin `<html>/<head>/<body>` para el visor de
Artifacts (que añade su propio esqueleto); publicada como «Autómata isométrico»:
https://claude.ai/artifact/D3MKMn1CTffmSTreZWg6oS

---

# Combate — hojas nuevas (ref/sheets_combate)

## Etapa 0 — Hojas y etiquetas
17 hojas de 1225×1284 (mismo formato: 4 filas de dirección × 6 frames): attack1-3, parry, block, dodge, hit y
death (`_1` = N, NE, E, SE; `_2` = S, SW, W, NW; ninguna hoja cambia ese orden) más `death_2_alt`.
Las etiquetas de fase de cada frame están en `ref/sheets_combate/labels.json`:

| anim | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| attack1, attack2 | ANTICIPATION | WIND UP | SWING | IMPACT | FOLLOW THROUGH | RECOVERY |
| attack3 | ANTICIPATION | LEAP | OVERHEAD | IMPACT | FOLLOW THROUGH | RECOVERY |
| parry | GUARD UP | DEFLECT | SPARK | PUSH BACK | READY | RECOVERY |
| block | RAISE | HOLD | HOLD | IMPACT | HOLD | LOWER |
| dodge | CROUCH | PUSH OFF | DASH | DASH | LANDING | RECOVERY |
| hit | IMPACT | RECOIL | STAGGER | STAGGER | RECOVER | READY |
| death | HIT | STAGGER | KNEES | COLLAPSE | DOWN | DOWN |

## Etapa 1 — Revisión y corrección de congruencia
Herramientas: `tools/combat_extract.py` (recorte) → `combat_color.py` (color) → `combat_normalize.py`
(escala, pivote y direcciones) → `combat_review_e1.py` (hojas de revisión). Salida: `build/combat/fixed`
(lienzo 256×288, pivote 128,264: algo mayor que el de idle/walk porque la cuchilla levantada de attack3 llega a
257 px sobre el suelo).

**Recorte.** El extractor original sirve para attack1/attack2 y death (fondo gris azulado). parry, block, dodge
y hit (y attack3, algo menos) tienen el fondo turquesa (G-R 12-24, B-G ~7), casi del tono de la tela verde
(B-G ≤ 1): el fondo se mide en cada hoja y se aceptan también sus tonos más oscuros (color ≈ k·fondo); los
números de columna se buscan por brillo (en esas hojas no son saturados); se quitan las sombras pintadas del
suelo (gris cálido en hit/dodge/death, gris azulado en attack2_2), los rótulos de dirección y las manchas
sueltas; y cuando dos frames están pegados en la hoja (cuchilla de DEFLECT contra las chispas de SPARK en parry
SE/NW) se corta por la línea media entre columnas y cada píxel se queda con el núcleo más cercano.

**Problemas encontrados** (hojas marcadas en `review/combat/E1_<anim>.png`; lista en `E1_revision.json`):

| | Problema | Arreglo |
|---|---|---|
| (a) | attack1 SW: toda la fila de espaldas (mochila) | espejo horizontal de attack1 SE |
| (a) | attack3 SW f6 (RECOVERY) con la mochila | espejo de attack3 SE f6 |
| (a)→(b) | attack3 f4 (IMPACT) de frente en N, NE, E, W, NW | provisional: pose FOLLOW THROUGH de la misma fila (dirección correcta, cuchilla abajo) + el estallido de fuego del IMPACT de la fila S. Se pierde el gesto de la cuchilla clavada → **regenerar** |
| (b) | attack3 f4 en SE y SW mira al frente (S), no en diagonal | se conserva (se lee bien); regenerar si se quiere la diagonal exacta |
| (a) | parry, block, dodge, hit, death: más rojos, saturados y brillantes, cuchilla roja, reborde rojo encendido alrededor de la silueta | color por zonas (Lab): la familia rojo intenso (tono < 50°, croma > 40: cuchilla, estela, chispas) se lleva por cuantiles de L, croma y tono a la de attack1-3 (naranja cálido con borde brillante); el resto de rojos (reflejos del visor, sombras rojizas) gira hacia el naranja de referencia por tramo de L con menos croma en los oscuros; la crema clara −7° y −10 % de croma; el núcleo rosado de la cuchilla → blanco cálido; el reborde del cuerpo → contorno cálido oscuro como en walk. Crema, verde y negro conservan su sombreado (`review/combat/E1_color.png`) |
| (a) | block, dodge, hit, death: dibujados más grandes (casco 7-12 % mayor que idle a igual baldosa) | escala = media geométrica de la escala por casco (pieza rígida) y por baldosa: se reducen 3-6 % (`E1_tamano.png`) |
| (b) | parry, dodge, hit, death: proporciones rechonchas (cabeza grande, cuerpo corto: alto/ancho 13-20 % menor que idle) | no se corrige con código sin deformar el casco; a la escala del juego se nota poco |
| elección | death_2 frente a death_2_alt | **death_2**: igual que death_1 cae de bruces hacia delante (mochila arriba, cabeza hacia donde miraba). death_2_alt acaba con la cabeza hacia atrás (p. ej. en S mira al frente y termina con la cabeza al fondo) y salta de golpe de COLLAPSE (casco al frente) a DOWN (mochila) — `E1_death.png` |

Direcciones del resto (revisadas fila a fila contra walk: mochila visible en N/NE/NW, visor en S/SE/SW, mochila
a la izquierda en E y a la derecha en W): correctas en attack2, parry, block, dodge, hit y death.

**Para regenerar:** attack3 IMPACT (frame 4) en N, NE, E, W y NW (y opcionalmente SE/SW en diagonal); si se
quiere exactitud de proporciones, parry, dodge, hit y death con la proporción cabeza/cuerpo de idle.

## Etapa 2 — Procesado (normales, especular, emisión, hojas y JSON)
`tools/combat_maps.py` sobre `build/combat/fixed` (ya recortados sin halo, color igualado, escala y pivote en
los pies, direcciones corregidas):

- **Normal maps**: el mismo método que idle/walk (`normals.py`: bisel global + bisel por pieza + detalle
  pintado → Sobel, convención OpenGL/Unity, verde arriba).
- **Especular**: por material, igual que antes (crema/dorado alto, negro del casco muy alto, bordado bajo, tela
  casi nulo); lo que emite no tiene especular propio.
- **Emisión** (`tools/combat_emission.py`): tras igualar el color, el sombreado naranja de las placas y del
  bordado tiene el mismo croma, tono y luz que la cuchilla, así que se decide por forma: brilla lo cálido que
  sobresale ≥ 8 px del cuerpo grueso (punta de la cuchilla, chispas, estela, fuego), creciendo hasta 35 px desde
  ahí, y en los frames activos también las piezas calientes grandes (el tajo y el fuego delante del cuerpo) y el
  núcleo blanco pegado a lo que brilla. Limitación: si el cono de la cuchilla queda pegado al brazo formando
  una masa gruesa (algunos frames de hit/dodge/death) no brilla. `review/combat/E2_mapas.png` lo enseña de
  noche con una luz a cada lado: la cuchilla y el tajo brillan sin luz.
- **Hojas** (`out/combat/<anim>_{color,normal,spec,emit}.png`): 8 filas (S, SW, W, NW, N, NE, E, SE) × 6 frames
  de 256×288, pivote (128, 264).
- **Atlas del mundo** (`world/assets/combat_{color,normal,spec}.png` + `combat_atlas.json`): media resolución,
  celdas de 128×144, 32 columnas (4096×1728); `spec` lleva R = especular y G = emisión.
- **JSON** (`out/combat/combat.json`): por frame etiqueta, fase (preparación / activo / recuperación), duración,
  si es activo y qué se puede cancelar en él; por animación ventanas de cancelación, siguiente golpe del combo,
  frames invulnerables, bucle de la guardia y desplazamiento pintado de los pies (movimiento raíz):

| anim | preparación | activo | recuperación | cancelación | total |
|---|---|---|---|---|---|
| attack1 / attack2 | 1-3 | 4 IMPACT | 5-6 | encadenar 4-6, esquivar 5-6 | 485 ms |
| attack3 | 1-3 (salto) | 4 IMPACT | 5-6 | esquivar 5-6 | 770 ms (más lento y pesado) |
| parry | 1 GUARD UP | 2-3 DEFLECT/SPARK | 4-6 | atacar/esquivar 5-6 | 450 ms |
| block | 1 RAISE | 2-5 (bucle 2-3, 4 = recibe) | 6 LOWER | soltar 2-5, esquivar 2,3,5 | — |
| dodge | 1-2 | 3-4 DASH (invulnerable) | 5-6 | atacar/esquivar 6 | 400 ms |
| hit | — | 1 IMPACT | 2-6 | esquivar 5-6, atacar 6 | 480 ms |
| death | — | 1 HIT | 2-6 (se queda en el último) | — | 1030 ms |

## Etapas 3-6 — Combate en el mundo
Sistema de combate, controles, el eco y las pruebas están en `world/` (ver `world/PROGRESS.md`, «Combate»).

---

# Enemigo: el Autómata del bosque (ref/sheets_enemigo)

## Etapa 0 — Hojas y etiquetas
20 hojas de 1536×1024 (idle, walk, run, attack1, attack2, parry, hit, block, dodge, death; `_1` = N, NE, E, SE y
`_2` = S, SW, W, NW; ninguna cambia ese orden). Sin líneas separadoras y con el título centrado (idle, walk, run,
attack, parry, hit_1) o arriba a la izquierda (hit_2, block, dodge, death): `tools/enemy_grid.py` saca la
cuadrícula del propio texto (columnas = los 6 números de la cabecera; filas = los 4 rótulos de la izquierda).
Etiquetas de fase y cuadrícula de cada hoja en `ref/sheets_enemigo/labels.json`:

| anim | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| idle | REST | RISE | PEAK | FALL | SETTLE | REST |
| walk | RIGHT CONTACT | DOWN | PASSING | LEFT CONTACT | DOWN | PASSING |
| run | RIGHT CONTACT | PUSH OFF | FLIGHT | LEFT CONTACT | PUSH OFF | FLIGHT |
| attack1, attack2 | ANTICIPATION | WIND UP | SWING | IMPACT | FOLLOW THROUGH | RECOVERY |
| parry | GUARD UP | DEFLECT | SPARK | PUSH BACK | READY | RECOVERY |
| hit | IMPACT | RECOIL | STAGGER | STAGGER | RECOVER | READY |
| block | RAISE | HOLD | HOLD | IMPACT | HOLD | LOWER |
| dodge | CROUCH | PUSH OFF | DASH | DASH | LANDING | RECOVERY |
| death | HIT | STAGGER | KNEES | COLLAPSE | DOWN | DOWN |

## Etapa 1 — Revisión y corrección de congruencia
`tools/enemy_extract.py` (recorte) → `enemy_color.py` (color) → `enemy_normalize.py` (pivote y direcciones) →
`enemy_review_e1.py` (hojas `review/enemy/E1_*`).

**Recorte**: fondo liso por hoja; baldosa y sombra = grises neutros lisos; el cuerpo de cada celda es la parte
gruesa y texturada con el centro dentro de la celda (estelas y garras finas no unen figuras vecinas); fuera
manchas sueltas de la fila de arriba y los bordes de la baldosa pegados a los pies; borde con `extract.matte`.

**Dirección** (medida con la posición del ojo cian respecto al cuerpo, frame a frame, y revisada a ojo):

| | Problema | Arreglo |
|---|---|---|
| (a) | idle E mira a la izquierda | espejo de idle W |
| (a) | idle SE está dibujada como un SW (ojo a la izquierda) y el frame 3 sale de perfil | espejo de idle SW (fila entera: arregla también el frame 3) |
| (a) | hit_1 NE, E, SE: las poses giran y dejan ver el ojo; no coinciden con su dirección | espejos de hit_2 NW, W y SW |
| (a)+(b) | hit_1 N: RECOVER y READY de frente | provisional: STAGGER sostenido y READY = idle N; **regenerar hit N** |
| (a) | attack2 SW: frames 3-5 de espaldas | espejo de attack2_1 SE (fila entera) |
| (a) | attack1 SW (frames 2-5) y W (2-6) miran al frente | espejos de attack1_1 SE y E |
| (a) | parry SW mira al frente (S) | espejo de parry_1 SE |
| (a) | block SW es igual que S; block W está dibujada como un SW | espejos de block_1 SE y E |
| se deja | idle N/NE frame 3 gira la cabeza (gesto de mirar alrededor); walk NE frames 3 y 6 enseñan un poco el ojo | leve |

**Color** (referencia idle/walk/run; la misma corrección para los 24 frames de cada hoja): attack y parry tenían
croma 35-39 (referencia 28) y el musgo amarillento, así que parecía que había menos (21-34 % de los píxeles de
color frente a 41 %); hit_2, block, dodge y death más grises (y death oscuro, L 53-56 frente a 70). Tono por
cuantiles (el musgo vuelve a verde: 41-42 % en todas), croma por familia (metal oxidado / musgo), luz al 75 %;
el ojo cian no se toca. Después: croma 27.5-29, L 66-71, musgo 41-42 % en las 20 hojas (`E1_color.png`,
`build/enemy/color_report.json`).

**Tamaño**: el grosor de piernas y pies mide lo mismo en píxeles en todas las hojas (14-15 px, ±7 %): mismo
tamaño de dibujo, escala única. La baldosa no sirve de regla: en block, dodge y death está dibujada un 10 % mayor
y escalar por ella encogería al autómata. La altura solo cambia con la pose (`E1_tamano.png`).

**Para regenerar (b)**: hit N (frames 5-6 de frente); hit_1 entera si se quiere su animación propia en NE/E/SE (se
usan espejos de hit_2; además tiene otro estilo, piezas más claras y redondas); opcional: el ojo es más pequeño
en hit_2, block, dodge y death (diferencia de diseño, apenas se nota a la escala del juego).

## Etapa 2 — Procesado (enemigo)
`tools/enemy_maps.py` sobre `build/enemy/fixed` (recortado, sin halo, color igualado, pivote en los pies,
direcciones corregidas):
- **Normal maps**: el mismo método que el personaje (`normals.py`).
- **Especular por material**: placas de metal oxidado 0.45-0.8 según su luz, juntas y cables 0.3, musgo y raíces
  0.04 (sin brillo), el ojo 0.
- **Emisión**: el ojo cian y su halo (lo único que brilla sola en la oscuridad). Se guarda también la posición del
  ojo en cada frame (`eye_px`) para poner en el mundo una luz puntual cian que ilumine un poco el entorno.
- **Pies**: garras en contacto por frame (mismo formato que `world/assets/feet.json`) para anclar los pies y
  colocar las sombras igual que con el personaje.
- **Hojas** `out/enemy/<anim>_{color,normal,spec,emit}.png` (8 filas × 6 frames de 360×290, pivote 180,260) y
  `out/enemy/enemy.json` (fases por frame: preparación / activo / recuperación, duraciones, ojo, pies, correcciones).
- **Atlas del mundo** `world/assets/enemy_{color,normal,spec}.png` (media resolución, 3960×3190, celdas 180×145;
  `spec`: R especular, G emisión) y `enemy_atlas.json`. Altura de pie: 214 px en la hoja; en el mundo se
  dibuja a 1.4 veces la altura del personaje.

| anim | preparación | activo | recuperación | total |
|---|---|---|---|---|
| attack1 (zarpazo rápido) | 1-3 | 4 IMPACT | 5-6 | 720 ms (+ la preparación larga de la IA) |
| attack2 (barrido amplio) | 1-3 | 4 IMPACT | 5-6 | 875 ms |
| parry | 1 | 2-3 DEFLECT/SPARK | 4-6 | 560 ms |
| block | 1 | 2-5 (4 = recibe) | 6 | — |
| dodge | 1-2 | 3-4 DASH | 5-6 | 550 ms |
| hit / death | — | 1 | 2-6 | 590 / 1500 ms |

Revisión: `review/enemy/E2_mapas.png` (de noche solo brilla el ojo; las placas reflejan la luz, el musgo no).

## Etapas 3-5 — El autómata en el mundo
Comportamiento, ambiente, pruebas y publicación: ver `world/PROGRESS.md`, «Enemigo definitivo: el Autómata del
bosque». Revisión final en `review/enemy/` (`E5_pelea.gif`, `E5_8direcciones.png`, `E5_estados.png`, `e5/`).
Pendiente de regenerar (lista (b) de `review/enemy/E1_revision.json`): la fila N de hit (RECOVER/READY de
frente), hit_1 NE/E/SE propias y el ojo algo más pequeño en hit_2/block/dodge/death.
