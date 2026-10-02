# code/ — código de lógica (copia para el portado)

Copias de `pixel_char/world/src/` SOLO con lógica: se han quitado shaders, mallas, luces, HUD del DOM y partículas de
estilo (cada hueco lleva un comentario `[VISUAL OMITIDO: …]` y, si hacía falta, un stub). Las llamadas sueltas a efectos
(`W.fx.*`, `W.sfx.*`, `W.combatStar`, `W.shakeCam`, `W.combatPop`, `flashLight`) se han dejado porque marcan **dónde**
ocurre cada evento: en Unity serán eventos de VFX/SFX/UI. Se regeneran con `python3 port/tools/make_code_copy.py`
(comprueba que todos los archivos siguen siendo JavaScript válido).

Todo cuelga de un espacio de nombres global `W` (`window.W`). Los «enganches» entre sistemas son funciones opcionales
de `W` (`if (W.duelResolve) …`): así cada módulo puede faltar sin romper el resto. En C# conviene sustituirlos por
interfaces o eventos (ver PORTING_NOTES.md).

| Archivo | Qué hace | Depende de | Lo usan |
|---|---|---|---|
| `main_loop.js` (extracto de main.js) | Bucle: paso real con `dt ≤ 50 ms` o paso fijo (`W.tick`); **orden de actualización** de cada paso | todo | — |
| `terrain_queries.js` (extracto de terrain.js) | Altura y tipo de baldosa, rejilla de navegación 160×160 (0.5 u), obstáculos circulares, `cellFree`, `canStep` (Δh ≤ 0.5) | el mapa generado `W.T` | nav, player, IA |
| `nav.js` | A* de 8 vecinos con coste junto a paredes, aristas de SALTO (jugador), celda libre más cercana, suavizado por línea de visión | terrain | controls, player (re-planificar), IA |
| `player.js` | Cuerpo que se mueve: seguir camino, aceleración/frenado, giro, colisiones deslizando, atascos y re-planificación, salto en el sitio y salto por el terreno, altura sobre escalones | terrain, nav, feet (velocidad) | jugador y TODOS los enemigos (cada uno tiene su `Player` como cuerpo) |
| `feet_locoParams.js` (extracto de feet.js) | Velocidad de la marcha a partir de los pies dibujados (cadencia fija) | datos de pies (assets/feet.json) | player.walkV |
| `character_logic.js` (extracto de character.js) | Elección de animación de locomoción (histéresis de velocidad) y **dirección del sprite** (8 sectores, histéresis 30.5°, paso por intermedias cada 40/25 ms, giro instantáneo con objetivo) | player, fighter.act | presentación |
| `controls.js` | Toque/ratón/teclado → órdenes: ir, seguir al dedo, deslizar = esquiva, seleccionar/atacar enemigo, pulsación de ataque L/H (`attackPress/attackRelease`), guardia con marca de tiempo, salto, Tab | nav, player, fighter, target | — |
| `fighter.js` | **Máquina de estados de combate** (jugador y enemigos): reloj de combate `ct`, `pressTime` (marca del evento + calibración), búfer, `can()` (cancelaciones), acciones y su avance por frames, impacto exacto, plan de los golpes enemigos, carga del fuerte, finta, defensa (`defense`: perfecto/normal/parcial/bloqueo), postura y stamina, `hurt` (respingo, hyper armor, guardia rota), estocada/esquiva/retroceso | combat (hooks), moves, duel, target | todos los luchadores |
| `combat.js` | **Resolución de golpes**: hitbox en arco en el frame de impacto, defensa del objetivo, parry por niveles, bloqueo y guardia rota, golpe limpio y remate, peligrosos (salto/mikiri/de lado), hitstop y cámara lenta (`combatStep`), postura del parry con racha, registro de eventos (`W.combatLog`) que usan la IA y las pruebas, `findSpot` | fighter, duel, group, fodder | fighter (onCombatFrame) |
| `moves.js` | Ataques del jugador L/H: tabla de combos `STEPS`, encadenado, cola de 2, ritmo (pulso ±50 ms → ×1.2), costes de stamina, nivel 2 de la carga | fighter | controls, fighter, autómata (familiaridad) |
| `duel.js` | Recompensa del parry: DESEQUILIBRADO, RIPOSTE de hasta 3 con ritmo del 3.º, DEATHBLOW, sustitutos de hoja, intercambio de desvíos (enlace con la IA), CHOQUE | fighter, combat | combat, fighter |
| `target.js` | Fijar objetivo: seleccionar, Tab, perder por distancia/visión/muerte, girarse al instante, sesgo de cámara | combat (fighters), terrain (visión) | controls, fighter |
| `group.js` | Turnos (máx. 2 atacando), corro a 3.6 u, PINZA sincronizada, MULTI-PARRY (DOBLE/TRIPLE PERFECTO) | IA del autómata, duel | IA (autómata, eco) |
| `calib.js` | Calibración de latencia: mediana del desfase de los toques; `W.COMBAT.calib` | fighter | — |
| `practice.js` | Modo entrenamiento (cadena forzada, sin lectura, nadie muere) y textos de timing | IA del autómata, combat | — |
| `enemies/core.js` | Registro de tipos de enemigo, aparición, paso de cada enemigo (IA → luchador → cuerpo), reaparición, ganchos `onFrame`/`onAct` | — | todos los enemigos |
| `enemies/automaton/automaton.js` | **IA del Autómata**: estados, cadenas y plan del golpe (carga/retención/suelta), trucos, ramas, peligrosos, counter e intercambio, lectura por trigramas, aperturas, familiaridad con combos, reacción humana, esquiva, dificultad adaptativa, pinza | fighter, combat, group, moves, nav | — |
| `enemies/echo/echo.js` | IA del Eco (enemigo de prueba): persigue y ataca con attack1/2/3 del jugador | fighter, nav, group | — |
| `enemies/fodder/fodder.js` | **Relleno** (zombi y perro): IA sin trucos, golpe con windup fijo, recompensas del parry (rematado / aturdido / agotado), fatiga, anillo de timing y andamio, TOKEN único, corro, grupos del mundo, grupo de práctica | fighter, combat, nav | — |

No se han copiado (son solo presentación): `look.js`, `effects.js`, `modules.js`, `props.js`, `zones.js`, `interact.js`,
`audio.js`, `walk.js`, `feel.js`, `animviewer.js`, el resto de `character.js`, `feet.js` y `main.js` (render, cámara, post).
La generación del mapa (`terrain.js` → `generateTerrain`) es contenido: en Unity el mapa se construye de nuevo; lo que
importa son las reglas de la rejilla (alturas en pasos de 0.5 u, celdas de 0.5 u, agua/borde bloquean).
