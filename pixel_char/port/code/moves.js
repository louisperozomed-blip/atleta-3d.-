// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/moves.js
// Ataques L/H, carga, combos y ritmo. Se omite el 2.º bloque (brillo y brasas de la carga).
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
// moves.js — ataques del jugador: LIGERO (L) y FUERTE (H) con carga, stamina y combos en datos.
//
//  · tocar = L; mantener ≥ 0,4 s = H (la carga empieza ahí: CROUCH y luego CHARGE/CHARGE MAX en bucle, con el
//    brillo de la cuchilla creciendo); a 1,2 s, carga de NIVEL 2; soltar lanza el golpe (a 1,8 s se suelta solo)
//  · la carga sustituye al antiguo «retraso»; durante la carga eres vulnerable y pulsar guardia la cancela (finta,
//    gasta stamina, como antes)
//  · stamina: el ligero gasta poco, el fuerte bastante más y el nivel 2 aún más; sin stamina los golpes salen más
//    lentos (preparación ×1,35)
//  · combos (tabla STEPS, fácil de ampliar): cada golpe continúa la secuencia L/H si la pulsación llega dentro de la
//    ventana de encadenado del anterior (desde su impacto hasta el final de su recuperación + un margen):
//      L·L·L  combo básico (attack1 → attack2 → attack3)
//      L·H    QUIEBRAGUARDIA: si te lo bloquea, le vacía mucha stamina (casi siempre le rompe la guardia)
//      L·L·H  REMATE GIRATORIO (hoja spin): golpe en 360° que alcanza a varios, mucha postura, recuperación larga
//      H·L    CORTE DE SALIDA: golpe rápido tras un fuerte
//      H·H    GOLPE CARGADO DOBLE: postura enorme, muy lento
//    Cada paso: hoja, stamina, daño y postura (× los del golpe), velocidad, recuperación, pulso del ritmo y si cierra
//    el combo. Búfer: hasta 2 pulsaciones en cola (fighter.js), para que no se pierda ningún toque
//  · RITMO: cada golpe tiene un PULSO (un instante tras su impacto, ±50 ms = ~100 ms dentro de su ventana). Pulsar
//    el siguiente en el pulso = EN RITMO: +20 % de daño y postura, sonido propio. Fuera del pulso el combo sigue sin
//    bonus. Se mide con la marca de tiempo del evento y la calibración de latencia (W.pressTime)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const M = (W.MOVES = {
    holdH: 0.4,            // s manteniendo para que sea FUERTE
    holdH2: 1.2,           // s manteniendo para la carga de nivel 2
    holdMax: 1.8,          // se suelta solo
    chainGrace: 0.35,      // margen tras la recuperación para seguir el combo (s)
    tiredSlow: 1.35,       // sin stamina: preparación más lenta
    // golpes por secuencia: anim (hoja), coste de stamina, daño y postura (× los del golpe en combat.js), etiqueta
    // y si cierra el combo. H2 = nivel 2 de la carga (multiplica daño, postura y coste)
    level2: { dmg: 1.5, post: 1.6, st: 1.55, stop: 1.35 },
    beatWin: 0.05,         // ± del pulso (100 ms en total)
    rhythm: 1.2,           // EN RITMO: daño y postura ×1,2
    // beat = pulso del SIGUIENTE golpe, en s tras el impacto de este (cae en su recuperación: en la ventana)
    STEPS: {
      L: { anim: "attack1", st: 6, name: "ligero", beat: 0.16 },
      LL: { anim: "attack2", st: 7, name: "ligero 2", beat: 0.17 },
      LLL: { anim: "attack3", st: 12, name: "Combo básico", end: true, combo: true },
      H: { anim: "heavy", st: 18, name: "fuerte", charge: true, beat: 0.24 },
      LH: { anim: "heavy", st: 20, name: "Quiebraguardia", charge: true, guardDrain: 0.65, postK: 1.25, end: true, combo: true },   // le vacía el 65 % de su stamina
      LLH: { anim: "spin", st: 22, name: "Remate giratorio", recK: 0.55, end: true, combo: true },
      HL: { anim: "attack2", st: 8, name: "Corte de salida", speed: 1.35, dmgK: 0.9, end: true, combo: true },
      HH: { anim: "heavy", st: 26, name: "Golpe cargado doble", charge: true, speed: 0.8, dmgK: 1.2, postK: 2.2, recK: 0.75, end: true, combo: true },
    },
  });
  const now3 = () => (W.U ? +W.U.uTime.value.toFixed(3) : 0);

  // ¿continúa el combo? (pulsación en la ventana del golpe anterior: desde su impacto hasta el final + margen)
  // force: la 2.ª pulsación de la cola (se decide al empezar el golpe anterior: sigue su secuencia)
  function comboSeq(f, kind, pt, force) {
    const C = f.combo;
    if (!C || !C.seq) return kind;
    const a = f.act, inWin = a && W.isAtk(a) && a.comboSeq === C.seq && (a.f >= W.hitF(a) || force);
    const after = !a && C.end != null && pt <= C.end + M.chainGrace;
    if (!(inWin || after) || C.closed) return kind;
    const s = C.seq + kind;
    return M.STEPS[s] ? s : kind;
  }
  W.movesNext = function (f, kind, pt, force) {
    if (pt == null) pt = W.ct;
    const seq = comboSeq(f, kind, pt, force);
    const step = M.STEPS[seq] || M.STEPS[kind];
    // ritmo: solo al continuar un combo y respecto al pulso del golpe anterior
    let rhythm = null;
    if (seq.length > 1 && f.beat != null) { const err = pt - f.beat; rhythm = { err: +err.toFixed(3), ok: Math.abs(err) <= M.beatWin }; }
    return { seq, step, rhythm };
  };
  // al empezar un golpe del combo (fighter.startAttack): su secuencia, coste y nivel
  W.movesStarted = function (f, a, seq, step, rhythm) {
    a.comboSeq = seq; a.kind = seq[seq.length - 1]; a.step = step;
    f.combo = { seq, end: null, closed: !!step.end, t0: W.ct };
    f.beat = null;
    // multiplicadores del paso y del ritmo (el nivel 2 de la carga se suma al soltar)
    const rk = rhythm && rhythm.ok ? M.rhythm : 1;
    a.dmgK = (step.dmgK || 1) * rk; a.postK = (step.postK || 1) * rk;
    if (step.speed) a.speed *= step.speed;
    if (step.recK) a.recK = step.recK;
    if (step.guardDrain) a.guardDrain = step.guardDrain;
    a.rhythm = rhythm;
    if (rhythm) {
      W.lastRhythm = { ok: rhythm.ok, err: rhythm.err, seq, t: W.ct };
      if (rhythm.ok) { if (W.sfx) W.sfx.combat("rhythm"); if (W.combatPop && f.ch) W.combatPop("EN RITMO", "#ffe27a", f); }
      if (W.onRhythm) W.onRhythm(rhythm, seq);
    }
    if (step.combo && W.combatPop && f.ch) W.combatPop(step.name.toUpperCase(), "#ffb050", f);
    if (W.combatLog) W.combatLog.push({ ev: "move", seq, anim: a.name, name: step.name, rhythm: rhythm ? (rhythm.ok ? "ok" : "fuera") : null, err: rhythm ? Math.round(rhythm.err * 1000) : null, t: now3() });
  };
  // impacto de un golpe del combo: el pulso del siguiente
  W.movesImpact = function (f, a) {
    if (a.step && a.step.beat && !a.step.end && a.impactT != null) f.beat = a.impactT + a.step.beat;
  };
  // al terminar (fighter.update): la ventana de después
  W.movesEnded = function (f, a) { if (f.combo && a.comboSeq === f.combo.seq) f.combo.end = W.ct; };
  W.movesCost = function (step, level) { return step.st * (level === 2 ? M.level2.st : 1); };
})();

// [VISUAL OMITIDO: brillo de la cuchilla y brasas de la carga (W.onChargeStart/onCharge2/onChargeRelease solo
//  escriben en el registro y lanzan sonido; W.movesAfter solo anima el brillo)]
