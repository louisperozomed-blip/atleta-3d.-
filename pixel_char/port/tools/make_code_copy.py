#!/usr/bin/env python3
"""Copia el código de LÓGICA de pixel_char/world/src a pixel_char/port/code/, quitando lo puramente visual
(shaders, mallas THREE, luces, HUD en el DOM, partículas de estilo) y dejando en su lugar un comentario
«[VISUAL OMITIDO: …]» y, si hace falta, un stub para que el resto del archivo siga siendo JavaScript válido.
Las llamadas sueltas a efectos (W.fx.dust, W.sfx.combat, W.combatStar, W.shakeCam, W.combatPop) se dejan:
en Unity son EVENTOS (VFX/SFX) y marcan dónde ocurre cada cosa.
uso: python3 make_code_copy.py   (desde cualquier sitio)"""
import os, re, subprocess, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "world", "src")
OUT = os.path.join(ROOT, "port", "code")
HDR = ("// ============================================================================================================\n"
       "// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/{name}\n"
       "// {note}\n"
       "// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:\n"
       "// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.\n"
       "// ============================================================================================================\n")

def cut(s, start, end, repl, name):
    i = s.find(start)
    if i < 0: sys.exit(f"{name}: no encuentro el inicio {start!r}")
    j = s.find(end, i + len(start)) if end else len(s)
    if j < 0: sys.exit(f"{name}: no encuentro el fin {end!r}")
    return s[:i] + repl + s[j:]

def V(what, stub=""):
    return f"  // [VISUAL OMITIDO: {what}]\n" + (stub + "\n" if stub else "") + "\n"

FILES = {
  # archivo: (nota, [(inicio, fin_exclusivo, sustituto)])
  "player.js": ("Movimiento del personaje (y de los cuerpos de los enemigos): completo, es todo lógica.", []),
  "nav.js": ("A* sobre la rejilla de navegación, aristas de salto y suavizado: completo.", []),
  "fighter.js": ("Máquina de estados de combate: completa (lógica pura).", []),
  "moves.js": ("Ataques L/H, carga, combos y ritmo. Se omite el 2.º bloque (brillo y brasas de la carga).", [
    ("// ---- sensación de la carga", None, "// [VISUAL OMITIDO: brillo de la cuchilla y brasas de la carga (W.onChargeStart/onCharge2/onChargeRelease solo\n//  escriben en el registro y lanzan sonido; W.movesAfter solo anima el brillo)]\n"),
  ]),
  "combat.js": ("Resolución de golpes, defensa, postura, hitstop, cámara lenta. Sin partículas, luces ni HUD.", [
    ("  // aviso sobre el personaje de lo que acaba de pasar", "  W.addFighter =", V("textos flotantes «¡PARRY!», «BLOQUEO»… (FB, feedback, addPop, el0, updatePops)",
      "  function feedback(e) {}\n  function el0() {}\n  W.combatPop = el0;\n  function updatePops() {}")),
    ("  const shake = {", "  // cámara lenta (Duelo 3)", V("sacudida de cámara (shakeCam/shakeOffset): solo visual",
      "  W.shakeCam = function () {};")),
    ("  // ---- luz del destello", "  // ---- resolución", V("luz del destello, estrellas de contacto y paletas de partículas",
      "  function flashLight() {}\n  function star() {}\n  W.combatStar = function () {};\n  function updateStars() {}\n"
      "  const EMBER = \"EMBER\", SPARK = \"SPARK\", GOLD = \"GOLD\", DULL = \"DULL\";\n"
      "  // superficie bajo un punto (tierra, piedra, agua, hierba, hojas, metal): solo elige partículas y sonido\n"
      "  function groundBurst(x, z) { return (W.surfaceAt && W.surfaceAt(x, z)) || \"dust\"; }")),
    ("  // ---- barras ----", "  // ---- inicio y paso", V("barras de vida/stamina/postura y botón GUARDIA en el DOM (makeHud, updateHud)",
      "  let hud = null;\n  function updateHud() {}")),
    ("    flashL = new THREE.PointLight(0xffe2a8, 0, 7, 2);\n    scene.add(flashL);\n    makeStars(scene);\n", "    W.pf = W.addFighter", ""),
    ("    hud = makeHud();\n", "    W.assets = assets;", ""),
    ("    updateStars(dt);\n    updatePops(dt);\n", "    if (W.movesAfter)", "    // [VISUAL OMITIDO: estrellas, textos, luz del destello, uniforms de destello y barras]\n"),
  ]),
  "duel.js": ("Recompensa del parry perfecto: desequilibrio, riposte con ritmo, deathblow, choque. Sin destello ni anillo.", [
    ("  // ---- destello de pantalla y cámara", "  // ---- paso: rebote", V("destello de pantalla, acercamiento de cámara del remate y anillo del ritmo (sprite)",
      "  function screenFlash() {}\n  W.duelFlash = screenFlash;\n  const cam = (W.DUEL_CAM = { k: 0, t: 0, on: false, cur: 0 });\n  W.duelZoom = function () { return 0; };\n"
      "  // anillo del ritmo: se muestra desde el impacto del 2.º golpe del riposte hasta beat + beatWin + 0,15 s;\n  //   se cierra (1.6 → 0.7) y es más claro dentro de ±beatWin; ring.hit = «ok» / «bad» al pulsar el 3.º\n"
      "  const ring = (W.DUEL_RING = { on: false, t0: 0, beat: 0, hit: null, hitT: 0 });\n  function updateRing() {}")),
    ("    const th = W.ui ? W.ui.theta : Math.PI / 4;\n    for (const f of W.fighters || []) {", "    // la ventana de riposte caduca",
      "    // [VISUAL OMITIDO: rebote del cuerpo del desequilibrado sin hoja, estelas de brasas, cámara del remate, destello]\n    const p = W.pf;\n"),
  ]),
  "target.js": ("Fijar objetivo: selección, Tab, pérdida por distancia/visión, giro instantáneo, sesgo de cámara.", [
    ("  // ---- anillo y retícula", "  W.targetUpdate =", V("anillo bajo los pies del objetivo y retícula en el DOM (makeRing, makeReticle)")),
    ("    if (!T.ring) { T.ring = makeRing(); T.ret = makeReticle(); }\n", "    T.t += dt;", ""),
    ("    // anillo bajo sus pies (gira despacio", "    // cámara: un poco hacia el objetivo",
      "    // [VISUAL OMITIDO: anillo y retícula]\n    if (!f) { T.cam.x += (0 - T.cam.x) * Math.min(1, dt * 3); T.cam.z += (0 - T.cam.z) * Math.min(1, dt * 3); return; }\n    const b = f.body;\n"),
  ]),
  "group.js": ("Combate en grupo: turnos (máx. 2), corro, pinza y multi-parry. Sin flechas de borde en el DOM.", [
    ("  // ---- indicador de borde", "  W.groupUpdate =", V("flechas de borde (DOM)",
      "  // REGLA (visual): mientras un enemigo PREPARA un golpe (act de ataque, frame < impacto) se muestra una flecha si está\n"
      "  //   fuera de pantalla (a < 24 px del borde: flecha en el borde, en su dirección) o por la ESPALDA (más de 110° respecto a\n"
      "  //   hacia donde mira el jugador: flecha a 70 px del personaje). Color: cian nivel 1, naranja nivel 2, rojo nivel ≥ 3.\n"
      "  function updateIndicators() {}")),
  ]),
  "calib.js": ("Calibración de latencia: el cálculo (mediana) y el valor. Sin la prueba en el DOM.", [
    ("  function runTest(box) {", None, "  // [VISUAL OMITIDO: prueba de ritmo en el DOM (10 pulsos cada 750 ms tras 1 s; cada toque guarda su\n  //  event.timeStamp; al acabar, W.calibFrom(pulsos, toques) y W.setCalib) y el panel]\n})();\n"),
  ]),
  "practice.js": ("Modo entrenamiento (lógica) y textos de timing. Sin las barras centrales del DOM.", [
    ("  // ---- HUD del duelo", None, "  // [VISUAL OMITIDO: barras de postura centrales y texto de timing en el DOM. W.practiceAfter llamaba a\n  //  W.trainingStep() en cada paso: en Unity, llamar a trainingStep() desde el bucle.]\n})();\n"),
  ]),
  "controls.js": ("Entrada táctil/teclado → órdenes (ir, seguir, atacar L/H, guardia, esquiva, salto). Sin marcadores en el suelo.", [
    ("  function ring(color) {", "  // dirección en el suelo de un vector de pantalla", V("marcadores en el suelo (aro amarillo; rojo con cruz si no se llega)",
      "  function ring() { return { position: { set() {} }, scale: { set() {} }, visible: false }; }\n  function addMarker(x, y, z, red) { W.lastMarker = { x, y, z, red: !!red }; }")),
    ("    for (let i = markers.length - 1; i >= 0; i--) {", "  };\n})();", "    // [VISUAL OMITIDO: animación de los marcadores]\n"),
  ]),
  "enemies/core.js": ("Registro de tipos de enemigo, aparición, paso y reaparición. Sin el panel ⚙.", [
    ("    // panel: lo que te está leyendo el autómata", "  W.respawnAll =", "    // [VISUAL OMITIDO: texto del panel y botón REAPARECER]\n  };\n"),
    ("  // ---- panel de pruebas", None, "  // [VISUAL OMITIDO: panel de pruebas ⚙ (selector de enemigo, deslizadores de dificultad W.ENEMY_DIFF, grupos)]\n})();\n"),
  ]),
  "enemies/echo/echo.js": ("El eco (enemigo de prueba): IA sencilla. Completo salvo el uniform del destello.", []),
  "enemies/automaton/automaton.js": ("El Autómata del bosque: IA completa (cadenas, trucos, peligrosos, lectura, reacción, combos, adaptativa).", [
    ("    // luz del ojo\n", "    f.ai = makeAI(f);", "    // [VISUAL OMITIDO: luz puntual y halo del ojo]\n"),
    ("  let _halo = null;", "  // ---- IA ----", V("halo del ojo, posición del ojo en pantalla y pisadas pesadas (polvo, esporas, temblor, sonido)",
      "  // posición del ojo: solo sirve para colocar el destello del aviso; aquí, el cuerpo\n  function eyeWorld(f) { return { p: { x: f.body.x, y: f.body.y + 1.9, z: f.body.z }, visible: true }; }\n  function heavyStep(f) { f.steps = (f.steps || 0) + 1; }")),
    ("  function update(f, dt) {", "  function respawn(f) {",
      "  // [VISUAL OMITIDO: color y brillo del ojo según la fase — CARGA parpadea (7 Hz; 9 Hz en los peligrosos), RETENCIÓN fijo,\n"
      "  //  SUELTA destello; ámbar = guardia leída / te ha leído; naranja = rompeguardias/heavy; rojo = peligroso; apagado y\n"
      "  //  vapor durante la ventana de castigo — y la luz/halo del ojo]\n"
      "  function update(f, dt) {\n    // muerte: en el suelo 3 s, luego se desvanece (2,5 s) y queda oculto (hidden) hasta REAPARECER\n"
      "    if (!f.alive) {\n      f.deadT += dt;\n      if (f.deadT > 3) { const u = Math.min(1, (f.deadT - 3) / 2.5); f.fade = 1 - u; if (u >= 1 && !f.hidden) f.hidden = true; }\n"
      "    } else { f.deadT = 0; f.fade = 1; }\n  }\n"),
    ("    f.deadT = 0; f.fade = 1; f.hidden = false; f.ch.uniforms.uFade.value = 1;\n    const ch = f.ch; ch.mesh.visible = ch.caster.visible = ch.blob.visible = ch.ghost.visible = true;\n", "    if (f.ai) {",
      "    f.deadT = 0; f.fade = 1; f.hidden = false;\n"),
  ]),
  "enemies/fodder/fodder.js": ("Relleno (zombi y perro): IA, recompensas, fatiga, andamio del anillo, token único, grupos.", [
    ("    f.ringMesh = makeRing(CFG.ring.r0[kind]);\n", "    return f;\n  }", "    // [VISUAL OMITIDO: malla del anillo y ojos del zombi]\n"),
    ("  // ---- anillo de timing: banda fina", "  // nivel de ayuda que toca ahora", V("shader del anillo de timing y textura de los ojos")),
    ("  function updateRing(f, dt) {", "  const DIRS8 =",
      "  // anillo de timing (LÓGICA de la ayuda): radio r = r0 × clamp(toImpact / windup, 0, 1) → toca el centro en el IMPACT.\n"
      "  // Visibilidad: nivel 2 = todo el windup (fundido de entrada 80 ms); nivel 1 = solo cuando toImpact ≤ 250 ms (fundido\n"
      "  // 50 ms); nivel 0 = nunca. En el IMPACT destella (ringFlash = 1, decae en 160 ms) si se veía.\n"
      "  function updateRing(f, dt) {\n    const a = f.act, C = f.fodder, R = CFG.ring;\n    f.ringFlash = Math.max(0, (f.ringFlash || 0) - dt / 0.16);\n    let alpha = 0, r = 0;\n"
      "    if (a && a.name === \"attack\" && a.ringLv > 0 && a.f < W.hitF(a) && f.alive) {\n      const ti = f.toImpact();\n"
      "      if (ti != null) {\n        r = R.r0[f.kind] * Math.max(0, Math.min(1, ti / C.windup));\n"
      "        alpha = a.ringLv >= 2 ? Math.min(1, (C.windup - ti) / 0.08) : ti <= R.late ? Math.min(1, (R.late - ti) / 0.05) : 0;\n"
      "        f.ring = { r, alpha, ti, t: W.ct };\n      }\n    } else f.ring = null;\n  }\n"
      "  // [VISUAL OMITIDO: ojos del zombi (se encienden 0,35 → 1 durante el windup)]\n  function updateEyes() {}\n"),
    ("  function hide(f, h) {\n    const ch = f.ch; f.hidden = h;\n", "  function respawn(f) {",
      "  function hide(f, h) { f.hidden = h; }   // [VISUAL OMITIDO: ocultar mallas]\n"),
    ("    f.deadT = 0; f.fade = 1; f.respawnAt = 0; f.ch.uniforms.uFade.value = 1; f.jitter = 0;", "\n", "    f.deadT = 0; f.fade = 1; f.respawnAt = 0; f.jitter = 0;"),
    ("  function remove(f) {\n    if (f.ringMesh)", "  // los mismos tres sitios", "  function remove(f) {}\n\n"),
    ("  // ---- contador en pantalla", None, "  // [VISUAL OMITIDO: contador en pantalla (parries seguidos, % perfectos, nivel del anillo: W.FODDER_STATS) y panel ⚙]\n"
      "  W.spawnFodder = spawn;\n  W.fodderRespawn = respawn;\n  W.fodderPhase = phaseOf;\n})();\n"),
  ]),
}
# extractos de archivos mayormente visuales
EXCERPTS = {
  "character_logic.js": ("character.js", "  // dirección (0..7) a partir del rumbo en el suelo", "        // efectos del walk (bob, balanceo, squash, túnica) según la variante",
    "Elección de animación (idle/walk/run/jump, con histéresis de velocidad) y DIRECCIÓN del sprite (8 sectores, histéresis\n// de ~30,5°, paso por las intermedias cada 40 ms; 25 ms en acciones; giro instantáneo con objetivo fijado). Extracto de\n// los métodos de W.makeCharacter (dirFromHeading, dirCenterHeading, update).",
    "const CharacterLogicExcerpt = {\n", "      }\n};\n"),
  "feet_locoParams.js": ("feet.js", "  // Locomoción guiada por los pies", "  W.makeFootAnchor = function (ch) {",
    "Velocidad de la marcha a partir de los pies dibujados (cadencia fija 12 fps). El resto de feet.js (deformar la pierna\n// apoyada para que la bota no patine) es visual.", "(function () {\n  const W = window.W; const DIRS = [\"S\", \"SW\", \"W\", \"NW\", \"N\", \"NE\", \"E\", \"SE\"];\n", "})();\n"),
  "main_loop.js": ("main.js", "    // Paso de simulación: frame() en tiempo real", "      if (W.afterCharacter) W.afterCharacter(dt, t);",
    "Bucle principal: orden de actualización de cada paso (lo que importa para la lógica). La cámara y el render que siguen\n// en el original son visuales. Ver también la resolución automática (main.js, solo rendimiento).",
    "function mainLoopExcerpt(W, clock, player, character, ui) {\n  let t = 0;\n", "    }\n}\n"),
  "terrain_queries.js": ("terrain.js", "  // Consultas\n", "  // Malla del terreno por chunks",
    "Consultas del terreno y rejilla de navegación (la generación del mapa y la malla son contenido/visual).\n// Constantes: N = 80 baldosas de 1 u, HALF = 40, STEP = MAX_STEP = 0,5 u, HEAD_H = 0,49 u, JUMP_MAX = 2·0,49·1,03 u,\n// JUMP_COST = 2,2. Tipos de baldosa K = {GRASS 0, PATH 1, WATER 2, PUDDLE 3, PLAZA 4, STONE 5, CRYSTAL 6, BORDER 7}.",
    "(function () {\n  const W = window.W; const K = W.K;\n  // ---------------------------------------------------------------------------\n", "})();\n"),
}

def main():
    os.makedirs(OUT, exist_ok=True)
    done = []
    for name, (note, ops) in FILES.items():
        s = open(os.path.join(SRC, name), encoding="utf-8").read()
        for (a, b, r) in ops: s = cut(s, a, b, r, name)
        dst = os.path.join(OUT, name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "w", encoding="utf-8").write(HDR.format(name=name, note=note) + s)
        done.append(dst)
    for out, (name, a, b, note, pre, post) in EXCERPTS.items():
        s = open(os.path.join(SRC, name), encoding="utf-8").read()
        i = s.find(a); j = s.find(b, i)
        if i < 0 or j < 0: sys.exit(f"extracto {out}: marcas no encontradas")
        body = s[i:j]
        dst = os.path.join(OUT, out)
        open(dst, "w", encoding="utf-8").write(HDR.format(name=name + " (EXTRACTO)", note=note) + pre + body + post)
        done.append(dst)
    bad = 0
    for d in done:
        r = subprocess.run(["node", "--check", d], capture_output=True, text=True)
        if r.returncode: bad += 1; print("SINTAXIS", d, r.stderr[:400])
    print(len(done), "archivos;", "todos con sintaxis válida" if not bad else f"{bad} con errores")
    return bad
sys.exit(main())
