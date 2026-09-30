# PROGRESS — pixel_char/world (mundo isométrico jugable)

Referencia: `ref/mapa_ref/` (bosque_postnatural.html en three.js r128, captura_1/2.png).
Personaje: atlas de `pixel_char/out/` reducidos a 0.5 por `tools/make_atlas.py` → `assets/`.

Construir: `python3 tools/build.py [dist/index.html] [--fragment artifact.html]` concatena `src/*.js`
(scripts clásicos sobre `window.W`) y embebe los atlas en WebP. three.js r128 se carga de cdnjs
(en las pruebas se sirve la copia local de npm porque cdnjs está bloqueado en este entorno).

## Etapa 1 — Mundo más grande

Módulos (`src/`):
| Archivo | Contenido |
|---|---|
| `core.js` | RNG y ruido deterministas, material "mundo" (toon 3 bandas + color por vértice + emisivo pulsante + balanceo/empuje por atributos), contornos por casco invertido horneados, `GeoBuilder` y sistema de chunks. |
| `terrain.js` | 80×80 baldosas (la referencia tenía 30×30 → ×7.1 de superficie), 5 zonas, 14 senderos + elipse del claro, alturas en escalones de 0.5, mesetas, agua profunda y charquitos, rejilla de navegación de 0.5 u, malla por chunks (solo caras visibles). |
| `props.js` | Arcos de raíces con vainas, árbol-corazón, árboles de raíces, hongos, tallos, cristales, pilares/muros/arcos de piedra, bloques caídos, rocas, hierba, destellos; obstáculos y emisores. |
| `effects.js` | Post-proceso pixel art (baja resolución + posterizado con dither, igual que la referencia), cristal cósmico, agua, pool de luces puntuales, esporas, ondas y polvo. |
| `player.js` | Movimiento continuo con aceleración/frenado, giro limitado, colisiones deslizantes, escalones suaves, salto. |
| `character.js` | Sprite vertical orientado a cámara (etapa 1: sin iluminar). |
| `main.js` | Renderer, luces (hemisférica turquesa/violeta, sol con sombras, pool de 8 puntuales), cámara isométrica que sigue con suavidad y ajuste a píxel, bucle. |

Zonas: claro del árbol-corazón (centro, plaza elevada), bosque de raíces (NO, colinas y arcos
cada ~5.5 u de sendero), campo de cristales (NE, meseta a 2.5 con escalones de entrada), charcas
(SE, lagunas profundas no transitables + charquitos transitables), ruinas (SO, terrazas cuadradas de
0.5 en 0.5 con plataformas de +1 m sin escalera, pilares, muros y arcos de piedra sobre el sendero).
Anillo exterior de senderos entre zonas y borde del mundo en acantilados altos.

Rendimiento (medido con `renderer.info`, en headless no hay GPU real): 42–56 draw calls y
54k–123k triángulos por frame (incluye la pasada de sombras) en cada zona a zoom normal; 102 / 179k con el
mundo entero a la vista. Técnicas: geometría estática fusionada por chunk de 16×16 (un mesh por material
y chunk → el frustum culling descarta chunks enteros), terreno sin caras ocultas, un único material para
sólidos y emisivos (pulso y balanceo en el vertex shader), 8 luces puntuales fijas reasignadas a los
emisores cercanos (sin recompilar shaders), sombra de 1024² que sigue a la cámara ajustada a texel,
render a 1/3 de resolución, esporas simuladas solo cerca de la vista.

| Problema | Corrección |
|---|---|
| Primer terreno casi sin desniveles no transitables y poca agua | Mesetas (+1.5/+2.5) lejos de los senderos, colinas más altas en el bosque de raíces, lagunas mayores, plataformas en las ruinas. Validado en Node (`tests/terrain_check.cjs`): todo lo transitable conectado; las mesetas quedan como plataformas decorativas. |
| `InstancedMesh` no hace culling por instancia en r128 | Terreno y props fusionados por chunk con su propia esfera envolvente. |
| Sombras del sol: en un mundo 7× mayor un solo frustum no alcanza | El frustum de sombra (±15 u) sigue al centro de la vista, ajustado a texel para que no parpadee. |
| Balanceo de tallos/hierba sin sombra coherente | Material de profundidad con el mismo vertex shader. |
| En móvil vertical se veía una franja de 3.5 u de ancho | Alto de vista escalado según el aspecto. |
| Agua y suelo de cristal demasiado saturados | Colores más oscuros (el cian del agua es el mismo de la referencia). |

Colisiones (`tests/collide.mjs`): contra el árbol-corazón se para a 1.78 del centro (radio 1.55); no
entra en lagunas; no sube desniveles de 1 m. Capturas: `review/stage1/`.

## Etapa 2 — Que el personaje pertenezca al mundo

`src/character.js` (material del personaje) e `src/interact.js` (reacciones del entorno).
Comparativa en 3 zonas con luz distinta: `review/stage2/comparativa_integrado.png`.

- **Sprite plano vertical** orientado a la cámara (gira solo en Y), de 1.7 u de alto; como el plano
  es vertical, su profundidad varía con la altura igual que un objeto real de pie.
- **Mismas luces del mundo**: `ShaderMaterial` con `lights: true` que lee los uniforms de three.js:
  la hemisférica turquesa/violeta, el sol (con su mapa de sombras, consultado 0.7 u hacia el sol para
  que su propio proyector no le haga auto-sombra) y las 8 luces puntuales del pool (vainas, hongos,
  árbol-corazón, cristales), con su normal map y su máscara especular (brillo más duro en metal y casco).
  Al pasar junto al árbol-corazón el casco y las piezas crema se tiñen de magenta; junto a los cristales,
  de violeta.
- **Sombra proyectada** con la dirección del sol del mundo: un segundo plano con el frame actual,
  girado de cara al sol (un plano de cara a la cámara casi no proyecta con el sol de lado), invisible en la
  pasada de color y con material de profundidad con alpha test. **Oclusión de contacto**: elipse oscura
  bajo los pies que se encoge y aclara con la altura del salto.
- **Profundidad**: alpha test (alfa < 0.5 se descarta) y escritura de profundidad → los arcos, raíces,
  cristales y hongos que están delante lo tapan (se ve en las capturas: cristal y hongo delante del cuerpo).
- **Pies a la altura del terreno** con un resorte de 0.1 s: en un escalón de 0.5 la altura pasa
  1 → 1.18 → 1.47 → 1.5 (medido en `tests/stage2_checks.mjs`).
- **Color**: mismo render a baja resolución y mismo posterizado que la escena (mismo tamaño de píxel);
  niebla del mundo; la luz se tiñe con la saturación algo contenida y los medios tonos se enfrían un poco
  (sombras hacia violeta), sin tocar negros ni altas luces.
- **Interacción**: ondas en los charquitos en cada pisada (fase 0 y 0.5 del ciclo) y cada 1.4 s en reposo;
  esporas que se apartan; hierba y tallos que se doblan al pasar (vertex shader con `uPlayer`); polvo
  luminoso y ondas al aterrizar.
- **Rotación de cámara en pasos de 90°**: la dirección se calcula respecto al azimut objetivo de la cámara
  y al girar el índice mostrado salta 2 posiciones (medido: 1 → 3 → 5 → vuelta a 1).

| Problema | Corrección |
|---|---|
| Personaje casi negro | En r128 sin luces físicas la irradiancia neta es color·intensidad (se multiplica y divide por π): sobraba mi división por π. |
| El crema se volvía gris azulado | Tinte de las luces con saturación al 60 % y corrección de color al 60 %; ganancia 1.12. |
| La luz del árbol-corazón lo dejaba turbio | Aporte difuso de las puntuales al 70 %. |
| No proyectaba sombra | En r128 la pasada de sombras dibuja las caras traseras de los materiales de una cara; el proyector pasa a doble cara. |
| Ondas casi invisibles sobre el agua clara | Anillo más grueso, más claro y más opaco. |
| Pegatina de comparación mal escalada | La altura en pantalla ya viene proyectada; sobraba el cos(elevación). |

## Etapa 3 — Mejorar SOLO la animación de caminar

Visor de opciones lado a lado (publicado): https://claude.ai/artifact/Qj1gjyHi6ZWqfwD5vY12c1
(`walk/viewer.html`, generado por `walk/build_viewer.py`). Las 5 variantes andan a la vez sobre un suelo
que se desplaza a la velocidad real, así que el patinaje de los pies se ve directamente. En la demo del
mundo el botón «andar A…E» cambia de variante (por defecto E).

| Variante | Qué añade |
|---|---|
| A · Original | 6 frames iguales, zancada fija 0.72 H (lo de antes). |
| B · Tiempos | Frames de contacto ×1.3 y de paso ×0.85 (contactos medidos). |
| C · Bob y balanceo | Bob según la separación de los pies (alto en el paso, bajo en el contacto), balanceo lateral de un periodo por ciclo hacia la pierna de apoyo, squash de 2 % al entrar en un contacto. |
| D · Túnica | La franja cintura-bajo del sprite se desplaza con un resorte amortiguado que sigue al balanceo y a los giros con retraso (deformación del muestreo en el shader; sin temblor). |
| E · Zancada medida | Reparto de la duración de cada frame y zancada por dirección medidos en los pies; la velocidad de marcha se ajusta a esa zancada (0.75–1.05 H/s según la dirección). |

Medición (`tools/walk_measure.py`, `review/stage3/measure.png`):
| Intento | Resultado |
|---|---|
| Flujo óptico Farneback en la franja de pies | Descartado: zancadas de ~0.1 H/ciclo (los pies se mueven 20–40 px entre frames y el sprite tiene poca textura). |
| k-means sobre la franja de 26 px | Descartado: el bajo de la túnica entra en la franja y diluye los pies. |
| Zapatos por color (crema cálido en los 45 px de abajo), 2 manchas | Usado. Separación de pies a lo largo de la marcha → contactos (máx.) y reparto del avance (∝ cambio de separación). Zancada = 2 × separación en contacto, convertida a la cámara del mundo (f(d) = √(sin²a + (cos a·sen EL)²)). |

El walk generado no es un ciclo físicamente limpio (en E hay 3 frames con los pies separados, 0, 2 y 4) y
en las diagonales los pies se solapan en la proyección, así que los valores se regularizan: media con la
dirección espejo, zancada en [0.35, 0.7] H, contactos medidos solo si hay 2–3 y reparto 50 % medido +
50 % regla de contacto con mínimo 10 % por frame. Resultado: E/W 0.58 H, S 0.43 H, resto 0.35 H por ciclo.

**Intermedios con flujo óptico (6 → 12 frames): descartados.** Con flujo DIS de OpenCV en ambos sentidos
los intermedios muestran pies y bajo de túnica dobles y semitransparentes; el alfa intermedio es 2–4× el
de los originales (E: 13.8 % frente a 3.5 %). Evidencia en `review/stage3/inbetween_eval.png`.

## Etapa 4 — Controles y demo

Demo publicada: https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG (`dist/index.html`, 2.6 MB).

- `src/nav.js`: A* sobre la rejilla de 0.5 u (8 vecinos, sin cortar esquinas, desniveles > 0.5 no
  transitables, coste extra junto a paredes) + suavizado por línea de visión con el radio del personaje.
  Si el destino está bloqueado o aislado (meseta, laguna) va al punto alcanzable más cercano.
  Entre las 5 zonas: todos los caminos llegan, 1–35 ms (Node).
- `src/controls.js`: los mismos controles de la demo anterior: tocar = ir por A* (camina si está cerca,
  corre si el camino supera 4 H y pasa a andar a 2.2 H del final); mantener > 170 ms o arrastrar =
  seguir al dedo (re-planifica cada 0.2 s, corre a > 1.2 H); doble toque parado = salto en el sitio
  (se anula el paseo del primer toque); SALTAR/Espacio = salto hacia delante en marcha; marcador que se
  encoge y se desvanece. Movimiento con aceleración/frenado suaves, dirección con histéresis de 8° y paso
  por las intermedias cada 40 ms (ya en `player.js`/`character.js`).
- Botones pequeños: girar cámara ⟲ ⟳ (90°), zoom − +, tamaño de píxel (px1–px8), «andar A–E» y SALTAR.
- Silueta translúcida del personaje cuando algo lo tapa (segunda pasada con `depthFunc = GreaterDepth`).

Pruebas (`tests/e2e.mjs`, escritorio 1100×700 con ratón e iPhone 13 390×844 a 3x táctil):
**31/31 OK** (`review/stage4/e2e_log.txt`): recorrido por las 5 zonas encadenando caminos A*
(9–15 s por tramo, pasando por senderos, 54–73 draw calls y 72k–135k triángulos por frame), toque
cercano (camina), toque lejano (idle → walk → run → walk → idle), rodear el árbol-corazón (distancia
mínima 2.19 al centro), subir escalones de la meseta 1.5 → 2.5 sin saltos bruscos, ondas en charquitos,
doble toque en el sitio (0 desplazamiento), SALTAR en marcha (avanza 3 u y levanta polvo), seguir al
dedo y terminar en el último punto, girar cámara (dirección ±2), zoom y píxel, sin scroll/zoom del
navegador y sin errores JS. Capturas en `review/stage4/`, GIF `review/stage4/recorrido.gif`.

| Fallo encontrado | Corrección |
|---|---|
| En el tramo cristales → charcas se atascaba en una esquina (el giro limitado recorta la curva y roza celdas bloqueadas) y se rendía | Al atascarse 0.35 s re-planifica A* desde su posición (hasta 3 veces). |
| La prueba de seguir al dedo medía el destino después de que la cámara se moviese | El destino se toma en el momento de soltar. |
| En el GIF pasaba largo rato oculto detrás de una meseta alta | Silueta translúcida cuando está tapado; ruta del GIF por el claro y las charcas. |

Rendimiento: en headless no hay GPU (SwiftShader, ~20 fps a 1x), así que no se puede medir los 60 fps del
iPhone aquí. Presupuesto medido: ≤ 73 draw calls y ≤ 139k triángulos por frame (sombras incluidas),
render a 1/3 de resolución (390×664 en un iPhone 13 con px3), 8 luces puntuales fijas, sombra 1024²,
atlas del personaje de 1920×1632.

## Etapa 5 — Peso e integración (que no levite)

Mismo link: https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG. Cada mejora tiene un interruptor
(`W.FX.anchor/contact/impact/inertia/matter/sound`) para grabar el antes/después con la MISMA
simulación (paso fijo, `W.manual` + `W.tick`). GIF antes/después andando de lado y en diagonal en
`review/stage5/pasoN.gif` (+ `pasoN_muestra.png`).

### Paso 1 — Pies anclados (`tools/feet.py`, `src/feet.js`)
- `tools/feet.py` detecta las dos botas en cada frame de idle/walk/run/jump en las 8 direcciones por el
  perfil inferior de la silueta (el color confundía la túnica y las rodillas), su punto de apoyo, cuál
  va delante, los frames de contacto y el píxel opaco más bajo → `assets/feet.json`
  (`review/stage5/pies_detectados.png`).
- Un root motion puro no sirve: el walk dibujado casi no barre los pies (~6 px por ciclo en S, "anda en
  el sitio"). Solución equivalente: el cuerpo avanza continuo y la pierna apoyada se deforma (IK 2D en el
  shader, de la rodilla a la suela, máx. 15–16 texeles) para que la bota se quede en SU punto del suelo.
  El apoyo pasa a la bota de delante en cada frame de contacto y la liberada vuelve a su forma en 80 ms.
  La velocidad sale de lo que la pierna puede absorber por apoyo, por dirección.
- Deslizamiento del pie apoyado (px de render por frame): de lado **2.40 → 0.00**, en diagonal
  **1.36 → 0.00** (objetivo < 1 px).
- Límite honesto: andando va a 0.8–1.25 u/s según la dirección (antes 1.8): es lo que permiten unas
  piernas dibujadas que apenas avanzan sin que el pie patine.

### Paso 2 — Contacto con el suelo
- Sombra de contacto pequeña y oscura bajo cada bota (se aclara al levantarla); la mancha redonda queda
  muy tenue.
- La sombra proyectada nace en el pie apoyado: el plano que la proyecta gira alrededor de esa bota, con
  el mismo mapa de sombras (misma dureza y oscuridad que árboles y rocas).
- Oclusión: degradado que oscurece piernas y botas hacia el suelo + rebote del color de la baldosa de
  debajo (hierba verde, sendero ocre, agua azulada).

### Paso 3 — Impacto en cada pisada
- Cada nuevo apoyo es un evento de pisada: polvo en sendero/plaza, gotas y onda en charcas, briznas en
  hierba, esquirlas en ruinas; la hierba cercana se aplasta un momento (4 huecos en el shader de la
  hierba); huella tenue que se desvanece en 0.6–3.5 s.
- Hundimiento: el cuerpo (de rodillas arriba, las botas no se mueven) baja 1.5 px andando / 2 px
  corriendo en el contacto y se recupera en ~0.2 s (el punto más bajo coincide con la pisada).
- Sonido suave sintetizado por terreno (WebAudio, sin archivos) con botón «sonido» para silenciar.

### Paso 4 — Inercia
- Arranque: llega al 90 % de la velocidad en 0.23 s (antes 0.13 s).
- Al parar: frame de contacto + el cuerpo se hunde 2.4 px y se asienta (0.16 s) antes del idle.
- Al correr, inclinación leve hacia delante (~1.7 px en la cabeza).

### Paso 5 — Misma "materia"
- El personaje ya se renderiza en el mismo buffer de baja resolución; ahora además se cuantiza a una
  paleta compartida (24 colores del mundo por k-means de capturas + 14 tonos propios del personaje tal
  como se ve iluminado, `tools/palette.py`, `review/stage5/paleta_compartida.png`) con dither ordenado
  solo entre colores cercanos, y contorno de 1 px en el tono oscuro de los objetos del mundo.
- Pie exactamente sobre la superficie: por frame se corrige el píxel opaco más bajo. Prueba
  (`tests/foot_surface.mjs`, 129 frames apoyados de idle/walk/run/jump en 8 direcciones): sin corrección
  desfase medio 0.34 px, máx 5 px, 9 frames > 1 px → con corrección **0 px en todos**
  (`review/stage5/foot_surface.json`).

### Paso 6 — Pruebas y publicación
Al escribir las pruebas aparecieron dos fallos reales, corregidos:

| Fallo encontrado | Corrección |
|---|---|
| Al cruzar un escalón el cuerpo subía/bajaba con un resorte de 0.3 s mientras el pie seguía anclado abajo: pie hundido o flotando hasta 25 px, y el ancla se reiniciaba (pisada, polvo y sonido falsos). También daba picos de deslizamiento de hasta 4.7 px al arrancar junto a un desnivel. | La altura del cuerpo es la del suelo bajo la bota APOYADA (su punto en profundidad se deduce del dibujo). Al subir, se predice dónde y cuándo se apoya la próxima bota y el cuerpo sube justo antes (el pie de atrás despega: impulso), así la bota nunca se hunde en el escalón; al bajar, cae en cuanto la bota toca el nivel de abajo (ajuste de 17 ms). El ancla acompaña el cambio de altura en vez de reiniciarse. Andando junto al borde de un desnivel, una bota que sobresale no cambia la altura. |
| E2E «seguir al dedo»: con la marcha más lenta, el último punto caía sobre una meseta inalcanzable y A* iba (bien) al punto alcanzable más cercano, a 2.85 u | La prueba compara con el destino que planificó A* al soltar y exige además el punto exacto cuando es alcanzable. |

`tests/stage5.mjs` (Playwright + SwiftShader, 60 Hz deterministas):
**13/13 OK** (`review/stage5/pruebas/stage5_log.txt`, datos en `stage5_results.json`):

| Prueba | Resultado |
|---|---|
| Deslizamiento del pie apoyado, walk, 8 direcciones de pantalla (tramos llanos de 4 u) | media 0.004 px/frame, máx 0.95 px, 0 de 3240 frames > 1 px |
| Ídem run, 8 direcciones (tramos de 9 u) | 0.00 px en los 111 frames de apoyo |
| Subir un escalón de 0.5 u (cruzado de frente) | 160 frames con pie apoyado: nunca hundido > 1 px; fuera del cambio de nivel |desfase| ≤ 0.27 px; cambio de nivel 133 ms (impulso: el pie de atrás despega, máx 24 px); parado arriba: 1 px; deslizamiento 0 |
| Bajar el mismo escalón | nunca hundido; resto ≤ 0.17 px; la bota toca abajo y el cuerpo cae en 67 ms (máx 9 px); parado abajo: 1 px; deslizamiento 0 |
| Charca (tramo seco → agua → seco) | 118 frames con pie apoyado (68 en el agua): desfase 0.00 px; parado dentro del agua: 1 px; cada una de las 11 pisadas en el agua es de tipo agua y deja su onda |
| Frenado andando / corriendo | para en el punto exacto (error 0.0000 u), nunca se pasa, deceleración máx 9.1 / 11.4 u/s² (límite 11.4), ajuste final ≤ 0.011 u/s; asentamiento con hundimiento de 2.4 px; el pie no desliza al frenar (0.00 px) |

Las medidas: deslizamiento = movimiento en pantalla de la bota apoyada entre frames seguidos (px del
buffer de render); desfase andando = línea de apoyo del sprite frente a la altura del suelo bajo la bota
apoyada; parado = render real (solo el personaje, con y sin él) comparando su píxel más bajo con la
fila del suelo. La medida por render confirma la geométrica en el escalón (p. ej. 9.7 px geométrico ↔
8 px en el render).

E2E de la etapa 4 repetido con todo lo nuevo: **31/31 OK** (`review/stage5/pruebas/e2e_log.txt`).
(Si se lanza a la vez que otra prueba pesada, el doble toque del iPhone puede fallar por tiempos: la CPU
compartida retrasa el segundo toque; en solitario pasa.)

GIF antes/después del paso 6: `review/stage5/paso6.gif` (subir un escalón, cruzar una charca y frenar
tras una carrera; «antes» = todos los interruptores apagados). Scripts: `tests/stage5.mjs`,
`tests/record6.mjs` + `tools/gif_compare.py`, `tests/foot_surface.mjs`, `tests/inertia_check.mjs`,
`tests/record.mjs` (GIF de los pasos 1–5).

Límites conocidos: la marcha es más lenta (ver paso 1); en un escalón de 0.5 u (30 % de la altura del
personaje) no hay pose dibujada de subir, así que durante ~0.13 s el pie de atrás despega antes de
tiempo (se eligió eso frente a que la bota de delante se hundiera en el escalón); la profundidad de cada
bota se deduce del dibujo (billboard), así que junto al borde lateral de un desnivel se usa la altura
del centro.

## Etapa 6 — Nueva dirección de arte: fantasía oscura (un mundo muerto que la naturaleza se traga)

Referencias en `ref/estilo/` (01 árboles retorcidos, 02 cueva bioluminiscente, 03 bosque muerto con
calaveras, 04 árbol hueco con farol, 05 titán esqueleto). No llegó `estilo_ref.zip` al contenedor ni al
repositorio: se usaron las 5 imágenes adjuntas al mensaje, guardadas con esos nombres (JPG).

### E1 — Look visual (`src/look.js`, parches en `core.js`, `main.js`, `terrain.js`)
- **Paleta** (`tools/palette_art.py` → `assets/palette_art.json`, `walk/palette_art.png`): 22 tonos del
  mundo por k-means en Lab sobre las 5 referencias (sin los saturados ni los cálidos), 12 anclas fijas
  (negros de tinta, cian/verde bioluminiscentes, naranja de farol y de flor, musgo terracota) y 12 tonos
  del personaje. `review/art1/paleta_refs.png`: las referencias reducidas a la paleta conservan el ambiente.
- **Post-proceso de ilustración** sobre el render a baja resolución (una pasada, sin geometría extra):
  la escena se pinta con textura de profundidad; de ella se reconstruyen posición y normales por píxel.
  Tinta: silueta donde la profundidad salta (laplaciano, solo en el borde cercano → línea de 1 px) y
  pliegue donde cambia la normal (bordes de terrazas, aristas). Sombreado de líneas diagonales (y
  cruzadas en lo más oscuro) como la tinta de la referencia 01. Niebla por altura sobre el suelo local
  (la altura del terreno va en el mapa de cobertura), más densa en lo bajo, sobre el agua y en las zonas
  húmedas, con jirones animados; bajo las copas su color es casi negro. Viñeta, grano leve y posterizado
  a la paleta con dither ordenado solo entre tonos vecinos. Líneas, dither y grano van anclados al mundo
  (se desplazan con la cámara píxel a píxel, no "resbalan").
- **Luz**: día nublado (cielo gris verdoso, sol velado). Mapa de cobertura (4 celdas/u): cada copa o
  techo lo oscurece; en los shaders del mundo apaga sol (94 %) y cielo (86 %) pero no faroles ni
  bioluminiscencia (`W.patchCover`). Bajo las copas queda casi a oscuras.
- **Partículas** (`W.makeAmbient`, 1100 puntos alrededor de la cámara): hojas que caen girando donde hay
  copas, ceniza que deriva, esporas que suben en lo húmedo, luciérnagas que parpadean en lo oscuro;
  todas se apartan del personaje (las luciérnagas más, y más si corre).
- **Rayos de luz** tenues entre las copas: 40 haces aditivos instanciados (1 draw call), orientados al
  sol, en claros pequeños junto a copas densas.
- Sin contornos horneados (cascos invertidos): la tinta sale del post → menos triángulos.
- Terreno recoloreado: musgo verde azulado desaturado, tierra oscura, piedra gris, parches terracota.

| Fallo encontrado | Corrección |
|---|---|
| Niebla con altura absoluta: el terreno va de 1 a 3.5 y tapaba al personaje y lavaba la escena | La capa va sobre el suelo local (altura del terreno en el canal B del mapa de cobertura). |
| Con el búfer de profundidad como textura (24 bits), la silueta de oclusión (`GreaterDepth`) empataba con el propio personaje y lo teñía de gris azulado | `polygonOffset` en la silueta; además ahora es una trama de puntos cálida (se le encuentra tapado sin romper el dibujo). |
| Dither y grano formaban un damero en superficies lisas | Dither solo entre tonos vecinos de la paleta y grano a 1.4 %. |

Draw calls / triángulos por frame (sombras incluidas, móvil 430×760, px3), misma geometría:

| Zona | Antes | Después E1 |
|---|---|---|
| Claro | 64 / 97.9k | 59 / 82.1k |
| Raíces | 53 / 120.6k | 48 / 93.1k |
| Cristales | 50 / 52.6k | 47 / 47.9k |
| Charcas | 54 / 66.3k | 49 / 55.8k |
| Ruinas | 45 / 60.2k | 41 / 51.8k |

`review/art1/antes_despues.png` (capturas deterministas con `tests/capture_art.mjs`).
