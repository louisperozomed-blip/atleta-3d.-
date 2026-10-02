// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/enemies/core.js
// Registro de tipos de enemigo, aparición, paso y reaparición. Sin el panel ⚙.
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
// enemies/core.js — tipos de enemigo registrados, aparición, paso, reaparición y panel de pruebas.
//
// Cada tipo vive en su propio módulo (src/enemies/<tipo>/) y se registra con W.registerEnemy(id, def):
//   def.label                        nombre en el panel
//   def.spawnPoints()                [{x, z, heading, zone}] dónde aparece
//   def.spawn(p, assets)             crea y devuelve el luchador (W.Fighter con .body, .ch, .ai, .home)
//   def.update(f, dt)                (opcional) cosas propias en cada paso (luces, desvanecerse...)
//   def.onFrame(f, a) / def.onAct(f, actor, act)   (opcionales) ganchos de animación y de acciones ajenas
//   def.respawn(f)                   (opcional) reaparición propia
//   def.remove(f)                    (opcional) limpieza al cambiar de tipo
// Tipo por defecto: "automaton" (el Autómata del bosque). El eco de pruebas sigue disponible: selector
// «Enemigo» del panel de pruebas (⚙), W.setEnemyType("echo") o la dirección con #enemy=echo.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const TYPES = (W.ENEMY_TYPES = W.ENEMY_TYPES || {});
  const foes = (W.foes = W.foes || []);
  W.registerEnemy = function (id, def) { def.id = id; TYPES[id] = def; };
  const m = /enemy=(\w+)/.exec(location.hash || "");
  W.enemyType = m ? m[1] : "automaton";
  // dificultad (la usa el autómata): reacción (×), frecuencia de parry y de bloqueo (0..1)
  W.ENEMY_DIFF = W.ENEMY_DIFF || { react: 1, parry: 0.3, block: 0.35 };

  function removeFoe(f) {
    const def = TYPES[f.type];
    if (def && def.remove) def.remove(f);
    const ch = f.ch;
    for (const o of [ch.mesh, ch.ghost, ch.caster, ch.blob, ...(ch.boots || [])]) if (o && o.parent) o.parent.remove(o);
    if (ch.sticker && ch.sticker.parentElement) ch.sticker.remove();
    const i = W.fighters.indexOf(f); if (i >= 0) W.fighters.splice(i, 1);
  }
  W.spawnEnemies = function (type) {
    type = type || W.enemyType;
    while (foes.length) removeFoe(foes.pop());
    if (W.fodderStreamReset) W.fodderStreamReset();
    if (type === "none") { W.enemyType = type; W.foe = null; return foes; }     // sin enemigos (pruebas del mundo)
    if (!TYPES[type]) type = Object.keys(TYPES)[0];
    W.enemyType = type;
    const def = TYPES[type];
    for (const p of def.spawnPoints()) {
      const f = def.spawn(p, W.assets);
      f.type = type; f.zone = p.zone;
      foes.push(f);
    }
    W.foe = foes[0] || null;
    if (W.TRAINING && W.TRAINING.on && W.setTraining) W.setTraining(W.TRAINING.id);   // el entrenamiento sigue al cambiar de tipo
    W.combatLog && W.combatLog.push({ ev: "enemies", type, n: foes.length, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 });
    const sel = document.getElementById("enemySel"); if (sel) sel.value = type;
    return foes;
  };
  W.setEnemyType = function (t) { return W.spawnEnemies(t); };
  // grupos (group.js): quitar todos y añadir uno de un tipo en un punto
  W.removeFoe = function (f) { const i = foes.indexOf(f); if (i >= 0) foes.splice(i, 1); removeFoe(f); if (W.foe === f) W.foe = foes[0] || null; };
  W.clearFoes = function () { if (W.fodderStreamReset) W.fodderStreamReset(); while (foes.length) removeFoe(foes.pop()); W.foe = null; };
  W.addFoe = function (type, p) {
    const def = TYPES[type]; if (!def) return null;
    const f = def.spawn(p, W.assets); f.type = type; f.zone = p.zone; foes.push(f); if (!W.foe) W.foe = f; return f;
  };

  W.updateFoes = function (dt, theta, thetaT) {
    if (W.fodderStream) W.fodderStream();          // grupos de relleno del mundo (aparecen al acercarte)
    for (const f of foes) {
      const def = TYPES[f.type];
      if (f.hidden) { if (def.hiddenUpdate) def.hiddenUpdate(f, dt); continue; }   // (el relleno vuelve solo)
      if (f.ai && dt > 0) f.ai.update(dt);           // cada IA mira su propio "enabled"
      f.update(dt);
      f.body.update(dt);
      f.ch.update(dt, f.body, theta, thetaT);
      if (def.update) def.update(f, dt);
    }
    // [VISUAL OMITIDO: texto del panel y botón REAPARECER]
  };
  W.respawnAll = function () {
    for (const f of foes) {
      const def = TYPES[f.type];
      if (def.respawn) def.respawn(f);
      else { f.respawn(f.home.x, f.home.z); f.body.heading = f.home.heading; }
      f.hidden = false;
    }
    const p = W.pf;
    if (p && !p.alive) p.respawn();
    W.combatLog.push({ ev: "respawn", t: +W.U.uTime.value.toFixed(3) });
  };
  // ganchos de animación: el de cada tipo
  W.onCombatFrameExtra = function (f, a) {
    const def = f.type && TYPES[f.type];
    if (def && def.onFrame) def.onFrame(f, a);
  };
  // acciones de cualquiera (p. ej. el jugador empieza un ataque): los enemigos pueden reaccionar
  W.onCombatAct = function (actor, act) {
    for (const f of foes) { const def = TYPES[f.type]; if (def.onAct && f !== actor) def.onAct(f, actor, act); }
  };

  // [VISUAL OMITIDO: panel de pruebas ⚙ (selector de enemigo, deslizadores de dificultad W.ENEMY_DIFF, grupos)]
})();
