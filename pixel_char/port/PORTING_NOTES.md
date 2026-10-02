# Notas de portado a Unity (C#)

Objetivo: reimplementar las MECÁNICAS (no los gráficos) con el mismo comportamiento medible. La especificación es
`MECHANICS_SPEC.md`; los números, `data/*.json`; el comportamiento esperado, `TESTS.md`; el código de referencia, `code/`.

## 1. Principio: simulación determinista separada de Unity

El juego actual es determinista a paso fijo (`W.tick(1/60)`), y casi todas las pruebas dependen de eso. Recomendación:

- Una clase **`Simulation`** (C# puro, sin `MonoBehaviour`) con `Step(float dt)` que hace exactamente el orden del §1.1 de
  la especificación. Un único `MonoBehaviour` (`SimulationRunner`) la llama desde `Update` con
  `dt = Mathf.Min(0.05f, Time.unscaledDeltaTime)` (o con un acumulador a 1/60 si se prefiere paso fijo también en juego).
- **Dos relojes**: `GameTime t` y `CombatClock ct` (se congela en el hitstop, va al 30 % en la cámara lenta). No usar
  `Time.timeScale` para el hitstop: congelaría también cámara y partículas, y el código actual NO lo hace.
- **Semillas**: el autómata (4242), el relleno (777) y el eco (12345) usan su propio generador `s = s·16807 mod (2³¹−1)`.
  Usar `System.Random` con semilla fija por IA (o portar el LCG) para que las pruebas sean reproducibles.
- **Registro de eventos** `CombatLog` (lista de structs `{ev, who, from, anim, level, early, ...}`): la IA lo escucha
  (`onResult` decide las ramas de la cadena) y las pruebas lo leen. Portarlo tal cual.

## 2. Mapa de sistemas → C#

| Sistema (JS) | C# recomendado |
|---|---|
| `W.COMBAT`, `W.MOVES`, `W.DUEL`, `W.GROUP`, `W.AUTOMATON`, `W.FODDER`, `PLAYER_ATTACKS`, `LEVEL`, `STOP` | **ScriptableObjects** (`CombatConfig`, `MovesConfig`, `DuelConfig`, `GroupConfig`, `AutomatonConfig`, `FodderConfig`, `AttackTable`) cargados desde `data/*.json` (un importador de editor que lea el JSON y rellene el asset) |
| Hojas de animación (`ms`, `activo`, `cancel`, `carga`, `invulnerable`, `loop_frames`, `reaccion`) | ScriptableObject **`ActionTimeline`** por acción (6 «frames lógicos» con su duración y banderas), independiente del `AnimationClip`. La animación nueva se sincroniza con el timeline (eventos de animación o normalizar la velocidad del clip a la duración total), nunca al revés |
| `Player` (cuerpo) | `Body` (C# puro): posición, rumbo, velocidad, camino, salto. Colisión con la rejilla propia (no `CharacterController`) para que `canStep`/Δh ≤ 0.5 sea idéntico. En la vista, un `Transform` que sigue al `Body` |
| `terrain.js` (consultas) + `nav.js` | `NavGrid` (160×160 celdas de 0.5 u, alturas, bloqueos, coste junto a paredes) + `AStar` propio (no NavMesh: las aristas de salto con Δh 0.5-1.0 u y el coste +2.2 no encajan bien en NavMesh; con NavMesh habría que usar `OffMeshLink`s y se perdería la equivalencia) |
| `Fighter` (fighter.js) | `Fighter` (C# puro) con `Act` (clase o struct con `Name`, `T`, `Tt`, `Frame`, `Speed`, `Slow`, `PrepK`, `RecK`, `Plan`, `Charging`, `ImpactT`…). La **máquina de estados** es «una acción en curso o ninguna» + `Can(type)` + búfer: mejor portarla así que con un `Animator`/state machine visual. Si se quiere un patrón, `IActionState` por tipo (Attack, Parry, Block, Dodge, Hit, Stun, Deflected, Death) con `Enter/Tick/CanCancelInto` |
| `combat.js` (resolución) | `CombatResolver` estático: `Resolve(attacker, act)` → recorre objetivos, `Defense()`, aplica el resultado y emite eventos (`OnParry`, `OnBlock`, `OnHit`, `OnGuardBreak`, `OnStun`…) que la capa visual convierte en VFX/SFX/hitstop de cámara |
| `moves.js`, `duel.js`, `target.js`, `group.js` | `ComboSystem`, `DuelSystem` (riposte, deflect, deathblow, clash), `TargetLock`, `GroupDirector` (turnos, corro, pinza, multi-parry) |
| IA (`automaton.js`, `echo.js`, `fodder.js`) | `AutomatonBrain`, `EchoBrain`, `FodderBrain` (C# puro) con `Tick(dt)`; el modelo de trigramas y la familiaridad en clases propias (`PlayerModel`, `ComboFamiliarity`) para poder probarlas aisladas |
| Ganchos opcionales `if (W.xxx) W.xxx(...)` | interfaces o eventos C# (`ICombatHooks`, `event Action<...>`). El orden de llamada importa: ver «trampas» abajo |
| `controls.js` | **Input System**: acciones `Tap`, `Hold` (≥ 170 ms → seguir), `Swipe` (> 42 px en < 260 ms → esquiva), `Attack` (press/release con duración), `Guard` (press/release), `Jump`, `Move` (WASD), `NextTarget`. Pasar **el tiempo del evento** (`context.time`) a `PressTime`, igual que `event.timeStamp` |
| `calib.js` | `LatencyCalibration` (PlayerPrefs para guardar el valor) |

## 3. Qué depende de three.js / del navegador y cómo sustituirlo

| En el código actual | Sustituto en Unity |
|---|---|
| `performance.now()`, `event.timeStamp`, `requestAnimationFrame` | `Time.realtimeSinceStartupAsDouble`, `InputAction.CallbackContext.time`, el `Update` del runner |
| `W.toScreen`, `W.pick` (proyección de la cámara ortográfica isométrica) | `Camera.WorldToScreenPoint`, `Physics.Raycast`/plano del suelo para tocar el suelo; para tocar enemigos, el rectángulo del sprite en pantalla (§4) o un collider |
| Cámara ortográfica isométrica 2:1 (elevación `atan(0.5)`, azimut 45°, giros de 90°) | Cámara ortográfica con la misma elevación; la dirección del sprite (8 sectores) se calcula respecto al azimut de la cámara (§2.7). Si el arte nuevo es 3D, la «dirección del sprite» y su histéresis desaparecen: basta con el rumbo |
| `THREE.Vector3`, `Mesh`, `Sprite`, `ShaderMaterial`, luces, partículas (`W.fx`), sonido (`W.sfx`) | Vista: VFX Graph/partículas, AudioSource; se disparan con los eventos del `CombatLog` |
| DOM (barras, botones, panel ⚙, textos «¡PARRY!») | UI Toolkit/uGUI escuchando el estado y los eventos |
| `localStorage` (calibración, modo del anillo) | `PlayerPrefs` |
| Pies anclados (deformación de la pierna) | Root motion de las animaciones nuevas, o IK de pies; mantener la velocidad de marcha en ~0.8–1.25 u/s (§2.6) |
| `W.skipRender` / `W.manual` (pruebas) | la `Simulation` se puede pasar sin vista en las pruebas de PlayMode/EditMode |

Escala: 1 u = 1 metro de Unity es lo más cómodo (personaje 1.7 m). Ejes: el juego usa `(x, z)` en el suelo y `y` arriba,
igual que Unity; el rumbo es `atan2(dz, dx)` (0 = +X): en Unity `Quaternion.Euler(0, 90 − rumbo·Mathf.Rad2Deg, 0)`.

## 4. Orden de portado recomendado (cada paso con sus pruebas)

1. **Reloj y bucle**: `Simulation`, `CombatClock` (hitstop, slowmo), `PressTime` con calibración. Pruebas: parry2 «a 20 fps…»,
   «event.timeStamp…», «calibración +40 ms…», timing_rt.
2. **Rejilla, A\*, cuerpo** (sin combate): `NavGrid`, `AStar` (con saltos), `Body` (seguir camino, frenar, colisiones, salto
   contextual). Pruebas: nav_stress (100 % de rutas con camino), salto, collide/stage5 (movimiento).
3. **Controles** básicos: tocar para ir, seguir el dedo, deslizar = esquiva, teclado.
4. **Fighter + timelines + resolución**: acciones, `Can`, búfer, hitbox en arco, daño, hitstop, `Hurt`, esquiva. Con el ECO
   (IA más sencilla) como sparring. Pruebas: combat (31).
5. **Defensa completa**: parry por niveles, spam, parcial, bloqueo/guardia rota, postura (ganancia, recuperación según la vida,
   ruptura), stamina. Pruebas: parry2 etapa 1-2 (niveles, postura).
6. **Ataques del jugador**: L/H, carga, combos, cola, ritmo, finta, toque recuperado. Pruebas: cc_e3, cc_e4, res_auto 5.
7. **Duelo**: deflected, riposte con ritmo, deathblow, choque. Pruebas: duel3 1-7, cc_e5.
8. **Autómata**: estados y persecución → cadenas con plan (carga/retención/suelta) → trucos y ramas → peligrosos → counter e
   intercambio → lectura (trigramas, aperturas) → reacción humana → familiaridad con combos → adaptativa. Pruebas: enemy, parry2
   etapa 3-4, duel3, cc_e6. Las pruebas de JUSTICIA (§15) son las más importantes: no darlo por bueno sin el bot humano.
9. **Objetivo fijado y grupo**: TargetLock, turnos, corro, pinza, multi-parry. Pruebas: cc_e2, cc_e7.
10. **Relleno**: FodderBrain, recompensas, fatiga, anillo y andamio, token, grupos. Pruebas: fodder, fodder_e3, fodder_e4, fodder_bot.
11. **Entrenamiento y calibración** (UI).

## 5. Trampas (cosas sutiles del código actual que cambian el comportamiento)

- **El instante del impacto es sub-frame**: `impactT = ct − (tt − inicio_HF)/velocidad`. Si se mide con el frame, a 20 fps
  hay hasta 50 ms de error y los niveles de parry cambian. Igual con `PressTime` (marca del evento, no frame).
- **Orden en la resolución del parry**: primero se calcula la postura ganada y se aplica; si NO rompe, `duelOnParry` crea la
  ventana de riposte y desequilibra; después se cobra la postura a quien desvía (`noBreak`) y por último se mira
  `counterT` (que casi nunca se abre: ver diferencia #4 del §17). Mantener este orden.
- **Un parry nunca rompe la postura de quien desvía; un bloqueo sí.**
- **El plan sustituye la preparación** de los golpes enemigos: `prepK` del autómata no tiene efecto. El impacto cae
  exactamente en `wind + hold + rel` desde el inicio (escalado por `act.speed`).
- **Golpes pendientes por calibración**: con `calib > 0`, los golpes ENEMIGOS se resuelven `calib` ms después del impacto.
- **La guardia mantenida vuelve sola** tras otra acción (si `guardHeld` y no hay acción → `block`).
- **Spam**: la penalización solo cuenta si la pulsación anterior no desvió nada (si no, varios atacantes la provocarían).
- **Postura del relleno**: los parries no suman postura «normal»; la fatiga la gestiona `fodderOnParry` (+50 / perfecto = muerte).
- **El relleno recibe 10 de daño** por golpe del jugador, sea cual sea el golpe.
- **Turnos**: el autómata y el eco usan `GroupDirector` (máx. 2) solo cuando hay 2+ enemigos persiguiendo; el relleno usa
  su propio TOKEN único (máx. 1). Son independientes.
- **Ramas de la cadena**: se deciden con el PRIMER resultado del 1.er golpe (incluido «whiff» si estabas esquivando).
- **El modelo de lectura se reinicia al reaparecer** el autómata; las muertes seguidas del jugador no.
- **Toque recuperado**: solo si el ligero empieza en el mismo paso en que se suelta (no si venía de la cola o del búfer).

## 6. Lo que no hace falta portar
Pies anclados como deformación, bob/sway del walk, túnica, paleta, contorno, niebla, luces del ojo, sombras, partículas,
textos flotantes, visor de animaciones y la resolución automática (en Unity: `QualitySettings`/`Screen` y escalado dinámico).
