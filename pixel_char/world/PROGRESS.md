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
