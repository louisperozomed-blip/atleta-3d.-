# Base mesh femenino

Cuerpo base femenino para videojuego, hecho por poly modeling con scripts de Blender (bpy/bmesh)
a partir de `reference/base_mesh_sheet.png`. Solo quads, con topología de deformación y UVs. No
lleva esculpido, rig, texturas ni animación.

- 1,70 m (LOD0 1,702 m), 1 unidad = 1 m, pies sobre el origen, mirando a −Y, A-pose de la hoja.
- Cabeza de 0,21 m (barbilla → coronilla), unas 8 cabezas de altura.
- Una sola malla continua, cerrada y simétrica en X.
- Iteración 2 (ver `PROGRESS.md`):
  - cara con loops concéntricos en ojos y boca, loop nasolabial y oreja con hélix y lóbulo;
  - deltoides preparado para levantar el brazo y glúteos con pliegue;
  - 3 loops en cada nudillo y pie continuo con la pierna;
  - UVs sin solapes.

## Entregables

| Archivo | Contenido |
|---|---|
| `export/base_mesh.blend` | Objeto `BaseMesh`: Mirror aplicado, **Subdivision Surface nivel 1 sin aplicar**, UVs (`UVMap`) y costuras marcadas. |
| `export/base_mesh_LOD1.fbx` / `.glb` | Jaula (LOD1) con UVs. |
| `export/base_mesh_LOD0.fbx` / `.glb` | Subdivision nivel 1 aplicada (LOD0), con UVs. |
| `export/base_mesh_stats.json` | Conteos, validación de los dos LOD, polos con su distancia a las articulaciones y estadísticas UV. |
| `renders/final_*` | Comparativa final con la hoja (lado a lado, superposición al 50 %, siluetas), arcilla, wireframe y primeros planos de la cara. |
| `renders/final_uv_map_*.png`, `renders/final_uv_checker_renders.jpg` | Mapa UV (islas en color y sobre la cuadrícula) y renders con la textura de cuadrícula. |
| `renders/deform_test.jpg` | Test de deformación temporal: 5 poses con primeros planos. |
| `renders/stageN/`, `renders/it2_*/` | Todas las iteraciones (comparativas, primeros planos y JSON de validación). |
| `web/visor_base_mesh.html` | Visor web: LOD0/LOD1; arcilla, arcilla + wire, solo wire o UV (cuadrícula + mapa de islas); cámaras front/side/back/3-4; regla de 8 cabezas. Necesita `web/base_mesh_LOD0.json` y `_LOD1.json` al lado. |
| `PROGRESS.md` | Registro de cada iteración con las diferencias encontradas y cómo se corrigieron. |

Ejes del FBX: −Z adelante / Y arriba con `bake_space_transform`, así el objeto entra en Unity sin
rotación y con escala 1. El FBX conserva los quads (Unity triangula al importar); el GLB está
triangulado por el formato.

## Conteo de polígonos

| | Quads | Triángulos (triangulado) | Vértices |
|---|---:|---:|---:|
| LOD1 (jaula) | 3 390 | 6 780 | 3 392 |
| LOD0 (Subdivision 1) | 13 560 | 27 120 | 13 562 |

Objetivo: jaula de 2 500 a 3 500 quads y LOD0 de unos 20 000 a 28 000 triángulos.

## Validación final (bmesh, `scripts/validate.py`)

| Comprobación | LOD1 | LOD0 |
|---|---:|---:|
| N-gons / triángulos | 0 / 0 | 0 / 0 |
| Polos de más de 5 aristas | 0 | 0 |
| Aristas no manifold (borde o >2 caras) | 0 | 0 |
| Normales invertidas | 0 (volumen positivo) | 0 |
| Vértices duplicados | 0 | 0 |
| Caras duplicadas / internas / degeneradas | 0 / 0 / 0 | 0 / 0 / 0 |
| Auto-intersecciones (BVH) | 0 | 0 |
| Error de simetría | 0 | 3,6e-7 m |
| Polos dentro de una zona de pliegue (hombro, codo, muñeca, cadera, rodilla, tobillo) | 0 | — |

**UVs** (`scripts/uv.py`):
- 32 islas, **0 píxeles solapados** (mapa rasterizado a 2048²), 0 caras fuera de [0,1], 0 caras
  con la UV invertida y 72 % del espacio UV aprovechado.
- Densidad de texel de todas las islas del cuerpo entre 0,944 y 0,968 (relativa a la mediana);
  la **cabeza a 1,53×**.
- Variación dentro de cada isla: 0,06 a 0,17 (pie 0,23, pulgar 0,26).

## Topología

- **Cara**: rejilla de 24 vértices alrededor sobre una superficie paramétrica.
  - Ojos: 3 loops concéntricos (órbita, párpados, borde del ojo).
  - Boca: 3 loops concéntricos.
  - Loop nasolabial alrededor de la nariz y la boca.
  - Relieve de nariz (puente, punta, aletas), labios, barbilla, cuenca del ojo, arco de la ceja y
    pómulo.
  - Oreja con hélix, concha y lóbulo.
  - Perfil de la cabeza dentro de ±4 mm de la vista SIDE.
- **Hombro**: el agujero del brazo queda bajo el acromion (con trapecio por encima) y el deltoides
  es un loft de 4 anillos que sale perpendicular al torso y se alinea con el húmero.
- **Loops de deformación**:
  - 3 en rodilla, codo, tobillo y cintura, y 3 en cada nudillo de los dedos (MCP, PIP, DIP) y
    del pulgar (MCP, IP);
  - anillos alrededor de cuello, pecho, cintura y muñeca;
  - un loop propio alrededor de cada glúteo cuyo tramo inferior es el pliegue del glúteo.
- **Pie**: el tubo de la pierna se dobla 90° (el talón sale de la curva) y solo se tapa la
  puntera.
- **Polos**: 88 de 3 y 80 de 5. Una malla cerrada de quads siempre tiene 8 polos de 3 más que de 5.
  La tabla completa y su justificación están en `PROGRESS.md` (It2 · Etapa 5). Todos están en:
  - las esquinas de los loops de ojos, boca, nasolabial y glúteos;
  - la oreja, la coronilla y la base del cuello;
  - las esquinas del hombro y las ingles;
  - las membranas y las puntas de los dedos, la base del pulgar y la puntera.

## Test de deformación (temporal)

`scripts/deform_test.py` crea un esqueleto simple de 19 huesos con pesos automáticos suavizados,
prueba 5 poses, mide sobre la jaula deformada y **borra el esqueleto** (no guarda nada).

| Pose | Auto-intersecciones | Junto a la articulación | Caras aplastadas |
|---|---:|---:|---:|
| Codos y rodillas 90°, hombros 30°, caderas 35° | 38 | 4 | 6 |
| Brazo levantado 180° | 16 | 8 | 2 |
| Brazo hacia delante 90° | 0 | 0 | 0 |
| Columna 30° + 10° y cuello 25° + cabeza 15° | 0 | 0 | 0 |
| Cadera a 90° (sentada, rodilla a 90°) | 30 | 0 | 12 |

- Las intersecciones de codos y rodillas y de la pose sentada son contacto entre partes: la mano
  contra el pecho, y la pantorrilla contra el muslo con la rodilla a 90°. En la cadera no hay
  ninguna.
- Con el brazo a 180°, el deltoides toca el trapecio. En un rig de producción eso se ajusta con
  pesos pintados o un corrective shape. La axila se estira sin el pliegue en V que tenía la
  topología anterior.
- El esqueleto no tiene huesos de dedos, así que el doblado de los dedos no se prueba.

## Cómo regenerarlo

Requisitos: Blender 4.x (probado con 4.0.2) y, para las comparativas, Python 3 con numpy, Pillow
y scipy.

```sh
python3 scripts/crop_reference.py                          # recortes y siluetas de la hoja
RENDER_DIR=prueba sh scripts/iter.sh 5 t 0 1.75            # construir + validar + renders + comparativa
RENDER_DIR=prueba xvfb-run -a blender -b -P scripts/uv_unwrap.py -- t   # UVs + renders con cuadrícula
xvfb-run -a blender -b -P scripts/export.py                # .blend, FBX/GLB LOD0/LOD1, JSON del visor
RENDER_DIR=prueba xvfb-run -a blender -b -P scripts/deform_test.py -- t # test de deformación
```

Las proporciones están como variables al principio de `scripts/params.py`. El resto de medidas
está en las tablas de anillos de `scripts/body.py` (cuerpo) y `scripts/head.py` (cabeza). La
topología no cambia al modificar las medidas.

### Scripts

| Script | Función |
|---|---|
| `params.py` | Variables de proporción. |
| `topo.py` | Herramientas de poly modeling sobre la media malla: anillos, Bridge Edge Loops, reducción de anillos solo con quads, Grid Fill, Inset de regiones (respetando el eje de simetría), extrusión, etiquetas de isla y costuras. |
| `body.py` | Torso, glúteos, piernas y pies, brazos (deltoides por loft), manos y dedos. |
| `head.py` | Cuello y cabeza: superficie paramétrica, loops de ojos, boca y nasolabial, relieve facial y oreja. |
| `build.py` | Crea el objeto (Mirror X con clipping + Subdivision 1), islas UV y costuras; valida y renderiza. |
| `render.py` | Cámaras ortográficas con el encuadre de la hoja, arcilla, wireframe y máscara. |
| `validate.py` | Validación bmesh (incluye auto-intersecciones y polos por articulación). |
| `uv.py`, `uv_unwrap.py`, `uv_layout.py` | Desenvolver, medir y dibujar las UVs; renders con cuadrícula. |
| `compare.py`, `head_profile.py`, `fit_leg.py` | Comparativas con la hoja. |
| `closeup.py`, `face_views.sh`, `hand_views.sh`, `glute_views.sh`, `foot_views.sh` | Primeros planos junto a la hoja. |
| `deform_test.py`, `deform_montage.py` | Test de deformación temporal y su montaje. |
| `export.py` | Entregables. |
