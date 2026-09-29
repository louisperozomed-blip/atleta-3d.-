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
