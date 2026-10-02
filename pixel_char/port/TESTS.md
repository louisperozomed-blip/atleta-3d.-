# Pruebas automáticas actuales = criterios de aceptación para Unity

Todas están en `pixel_char/world/tests/` (Playwright + Chromium con WebGL por SwiftShader; `source tests/env.sh`). Salvo
que se diga otra cosa, son **deterministas a paso fijo**: `W.manual = true` y `W.tick(1/60)` (60 pasos por segundo),
a menudo sin pintar (`W.skipRender`). Muchas colocan a los luchadores a mano, apagan la IA (`ai.enabled = false`) y
lanzan un golpe concreto (`f.ai.attack("attack1")` / `f.ai.strike(rumbo)`); el «jugador» pulsa `guardDown` cuando
`enemigo.toImpact() ≤ antelación` (o con una marca de tiempo `ts = ahora + (lo que falta − antelación)·1000`).
Los resultados se leen del registro de eventos `W.combatLog` (`parry`, `block`, `hit`, `evade`, `mikiri`, `stun`,
`deathblow`, `riposte`, `chainStart`, `warn`, `release`, `foeRead`, `foeGuard`…).

**Cómo replicarlas en Unity**: NUnit/Unity Test Framework en modo *PlayMode* con `Time.captureDeltaTime = 1/60` (o un
`Simulation.Step(1/60)` propio, mejor: la lógica no debería depender de `Update` de Unity, ver PORTING_NOTES.md), un
`CombatLog` equivalente y helpers `Place(a, b, distancia, ángulo)`, `ForceAttack(enemigo, golpe)`, `PressGuard(antelación)`.
El número de cada batería (p. ej. 31/31) es el resultado actual: todas pasan en la rama.

Leyenda: **[UI]** = comprobación de la interfaz web (adaptar o descartar); **[visual]** = presentación.

## Resumen

| Batería | Comprobaciones | Estado |
|---|---|---|
| `combat.mjs` | 31 | 31/31 |
| `parry2.mjs` | 50 | 50/50 |
| `enemy.mjs` | 21 | 21/21 |
| `duel3.mjs` | 22 | 22/22 |
| `cc_e2.mjs` | 17 | 17/17 |
| `cc_e3.mjs` | 15 | 15/15 |
| `cc_e4.mjs` | 11 | 11/11 |
| `cc_e5.mjs` | 8 | 8/8 |
| `cc_e6.mjs` | 9 | 9/9 |
| `cc_e7.mjs` | 11 | 11/11 |
| `salto.mjs` | 15 | 15/15 |
| `fodder.mjs` | 9 | 9/9 |
| `fodder_e3.mjs` | 11 | 11/11 |
| `fodder_e4.mjs` | 10 | 10/10 |
| `parry2_ui.mjs` | 10 | 10/10 |
| `cc_e1.mjs` | 7 | 7/7 |
| `nav_stress.mjs` | 1 (300 rutas) | 282/282 |
| `timing_rt.mjs` | 1 por modo | OK |
| `res_auto.mjs` | 8 | 8/8 |
| `fodder_bot.mjs` | métricas | OK |
| `stage5.mjs / collide.mjs / stage2_checks.mjs` | movimiento fino | OK (sobre todo visual) |

## `combat.mjs` — 31/31

Combate básico contra el ECO (`#enemy=echo`), IA apagada salvo en la prueba de IA. El eco se coloca a 1.3 u del jugador en cada una de las 8 direcciones (cada 45°) y lanza attack1; el jugador pulsa la guardia o esquiva cuando faltan X ms para el impacto (`toImpact() ≤ X`).

1. combo attack1→2→3 acierta en las 8 direcciones (10+12+22)
2. el sprite mira hacia el golpe en las 8 direcciones
3. parry en ventana (120 ms antes): sin daño y +38 de postura al eco, 8 direcciones
4. guardia demasiado pronto (480 ms antes): recibe el golpe, 8 direcciones
5. parry justo fuera de ventana (270 ms antes): cuenta como bloqueo, 8 direcciones
6. spam de parry: la ventana se encoge (< 200 ms) y el parry falla
7. la penalización se recupera sola: tras 2 s el parry vuelve a salir
8. bloqueo mantenido: bloquea gastando stamina hasta que la guardia se rompe, 8 direcciones
9. esquiva lateral a tiempo (150 ms antes): sale del alcance, sin daño, 8 direcciones
10. esquiva a través del golpe (120 ms antes, dentro del alcance): invulnerable en DASH, 8 direcciones
11. esquiva tarde (10 ms antes, aún sin DASH): recibe el golpe, 8 direcciones
12. cancelación: attack1 → esquiva después del IMPACT
13. sin cancelación antes del IMPACT (el ataque sigue)
14. parry → contraataque en READY
15. fuera de la ventana de encadenado no hay combo (vuelve a attack1)
16. esquiva → ataque en su último frame
17. tres parries llenan la postura del eco: aturdido
18. golpe al eco aturdido = remate (daño ×3, mínimo 40)
19. muerte del eco: death hasta el último frame y botón REAPARECER encendido
20. REAPARECER devuelve al eco a su claro con la vida llena
21. muerte del jugador: death y REAPARECER encendido
22. REAPARECER devuelve la vida al jugador
23. IA: dormido lejos, despierta al acercarse, persigue y ataca con aviso antes de cada golpe
24. teclado: J J J encadena el combo
25. teclado: K tocada = parry, mantenida = bloqueo
26. teclado: Espacio esquiva y L salta
27. teclado: A mueve a la izquierda de la pantalla
28. ratón: clic sobre el eco = ataque que acierta
29. botón GUARDIA: tocar = parry, mantener = bloqueo
30. móvil: deslizar esquiva hacia allí en las 8 direcciones
31. móvil: tocar al eco ataca y los toques seguidos encadenan el combo

## `parry2.mjs` — 50/50

Parry por niveles, postura con tensión, cadenas y trucos del autómata, peligrosos, lectura, reacción humana, entrenamiento. Incluye el bot humano (reacción 250 ± 40 ms, normal truncada a ±3σ): pulsa la guardia a los 250 ms de la SUELTA (destello del ojo).

1. niveles: ≤70 ms = PERFECTO, resto de la ventana (≤200 ms) = NORMAL, fuera de ventana = BLOQUEO, ataque 1 y 2
2. guardia mantenida desde antes = BLOQUEO; tocar demasiado pronto y soltar = golpe
3. la antelación medida coincide con la real (±2 ms): se mide al instante exacto del impacto
4. PERFECTO: mucha postura al enemigo, 0 para ti, sin gasto de stamina
5. NORMAL: postura media al enemigo y un pequeño coste de postura para ti
6. BLOQUEO: nada de postura al enemigo, más coste para ti y gasto de stamina
7. PERFECTO: sonido propio y hitstop más largo que el normal
8. ventana de contraataque tras un PERFECTO (Duelo 3: el riposte, ~0,7 s): el golpe que empiezas en ella sale como riposte y no se puede defender
9. pasada la ventana, el golpe es normal (y el enemigo puede defenderse)
10. spam: pulsar seguido encoge la ventana (penalización que se recupera sola)
11. a 20 fps (pasos de 50 ms) los niveles salen igual: 50 ms → PERFECTO, 180 ms → NORMAL
12. event.timeStamp: la pulsación cuenta desde el evento, no desde que se procesa (60 ms de retraso → 60 ms antes)
13. calibración +40 ms: una pulsación que llega justo después del impacto cuenta como PERFECTO (sin calibrar, golpe)
14. prueba de ritmo: la mediana del desfase de los toques da la calibración
15. panel ⚙: deslizador de latencia y prueba de ritmo **[UI]**
16. un parry NUNCA rompe tu postura aunque la barra esté llena
17. un bloqueo sí puede romperla (POSTURA ROTA)
18. mantener la guardia sin recibir golpes recupera tu postura más deprisa (2.5 s)
19. postura del autómata por parry: 18-28 según el golpe y el nivel
20. bonus creciente por desvíos seguidos en la misma cadena (+3 cada uno); se pierde con una pausa o un bloqueo
21. una cadena de 4 desviada con perfectos le rompe la postura; con normales se queda cerca
22. la recuperación de postura depende de la vida (dañar su vida la frena): con 30 % de vida, < 40 % de la recuperación con vida llena
23. cadenas de 2 a 4 golpes que combinan attack1 y attack2 (y a veces un peligroso)
24. desviar la cadena completa = un parry por golpe («clin-clin-clin»)
25. ritmos distintos: rápido-rápido-lento y lento-pausa-rápido
26. golpe retrasado: retiene la preparación con el ojo FIJO encendido (no parpadea)
27. el retraso castiga a quien pulsa de memoria y no a quien espera la suelta
28. finta: corta la carga sin destello de suelta y el golpe nuevo avisa de nuevo con ≥ 350 ms
29. como mucho un truco (retraso o finta) por cadena y nunca en dos cadenas seguidas
30. BARRIDO bajo: se salta (y en el aire se contraataca con daño extra); guardia y parry no sirven
31. ESTOCADA: esquivar HACIA él = contraataque que le quita mucha postura; de lado solo la evita; parry no sirve
32. AGARRE: se esquiva de lado; hacia atrás, saltando o con parry te atrapa
33. justicia: preparación visible ≥ 350 ms en todos los golpes y la suelta avisa ≥ 360 ms antes
34. avisos más evidentes cuanto más fuerte: zarpazo (1) < barrido (2) < peligrosos (3, ojo ROJO); la suelta avisa antes en los fuertes
35. nunca ataca mientras estás en el suelo o en tu animación de golpe recibido
36. tras cada cadena, ventana de castigo clara (~1 s resoplando: ni ataca ni se defiende)
37. te lee si te repites: el mismo combo con el mismo ritmo → la mayoría de tus golpes defendidos (aperturas bloqueadas, ≥ 30 % desviados)
38. si varías el ritmo, retrasas o fintas, falla: pocos golpes desviados
39. reacción de velocidad humana: 200-260 ms con variación según la dificultad, nunca menos de 200 ms
40. a un golpe más rápido que su reacción (zarpazo, 205 ms) no puede reaccionar: solo lo para si lo ha leído
41. su parry se ve venir: alza la guardia (ojo ámbar) ≥ 150 ms antes de intentarlo
42. si lo engañas (retrasas el golpe que esperaba), su parry falla y queda EXPUESTO: tu golpe entra con más postura
43. tus herramientas: FINTA (guardia durante la preparación cancela tu golpe y gasta stamina) y RETRASO (mantener el ataque)
44. su conocimiento de tus hábitos se reinicia cada vez que reaparece
45. dificultad adaptativa suave: muertes seguidas → pausas más largas; perfectos seguidos → más cortas y más trucos; se ve en el panel
46. modo entrenamiento (panel ⚙): el autómata repite la cadena elegida, sin leerte ni defenderse, y nadie muere (lógica; el panel solo lo activa)
47. indicador tras cada golpe: ms de antelación y nivel (PERFECTO / PARRY), PRONTO o TARDE, y en los peligrosos la respuesta
48. barras de postura de ambos siempre visibles en combate (y ocultas lejos), con la ventana de contraataque bajo la tuya
49. bot humano (reacción 250 ms ± 40 ms): desvía ≥ 75 % de cada tipo de ataque normal (también retrasados y tras finta)
50. bot humano: evita cada ataque peligroso con la respuesta correcta (salto, esquiva hacia él, esquiva de lado) ≥ 75 %

## `enemy.mjs` — 21/21

Autómata del bosque: aparición, persecución, avisos, parry contra él (100 ms antes), sus defensas, postura, remate, muerte y desvanecimiento, cambio al eco.

1. por defecto el Autómata, en 3 zonas (titán, raíces, ruinas), patrullando
2. altura del autómata = 1.4 × la del personaje (de pie, en el mundo)
3. persecución: al ver al jugador se acerca corriendo por A* y ataca
4. cada ataque va precedido de aviso (log + ojo que parpadea > 3× su brillo) y preparación larga (≥ 0.6 s)
5. parry del jugador a 100 ms del impacto: sin daño y +18/+21 de postura, 8 direcciones
6. el autómata mira al jugador al atacar en las 8 direcciones
7. guardia demasiado pronto contra el autómata (550 ms antes): recibe el golpe, 8 direcciones
8. los golpes del jugador alcanzan al autómata desde las 8 direcciones
9. su bloqueo: por reacción (200-260 ms) bloquea los golpes que tardan más que eso (retenidos)
10. su bloqueo no aguanta para siempre: gasta stamina y postura hasta romperse la guardia o quedar aturdido
11. su parry: te desvía lo que te ha leído (el mismo combo repetido) y pierdes postura
12. sus intentos de parry llegan con la repetición (al principio no te conoce)
13. sus ataques desviados le llenan la postura: aturdido tras 5-6 desvíos de golpes sueltos
14. remate al autómata aturdido (daño ×3, mínimo 40)
15. muerte: death hasta el último frame y REAPARECER encendido
16. a los pocos segundos se desvanece con esporas que se levantan
17. REAPARECER lo devuelve a su sitio con toda la vida
18. pisadas pesadas: cada paso del autómata levanta polvo y esporas (y hace temblar la cámara cerca)
19. panel de pruebas: cambiar al eco
20. el eco sigue funcionando igual (su ataque se desvía con parry)
21. y volver al autómata

## `duel3.mjs` — 22/22

Recompensa del parry perfecto (desequilibrio, riposte con ritmo, deathblow), reacciones por peso, counter e intercambio, choque, ramas, rompeguardias, sensación, entrenamiento del riposte y bot de ritmo.

1. hojas nuevas en uso (riposte, deathblow, deflected, counter) y sustitutos configurables (W.DUEL.sheets = "sustituto")
2. parry perfecto → DESEQUILIBRADO ~0,7 s (hoja deflected; sin hoja, frames de hit + rebote por código)
3. riposte: 3 golpes con buen ritmo (hoja riposte), daño, postura, hitstop y sacudida crecientes; desde postura 0 no la rompe (no es un premio automático)
4. 3.er golpe fuera de la ventana de ritmo (pronto, tarde o machacando): se recupera y lo desvía; dentro (±80 ms) entra
5. parry normal: un solo golpe de riposte y ventana más corta (0,32 s frente a 0,7 s)
6. sin hoja: riposte = attack1 ×1,4 con estela naranja, y también encadena 3
7. postura rota durante el riposte → DEATHBLOW directo (hoja deathblow; sin hoja, attack3) con cámara más cerca y destello
8. reacción según el peso: golpe ligero = respingo corto (1-2 frames de hit); pesado = tambaleo con retroceso
9. hyper armor: durante sus golpes pesados aguanta sin interrumpirse (pero recibe el daño); el zarpazo ligero sí se interrumpe
10. lee tu combo completo: repitiendo el ritmo (y fuera de su resoplido), bloquea tus aperturas y desvía el 2.º/3.º (≥ 50 %); variándolo, mucho menos
11. si te hace parry: quedas desequilibrado (tus frames de hit) y lanza su COUNTER (hoja counter; sin hoja, attack1 rápido) con preparación visible ≥ 350 ms
12. intercambio de desvíos (clin-clin): cada counter desviado con un perfecto puede traer otro; pierde quien falla primero (si falla él, queda desequilibrado y te toca el riposte)
13. choque: si los dos golpeáis a la vez (±80 ms) chispas grandes y ambos retrocedéis sin daño; con 150 ms de diferencia, no
14. ramas: desvías el 1.º → el siguiente va RETRASADO; esquivas → te persigue con la ESTOCADA; bloqueas → HEAVY (rompe la guardia); te alcanza → sigue igual
15. justicia: preparación visible ≥ 350 ms en todas las ramas, como mucho un truco por cadena (si ya lleva uno, la rama no añade otro) y ventana de castigo tras cada cadena
16. ROMPEGUARDIAS: carga larga visible (≥ 350 ms, aviso fuerte); si lo bloqueas te rompe la guardia, si lo desvías no
17. parry perfecto: instante de cámara lenta (~120 ms reales al 30 %), sonido metálico agudo y chispas doradas
18. riposte con sonido de corte creciente (1, 2, 3) y deathblow con su golpe grave
19. entrenamiento RIPOSTE (panel ⚙): siempre la misma cadena y tras el 3.er golpe dice si acertaste el ritmo (✓, PRONTO o TARDE y los ms) (lógica; el panel solo lo activa)
20. bot humano (reacción 250 ± 40 ms): con buen ritmo encadena el riposte completo en ≥ 60 % de sus parries perfectos
21. pulsando el 3.er golpe al azar, la mayoría falla (≤ 40 % entra) y siempre peor que con ritmo
22. deathblow en las 8 direcciones: cada una con su fila de la hoja (8 direcciones distintas) y el remate entra

## `cc_e2.mjs` — 17/17

Fijar objetivo (escritorio ratón+teclado, iPhone toques reales).

1. [escritorio] tocar un enemigo lo SELECCIONA (anillo y retícula) y no ataca
2. [escritorio] tocar otro enemigo cambia el objetivo
3. [escritorio] tocar el objetivo ataca y se gira al instante hacia él (rumbo y sprite)
4. [escritorio] al caminar mira hacia donde va; al guardar y al esquivar se gira al instante hacia el objetivo
5. [escritorio] cámara con un ligero sesgo hacia el objetivo **[visual]**
6. [escritorio] Tab cambia de objetivo (el más cercano primero)
7. [escritorio] se suelta al alejarte más de ~9 u
8. [escritorio] se suelta sin línea de visión más de 1,5 s (a 1 s sigue)
9. [escritorio] si el objetivo muere pasa al otro enemigo cercano en combate; si no queda ninguno, se suelta
10. [iphone] tocar un enemigo lo SELECCIONA (anillo y retícula) y no ataca
11. [iphone] tocar otro enemigo cambia el objetivo
12. [iphone] tocar el objetivo ataca y se gira al instante hacia él (rumbo y sprite)
13. [iphone] al caminar mira hacia donde va; al guardar y al esquivar se gira al instante hacia el objetivo
14. [iphone] cámara con un ligero sesgo hacia el objetivo **[visual]**
15. [iphone] se suelta al alejarte más de ~9 u
16. [iphone] se suelta sin línea de visión más de 1,5 s (a 1 s sigue)
17. [iphone] si el objetivo muere pasa al otro enemigo cercano en combate; si no queda ninguno, se suelta

## `cc_e3.mjs` — 15/15

Ligero y fuerte con carga, nivel 2, finta, vulnerabilidad, stamina (escritorio e iPhone; la duración de la pulsación se mide en tiempo de juego).

1. [escritorio] tocar el objetivo = LIGERO (attack1)
2. [escritorio] mantener ≥ 0,4 s = FUERTE: carga (a 0,35 s aún no); soltar lanza el golpe
3. [escritorio] carga de NIVEL 2 a 1,2 s (×1,5 daño, más postura); a 1,8 s se suelta sola
4. [escritorio] guardia durante la carga = finta (cancela, gasta stamina, pasa a guardia)
5. [escritorio] durante la carga eres vulnerable (su golpe la interrumpe)
6. [escritorio] stamina: ligero < fuerte < nivel 2; sin stamina el golpe sale más lento
7. [escritorio] teclado: J tocada = ligero, J mantenida = fuerte con carga
8. [escritorio] tocar el suelo te mueve (no ataca)
9. [iphone] tocar el objetivo = LIGERO (attack1)
10. [iphone] mantener ≥ 0,4 s = FUERTE: carga (a 0,35 s aún no); soltar lanza el golpe
11. [iphone] carga de NIVEL 2 a 1,2 s (×1,5 daño, más postura); a 1,8 s se suelta sola
12. [iphone] guardia durante la carga = finta (cancela, gasta stamina, pasa a guardia)
13. [iphone] durante la carga eres vulnerable (su golpe la interrumpe)
14. [iphone] stamina: ligero < fuerte < nivel 2; sin stamina el golpe sale más lento
15. [iphone] tocar el suelo te mueve (no ataca)

## `cc_e4.mjs` — 11/11

Combos en datos, cola de 2, ritmo; las pulsaciones llevan su marca de tiempo.

1. L·L·L = combo básico (attack1 → attack2 → attack3)
2. L·H = Quiebraguardia (fuerte tras un ligero)
3. L·L·H = Remate giratorio (hoja spin)
4. H·L = Corte de salida (golpe rápido tras un fuerte)
5. H·H = Golpe cargado doble
6. Quiebraguardia: si el enemigo lo bloquea le vacía mucha stamina (≥ 60 % de la suya, el doble que un fuerte)
7. Remate giratorio: golpe en 360° que alcanza a varios y recuperación larga (castigable)
8. Golpe cargado doble: el segundo fuerte da una postura enorme
9. búfer de entrada: tres toques seguidos (los 3 durante el primer golpe) no se pierden: L, LL, LLL
10. ritmo: pulsar en el pulso = EN RITMO (+20 % daño y postura); fuera del pulso el combo sigue sin bonus
11. cada combo en las 8 direcciones: todos los golpes aciertan y cada dirección usa su fila de la hoja (8 distintas)

## `cc_e5.mjs` — 8/8

Parry, riposte y reacciones con los controles L/H y objetivo fijado.

1. parry perfecto: el enemigo queda DEFLECTED y el riposte (con toques) da 3 golpes con el 3.º en ritmo
2. DEFLECTED dura ~0,7 s
3. riposte: el 3.º fuera de ritmo lo desvía el enemigo
4. parry normal: riposte de un solo golpe
5. si la postura se rompe en el riposte: DEATHBLOW
6. reacción por peso: ligero = respingo corto; fuerte = tambaleo con retroceso; su golpe fuerte aguanta (hyper armor)
7. si el enemigo te desvía: quedas desequilibrado y lanza su COUNTER; con un perfecto lo desvías (intercambio)
8. choque: los dos golpeáis a la vez → chispas y retroceso sin daño

## `cc_e6.mjs` — 9/9

El autómata castiga la repetición (familiaridad por combo) y su HEAVY.

1. repetir L·L·L: la familiaridad sube en cada repetición y, alta, desvía el golpe final (bloquea antes)
2. variar el ritmo (3.º 160 ms tarde) engaña al que te ha leído: su parry falla y queda expuesto
3. con L·H muy leído te interrumpe durante la carga; fintar (guardia en la carga) la cancela
4. alta familiaridad con un combo que acaba en fuerte: te interrumpe durante la carga
5. alternar 3 combos con buen ritmo: su familiaridad se queda baja y apenas desvía
6. cuando te ha leído su ojo parpadea en ámbar; solo desvía lo que ha predicho
7. en grupo comparten el 50 % de lo aprendido; al reaparecer se reinicia
8. su HEAVY: preparación más larga (retención ≥ 0,35 s) con aviso evidente (ojo naranja, sonido grave) y rompe la guardia si lo bloqueas
9. cadenas con su HEAVY y la rama «lo bloqueas» → HEAVY para romper la guardia

## `cc_e7.mjs` — 11/11

Grupos y multi-parry (2-3 autómatas, + eco).

1. panel de pruebas: aparecer 3 autómatas alrededor del jugador
2. turnos: con 3 autómatas como mucho 2 atacan a la vez (todos acaban atacando); el resto rodea a ~3,6 u
3. pinza: dos autómatas sincronizados (impactos a ≤ 40 ms) con aviso doble (ojos a la vez y sonido propio)
4. multi-parry: una sola pulsación desvía los dos impactos (≤ 150 ms); todos perfectos = DOBLE PERFECTO (cámara lenta, los dos desequilibrados, bonus de postura)
5. el riposte tras el multi-parry va al objetivo fijado
6. TRIPLE PERFECTO con tres autómatas
7. impactos a 110 ms: la misma pulsación los desvía a los dos, cada uno con su nivel (perfecto y normal)
8. impactos separados (400 ms): un parry por golpe y sin penalización por spam
9. la guardia cubre 360° (golpe por la espalda desviado) y su aviso sale como flecha junto al personaje
10. ataque fuera de pantalla: flecha en el borde de la pantalla
11. 2 autómatas + el eco: también como mucho 2 atacando a la vez

## `salto.mjs` — 15/15

Salto contextual con clics/toques reales (escritorio e iPhone), paso fijo.

1. [escritorio] sube saltando bordes de 2 cabezas (1 u) en varios puntos del mapa, tocando la zona alta
2. [escritorio] baja saltando (más de un escalón y hasta 2 cabezas) con aterrizaje
3. [escritorio] animación del salto: hoja jump entera (preparación → aterrizaje), pies quietos al despegar y aterrizar, sombra que se separa en el aire
4. [escritorio] zona alta inalcanzable (más de 2 cabezas: 2 u = 4.1 cabezas) → marcador ROJO y no se mueve
5. [escritorio] A*: los saltos del camino nunca superan 2 cabezas (1,5 u o más sigue siendo infranqueable)
6. [escritorio] botón SALTAR y tecla L siguen saltando (para el barrido bajo del autómata)
7. [escritorio] doble toque: ya no salta (va al punto tocado)
8. [iphone] sube saltando bordes de 2 cabezas (1 u) en varios puntos del mapa, tocando la zona alta
9. [iphone] baja saltando (más de un escalón y hasta 2 cabezas) con aterrizaje
10. [iphone] animación del salto: hoja jump entera (preparación → aterrizaje), pies quietos al despegar y aterrizar, sombra que se separa en el aire
11. [iphone] zona alta inalcanzable (más de 2 cabezas: 2 u = 4.1 cabezas) → marcador ROJO y no se mueve
12. [iphone] A*: los saltos del camino nunca superan 2 cabezas (1,5 u o más sigue siendo infranqueable)
13. [iphone] botón SALTAR siguen saltando (para el barrido bajo del autómata)
14. [iphone] doble toque: ya no salta (va al punto tocado)
15. el autómata no salta: si te persigue y hay un desnivel que no puede salvar, rodea (camino más corto andando) y llega

## `fodder.mjs` — 9/9

Relleno: estados, golpe solo en el IMPACT, A*, muerte y reaparición, parry con K (escritorio) y GUARDIA táctil (iPhone).

1. estados: idle/wander → chase → windup → attack → recovery → hit → … → stun → … → death
2. golpe en arco solo en el frame IMPACT (un «swing» por golpe, ninguno en la preparación ni en la recuperación)
3. A* sin atascos: llegan a su distancia de ataque desde 6-12 u (titán, cementerio, charcas)
4. muerte: se queda en el suelo y se desvanece (~3,2 s); reaparece en su sitio a los 9 s si no estás encima
5. escritorio: tecla K → parry PERFECTO remata al zombi; parry NORMAL aturde al perro
6. escritorio: nunca se pide una animación inexistente
7. iPhone: botón GUARDIA táctil → parry al zombi y al perro (aturdido o rematado)
8. iPhone: el contador de la práctica se ve dentro de la pantalla y no pisa botones ni barras **[UI]**
9. iPhone: nunca se pide una animación inexistente

## `fodder_e3.mjs` — 11/11

Relleno: anillo, clic, andamio, recompensas y fatiga.

1. parry PERFECTO al zombi: queda REMATADO al instante (muerte con fogonazo)
2. parry NORMAL al perro: STUN de 1,2 s y sale despedido ~1,5 baldosas
3. durante el STUN cualquier golpe tuyo lo mata
4. barra de FATIGA: parry normal +50 (aturdido 1,2 s); el 2.º la llena → ¡AGOTADO! 2,2 s; baja sola si no le desvías
5. bloqueo: cuesta la mitad de stamina y no aturde
6. golpe recibido: daño bajo (6 = 1/3 del zarpazo del autómata, 18)
7. el anillo toca el centro a ±16 ms del IMPACT (zombi y perro)
8. nivel 1: el anillo solo se ve los últimos 250 ms; nivel 0: sin anillo (solo pose, gruñido y clic)
9. andamio: 4 parries seguidos → nivel 1, otros 4 → nivel 0; 3 fallos → sube a 1 (y es por tipo: el perro sigue en 2)
10. panel ⚙: «Anillo» Auto (por defecto) / Siempre / Nunca **[UI]**
11. nunca se pide una animación inexistente

## `fodder_e4.mjs` — 10/10

Relleno: grupos en metrónomo (token único), grupo de práctica, contador, selector, grupos del mundo.

1. #enemy=fodder: grupo de práctica de 4 (zombis y perros) junto al jugador
2. TOKEN ÚNICO: nunca hay 2 enemigos en WINDUP/ATTACK a la vez
3. el siguiente empieza su WINDUP 700 ms después de que el anterior termine RECOVERY/STUN (metrónomo)
4. los demás rodean a 2-3 baldosas y esperan
5. contador en pantalla: parries seguidos, % de PERFECTOS y nivel del anillo
6. grupo de práctica: el que cae vuelve a ~5 u un segundo después de desvanecerse
7. selector: «Zombi», «Perro zombi» y «Grupo de práctica»; botón del panel; W.setEnemyType
8. mundo: grupos mezclados de 2-4 en el cementerio y en las charcas (al acercarte); el autómata sigue en sus 3 zonas
9. modo entrenamiento: ms antes del impacto y el nivel conseguido contra el relleno
10. nunca se pide una animación inexistente

## `parry2_ui.mjs` — 10/10

Controles REALES en tiempo real: escritorio (teclado K/J y ratón) e iPhone 13 (toques por CDP). La guardia se mide desde la marca de tiempo del evento. Las comprobaciones de maquetación (barras, panel) son de la interfaz web: en Unity, adaptarlas a su UI.

1. [escritorio] guardia (tecla K): parry medido desde la marca de tiempo del evento (antelación = lo que faltaba + el retraso del evento)
2. [escritorio] fuerte manteniendo J: carga mientras se mantiene y el golpe sale al soltar
3. [escritorio] finta: K durante la preparación de tu golpe lo cancela y pasa a guardia
4. [escritorio] barras de postura centrales visibles sin tapar GUARDIA ni la barra de botones, sin scroll horizontal **[UI]**
5. [escritorio] panel ⚙: entrenar (cadena retrasada), latencia y prueba de ritmo, todo dentro de la pantalla **[UI]**
6. [movil] guardia (toque en GUARDIA): parry medido desde la marca de tiempo del evento (antelación = lo que faltaba + el retraso del evento)
7. [movil] fuerte manteniendo el dedo sobre el enemigo: carga mientras se mantiene y el golpe sale al soltar
8. [movil] finta: tocar GUARDIA durante la preparación de tu golpe lo cancela y pasa a guardia
9. [movil] barras de postura centrales visibles sin tapar GUARDIA ni la barra de botones, sin scroll horizontal **[UI]**
10. [movil] panel ⚙: entrenar (cadena retrasada), latencia y prueba de ritmo, todo dentro de la pantalla **[UI]**

## `cc_e1.mjs` — 7/7

Animaciones nuevas en el atlas (heavy, spin, heavy del autómata) y visor de animaciones. Las del visor son de herramienta: opcionales en Unity.

1. atlas del personaje: heavy y spin con sus fases (heavy: carga 1-2, impacto 4; spin: activos 2-3 en 360°)
2. atlas del autómata: heavy con HOLD (aviso largo) e impacto en IMPACT
3. visor: se abre desde el panel y pinta la animación, dirección y frame elegidos **[UI]**
4. visor: con y sin luz **[UI]**
5. visor: reproducir avanza los frames con sus tiempos **[UI]**
6. visor: al cerrar, todo vuelve (sin vista fija, IA activa) **[UI]**
7. móvil: el visor cabe en la pantalla **[UI]**

## `nav_stress.mjs` — 282/282

Estrés de navegación sin render: semilla fija `W.rng(9)`, 300 intentos de ruta aleatoria (origen y destino libres) con A* y el paso del cuerpo
(`player.update` a 1/60). Una ruta es válida si el personaje acaba a **< 0.3 u** del final del camino. Resultado esperado: **282 de 300**
(las 18 restantes son destinos sin camino). En Unity, con otro mapa, el criterio es: 100 % de las rutas con camino terminan a < 0.3 u, sin atascos.

## `timing_rt.mjs` — cronometraje de la guardia en tiempo real

No es a paso fijo: el juego corre en tiempo real; cada paso registra (reloj real, ct) y el instante de juego verdadero de una pulsación con marca `ts`
es la interpolación de ct entre los dos pasos que la rodean. Se compara con `pressTime(ts)`. 40 pulsaciones por modo contra el zombi, entre 0 y 240 ms
antes del impacto. Esperado (código actual): 60 fps → error 0 ms; 37 fps con tirones de 60-110 ms cada 6 frames → medio ≤ 0.5 ms, máx ≤ 11 ms, 40/40
bien juzgadas; ~14 fps → medio ≤ 3.5 ms, máx ≤ 17 ms, 40/40. (Antes del arreglo: 4.4/50 ms y 14.3/50 ms.)

## `res_auto.mjs` — 8/8

1-4 y 6 son de resolución automática **[visual/rendimiento]**. La 5 es lógica: **ligero por toque** — pulsar → impacto ≤ 205 ms + toque − min(toque, 82 ms) + 17 ms
(toques de 50/100/150 ms → 217/233/283 ms).

## `fodder_bot.mjs` — bot de reacción humana contra el relleno

Reacción 250 ± 40 ms (normal truncada a ±3σ) desde el inicio del WINDUP; apunta 60 ms antes del IMPACT con error σ = 20 ms (anillo completo), 25 ms
(últimos 250 ms) o 35 ms (sin anillo); nunca antes de percibir el aviso + 50 ms. N = 120 golpes por tipo y nivel. Criterio: **≥ 99 %** de golpes
«desviables» (reacción + 50 ms ≤ windup) en todos los niveles y ≥ 99 % desviados con el anillo completo. Referencia actual: zombi/perro nivel 2 = 100 %
desviados (68-69 % perfectos); nivel 0 = 97-98 % (54-57 % perfectos); autómata (bot de parry2) 96.7 % desviados, 9.3 % perfectos.

## `stage5.mjs`, `collide.mjs`, `stage2_checks.mjs` — movimiento fino

- Colisiones: contra el árbol-corazón y el agua el personaje se para en el borde (no atraviesa) y desliza por la pared.
- Escalones: cruzar un escalón de 0.5 u sin atascarse; desniveles > 0.5 no se suben andando.
- Frenado: sin pasarse del destino, desaceleración suave, parada exacta.
- Pie apoyado sin patinar (≤ 1 px de render por frame) y pie sobre la superficie **[visual]**: en Unity, comprobar el *foot sliding* de las animaciones nuevas.
