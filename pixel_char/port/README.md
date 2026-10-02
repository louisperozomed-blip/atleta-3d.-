# Paquete de traspaso: mecánicas del Bosque del autómata → Unity (C#)

Todo lo necesario para reimplementar la LÓGICA del juego en Unity sin verlo funcionar. Los gráficos no se portan.

| Archivo | Qué es |
|---|---|
| `MECHANICS_SPEC.md` | Especificación completa de cada sistema: constantes, fórmulas, tiempos, reglas, pseudocódigo, datos de animación y las diferencias encontradas entre la documentación antigua y el código (§17) |
| `MECHANICS_SPEC.pdf` | La misma especificación en PDF, para leer |
| `data/*.json` | Tablas de datos exportadas del juego en marcha (constantes de combate, golpes, combos, duelo, grupo, objetivo, movimiento, navegación, controles, calibración, IA del autómata, eco y relleno, dificultad) |
| `data/animations/*.json` | Fases por frame de cada animación (ms, inicio, fase, frame de impacto, cancelaciones, carga, invulnerabilidad) |
| `code/` | Copia del código de lógica (sin render ni shaders) + `code/INDEX.md` (qué hace cada archivo y de qué depende) |
| `TESTS.md` | Pruebas automáticas actuales como criterios de aceptación |
| `PORTING_NOTES.md` | Cómo mapear cada sistema a C#, qué sustituir de three.js/navegador, orden de portado y trampas |
| `tools/export_port_data.mjs` | Regenera `data/` desde el juego en marcha. Necesita el Playwright de `world/tests`: `cp port/tools/export_port_data.mjs world/tests/ && cd world/tests && source env.sh && node export_port_data.mjs ../dist/index.html ../../port/data` |
| `tools/make_code_copy.py` | Regenera `code/` desde `world/src` |
| `tools/md2pdf.py` | Regenera el PDF (`pip install markdown`; usa el Playwright de `world/tests`) |

Orden de lectura sugerido: README → MECHANICS_SPEC §0-§1 → PORTING_NOTES → el resto de la especificación según se porte
cada sistema, con su sección de TESTS.md al lado.
