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

### E2 — Zonas rehechas (`src/zones.js`, `src/modules.js`; mismo mapa y mismas claves de zona)
- **El titán caído** (centro): máquina-gigante esquelética tendida. Columna de vértebras con placas, 5
  costillas en arco (2 rotas) con placas oxidadas, musgo y cables-tendón: se camina por dentro de la caja
  torácica y entre las costillas. Cráneo de máquina mirando a la cámara (cuencas hondas, dientes,
  mandíbula caída, casco oxidado, cables en la nuca) con una luz de emergencia roja moribunda en una
  cuenca. Brazo con antebrazo blindado y la **mano abierta = plataforma**: 2×2 baldosas medio escalón por
  encima (`W.HAND`), dedos curvados con nudillos de metal; se sube por el sur y el este (A* comprobado).
  Pelvis hundida y 8 cables que salen del titán y corren por el suelo como raíces.
- **Bosque retorcido**: árboles de 6–9 u con 3–4 troncos trenzados en hélice, raíces que se abren y se
  hunden, ramas y copas en racimos de tonos distintos (verde azulado, oliva, algo de terracota). Arcos de
  raíces trenzadas sobre los senderos con musgo terracota colgando. Copas → mapa de cobertura (oscuro).
- **Charcas bioluminiscentes**: agua casi negra con brillo especular de las luces cercanas y reflejos
  temblorosos de la bioluminiscencia (quads instanciados alargados hacia la cámara). Salientes de roca
  como dólmenes con dintel de losas quebradas y lianas con punta luminosa; raíces muertas sobre el agua
  con más lianas; hongos cian/verde (los grandes con brillo apagado), líquenes que brillan. Penumbra de
  cueva en toda la zona.
- **Cementerio del bosque muerto**: árboles muertos blanquecinos sin copa, troncos caídos, tumbas y
  cruces en filas con su montículo, cercas rotas (postes que faltan, travesaños caídos), 70 calaveras y
  110 huesos entre la hierba, niebla densa. Las terrazas ahora son de hierba.
- **Árbol del farol** (meseta): 7 troncos trenzados en anillo que dejan un hueco hacia el sendero y se
  juntan arriba, la copa más grande del mapa; dentro, un farol cálido (única luz naranja, parpadeo de
  llama, prioridad en el pool de luces); escalones de piedra con musgo hacia el hueco y en la subida a la
  meseta, 150 flores naranjas (solo aquí), rocas con musgo; más de la mitad de las luciérnagas se juntan
  aquí.
- **Ciencia ficción en ruinas** por todo el mapa: terminales rotas cuya pantalla parpadea (brillo
  `aGlow ≥ 2`: parpadeo irregular en el shader + luz puntual que parpadea), placas de metal hundidas
  (registradas en `W.plates` para las pisadas metálicas), balizas de emergencia moribundas (se encienden
  a ratos), diodos en los cables.
- **Módulos instanciados** (una malla por tipo para todo el mapa): calavera, hueso, poste y travesaño de
  cerca, lápida, cruz, montículo, placa, terminal, baliza, hongo, flor, musgo, roca, tronco caído, losa,
  diodo, liquen. Piezas grandes y únicas (árboles, titán, raíces, cables): tubos fusionados por chunk.
- **Recorte con trama**: las copas, las costillas y los hongos que quedan entre la cámara y el
  personaje se tramean en un círculo a su alrededor (dither anclado), así nunca se le pierde de vista.

| Fallo encontrado | Corrección |
|---|---|
| Las copas se oscurecían a sí mismas (la cobertura se aplicaba a toda altura): manchas negras | La cobertura solo apaga lo que está hasta ~3 u sobre el suelo local. |
| Copas y costillas tapaban al personaje | Recorte con trama alrededor del personaje (`W.U.uCutP/uCutR`). |
| Con todas las piezas proyectando sombra: hasta 252k triángulos y 82 draw calls | Proyectan sombra el terreno, el personaje y los módulos altos (tumbas, cruces, terminales, balizas, troncos); los árboles y el titán no (día nublado, y la oscuridad bajo copas ya la da la cobertura). |
| Hongos gigantes enormes y chillones | 1.6–2.8 de escala con tinte apagado; se tramean si tapan. |
| La luz de emergencia teñía de rosa el cráneo | Más roja y más débil. |

Draw calls / triángulos por frame (sombras incluidas, móvil 430×760; vista amplia 900×700 al final):

| Zona | Antes (original) | Después E2 (móvil) | Después E2 (vista amplia) |
|---|---|---|---|
| Titán / claro | 64 / 97.9k | 63 / 132.7k | 76 / 163.9k |
| Bosque retorcido | 53 / 120.6k | 61 / 153.1k | 64 / 157.3k |
| Árbol del farol | 50 / 52.6k | 55 / 106.9k | 63 / 125.8k |
| Charcas | 54 / 66.3k | 62 / 117.9k | 65 / 122.7k |
| Cementerio | 45 / 60.2k | 53 / 97.6k | 61 / 120.6k |

Geometría total del mapa: 72 mallas (25 chunks × material + 20 tipos instanciados + terreno y agua),
~200k triángulos; los módulos instanciados son ~30k (sin descarte, siempre se dibujan). En la vista del
móvil el peor caso es ~153k triángulos y 63 draw calls, dentro del presupuesto que ya funcionaba en la
etapa 4 (≤ 94 draw calls, ≤ 139k). No se puede medir el frame en un iPhone real desde aquí (headless
con SwiftShader).

`review/art2/antes_despues.png`, `review/art2/zonas_vista.png` (vista amplia de las 5 zonas y el
personaje sobre la mano del titán), `review/art2/{mano_titan,craneo_titan,charca_dolmen}.png`.

### E3 — Sentimiento al caminar (`src/feel.js`, parches en `character.js`, `look.js`, `interact.js`, `audio.js`, `main.js`)
Cada efecto tiene su interruptor en `W.FEEL.on` (luz, visor, niebla, cámara, primer plano, reflejo, ambiente).
- **Luz que envuelve**: la cobertura bajo sus pies, suavizada (~0.5 s), apaga su sol hasta un 62 % y su
  cielo hasta un 55 % (se oscurece poco a poco, pero siempre se le distingue). Hongos, pantallas y agua a
  su alrededor le dan **luz fría desde abajo** (más en botas y en lo que mira al suelo). Junto al farol,
  una **envolvente cálida** desde todas partes además de la luz puntual (antes quedaba a contraluz).
- **Visor**: los píxeles oscuros y brillantes de la franja del casco (color + mapa especular) tienen un
  brillo verde azulado propio, muy tenue a cielo abierto y más visible cuanto más oscuro está.
- **Pisadas según el terreno** (`W.surfaceAt`, comprobado andando: `mano` → metal, `bosque` → hojas,
  `charco` → agua, `sendero` → tierra): chapoteo con ondas y **su reflejo en la charca** (el frame volteado
  bajo el suelo, oscuro y ondulado); crujido de hojas secas (varios chasquidos) con hojas que saltan;
  pisada metálica (golpe con resonancia de placa hueca) con una **chispa mínima**; polvo en piedra y tierra.
- **Niebla**: se abre alrededor del personaje (más si corre), los jirones se **arremolinan** a su
  alrededor y una estela de 3 huecos se **cierra detrás** en ~1.3 s.
- **Cámara**: sigue con un leve retraso (suavizado más lento) y un poco de anticipación hacia donde
  camina; en reposo (> 0.8 s) se acerca un 9 % poco a poco, y al correr se aleja un 10 %.
- **Primer plano**: 8 siluetas de tinta (ramas con hojas, lianas, ramitas muertas, helechos) dibujadas
  en un lienzo, pintadas encima de todo en el borde de la pantalla y moviéndose más rápido que el mundo
  (paralaje 1.35–1.75); la silueta depende de la zona y la densidad de lo cubierto que esté.
- **Audio ambiental** (WebAudio, sin archivos; el botón «sonido» lo silencia todo): viento de ruido
  marrón que respira, más fuerte a cielo abierto; goteo en las charcas y bajo las copas; zumbido eléctrico
  de 50 Hz con armónicos y cortes junto a las máquinas (titán, terminales, balizas: `W.machines`).

| Fallo encontrado | Corrección |
|---|---|
| Bajo las copas el personaje se perdía del todo en el negro | Oscurecimiento máximo 62 % (antes 88 %) y visor que sube con la oscuridad. |
| Junto al farol quedaba a contraluz (el farol está detrás, en el hueco) | Envolvente cálida por cercanía al farol. |

`review/art3/antes_despues.png` (sin/con, en oscuridad, en una charca y junto al farol) y
`review/art3/caminar.gif` (cementerio con niebla → reposo con la cámara acercándose → carrera por el bosque).

### E4 — Pruebas y publicación
Mismo link: https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG

- **Capturas por zona** con el personaje frente a la versión anterior: `review/art4/antes_despues.png`
  (móvil 430×760) y `review/art4/vista/*.png` (vista amplia). **GIF recorriendo el mapa**:
  `review/art4/recorrido.gif` (sube a la mano del titán → corre por el bosque retorcido → llega al farol y
  se queda al calor → charcas → cementerio con niebla).
- **Frente a las referencias** (`review/art4/vs_referencias.png`, cada zona junto a su imagen):
  - Oscuro: sí. Bajo las copas y en las charcas casi a oscuras, con negros profundos y líneas de tinta en
    lo oscuro; niebla densa en lo bajo, en las charcas y en el cementerio.
  - Melancólico: sí. Paleta desaturada, día nublado, ceniza y hojas cayendo, árboles muertos, tumbas y
    calaveras; el cálido solo en el farol y en el personaje, que es lo más cálido de la escena.
  - Restos de ciencia ficción: se leen claramente en el titán (cráneo de máquina con luz de emergencia,
    placas oxidadas, cables-tendón, mano-plataforma); en el resto del mapa (terminales que parpadean,
    placas, balizas, cables en el suelo) son discretos a esta escala.
  - Por debajo de las referencias: la bioluminiscencia brilla menos que en la 02 (la paleta y la niebla
    la comprimen); las copas son racimos poligonales y no los troncos-cuerda dibujados de la 01; el agua
    oscura casi no se distingue bajo la niebla; las flores y terminales son pequeños en la vista isométrica.
- **Playwright**, versión final: E2E **33/33** (escritorio 1100×700 con ratón 19/19, iPhone 13 táctil
  14/14; `review/art4/pruebas/`), con dos pruebas nuevas del titán (rodear su columna sin atravesarla,
  subir a la mano-plataforma); pruebas de peso e integración (etapa 5) **13/13** con todo lo nuevo.
- Rendimiento con el recorrido completo en escritorio: máx. 93 draw calls y 160k triángulos por frame
  (antes de la dirección de arte: 94 / 139k). En el móvil (430×760): 53–63 draw calls y 98–153k
  triángulos por zona (tabla de E2). Más ~8 draw calls del primer plano, que se pinta después del post.

| Fallo encontrado | Corrección |
|---|---|
| Prueba de estrés de navegación (282 rutas aleatorias): el personaje se atascaba en esquinas de baldosas con 1 u de desnivel y se rendía a medio camino (**ya pasaba antes del arte**: 95.5 % de rutas bien) | Cuatro causas: el suavizado solo miraba la línea central (ahora el borde del cuerpo en una franja de ±0.12 u); deslizarse por un borde contaba como atasco (ahora atasco = sin acercarse al punto de paso 0.45 s); la sonda del cuerpo usaba el signo de cada componente y un residuo de 1e-17 la lanzaba contra un acantilado (ahora va en la dirección real); A* cortaba esquinas en diagonal si la celda ortogonal llevaba a un desnivel de 1 u. Resultado: **282/282**. |
| E2E: SALTAR, doble toque y seguir al dedo fallaban a ratos en el iPhone emulado | Con la escena nueva, SwiftShader va a pocos fps y el tiempo simulado avanza más despacio que el real: esperas por tiempo real, y en el doble toque táctil el render se pausa durante los dos toques (se miden y se envían seguidos por CDP). El juego no cambia. |
| La prueba del árbol-corazón ya no tenía sentido | Sustituida por las del titán. |

Limitaciones: el rendimiento en un iPhone real no se puede medir desde aquí (headless con SwiftShader, sin
GPU); el presupuesto de geometría y llamadas es parecido al de la versión anterior, que ya funcionaba. El
audio (viento, goteo, zumbido, pasos) está comprobado solo en que no da errores: no se puede escuchar aquí.

---

# Combate

Hojas nuevas procesadas en `pixel_char/` (ver `pixel_char/PROGRESS.md`, «Combate», etapas 0-2): atlas del mundo
`assets/combat_{color,normal,spec}.png` (celdas 128×144, `spec`: R especular, G emisión) y `combat_atlas.json`
con duración de cada frame, frame activo, ventanas de cancelación, siguiente golpe del combo y desplazamiento
pintado de los pies.

## Etapa 3 — Sistema de combate
Archivos nuevos: `src/fighter.js` (máquina de estados, común al jugador y al enemigo), `src/combat.js`
(resolución de golpes, sensación, barras), `src/enemy.js` (el eco; la IA llega en la etapa 5). Cambios en
`character.js` (segundo atlas, emisión, destello blanco, tinte frío del eco), `player.js` (cada cuerpo usa su
propio personaje), `main.js` (hitstop, sacudida, luchadores) y `audio.js` (sonidos de combate sintetizados).

- **Estados**: idle, walk, run y jump siguen en `player.js`; las acciones attack1-3, parry, block, dodge, hit,
  death (y «aturdido») las lleva `fighter.js` con los tiempos del JSON (una sola fuente para animación y
  lógica). Las transiciones salen de frames que casan con idle (RECOVERY, LOWER, READY) y el giro hacia el
  objetivo pasa por las direcciones intermedias cada 25 ms.
- **Combo**: pulsar durante IMPACT..RECOVERY de attack1 encadena attack2 (y attack2 → attack3); el golpe
  siguiente empieza al entrar en FOLLOW THROUGH. attack3 dura 770 ms (485 los otros), salta hacia delante y
  tiene más hitstop, sacudida y alcance. **Búfer** de entrada de 180 ms.
- **Hitbox** en el suelo: arco delante del atacante (±70°, ±85° en attack3; alcance 1.6-1.95 u + radio del
  objetivo), activo solo en el frame IMPACT; cada golpe alcanza una vez a cada objetivo.
- **Atracción** suave: al atacar, si hay un enemigo a menos de 3.4 u por delante, gira hacia él y se acerca
  durante la preparación hasta la distancia de golpe (sin atravesarlo).
- **Parry** (tocar guardia): ventana de 200 ms desde la pulsación; cada pulsación seguida (< 0.7 s) encoge la
  ventana 45 ms (hasta 130 ms menos) y la penalización se recupera sola a 120 ms/s. Justo fuera de la ventana
  (hasta +120 ms) cuenta como bloqueo. Parry logrado: chispas, destello en estrella y luz que ilumina a los dos,
  sin daño, +38 de postura al atacante (+48 contra attack3) que además retrocede; hitstop 110-130 ms.
- **Bloqueo** (mantener guardia, del parry pasa a la guardia sostenida a los 170 ms): daño ×0.15, gasta 22 de
  stamina (36 contra attack3); sin stamina la guardia se rompe (tambaleo largo, medio daño).
- **Esquiva**: 2.3 u, invulnerable en los frames DASH; cancela un ataque después de su IMPACT. La hoja pinta un
  paso atrás, así que el personaje mira al lado contrario de hacia donde se aparta; el desplazamiento pintado de
  los pies se compensa en el sprite (el cuerpo lo mueve el código), igual en el golpe recibido.
- **Barras**: vida y stamina del jugador (arriba a la izquierda); vida y postura del enemigo sobre su cabeza.
  Postura llena = aturdido 2.4 s; golpearlo entonces es un remate (daño ×3, mínimo 40).
- **Sensación**: hitstop 60-120 ms (160 en el remate), sacudida de cámara en la dirección del golpe (ajustada a
  píxeles), destello blanco en quien recibe, partículas según el terreno (tierra, piedra, agua, hierba, hojas,
  metal) y ascuas, destello en estrella, sonidos (tajo, tajo pesado, golpe, parry, bloqueo, rotura de guardia,
  esquiva, aturdido, remate, muerte).

Comprobado en el navegador por la API (`W.pf.input(...)`, `W.foe.input(...)`): combo completo que acierta
10+12+22, parry a 117 ms del impacto → sin daño y +38 de postura, parry parcial → bloqueo, 7 golpes bloqueados →
rotura de guardia, esquiva 130 ms antes → «evade», attack1 cancelado con esquiva en FOLLOW THROUGH, eco muerto
tras 9 golpes (queda en el último frame de death).

## Etapa 4 — Controles táctiles y teclado
`src/controls.js` (y el botón GUARDIA en `src/buttons.html`):

| Gesto / tecla | Acción |
|---|---|
| tocar el suelo | ir ahí (A*; camina cerca, corre lejos). Mantener: seguir al dedo. Doble toque: saltar |
| tocar al enemigo | atacar hacia él; toques seguidos encadenan attack1 → 2 → 3. Si está a más de 3.2 u, va hacia él y ataca al llegar |
| deslizar rápido (> 42 px en < 260 ms) | esquivar en esa dirección (se deshace el acortamiento isométrico de la pantalla) |
| botón GUARDIA | tocar = parry; mantener = bloquear |
| botón SALTAR | saltar (como antes) |
| WASD / flechas | mover (relativo a la cámara); con Mayús, correr |
| J | atacar (hacia el enemigo cercano, o hacia donde se mueve) |
| K | guardia (tocar = parry, mantener = bloquear) |
| Espacio | esquivar hacia donde se mueve (sin dirección: hacia atrás) |
| L | saltar |

Detalles: el toque sobre el enemigo usa el rectángulo de su sprite en pantalla con margen para el dedo y no
arranca el seguimiento; un deslizamiento rápido no arranca el seguimiento hasta ver si es una esquiva; un toque
en el suelo en mitad de una acción de combate queda pendiente y se ejecuta al terminarla.

Comprobado en Chromium (escritorio con teclado y ratón; iPhone con toques por CDP): D mueve a la derecha de la
pantalla, Mayús+W corre (4.6 u/s), J J J → attack1-2-3 aciertan, K tocada → parry, K mantenida → block,
Espacio → esquiva, L → salto, clic en el eco a 1.6 u → ataque, a 6 u → se acerca (A*) y ataca, GUARDIA tocado
→ parry y mantenido → block, y deslizar derecha/arriba/izquierda/abajo → esquiva hacia allí (+155, −56, −155,
+70 px en pantalla). Nota de las pruebas: con SwiftShader los eventos táctiles sueltos se procesan con segundos
de retraso (el gesto parecía durar 3.6 s y arrancaba el seguimiento); los eventos de cada gesto se envían juntos.

## Etapa 5 — Enemigo de prueba: el eco
`src/enemy.js` (+ tinte en `character.js`, botón en `buttons.html`):

- **Aspecto**: las mismas animaciones y hojas que el jugador, recoloreadas en el shader por materiales
  conservando la luminancia (el sombreado pintado): crema y dorado → gris cian claro, bordado naranja → cian
  vivo, tela verde → pizarra oscura, negro → azul noche. Visor con brillo cian propio, cuchilla con emisión cian,
  silueta oculta con trama fría (la del jugador es cálida).
- **IA**: dormido en su claro (aparece a 4.9 u del inicio) hasta que el jugador se acerca a 4.5 u o le ataca;
  persigue con A* (re-planifica cada 0.35 s, corre si está a más de 5 u), se para a distancia de golpe, gira
  hacia el jugador y ataca: attack3 (salto) sobre todo a media distancia, attack1 si no (35 % encadena attack2).
  Su preparación es 1.7 veces más lenta que la del jugador y al empezar cada golpe da un **destello de aviso**
  (cuerpo y visor se encienden, chispa en la cabeza y un tono; cian = golpe normal, naranja = attack3). Tras
  golpear se aparta rodeando al jugador y espera 0.9-1.6 s (+0.4 tras attack3). A más de 14 u de su claro, vuelve.
  Números aleatorios deterministas (pruebas repetibles).
- **Aturdido** al llenarse la postura (2.4 s, etiqueta ATURDIDO sobre sus barras); golpearlo entonces es un
  remate (×3, mínimo 40).
- **REAPARECER**: el botón se ilumina cuando el eco (o el jugador) ha muerto; lo devuelve a su claro con la vida
  llena y dormido (y al jugador, si había muerto).

Comprobado en el navegador: al cargar está dormido a 4.88 u; al acercarse despierta, persigue (4.5 → 1.6 u) y
ataca con aviso antes de cada golpe (warn:attack3 → hit, warn:attack1 → hit, warn:attack2 → hit); tres parries a
~110 ms del impacto → postura 48 → 77 → 100 → aturdido; remate de 40; muerto → REAPARECER encendido → vuelve a
su claro con 120 de vida.

## Etapa 6 — Pruebas, capturas, GIF y publicación
**Pruebas de combate** (`tests/combat.mjs`, Playwright + Chromium con SwiftShader): simulación determinista a
paso fijo (1/60 s); `W.skipRender` avanza sin pintar para que las 8 direcciones quepan en minutos (solo se pinta
en las capturas). El eco se coloca a 1.3 u del jugador cada 45° y se controla a mano salvo en la prueba de IA.
Resultado: **31/31 OK, sin errores JS** (`review/combat/e6/combat_log.txt`, `results.json`):

| Prueba | Resultado |
|---|---|
| combo attack1→2→3, 8 direcciones | 8/8 aciertan 10+12+22; el sprite mira hacia el golpe en las 8 (índices 7,0,1…6) |
| parry a 120 ms del impacto, 8 dir. | 8/8: sin daño, +38 de postura al eco |
| guardia 480 ms antes (demasiado pronto), 8 dir. | 8/8 reciben el golpe |
| guardia 270 ms antes (justo fuera de la ventana), 8 dir. | 8/8 cuentan como bloqueo |
| spam de parry (5 pulsaciones seguidas) | la ventana baja a 70 ms y el parry falla; 2 s después vuelve a 200 ms y sale |
| bloqueo mantenido, 8 dir. | 8/8 bloquean 5 golpes gastando stamina y el 6.º rompe la guardia |
| esquiva lateral 150 ms antes, 8 dir. | 8/8 sin daño (sale del alcance) |
| esquiva a través del golpe 120 ms antes, 8 dir. | 8/8 «evade»: invulnerable en DASH dentro del alcance |
| esquiva 10 ms antes (aún sin DASH), 8 dir. | 8/8 reciben el golpe |
| cancelaciones | attack1→esquiva tras IMPACT sí; antes del IMPACT no; parry→ataque en READY; esquiva→ataque en su último frame; sin combo fuera de la ventana |
| postura, remate, muerte | 3 parries → aturdido; remate de 40; muertes del eco y del jugador en el último frame de death; REAPARECER devuelve a ambos |
| IA | dormido lejos, despierta al acercarse, persigue y cada golpe va precedido de su aviso |
| teclado / ratón | J J J combo, K tocada/mantenida = parry/bloqueo, Espacio esquiva, L salta, A mueve a la izquierda, clic en el eco ataca, GUARDIA tocar/mantener |
| móvil (toques por CDP) | deslizar esquiva hacia allí en las 8 direcciones de pantalla (coseno ≥ 0.99); tocar al eco ataca y 3 toques = combo |

Fallo encontrado por las pruebas y corregido: la primera versión de la prueba de esquiva esperaba «evade» con una
esquiva lateral, pero a 150 ms el jugador ya ha salido del alcance y el golpe simplemente no llega («whiff»); se
separó en dos pruebas (lateral = sin daño; a través del golpe = invulnerabilidad de los frames DASH).

**Capturas** (`review/combat/e6/`): combo (attack1, attack3), parry (destello que ilumina a los dos), bloqueo,
rotura de guardia, esquiva, aturdido, remate, muerte del eco y del jugador, aviso del eco y la vista de móvil.
**GIF** (`review/combat/pelea.gif`, `tests/record_combat.mjs`): pelea contra el eco con su IA; un guion hace de
jugador (parry a los golpes normales, esquiva el attack3, contraataca tras cada parry): aviso → esquiva, aviso →
parry → contraataque, … → aturdido → remate. Además `review/combat/E1_*` (revisión de las hojas) y `E2_mapas.png`.

**Regresiones** (pruebas anteriores del mundo con el combate dentro): `e2e.mjs` escritorio 19/19 e iPhone 14/14,
`stage5.mjs` 13/13 (`review/combat/e6/regresion_*.txt`). En una primera pasada el e2e de iPhone dio 12/14:
se ejecutó a la vez que otra prueba y la compilación de la página, el iPhone emulado (dpr 3, SwiftShader) bajó
a ~2 frames/s reales y dos paseos no terminaron dentro de su límite de tiempo; ejecutado solo, 14/14. Medido
aparte: ni la luz del destello ni el segundo personaje cambian la velocidad de ese render.

**Publicado** sobre el mismo enlace (versión 4): https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG (7.2 MB con los
atlas de combate en WebP).

Limitaciones: el audio de combate solo se comprueba en que no da errores (aquí no se puede escuchar); el
rendimiento en un iPhone real no se puede medir desde aquí.

## Ajuste — guardia visible y avisos de acción
El botón GUARDIA quedaba mezclado con los de cámara y no decía qué hacía. Ahora es un botón redondo grande y
aparte, abajo a la derecha (al alcance del pulgar), con «toca: parry · mantén: bloqueo» escrito. Además, cada
acción defensiva muestra un aviso sobre el personaje: ¡PARRY!, BLOQUEO, GUARDIA ROTA, ESQUIVA; y sobre el eco,
ATURDIDO y ¡REMATE!. Comprobado en móvil y escritorio (`tests/guard_ui.mjs`: tocar → parry, mantener → block,
parry contra un golpe → «¡PARRY!»; captura `review/combat/guardia_movil.png`).

---

# Enemigo definitivo: el Autómata del bosque
Hojas procesadas en `pixel_char/` (ver `pixel_char/PROGRESS.md`, «Enemigo», etapas 0-2): atlas
`assets/enemy_{color,normal,spec}.png` + `enemy_atlas.json` (animaciones, fases, pies, posición del ojo).

## Etapa 3 — Comportamiento y tipos de enemigo
**Tipos de enemigo** (`src/enemies/`): cada tipo es un módulo que se registra con `W.registerEnemy(id, def)`
(`core.js`: aparición, paso, reaparición, ganchos y panel de pruebas).
- `enemies/automaton/automaton.js` — el Autómata del bosque, **por defecto**.
- `enemies/echo/echo.js` — **el eco (enemigo de prueba) guardado tal cual**: mismo aspecto, IA, aviso y
  reaparición que antes; solo se ha movido a su módulo y se registra como tipo `"echo"`.

**Cómo volver a usar el eco**: botón ⚙ (arriba a la derecha) → panel PRUEBAS → «Enemigo: Eco (prueba)»; o
abrir la página con `#enemy=echo` al final de la dirección; o desde la consola `W.setEnemyType("echo")`. Para
volver: el mismo selector (`Autómata del bosque`) o `W.setEnemyType("automaton")`. (`#enemy=none` = sin
enemigos, para las pruebas del mundo.)

**Generalizado para varios cuerpos**: `makeCharacter` acepta un atlas propio (lista de animaciones, pies,
altura, color de emisión, desvanecerse), `feet.js` ancla los pies de cualquier personaje con sus propios datos,
`Player` admite radio y velocidad de carrera propios y `Fighter` admite tiempos de animación, aturdido,
esquiva, retroceso y tabla de ataques propios.

**El autómata** (1.4 veces la altura del personaje, 260 de vida, 120 de stamina):
- Patrulla lenta (walk, 0.8 u/s) alrededor de su punto con pausas; al ver al jugador (8 u, o si le ataca) se
  acerca por A* corriendo (run, 2.75 u/s) y se para a distancia de golpe. Si el jugador se aleja más de 15 u de
  su zona, vuelve andando.
- Ataques: **attack1** (zarpazo rápido: 18 de daño, alcance 2.2 u, arco ±75°) y **attack2** (barrido amplio:
  26, alcance 2.5 u, arco ±115°, pesado). Preparación larga (×1.9) con **aviso**: el ojo parpadea fuerte a 7 Hz
  durante la preparación, destello cian en el ojo y un zumbido grave mecánico.
- Defensa ante los ataques del jugador (según el panel): bloquea (block, gasta su stamina; sin stamina se le
  rompe la guardia) o hace **parry**, más probable cuanto más repite el jugador el mismo ataque
  (probabilidad × (1 + 0.8 × repeticiones)); su parry quita 38-48 de **postura al jugador** (barra POST nueva;
  llena = «POSTURA ROTA», tambaleo largo). Esquiva de lado cuando tiene poca vida (< 35 %) o tras encajar un
  combo (2 golpes en 2.2 s), incluso desde la mitad del tambaleo; invulnerable desde el impulso.
- Postura: cada parry del jugador contra sus ataques le suma 40 (attack1) o 50 (attack2); llena = **aturdido
  3.2 s** (frames STAGGER de hit en bucle lento, el ojo titila), expuesto a un **remate** (×3, mínimo 40).
- Golpes: hit con retroceso (reducido: es pesado). Muerte: death, se queda en el suelo, el ojo se apaga y a los
  3 s se desvanece (trama ordenada, 2.5 s) mientras se levantan esporas.
- **Dificultad** en el panel ⚙: reacción (×0.5-1.6: tiempo de reacción y ritmo de ataques), frecuencia de parry
  y de bloqueo.

Comprobado en el navegador (`tests/_beh.mjs`, `_dodge.mjs`): aparece a 11 u del inicio patrullando; bloqueo al
100 % → «foeBlock, block»; parry al 100 % → «parry» y la postura del jugador 0 → 38; con poca vida esquiva y el
golpe siguiente falla; tres parries del jugador → aturdido → remate de 40; muerte → se desvanece (1 → 0.31 → 0)
y queda oculto; REAPARECER lo devuelve con 260; cambio al eco (1 enemigo) y vuelta (3 autómatas).

Regresión: la batería de combate anterior contra el eco (`HASH=#enemy=echo node tests/combat.mjs`) pasa 31/31,
sin errores JS: el eco guardado se comporta exactamente como antes.

## Etapa 4 — Ambiente
- **Pasos pesados**: cada pisada del autómata (del anclaje de pies, igual que el personaje) hace temblar un poco la
  cámara (según la distancia al jugador: nada a más de 13 u; más al correr), levanta polvo del terreno, suelta
  esporas del musgo que lleva encima, deja una huella grande (u ondas en el agua) y suena un golpe grave. Las
  pisadas de los enemigos ya no hunden al jugador (antes todas iban al mismo sitio; ahora cada evento lleva su
  personaje y cada tipo las trata a su manera).
- **El ojo lo delata**: luz puntual cian (4.5 u) que sigue al ojo frame a frame y un halo aditivo que se ve en la
  oscuridad y entre la niebla (no a través de los objetos: la silueta tapada usa una trama fría); más fuertes
  mientras prepara un ataque; se apagan al morir.
- **Sonido grave mecánico** al preparar cada ataque (motor que se carga + chirrido de metal; más largo en el
  barrido) y golpe sordo en las pisadas.
- **Tres puntos del mapa**: el claro junto al titán (a 11 u del inicio), el bosque de raíces y el cementerio
  de las ruinas (claros con 1.6 u de suelo libre y llano). Cada uno patrulla su zona. **Reaparecer**: el botón
  REAPARECER se enciende al morir alguno (o el jugador) y el panel ⚙ tiene «reaparecer enemigos».
Captura: `review/enemy/E4_zonas.png` (raíces: tras un tronco se le ve el ojo y la silueta; ruinas).

## Etapa 5 — Pruebas y publicación
**Ajuste** encontrado por las pruebas: el autómata recuperaba stamina tan rápido como el jugador (34/s) y su
guardia no se rompía nunca bajo presión. Ahora `Fighter` admite `staminaRegen` propio y el autómata recupera
12/s: bloquear golpe tras golpe le vacía la stamina (≈ 9 golpes seguidos) y se le rompe la guardia.

**Batería del autómata** `tests/enemy.mjs` (Playwright + Chromium/SwiftShader, simulación determinista 1/60 s):
**21/21 OK, sin errores JS** (`review/enemy/e5/results.json`, capturas `00_tamano` … `07_panel_eco`).
| prueba | resultado |
|---|---|
| por defecto el Autómata, en 3 zonas, patrullando | titán a 11 u del inicio, raíces, ruinas |
| altura = 1.4 × el personaje | 1.40 |
| persecución: run + A* hasta distancia de golpe y ataca | run → walk → attack1, 2.2 s desde 7.2 u |
| cada ataque avisa antes (log, ojo ×3.4, preparación larga) | attack1 0.72 s, attack2 0.87 s |
| parry del jugador a 100 ms del impacto, 8 direcciones | sin daño, +40 (attack1) / +50 (attack2) de postura |
| el autómata mira al jugador al atacar, 8 direcciones | las 8 filas del atlas |
| guardia demasiado pronto (550 ms) → recibe el golpe, 8 direcciones | hit ×8 |
| los golpes del jugador le alcanzan desde las 8 direcciones | hit ×8 |
| su bloqueo | foeBlock → block |
| su bloqueo gasta stamina hasta romperse la guardia | guardbreak al 9.º golpe |
| su parry quita postura al jugador | parry, postura del jugador +38 |
| su parry sale más si se repite el mismo ataque | parries con 4-5 repeticiones (al 30 %) |
| aturdido por postura en 2-3 parries | 3 parries → aturdido 3.2 s |
| remate | 40 de daño |
| muerte: death hasta el final, REAPARECER encendido | death f6 |
| se desvanece con esporas | 0.65 → 0, 29 ráfagas de esporas, oculto |
| REAPARECER | vuelve con 260 |
| pisadas pesadas | 16 pisadas en 3 s de carrera |
| panel ⚙ → Eco (prueba) | 1 eco, etiqueta ECO, tinte frío |
| el eco sigue igual (su ataque se desvía con parry) | parry |
| y volver al autómata | 3 autómatas |

**Regresión**: `HASH=#enemy=echo node tests/combat.mjs` (la batería del combate contra el eco) 31/31 OK.
`e2e.mjs`, `stage5.mjs` y `record_combat.mjs` aceptan también `HASH` (el recorrido del mundo se prueba con
`#enemy=none` para que los autómatas de las raíces y las ruinas no se metan en el camino).
El recorrido del mundo con `#enemy=none`: `stage5.mjs` 13/13 OK (pies, escalones, charcas, frenado) y `e2e.mjs`
33/33 OK (escritorio e iPhone), sin errores JS.

**Revisión** en `review/enemy/`:
- `E5_pelea.gif` — pelea completa (`tests/record_automaton.mjs`, IA real con parry 15 % y bloqueo 25 %, vida recortada a 120 para que quepa): se
  acerca corriendo, prepara con el ojo parpadeando, el jugador desvía, contraataca, aturdido, remate, muerte en el
  suelo y se desvanece con esporas.
- `E5_8direcciones.png` — el autómata en el mundo en el frame IMPACT de attack1 y attack2 hacia el jugador en los
  8 ángulos (`tests/enemy_stills.mjs`).
- `E5_estados.png` — aviso, bloqueo, parry, esquiva, aturdido, muerte y desvanecerse.
- `e5/` — capturas de la batería.

**Cómo volver a usar el eco** (recordatorio): ⚙ → «Enemigo: Eco (prueba)», o `#enemy=echo` en la dirección, o
`W.setEnemyType("echo")` en la consola. El código del eco está intacto en `src/enemies/echo/echo.js`.

Publicado en el mismo enlace (versión 6): https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG

# Duelo de timing: parry por niveles y la IA del autómata
Objetivo: un duelo de timing y lectura contra una IA avanzada, pero justo (todo se puede leer y aprender).

## Revisión del sistema anterior: qué se conserva y qué cambia
**Se conserva**: `W.COMBAT` como tabla de ajustes, la máquina de estados `Fighter` (búfer de 180 ms, combo
a1→a2→a3, esquiva con frames invulnerables, aturdido y remate), el parry estilo Sekiro con la ventana (~200 ms)
desde la pulsación, la penalización por spam (+45 ms por pulsación seguida, se recupera sola) y el parry parcial
(justo fuera de la ventana = bloqueo), la resolución de golpes en `combat.js` (arco delante del atacante, tabla
de ataques por tipo), hitstop, sacudida y destellos. **El eco queda intacto** en `src/enemies/echo/`: le
afectan las mecánicas del jugador, no su IA.

**Cambia**:
- El tiempo de la defensa se medía con el reloj del luchador en el paso en que cambiaba el frame (a 20 fps en
  móvil, hasta 50 ms de error). Ahora hay un reloj de combate común (`W.ct`), el instante EXACTO del impacto
  (descontando lo que el frame se pasó) y la marca de tiempo del evento de entrada (`event.timeStamp`), más una
  calibración de latencia.
- `Fighter.defense()` devuelve el nivel (perfecto / normal / parcial / bloqueo) y `resolve` reparte recompensas
  por nivel y abre la ventana de contraataque.
- Postura: cualquier parry sumaba 38-50 al atacante y nada al que desvía → tensión estilo Sekiro (etapa 2).
- IA del autómata: defendía con dados (`onPlayerAttack`/`react` con probabilidades), reaccionaba en 140 ms y
  atacaba con golpes sueltos cada 1.3-2.2 s → cadenas, retrasos, fintas, ataques peligrosos y una defensa basada
  en un modelo del jugador (etapas 3-4).

## Etapa 1 — Niveles de parry
- **Medida**: `W.pressTime(event.timeStamp)` coloca la pulsación en el reloj de combate aunque se procese tarde;
  el impacto guarda su instante exacto (`act.impactT`), y `defense(impactT)` compara los dos. La antelación queda
  en el registro (`early`, ms).
- **Niveles**: PERFECTO = últimos 70 ms (la mitad de la ventana si el spam la ha encogido), NORMAL = resto de la
  ventana de 200 ms, BLOQUEO = fuera de ventana con la guardia mantenida (o parry parcial: hasta 120 ms fuera).
  Mantener la guardia tras pulsar a tiempo sigue contando como parry.
- **Recompensas** (`W.PARRY_LEVELS`):
  | nivel | postura al atacante | tu postura | stamina | efectos |
  |---|---|---|---|---|
  | PERFECTO | ×1.33 su "post" | 0 | 0 | chispas doradas, sonido propio, hitstop 160-180 ms, **ventana de contraataque 350 ms** |
  | NORMAL | ×1.0 | +7 (+10 pesado) | 0 | chispas, hitstop 110-130 ms |
  | BLOQUEO | 0 | +18 (+26 pesado) | −22 (−36) | sin stamina, guardia rota |
- **Contraataque**: un ataque que empiezas dentro de los 350 ms tras un PERFECTO (puedes cortar la recuperación
  del parry) hace ×1.6 de daño y ×1.5 de postura y no se puede defender («¡CONTRA!»). Barra dorada CONTRA bajo tus
  barras mientras dura.
- **Calibración de latencia** (panel ⚙): deslizador «Latencia» (−60…+150 ms) y prueba de ritmo «calibrar latencia»
  (10 pulsos con destello y clic; tocas el círculo o K; la mediana del desfase sin los dos primeros). Con valor
  positivo, el golpe que te lanzan se resuelve esos ms después del impacto, así una pulsación que llega tarde por la
  pantalla táctil sigue contando. Se recuerda en el navegador. Solo afecta al jugador.
- **Pruebas** `tests/parry2.mjs` (STAGES=1): 15/15 OK, sin errores JS. Comprueban:
  - los niveles a 30/65/100/190/270 ms en los dos ataques;
  - que la antelación medida coincide con la real (±2 ms);
  - recompensas, sonido, hitstop y la ventana de contraataque (dentro y fuera);
  - spam, y los mismos niveles a 20 fps;
  - un evento real procesado 60 ms tarde, que cuenta 60 ms antes;
  - calibración +40 ms, la mediana de la prueba de ritmo y el panel.
- **Regresión**: autómata (`enemy.mjs`) 21/21, eco (`combat.mjs`, `#enemy=echo`) 31/31.
- En `enemy.mjs`: bloquear también le sube la postura, así que la presión sostenida le rompe la guardia o la
  postura; además, la prueba de la muerte desactiva su defensa para ser determinista.
- Capturas: `review/parry2/E1_perfecto.png` (chispas doradas, ¡PERFECTO!, barra CONTRA) y `E1_calibrar.png`.

## Etapa 2 — Postura con tensión (estilo Sekiro)
- **Tu postura** sube poco al desviar (NORMAL +7/+10; PERFECTO 0) y mucho al bloquear (+18/+26). **Un parry nunca
  la rompe** aunque la barra esté llena (`addPosture(v, {noBreak})`); un bloqueo sí («POSTURA ROTA»: tambaleo largo).
- **Guardia alta sin recibir golpes** = la postura se recupera ×2.8 y empieza a los 0.45 s (en vez de 1.6 s).
- **Postura del enemigo por parry** (su campo `post` × nivel): el autómata gana 18 (zarpazo) / 21 (barrido) con
  un NORMAL y 24 / 28 con un PERFECTO; **racha**: cada desvío seguido dentro de la misma cadena de ataques suma +3
  más (18, 21, 24, 27…). La cadena la marca la IA (`act.chainId`, etapa 3); sin ella, golpes a menos de 1.25 s.
  La racha se pierde si un golpe te alcanza o lo bloqueas. Resultado: hace falta desviar cadenas enteras (4
  desvíos normales la dejan en ~96; con perfectos se rompe).
- **Recuperación según la vida** (ambos): ×(0.15 + 0.85·(vida/máx)^1.5): con el 30 % de vida se recupera ~4 veces
  más despacio que con la vida llena (antes ×0.6-1.0). Dañar su vida hace que la presión de postura dure.
- El eco conserva su tabla (38 por parry): su batería sigue igual.
- **Pruebas** `tests/parry2.mjs` (STAGES=1,2): 22/22 OK, sin errores JS. Comprueban:
  - que un parry con la barra llena no te rompe la postura y un bloqueo sí;
  - que con la guardia alta se recupera 52 frente a 8 en 2.5 s;
  - que la postura que gana el autómata es 18/21/24/28 y que la racha va 18-21-24-27 y se pierde con una pausa o un bloqueo;
  - que 4 desvíos normales de una cadena lo dejan en 96 y con perfectos se rompe;
  - que con el 30 % de vida la recuperación es de 6 frente a 22.
- **Regresión**: autómata 21/21 (con las expectativas nuevas: +18/+21 por parry, aturdido al desviar una cadena
  entera) y eco 31/31.

## Etapa 3 — El autómata ataca como un duelista
- **Plan de cada golpe** (`act.plan`, `Fighter.update`): **CARGA** (frames 0-1; el ojo parpadea) → **RETENCIÓN**
  (solo en los retrasados: frame 1 fijo, ojo FIJO encendido) → **SUELTA** (frame 2; destello del ojo + chasquido
  metálico) → impacto. La SUELTA dura 0.36 s (zarpazo), 0.40 s (barrido) o 0.46 s (peligrosos): es la señal que se
  puede leer siempre. Carga según el ritmo: rápida 0.12 s, normal 0.32 s, lenta 0.55 s.
- **Cadenas** (`W.AUTOMATON.chains`), de 2 a 4 golpes, cada una con sus ritmos y pausas:
  - rápido-rápido-lento (a1 a1 a2);
  - lento-pausa-rápido (a2 … a1);
  - zarpazo y barrido (a1 a2);
  - cuatro golpes (a1 a1 a2 a1);
  - y tres con un peligroso al final: barrido bajo, estocada y agarre.

  El siguiente golpe sale en la recuperación del anterior, más su pausa. Desviar una cadena entera suena «clin-clin-clin», y cada desvío suma racha de postura (etapa 2).
- **Trucos** (40 %, como mucho uno por cadena y nunca en dos cadenas seguidas):
  - *retraso*: retiene la carga 0.32-0.5 s con el ojo fijo, y castiga a quien pulsa de memoria;
  - *finta*: al acabar la carga corta, sin destello de suelta, y cambia a otro golpe que vuelve a avisar con su preparación completa (≥ 0.52 s).
- **Ataques peligrosos** (aviso ROJO: el ojo, su luz y el destello se vuelven rojos, «¡PELIGRO!» y una bocina
  grave; no se desvían ni se bloquean). Se distinguen por la pose, hecha con frames de otras hojas y efectos por
  código:
  - **BARRIDO bajo**: hoja attack2, agachado ×0.8 y tierra a ras de suelo. Persigue al jugador, así que se **salta**; si lo saltas, en el aire puedes lanzar un golpe de salto que no se defiende (×1.6).
  - **ESTOCADA**: frames de la esquiva, encogido y lanzándose 2.3 u. Si **esquivas HACIA él** en tus frames invulnerables, le pisas la estocada: +42 de postura, retrocede y abres ventana de contraataque. Cualquier otra esquiva a tiempo solo la evita.
  - **AGARRE**: frames de bloqueo, con los brazos en alto, y persigue hasta 2.4 u. Se **esquiva de lado**; hacia atrás, saltando o con la guardia te atrapa y te lanza (30, tambaleo largo).
- **Reglas de justicia**:
  - preparación visible ≥ 350 ms en todo golpe (mínimo real 0.48 s);
  - avisos más evidentes cuanto más fuerte es el golpe: nivel 1 cian pequeño, nivel 2 cian grande con zumbido más grave, nivel 3 rojo con bocina, y la suelta más larga cuanto más fuerte;
  - **nunca ataca** si estás en el suelo o encajando un golpe (ni empieza cadena ni sigue: si pasa más de 1.2 s, abandona la cadena);
  - tras cada cadena, **ventana de castigo** de 0.95 s: resopla vapor, el ojo se apaga y no ataca ni se defiende. Después, una pausa de 0.9-1.6 s.
- **Pruebas** `tests/parry2.mjs` (STAGES=1,2,3): 36/36 OK, sin errores JS. Usan un **bot de duelo** que ve la
  suelta de cada golpe y responde con reacción humana: guardia, salto, esquiva hacia él o esquiva de lado.
  Comprueban:
  - longitudes de cadena de 2 a 4 golpes, y un parry por golpe al desviar la cadena entera;
  - ritmos (preparaciones 0.48/0.48/0.95 s y 0.95/0.48 s);
  - el golpe retrasado: ojo fijo a 3.4; de memoria → golpe, esperando la suelta → 2 parries;
  - la finta: sin suelta falsa y el golpe nuevo con 0.52 s de preparación;
  - los trucos de 14 cadenas: «10101010101010», nunca dos seguidas;
  - los tres peligrosos con todas las respuestas;
  - la justicia: preparación mínima de 0.48 s en 52+ golpes, niveles de aviso y ojo rojo, nunca ataca en tu golpe recibido ni en el suelo, y la ventana de castigo.
- **Regresión**: autómata 21/21 (avisos nuevos fuera del filtro; con golpes sueltos, sin racha, el aturdido llega
  en 5-6 desvíos) y eco 31/31.
- Capturas:
  - `review/parry2/E3_poses.png`: carga, suelta e impacto de los cinco golpes;
  - `E3_peligro_agarre.png` y `E3_peligro_barrido.png`.

## Etapa 4 — Defensa del enemigo basada en leerte, no en dados
- **Fuera los dados**: se quitan `onPlayerAttack`/`react` con sus probabilidades (parry ×repetición, bloqueo,
  esquiva al azar).
- **Modelo del jugador** (`ai.addToken/forecast`):
  - *Fichas*: cada impacto de tus golpes (a1/a2/a3), cada finta tuya (F), el final de su cadena (E) y las pausas
    largas (·). Cada ficha lleva su ritmo desde la anterior: rápido < 0.45 s, medio < 1 s, lento.
  - *N-gramas*: trigramas (las dos fichas anteriores → siguiente) con bigrama de respaldo, cada uno con su intervalo
    medio. Tienen **memoria reciente**: lo anterior pesa ×0.8 en cada actualización.
  - *Predicción*: si lo más probable es un ataque visto ≥ 2 veces con confianza suficiente, se compromete a
    defender en el instante previsto: PARRY si está muy seguro (≥ 1 − 0.5·«Parry»), BLOQUEO si lo está menos
    (≥ 0.9 − 0.6·«Bloqueo»).
  - *Resultado*: si te repites te lee (mismo combo y ritmo → 64 % de tus golpes desviados); si varías ritmo,
    retrasas o fintas, falla (13 %).
- **Su parry se ve venir**: alza la guardia (pose de bloqueo y **ojo ámbar**) 280-340 ms antes del impacto
  previsto, ≥ 190 ms antes de intentar el parry. Tiene su ventana (200 ms) y su recuperación. Si lo engañas, su
  parry se queda en el aire: **¡EXPUESTO!** 0.6 s, tambaleándose, y tus golpes le hacen ×1.5 de postura.
- Si espera tu golpe (te ha leído), no empieza cadenas: se queda a defender. Como es pesado, puede defender desde
  el 2.º frame de un golpe recibido, así que puede desviar tu combo a mitad.
- **Reacción humana**: 200-260 ms según «Reacción» (el deslizador ahora muestra los ms), con ±25 ms al azar.
  Nunca reacciona a algo más rápido: el zarpazo del jugador (205 ms) solo lo para si lo ha leído. Por reacción solo
  bloquea lo lento (golpes retenidos, el de salto) o se aparta de lado si está bajo de vida o tras encajar un combo.
- **Tus herramientas para ganarle la lectura**:
  - **finta**: guardia durante la preparación de tu golpe; lo cancela, gasta 14 de stamina y la pulsación sigue
    como guardia;
  - **retraso**: mantén el ataque (J mantenida, o el dedo sobre el enemigo) y la preparación se queda en la pose
    de carga hasta soltar, como mucho 0.6 s.
- **Su conocimiento se reinicia** cada vez que reaparece.
- **Dificultad adaptativa suave** (`ai.adapt`, de −1.2 a +1, vuelve sola despacio a 0):
  - cada muerte seguida tuya: −0.35, y pausas entre cadenas más largas (×1.26 tras 3);
  - parries perfectos seguidos: +0.12 cada uno desde el 2.º, pausas más cortas (×0.88 tras 5) y más trucos.

  El panel ⚙ lo muestra: «Te lee: golpe 2 rápido 82 % → PARRY», número de fichas, reacción en ms, adaptativa y
  muertes seguidas.
- **Pruebas** `tests/parry2.mjs` (STAGES=4): 9/9 OK, sin errores JS. Comprueban:
  - contra el mismo combo repetido: 64 % desviados;
  - contra combos variados, con retrasos y fintas: 13 % desviados;
  - reacción: 250-284 ms en la dificultad más lenta y 216-234 ms en la más rápida, nunca por debajo de 200 (medido en pasos de 1/60 s);
  - que el zarpazo sin leer no lo para;
  - que alza la guardia 200-250 ms antes de su parry, con el ojo ámbar en todos los frames;
  - que si lo engañas queda expuesto y tu golpe le hace +10.5 de postura (×1.5);
  - la finta (−14 de stamina, pasa a parry) y el retraso (impacto a 405 ms en vez de 205);
  - que el modelo se reinicia al reaparecer;
  - la adaptativa: −1.05 tras 3 muertes (pausas ×1.26) y +0.47 tras 5 perfectos (×0.88), visible en el panel.
- **Regresión**: parry E1-E3 36/36; autómata 21/21 (su bloqueo y su parry ya salen de la reacción y de la lectura,
  no de dados); eco 31/31.
- Capturas: `review/parry2/E4_guardia_leida.png` (guardia leída, ojo ámbar) y `E4_panel.png` (panel con la lectura
  y la adaptativa).
- **Pruebas** `tests/parry2.mjs` (STAGES=5): 3/3 OK, sin errores JS. Comprueban:
  - que el entrenamiento repite «cuatro» tres veces sin defenderse y nadie muere;
  - los textos del indicador: «PERFECTO · 45 ms antes», «PARRY · 130 ms antes», «PRONTO · 450 ms antes», «TARDE · 14 ms» y «BARRIDO → salta»;
  - las barras visibles cerca y ocultas lejos, con anchos 40/25 %, y la ventana de contraataque que se enciende y se apaga.

  Etapas 1-5 seguidas en una misma página: **48/48**.
- **Regresión**: autómata 21/21, eco 31/31.
- Capturas: `review/parry2/E5_entrenamiento.png` y `E5_barras_contra.png` (barras centrales y ventana de contraataque
  dorada).

## Etapa 6 — Pruebas de justicia y publicación
**Bot de pruebas con reacción humana** (`tests/parry2.mjs`, STAGES=6). Ve la SUELTA de cada golpe y responde
250 ms después, con un error de timing de ± 40 ms (normal, σ = 40 ms, recortado a 3σ). Intenta desviarlo todo: los
golpes normales con la guardia y los peligrosos con su respuesta (saltar el barrido, esquivar hacia la estocada,
esquivar de lado el agarre). Se juegan 16 veces cada una de 13 combinaciones de cadena y truco (208 cadenas).

| tipo de golpe | antes | después del ajuste (batería completa) |
|---|---|---|
| zarpazo (attack1) | 97 % | 99 % (n = 228) |
| barrido (attack2) | 88 % | 93 % (n = 125) |
| zarpazo retrasado | 95 % | 97 % (n = 37) |
| **barrido retrasado** | **71 %** (n = 7) | 100 % (n = 27) |
| zarpazo / barrido tras finta | 100 / 80 % | 92 / 100 % |
| barrido bajo (salto) | 100 % | 100 % (n = 16) |
| estocada (esquiva hacia él) | 93 % | 100 % (n = 16) |
| **agarre (esquiva de lado)** | **71 %** | 100 % (n = 16) |

**Qué no cumplía y qué se ha ajustado**:
- **El barrido (attack2)**, sobre todo el retrasado. Su SUELTA duraba 0.40 s: una pulsación a 250 ms caía a 150 ms
  del impacto, cerca del borde de la ventana de 200 ms, y con −50 ms de error se salía (≈ 11 % de fallos; 2 de 7 en
  los retrasados). **Suelta: 0.40 → 0.38 s**, que sigue siendo más larga que la del zarpazo (0.36 s): los golpes
  fuertes siguen avisando antes.
- **El agarre.** La esquiva lateral solo contaba en sus frames invulnerables (0.10-0.24 s tras pulsar), una ventana
  más estrecha que el error humano. Los peligrosos tienen ahora una **ventana de esquiva explícita**, como el mikiri
  de Sekiro: cuenta la esquiva que empezó entre 40 y 340 ms antes del impacto, o que esté en sus frames
  invulnerables, siempre que vaya en la dirección correcta. La esquiva hacia atrás o hacia delante sigue sin servir
  contra el agarre, y la de lado sigue sin dar el contraataque de la estocada.
- (En la primera medición salieron 68 % y 52 % en el zarpazo, pero no era el juego: el generador aleatorio del bot
  daba con semillas pequeñas un primer número ≈ 0 → error extremo. Se arregló la semilla antes de medir lo de arriba.)

**La lectura** (etapa 4, se repite en la batería completa):
- el mismo combo con el mismo ritmo → la mayoría de tus golpes desviados (64 %);
- ritmos variados, retrasos y fintas → falla (13 %).

**Interfaz en escritorio y móvil** (`tests/parry2_ui.mjs`, Chromium 1280×800 con teclado y ratón, y 390×844 táctil
con toques reales por CDP): **10/10 OK, sin errores JS**. Comprueba:
- que el parry se mide desde la marca de tiempo del evento: la antelación es lo que faltaba más lo que tardó el
  evento en llegar al juego, incluidos los ~20 ms de arrancar el audio en la 1.ª pulsación;
- el golpe retrasado: J mantenida o el dedo sobre el enemigo retienen la carga 450 ms;
- la finta (K o GUARDIA durante tu preparación);
- que las barras centrales no tapan GUARDIA, ni los botones, ni el título, ni tus barras, y que no hay scroll
  horizontal. En el móvil la tuya va encima de los botones a la izquierda de GUARDIA, y la suya bajo el ⚙;
- el panel (entrenar, latencia, calibrar), que cabe en pantalla.

**Revisión** en `review/parry2/`:
- capturas E1-E6;
- `E6_duelo.gif`: guion de cadenas contra un jugador con reacción humana. Desvía (clin-clin), castiga en el
  resoplido, salta el barrido y contraataca en el aire, pisa la estocada, aturdido y remate;
- `E6_lectura.gif`: repites el mismo combo → guardia ámbar y «¡DESVÍA!» (hasta romperte la postura); retrasas el
  2.º golpe → su parry falla, «¡EXPUESTO!» y tu golpe entra;
- `E6_ui_*`: escritorio y móvil, con duelo, panel y calibración.
- **Batería completa**:
  - `tests/parry2.mjs` (etapas 1-6 seguidas): **50/50 OK**, sin errores JS;
  - `parry2_ui.mjs` (escritorio y móvil): 10/10;
  - autómata 21/21 y eco 31/31.
  - recorrido del mundo con `#enemy=none`: `stage5.mjs` 13/13 y `e2e.mjs` 33/33 (escritorio e iPhone).
- **Publicado** en el mismo enlace (versión 7): https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG

# Mejora del duelo: recompensa del parry perfecto, contraataques y reacciones del enemigo
El eco sigue guardado en `src/enemies/echo/` (se elige en el panel ⚙ → Enemigo) y no se toca.

## Etapa 0 — Hojas nuevas por el pipeline (riposte, deathblow, deflected, counter)
Las cuatro hojas existen, así que se procesan por el mismo pipeline que las demás (los sustitutos de
código siguen disponibles y configurables en `W.DUEL.sheets`, ver Etapa 1).

**Hojas** (`ref/`, etiquetas de fase en cada `labels.json`; `_1` = N, NE, E, SE; `_2` = S, SW, W, NW):

| animación | hoja | fases |
|---|---|---|
| riposte (personaje) | `sheets_combate/riposte_{1,2}.png` | PARRY POSE, SNAP, LUNGE, CUT, CUT FOLLOW, READY |
| deathblow (personaje) | `sheets_combate/deathblow_{1,2}.png` | STEP IN, RAISE, PLUNGE, IMPACT, PULL OUT, RECOVER |
| deflected (autómata) | `sheets_enemigo/deflected_{1,2}.png` | CLASH, RECOIL, OFF BALANCE ×2, REGAIN, READY |
| counter (autómata) | `sheets_enemigo/counter_{1,2}.png` | CATCH, TWIST, LUNGE, SLASH, FOLLOW THROUGH, READY |

**Pipeline del personaje** (`combat_extract` → `combat_color` → `combat_normalize` → `combat_maps`):
- recorte: riposte llegó a 1312×1199 (las demás 1225×1284); se reescala ×0.934 al leerla para que la rejilla común
  caiga en su sitio. Deathblow cierra la última fila con una raya: el extractor admite ese 5.º separador;
- color: las dos ya tienen el color de los ataques (cuchilla L 141-143, croma 59-62, tono 55-56°, como attack1),
  así que se copian sin tocar. Arreglado de paso: `deathblow` empezaba por `death` y se colaba en su recoloreado;
- escala: casco y baldosa, como las demás (riposte ×1.06, deathblow ×1.08 frente al recorte);
- congruencia (a, corregido con código): en riposte la fila SW era la de S sin girar y la NW cortaba hacia atrás
  a la derecha → espejos de SE y NE (b: con el espejo la cuchilla cambia de mano, como en attack1 SW);
- emisión: estela naranja del CUT y cuchilla del deathblow (la regla de las piezas que sobresalen del cuerpo);
- fases y tiempos (`combat_maps.py`): riposte 40-45-50-60-80-110 ms (385 ms, golpe en el CUT a los 135 ms,
  encadenable consigo misma); deathblow 110-140-90-170-150-190 ms (impacto en IMPACT a los 340 ms);
- atlas del mundo: 4096×1728 → 4096×2160 (10 animaciones). Las celdas de antes no cambian ni un píxel.

**Pipeline del autómata** (`enemy_grid` → `enemy_extract` → `enemy_color` → `enemy_normalize` → `enemy_maps`):
- maquetación distinta (sin cabecera de números: número gris en cada celda y la fase debajo): nueva
  `enemy_grid.grid_b` (filas por las líneas de etiquetas, columnas por sus 6 palabras) y el texto se quita por
  cajas, así el brazo y las chispas del CLASH que asoman a la izquierda no se cortan;
- color por zonas hacia idle/walk/run (counter era más cobrizo, croma 34-36 frente a 28);
- congruencia (a): deflected_1 E, SE y NE miran a la izquierda → espejos de deflected_2 W, SW y NW;
  counter_2 SW está dibujada como SE y NW corta a la derecha → espejos de counter_1 SE y NE;
- las chispas del CLASH son motas sueltas que no sobreviven al recorte: las pone el juego en el punto de choque;
- emisión: la estela cian del SLASH tiene el mismo cian que el ojo; `split_cyan` separa estela (piezas grandes o
  fuera del cuerpo: emiten) y ojo (la pieza pequeña con más núcleo: lleva la luz). Solo en counter, así los
  mapas de las demás animaciones salen idénticos;
- pies anclados y ojo por frame en `enemy_atlas.json` (`feet`, `eye_px`), como el resto;
- tiempos: deflected 60-100-170-170-120-90 ms (~0,7 s); counter 70-80-70-75-110-140 ms (SLASH a los 220 ms);
- atlas: 3960×3190 → 3960×3915 (12 animaciones). Las celdas de antes no cambian.

**Revisión** en `review/duel3/` (`tools/duel3_review_e0.py`): `E0_<anim>.png` antes | después con los problemas
marcados, `E0_tamano.png` (junto a idle y attack1), `E0_emision.png` y `E0_revision.json`.

## Etapa 1 — Recompensa del parry perfecto (`src/duel.js`, enganches en `fighter.js`, `combat.js`, `character.js`)
**Hojas o sustitutos** (`W.DUEL.sheets`): cada animación nueva usa su hoja si está en el atlas (`"auto"`) o su
sustituto (`"sustituto"`, también automático si la hoja falta):

| animación | sustituto |
|---|---|
| riposte | attack1 ×1,4 con estela naranja (brasas a lo largo del tajo) |
| deathblow | attack3 con brasas en la cuchilla, destello y estallido |
| deflected | frames de hit (IMPACT, RECOIL, STAGGER…) a la velocidad que dé 0,7 s, con retroceso y el cuerpo rebotando por código (inclinación amortiguada) |
| counter | attack1 ×1,35 (etapa 2) |

La acción guarda su nombre lógico (`act.name = "riposte"`) y la hoja que la pinta (`act.sheet`); los tiempos
salen de la hoja que se pinta (`fighter.js: an(a)`), y `W.isAtk(a)` reconoce los golpes nuevos.

**Desequilibrado**: tu parry perfecto deja al enemigo en DEFLECTED ~0,7 s (CLASH, RECOIL, OFF BALANCE ×2,
REGAIN, READY), con el pecho expuesto: no se defiende, tus golpes le quitan +50 % de postura y su cadena se corta.

**Riposte** (ventana de 0,7 s tras el perfecto; la barra CONTRA la muestra):
- atacar en la ventana lanza el riposte (rápido: golpe a los 135 ms); se encadena hasta 3 veces pulsando de
  nuevo, y cada golpe lo vuelve a desequilibrar (vuelve a OFF BALANCE y la ventana se alarga 0,45 s);
- golpes 1-2-3: daño 8-10-13, postura 10-14-20, hitstop 70-90-130 ms y sacudida 0,05-0,075-0,11 crecientes,
  chispas cada vez más doradas y un tajo más agudo cada vez. No se pueden defender;
- un riposte completo tras un parry perfecto deja su postura en ~3/4: no es un premio automático;
- **ritmo del 3.º**: tras el impacto del 2.º se cierra un anillo dorado tenue sobre ti; el momento ideal es a los
  170 ms del impacto y el margen ±80 ms (la pulsación se mide con la marca de tiempo del evento, también la del
  ataque, y la calibración de latencia). Pronto, tarde o machacando antes del 2.º impacto, el anillo se pone
  rojo, él se recupera y desvía tu 3.er golpe (tú retrocedes y pierdes un poco de postura);
- **parry normal**: ventana de 0,32 s y un solo golpe.

**Deathblow**: si su postura se rompe durante el riposte, el golpe siguiente es el remate (transición directa):
hoja deathblow (o attack3 con efectos), 100 de daño, la cámara se acerca un 16 % y vuelve, destello de pantalla
y de luz, chispas doradas y golpe grave. Fuera del riposte, el enemigo aturdido se sigue rematando como antes (golpe ×3).

**Pruebas** (`tests/duel3.mjs`, etapa 1): 7/7 — hojas y sustitutos, desequilibrado de 0,7 s (con y sin hoja,
rebote por código), riposte de 3 golpes con todo creciente, 3.er golpe pronto/tarde/machacando desviado y dentro
de ±80 ms aceptado, parry normal de 1 golpe, sustituto del riposte que también encadena 3, y deathblow directo
(con hoja y con attack3) con zoom y destello.

## Etapa 2 — El enemigo reacciona mejor a tus golpes
**Peso del golpe** (`fighter.js: hurt`, solo enemigos):
- golpe ligero (attack1, attack2) = respingo corto: IMPACT y RECOIL de hit (~150 ms) y casi sin retroceso; le
  corta su golpe si es ligero;
- golpe pesado (attack3, contraataques) = tambaleo completo (~0,6 s) con retroceso (×1,25);
- **hyper armor**: durante sus golpes de nivel ≥ 2 (barrido amplio y los peligrosos) aguanta sin interrumpirse
  (recibe el daño y la postura, chispas de metal y un golpe sordo) y su golpe sigue.

**Lee tu combo completo** (`automaton.js`):
- la apertura de tu combo (el golpe que prevé tras el fin de su cadena o tras una pausa de más de 0,8 s) la
  BLOQUEA; los golpes encadenados (2.º, 3.º) los DESVÍA si tu ritmo se repite;
- además mide cuánto tardas en abrir el combo desde que quedas libre; si ese tiempo se repite (las 3 últimas
  aperturas con menos de 0,15 s de diferencia), prevé la siguiente y alza la guardia;
- arreglado: tras bloquear el 1.º, el compromiso de desviar el 2.º se daba por cumplido con ese mismo bloqueo;
  ahora solo cuenta una defensa posterior al compromiso.

**Su parry y su COUNTER**: si te desvía, quedas desequilibrado (tus frames de hit, más largos que en un desvío
normal) y a los 120 ms lanza su COUNTER (hoja counter; sin hoja, attack1 ×1,35 con el plan estirado para que avise
igual): carga 0,1 s + suelta 0,34 s = preparación visible de 0,44 s, se puede desviar. Tras el counter también
resopla (ventana de castigo), más corta que tras una cadena: 0,5 s.

**Intercambio de desvíos (clin-clin)**: si desvías su counter con un PERFECTO, puede volver a contraatacar,
cada vez más deprisa (suelta 0,34 → 0,31 → 0,28 → 0,26 s) y con más probabilidad de fallar (30 %, 50 %, 75 %,
100 %). Pierde quien falla primero: si fallas tú (no llegas, bloqueo o parry normal), te alcanza o se acaba; si
falla él, queda desequilibrado 0,9 s y se abre tu riposte (o se le rompe la postura por la racha de desvíos).

**Choque**: si los dos golpes impactan a menos de 80 ms y os miráis (ni peligrosos ni de duelo), chispas grandes
blancas y doradas, destello, hitstop de 130 ms, sonido de metal grave y ambos retrocedéis sin daño; su cadena sigue.

**Pruebas** (`tests/duel3.mjs`, etapa 2): 6/6 — respingo 150 ms frente a tambaleo 0,62 s; hyper armor en el
barrido (su golpe sigue y entra) y no en el zarpazo; lectura: repitiendo el combo (fuera de su resoplido)
bloquea el 90 % de tus aperturas y desvía el 91 % de tus 2.º/3.º golpes, variándolo 0 %; counter con hoja y con sustituto (preparación 0,44 s); 12 intercambios
de desvíos de 1 a 3 golpes ganados con perfectos (2 por postura rota) y sin pulsar te alcanza; choque a la vez y
con 40 ms sí, con 150 ms no.

**Justicia**: si al llegar el momento de alzar la guardia ya no quedan ≥ 150 ms hasta su parry (estaba ocupado),
solo bloquea; así su parry siempre se ve venir (lo detectó la prueba antigua de parry2).

**Pruebas antiguas ajustadas al nuevo diseño** (`tests/parry2.mjs`, etapa 4): el jugador de prueba ahora se cubre
de su counter tras ser desviado (como una persona) y se repone su postura y stamina entre combos (si no, de tanto
bloquear aperturas acaba aturdido y se mide eso); «te lee si te repites» pasa a ≥ 50 % de golpes defendidos y
≥ 30 % desviados (tras su counter resopla y, por justicia, en ese rato tus aperturas entran); y «si lo engañas» se
hace retrasando el 2.º golpe, que es el que ahora desvía (la apertura la bloquea).

## Etapa 3 — Combos del enemigo que se adaptan (`automaton.js`, `combat.js`)
Cada golpe que resuelve `combat.js` avisa a la IA de su resultado (`ai.onResult`); tu respuesta a su 1.er golpe de
la cadena decide cómo sigue (`CFG.branch`):

| tu respuesta al 1.º | la cadena sigue con |
|---|---|
| lo desvías | el siguiente golpe RETRASADO (retiene la carga 0,32-0,5 s con el ojo fijo: castiga el parry de memoria) |
| lo esquivas | la ESTOCADA, persiguiéndote (peligrosa: esquiva hacia él = contraataque) |
| lo bloqueas | el ROMPEGUARDIAS: carga larga (0,55 + 0,42 s) con el ojo naranja y «¡ROMPEGUARDIAS!»; si lo vuelves a bloquear te rompe la guardia aunque te quede stamina; se desvía o se esquiva |
| te alcanza | lo que tenía previsto |

**Reglas de justicia que se siguen cumpliendo**: preparación visible ≥ 350 ms en todas las ramas (mínimo medido
0,68 s); como mucho un truco por cadena: el golpe retrasado de la rama cuenta como truco y, si la cadena ya traía uno
(retraso o finta), o la anterior lo trajo, o los trucos están desactivados, la rama no añade otro («igual»); y ventana de castigo tras cada cadena
(resopla 0,95 s). En entrenamiento las cadenas no se ramifican (siempre la misma).

**Pruebas** (`tests/duel3.mjs`, etapa 3): 3/3 — las cuatro ramas con el bot (4 veces cada una), justicia en todas
(también con truco previo) y el rompeguardias: bloqueado = guardia rota, desviado = parry perfecto.

## Etapa 4 — Sensación y entrenamiento del riposte
- **Parry perfecto**: tras su hitstop (160 ms congelado), un instante de cámara lenta: 120 ms reales al 30 %
  (`W.slowmo`, `W.DUEL.slowmo`; el reloj de combate avanza a ese ritmo, así el juego entero se ralentiza);
  chispas doradas, destello y el sonido metálico agudo de siempre con una chispa aguda más (5,3 kHz).
- **Riposte**: estelas de brasas a lo largo del tajo, más en cada golpe (con la hoja, que ya pinta su estela
  naranja, un rastro que crece; con el sustituto, la estela entera); tajo cada vez más agudo, largo y fuerte
  (riposte1-2-3) y una campanilla en el 3.º.
- **Deathblow**: destello de pantalla y de luz, chispas doradas y un golpe grave más profundo (sub de 55 Hz + cuerpo
  de 90 Hz) con un brillo que queda sonando; la cámara se acerca un 16 %.
- **Entrenamiento → «RIPOSTE · desvía y contraataca (ritmo del 3.º)»** (panel ⚙): el autómata hace siempre la misma
  cadena (zarpazo y barrido, sin trucos ni ramas), no te lee ni se defiende, nadie muere; tras cada 3.er golpe el
  indicador dice «RITMO ✓ +30 ms», «RITMO · TARDE +150 ms» o «RITMO · PRONTO −140 ms» y cuántos llevas bien (2/4).
- Arreglado de paso: tras el remate a un aturdido su postura se quedaba llena y cualquier desvío posterior lo
  volvía a aturdir al instante; ahora queda al 35 %, como al acabar el aturdido.

**Pruebas** (`tests/duel3.mjs`, etapa 4): 3/3 — cámara lenta medida (133 ms reales, 40 ms de juego), sonidos
riposte1-2-3 y deathblow, y el entrenamiento (7 cadenas iguales; ✓, TARDE, PRONTO, ✓).

## Etapa 5 — Pruebas y publicación
**Bot con reacción humana** (`tests/duel3.mjs`, etapa 5): desvía los golpes de la IA real (cadena «dos», 90 duelos)
reaccionando a la suelta con 250 ms ± 40 ms; tras cada PERFECTO lanza el riposte: 1.ª pulsación a su reacción al
desvío, 2.ª a su reacción al impacto del 1.º y la 3.ª…
- **con buen ritmo** (el momento ideal ± 40 ms de error humano): riposte completo en **18 de 18** parries
  perfectos (100 %, se pedía ≥ 60 %);
- **al azar** (en cualquier momento de los 0,6 s siguientes): el 3.er golpe entra en **4 de 16** (25 %) y el resto
  lo desvía él.

**Ramas, intercambio, choque y deathblow**: las cuatro ramas de cadena con el bot y su justicia (etapa 3),
el intercambio de desvíos y el choque (etapa 2), y el deathblow con la IA en las **8 direcciones** (cada una con
su fila de la hoja; `review/duel3/E5_deathblow_8dir.png`, capturado en el impacto, con su destello).

**Batería completa** (todas sin errores JS):

| prueba | resultado |
|---|---|
| `duel3.mjs` (etapas 1-5) | 22/22 |
| `parry2.mjs` (duelo de timing, etapas 1-6) | 50/50 |
| `parry2_ui.mjs` (escritorio y móvil) | 10/10 |
| `enemy.mjs` (autómata) | 21/21 |
| `combat.mjs` con el eco (`#enemy=echo`) | 31/31 |
| `stage5.mjs` (mundo, `#enemy=none`) | 13/13 |
| `e2e.mjs` (mundo, `#enemy=none`, escritorio e iPhone) | 30-31/33 |

`e2e.mjs`: en esta máquina fallan 2-3 comprobaciones de iPhone en tiempo real (rodear la columna del titán, subir
a su mano, suavidad en escalones). **No es una regresión**: la versión de antes de este trabajo, compilada y probada
en la misma máquina, falla esas mismas y una más (29/33); son pruebas de navegación a tiempo real sensibles a la
carga del contenedor (stage5 tarda ahora ~25 min con las dos versiones). El escritorio pasa entero.

**Publicado** en el mismo enlace (versión 8): https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG

**Revisión** en `review/duel3/`: E0 (hojas antes/después, tamaño, emisión, lista de problemas), E1-E4 (capturas de
cada etapa), `E5_duelo.gif` (duelo con la IA: perfectos con cámara lenta, riposte de 3 con el anillo del ritmo,
deathblow; te desvía → counter → clin-clin ×3 → se le rompe la postura → remate; choque), `E5_*.png` y
`E5_results.json`. El GIF se graba con `tests/record_duel3.mjs`.

---

# Salto contextual (`terrain.js`, `nav.js`, `player.js`, `controls.js`, `character.js`, `interact.js`)

Solo este cambio; el eco, el autómata, el duelo y el resto de sistemas siguen igual.

**Medida de la cabeza.** En los sprites del personaje (vistas de frente, a resolución completa) la cabeza, del
casco al borde inferior del visor, mide **~59 px** (57-60 según la vista) de **206 px** de alto de pie. Con
`CHAR_H = 1,7 u` eso es **1 cabeza ≈ 0,49 u** del mundo → **2 cabezas ≈ 0,98 u** (`W.HEAD_H`, `W.JUMP_MAX` en
`terrain.js`). Los desniveles del mapa van de 0,5 en 0,5 u (vecinos: 0,5 u ×3271, 1 u ×644, 1,5 u ×348, 2 u ×153,
más ×248), así que en la práctica:

| desnivel entre baldosas vecinas | cabezas | qué pasa |
|---|---|---|
| ≤ 0,5 u (escalón) | ≤ 1 | se camina, como antes |
| 1 u | 2,04 (se admite un 3 % de margen sobre la medida) | **se salta** (subir y bajar) |
| ≥ 1,5 u | ≥ 3 | infranqueable: se rodea o, si no hay camino, **marcador rojo** |

**Cambios:**
1. **Fuera el salto por doble toque** (`controls.js`): dos toques seguidos son dos órdenes de ir a ese punto.
2. **El botón SALTAR y la tecla L se quedan** (para esquivar el barrido bajo del autómata), sin cambios.
3. **A\* con aristas de salto** (`nav.js`, `opts.jump`, solo para el jugador): entre celdas vecinas ortogonales
   libres con desnivel entre un escalón (0,5 u) y 2 cabezas, con un coste extra de 2,2 celdas (`W.JUMP_COST`): si
   hay un rodeo andando corto lo prefiere; solo salta cuando hace falta o compensa. El punto de aterrizaje sale
   marcado en el camino (`{jump: true, dh}`) y el anterior es el despegue (el suavizado lo conserva porque la línea
   recta cruza el borde). Al llegar al despegue (a 0,12 u) el jugador lanza `terrainJump`.
4. **Zona inalcanzable** (más de 2 cabezas y sin camino): no se mueve y sale el **marcador rojo** (elipse con
   cruz, late dos veces y se apaga en 1 s). Se dibuja encima de la imagen, fuera del post-proceso de paleta: el aro
   3D rojo salía naranja, igual que el normal.
5. **Animación** (`player.js`, `character.js`): hoja `jump` completa (preparación → despegue → vuelo → aterrizaje),
   pies anclados en la preparación (0,11 s) y en el aterrizaje (0,16 s) — 0 mm de deslizamiento medido —, arco
   suave hasta el borde de destino (vuelo 0,4 s + 0,12 s por unidad de desnivel; sube con ease-out y baja con
   ease-in), polvo al despegar y más polvo al aterrizar (más cuanto más alta la caída) con su golpe sordo, y la
   sombra que se queda en el suelo y se encoge (hasta 0,36 de su tamaño) mientras el cuerpo está en el aire.
6. **El autómata (y el eco) no saltan**: su A\* es el de siempre (sin `opts.jump`), así que ante un desnivel que no
   puede salvar te persigue rodeando por el camino andando más corto.

**Pruebas** (`tests/salto.mjs`, Playwright, escritorio 1280×800 con ratón y teclado e iPhone 13 con toques reales
por CDP, paso fijo): **15/15, sin errores JS**.
- sube saltando en 3 puntos del mapa y baja saltando en otros 3, tocando la zona de destino;
- animación: fotogramas 0-5 de la hoja, pies quietos al despegar y aterrizar, sombra separada, altura en el aire;
- 2 u (4,1 cabezas) → marcador rojo y no se mueve; en 40 caminos al azar ningún salto supera 1 u (2,04 cabezas);
- botón SALTAR (y L en escritorio) siguen saltando; doble toque → camina al punto, no salta;
- autómata: borde de 1 u entre él y tú (a 2 u en línea recta) → rodea 11,2 u sin pisar desniveles de más de
  0,5 u y te alcanza, sin saltar.
`tests/e2e.mjs`: la comprobación del doble toque ahora espera que **no** salte. Regresión: `e2e.mjs`
(escritorio e iPhone) **33/33**, `enemy.mjs` (autómata, incluido esquivar el barrido saltando) **21/21**.

**Publicado** en el mismo enlace: https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG

**Revisión** en `review/salto/`: `salto.gif` (`tests/record_salto.mjs`: sube un borde de 1 u, vuelve a bajar,
baja otro, toca una zona de 2 u → marcador rojo, y el autómata rodeando el desnivel para alcanzarte), capturas de
escritorio y iPhone (`*_01_subiendo`, `*_02_aterriza`, `*_03_bajando`, `*_04_marcador_rojo`),
`autómata_rodea.png` y `results.json`.
