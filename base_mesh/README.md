# Base mesh femenino (solo modelado)

Cuerpo base femenino para videojuego hecho por poly modeling con scripts de Blender (bpy/bmesh),
siguiendo `reference/base_mesh_sheet.png`. Esta fase es solo modelado: no hay esculpido, rig,
UVs, texturas ni animación.

- 1,70 m de altura (LOD0 1,701 m), 1 unidad = 1 m, pies sobre el origen, mira a −Y, A-pose de la hoja.
- Cabeza de 0,215 m (barbilla → coronilla) = 7,9 cabezas.
- Una sola malla continua, cerrada y simétrica en X. Solo quads.

## Entregables

| Archivo | Contenido |
|---|---|
| `export/base_mesh.blend` | Objeto `BaseMesh` con el Mirror aplicado y **Subdivision Surface nivel 1 sin aplicar** (sombreado suave, material gris). |
| `export/base_mesh_LOD1.fbx` / `.glb` | Jaula (LOD1). |
| `export/base_mesh_LOD0.fbx` / `.glb` | Subdivision nivel 1 aplicada (LOD0). |
| `export/base_mesh_stats.json` | Conteos y validación de los dos LOD, lista de polos con su distancia a las articulaciones. |
| `renders/final_*.png/.jpg` | Comparativa final con la hoja (lado a lado, superposición al 50 %, siluetas), arcilla y wireframe front/side/back. |
| `renders/deform_test.png`, `renders/stage5/deform_test_*` | Test temporal de deformación (codos y rodillas a 90°). |
| `renders/stageN/` | Todas las iteraciones de cada etapa (comparativas + JSON de validación). |
| `web/visor_base_mesh.html` | Visor web con LOD0/LOD1, arcilla / arcilla + wire / solo wire, cámaras front/side/back/3-4 y regla de 8 cabezas. Necesita `web/base_mesh_LOD0.json` y `_LOD1.json` al lado. |
| `PROGRESS.md` | Registro de todas las iteraciones y diferencias encontradas. |

FBX: ejes −Z adelante / Y arriba con `bake_space_transform`, así el objeto entra en Unity sin
rotación y con escala 1. El FBX conserva los quads (Unity triangula al importar); el GLB está
triangulado por el formato.

## Conteo de polígonos

| | Quads | Triángulos (triangulado) | Vértices |
|---|---:|---:|---:|
| LOD1 (jaula) | 2 636 | 5 272 | 2 638 |
| LOD0 (Subdivision 1) | 10 544 | 21 088 | 10 546 |

Objetivo pedido: jaula de 2 500–3 500 quads y LOD0 de ~20k–28k triángulos. Por bloques (malla
completa): torso y pelvis 590 quads, piernas y pies 1 124, brazos y manos 682, cuello y cabeza 240.

## Validación final (bmesh, `scripts/validate.py`)

| Comprobación | LOD1 | LOD0 |
|---|---:|---:|
| N-gons | 0 | 0 |
| Triángulos | 0 | 0 |
| Polos de más de 5 aristas | 0 | 0 |
| Aristas no manifold (borde o >2 caras) | 0 | 0 |
| Normales invertidas | 0 (todas hacia fuera, volumen positivo) | 0 |
| Vértices duplicados | 0 | 0 |
| Caras duplicadas / internas / degeneradas | 0 / 0 / 0 | 0 / 0 / 0 |
| Auto-intersecciones (BVH) | 0 | 0 |
| Error de simetría | 0 | 3,6e-7 m |
| Polos dentro de una zona de pliegue (hombro, codo, muñeca, cadera, rodilla, tobillo) | 0 | — |

Polos justificados (malla completa; 72 de 3 aristas y 64 de 5, detalle en `PROGRESS.md`):
ingle y pliegue del glúteo (reducción 20→16 de la pierna), pliegues delantero y trasero de la
axila, base del cuello (reducción 32→16) y clavícula/trapecio, dorso y palma de la mano
(reducción 16→12), base del pulgar, membranas entre dedos, puntas de los dedos, esquinas del
agujero del tobillo sobre el empeine, esquinas de talón y puntera, oreja y coronilla.

Loops de deformación: 3 en rodilla, codo, tobillo, muñeca (2 del antebrazo + anillo de la
palma) y cintura; el hombro sale de un agujero 3×3 del torso con el anillo A0, el arranque del
deltoides y dos anillos más antes del bíceps; la cadera tiene R0 + L1 + 2 anillos del muslo por
encima de la entrepierna. Anillos alrededor del cuello, la cintura y el pecho.

## Test de deformación (temporal)

`scripts/deform_test.py` crea un esqueleto simple, lo emparenta con pesos automáticos, dobla
codos y rodillas 90°, abduce los hombros 30° (+20° de flexión) y flexiona las caderas 35°,
renderiza y borra el esqueleto (el script comprueba que no queda ningún Armature ni grupos de
vértices; no guarda el .blend). Codo y rodilla conservan el volumen y los loops se reparten
por el pliegue sin pellizcos (`renders/stage5/deform_test_elbow_wire.png`, `_knee_wire.png`).

## Cómo regenerarlo

Requisitos: Blender 4.x (probado con 4.0.2) y, para las comparativas, Python 3 con numpy,
Pillow y scipy.

```sh
python3 scripts/crop_reference.py                 # recortes y siluetas de la hoja
sh scripts/iter.sh 5 prueba 0 1.75                 # construir + validar + renders + comparativa
xvfb-run -a blender -b -P scripts/export.py        # .blend, FBX/GLB LOD0/LOD1, JSON del visor
xvfb-run -a blender -b -P scripts/deform_test.py   # test de deformación temporal
```

Las proporciones están como variables al principio de `scripts/params.py` (altura, hombros,
cintura, cadera, muslo, pecho, glúteo, brazo, pierna); el resto de medidas están en las tablas
de anillos de `scripts/body.py`. La topología no cambia al modificar las medidas.

### Scripts

| Script | Función |
|---|---|
| `params.py` | Variables de proporción. |
| `topo.py` | Herramientas de poly modeling sobre la media malla: anillos (edge loops), Bridge Edge Loops, reducción de anillos solo con quads, Grid Fill, extrusión de caras. |
| `body.py` | Los bloques: torso y pelvis, piernas y pies, brazos y manos, cuello y cabeza. |
| `build.py` | Crea el objeto (Mirror X con clipping + Subdivision 1), valida y renderiza una etapa. |
| `render.py` | Cámaras ortográficas con el encuadre de la hoja, arcilla, wireframe y máscara. |
| `validate.py` | Validación bmesh. |
| `compare.py`, `fit_leg.py` | Comparativas con la hoja y ajuste de la pierna a la silueta. |
| `closeup.py` | Primeros planos con wireframe (mano, cabeza). |
| `export.py`, `deform_test.py` | Entregables y test de deformación. |
