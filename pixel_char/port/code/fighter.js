// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/fighter.js
// Máquina de estados de combate: completa (lógica pura).
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
// fighter.js — máquina de estados de combate (jugador y enemigo).
//
// Estados: locomoción (idle / walk / run / jump, los lleva player.js) y acciones de combate que usan las
// hojas nuevas: attack1-3, parry, block, dodge, hit, death (+ "stun": aturdido tras perder la postura).
// Los tiempos de cada frame, el frame activo y las ventanas de cancelación salen de combat_atlas.json
// (pixel_char/out/combat/combat.json): una sola fuente de verdad para la animación y la lógica.
//
//  · combo: attack1 → attack2 → attack3 si se pulsa durante la ventana de encadenado (IMPACT..RECOVERY);
//    el siguiente golpe empieza al entrar en FOLLOW THROUGH (o en el acto si ya se está en él)
//  · búfer de entrada de 180 ms: una pulsación que llega un poco antes de que se pueda actuar no se pierde
//  · parry estilo Sekiro: la ventana (~200 ms) cuenta desde la pulsación de guardia; pulsar repetidamente
//    la encoge (+45 ms de penalización por pulsación seguida, se recupera sola a 120 ms/s); una pulsación
//    justo fuera de la ventana (hasta +120 ms) cuenta como bloqueo (parry parcial)
//  · niveles (se mide la antelación de la pulsación respecto al instante EXACTO del impacto, con el reloj de
//    combate W.ct y la marca de tiempo del evento de entrada, no con el frame en que se procesa):
//      PERFECTO  últimos ~70 ms  ·  NORMAL  resto de la ventana  ·  BLOQUEO  fuera de ventana con guardia
//    + calibración de latencia (W.COMBAT.calib, ms): desplaza la ventana para pantallas táctiles lentas
//  · bloqueo: mantener guardia; el daño se reduce y gasta stamina; sin stamina la guardia se rompe
//  · esquiva: invulnerable en los frames DASH; cancela un ataque después de su frame de impacto
//  · plan de golpe (enemigos): CARGA (frames 0-1) → RETENCIÓN (frame 1 fijo) → SUELTA (frame 2) → impacto, con
//    duraciones propias (act.plan = {wind, hold, rel}); avisa de las fases con this.onPhase(act, "hold"|"release")
//  · tras saltar un barrido, contraataque en el aire (airCounterT)
//  · herramientas para ganar la lectura: FINTA (guardia durante la preparación de tu ataque o la carga del fuerte:
//    lo cancela, gasta stamina) y RETRASO (mantener pulsado el ataque: la preparación se queda en la pose de carga
//    hasta soltar; Combate completo: en el jugador lo sustituye la CARGA del fuerte, moves.js)
//  · jugador (moves.js): ataques L/H con su secuencia de combo; el fuerte se CARGA mientras se mantiene (frames de
//    carga en bucle; a 1,2 s nivel 2) y sale al soltar
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  const C = (W.COMBAT = {
    buffer: 0.18,
    parryWin: 0.2, perfectWin: 0.07, parryPartial: 0.12, parryPen: 0.045, parryPenMax: 0.13, parryPenDecay: 0.12, spamGap: 0.7,
    counterWin: 0.35, counterDmg: 1.6, counterPost: 1.5,   // contraataque tras un parry perfecto
    feintCost: 14, holdMax: 0.6,                   // finta (stamina) y retraso máximo manteniendo el ataque (s)
    calib: 0,                                      // ms (+ = tus pulsaciones llegan tarde): desplaza la ventana
    staminaRegen: 34, staminaDelay: 0.55, blockRegenK: 0.35,
    dodgeCost: 18, attackCost: [6, 7, 12], dodgeDist: 2.3,
    postureDecay: 9, postureDelay: 1.6, stunTime: 2.4,
    // postura con tensión (estilo Sekiro): con la guardia alta y sin recibir golpes se recupera más deprisa;
    // la recuperación depende de la vida que queda (dañar la vida frena la recuperación de la postura)
    guardRecovDelay: 0.45, guardRecovK: 2.8, hpRecovMin: 0.15, hpRecovPow: 1.5,
    chainGap: 1.25, chainBonus: 3,                  // racha de desvíos dentro de la misma cadena de ataques
  });

  // reloj de combate: avanza con el tiempo de juego (se congela en el hitstop); lo usan la defensa y los impactos
  W.ct = W.ct || 0; W.ctReal = 0;
  // instante (en W.ct) de una pulsación: con la marca de tiempo del evento (event.timeStamp, ms) se descuenta lo
  // que tardó en procesarse; y la calibración desplaza la ventana
  W.pressTime = function (ts, human) {
    let t = W.ct;
    if (ts != null && isFinite(ts)) {
      if (W.manual || W.ctRate == null) {
        const ref = W.manual ? performance.now() : (W.ctReal || performance.now());
        // (en cámara lenta, los ms reales valen menos tiempo de combate)
        t += Math.max(-0.12, Math.min(0.05, (ts - ref) / 1000)) * (W.SLOWMO && W.SLOWMO.t > 0 ? W.SLOWMO.k : 1);
      } else {
        // tiempo real: entre dos frames el juego no avanza 1:1 con el reloj (a pocos fps el paso se recorta a
        // 50 ms; en el hitstop se congela; en cámara lenta va al 30 %). Una pulsación de ANTES del último paso se
        // sitúa con el ritmo que tuvo ese paso; una de DESPUÉS, con el que tendrá el siguiente: congelado si hay
        // hitstop, la cámara lenta en curso o pendiente, y el recorte según la duración esperada del frame
        const x = (ts - W.ctReal) / 1000;
        if (x < 0) t += Math.max(-Math.max(0.12, (W.ctFrame || 0) + 0.02), x) * W.ctRate;
        else {
          const S = W.SLOWMO, D = Math.max(x, W.ctFrameEst || 1 / 60);
          const k = W.hitstop > 0 ? 0 : S && S.pend ? S.pend.k : S && S.t > 0 ? S.k : 1;
          t += Math.min(x, 0.25) * Math.min(D, 0.05) / D * k;
        }
      }
    }
    return human ? t - (C.calib || 0) / 1000 : t;   // la calibración, solo para el jugador
  };
  let CM = null;                                   // meta de combate (atlas)
  function meta() { return CM || (CM = W.CMETA); }
  // tiempos acumulados de cada animación, por meta (el jugador usa combat_atlas.json; cada tipo de
  // enemigo, el suyo)
  function cumOf(M, an) {
    M._cum = M._cum || {};
    if (!M._cum[an]) {
      const out = [0];
      for (const ms of M.animations[an].ms) out.push(out[out.length - 1] + ms / 1000);
      M._cum[an] = out;
    }
    return M._cum[an];
  }
  function frameAt(an, t, M) {
    const c = cumOf(M || meta(), an);
    for (let i = 0; i < 6; i++) if (t < c[i + 1]) return i;
    return 6;                                        // terminó
  }
  W.combatFrameAt = frameAt;
  W.combatDur = function (an, M) { return cumOf(M || meta(), an)[6]; };
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // hoja que pinta la acción (Duelo 3: riposte, deathblow, deflected y counter usan su hoja si existe; si no, un
  // sustituto configurable en W.DUEL, p. ej. attack1 acelerado) y ¿es un golpe? (attack1-3 y los del duelo)
  const an = (a) => a.sheet || a.name;
  const isAtk = (a) => !!a && (!!a.atk || a.name.startsWith("attack"));
  // frame de impacto de cada golpe (Combate completo): el primero «activo» de su hoja en el atlas (heavy: 4 =
  // IMPACT; spin: 2 = el primer SPIN); 3 en attack1-3, riposte, deathblow, counter... Las fases relativas a él:
  // preparación < hf, suelta = hf-1, encadenado desde hf, recuperación > hf
  const HF = (a) => (a && a.hf != null ? a.hf : 3);
  function hitFrame(M, s) { const A = M && M.animations && M.animations[s]; return A && A.activo && A.activo.length ? A.activo[0] : 3; }
  W.isAtk = isAtk; W.actSheet = an; W.hitF = HF; W.hitFrameOf = hitFrame;

  class Fighter {
    constructor(body, o) {
      o = o || {};
      this.body = body; body.fighter = this;
      this.team = o.team || "player";
      this.name = o.name || this.team;
      this.hpMax = o.hp || 100; this.hp = this.hpMax;
      this.stMax = o.stamina || 100; this.st = this.stMax; this.stT = 0;
      this.stRegen = o.staminaRegen || C.staminaRegen;   // stamina/s (el autómata, pesado, se recupera despacio)
      this.postMax = o.posture || 100; this.post = 0; this.postT = 0;
      this.act = null;
      this.buf = null;                              // entrada en el búfer {type, t, data}
      this.guardHeld = false; this.guardT = -9; this.lastGuardT = -9; this.pen = 0;   // guardT, lastGuardT: en W.ct
      this.counterT = 0;                            // fin de la ventana de contraataque (W.ct)
      this.airCounterT = 0;                         // fin de la ventana de contraataque en el aire (W.ct)
      this.flash = 0; this.time = 0;
      this.prepK = o.prepK || 1;                    // >1: preparación de los ataques más lenta (enemigo)
      this.cm = o.meta || null;                     // meta de animaciones propio (enemigos)
      this.stunTime = o.stunTime || C.stunTime; this.stunRate = o.stunRate || 4;
      this.dodgeDist = o.dodgeDist || C.dodgeDist; this.kbK = o.kbK == null ? 1 : o.kbK;
      this.dodgeInv = o.dodgeInv || [2, 3];         // frames invulnerables de la esquiva (DASH)
      this.attackWant = o.attackWant || { attack1: 1.0, attack2: 1.0, attack3: 1.15 };
      this.log = [];
    }
    M() { return this.cm || meta(); }
    get alive() { return this.hp > 0; }
    get acting() { return !!this.act; }
    get invulnerable() { return !!(this.act && this.act.name === "dodge" && this.act.f >= this.dodgeInv[0] && this.act.f <= this.dodgeInv[1]); }
    get stunned() { return !!(this.act && this.act.name === "stun"); }
    parryWindow() { return Math.max(0.07, C.parryWin - this.pen); }
    // segundos que faltan para el impacto del ataque en curso (null si no está preparando un ataque)
    toImpact() {
      const a = this.act;
      if (!a || !isAtk(a) || a.f >= HF(a) || a.charging) return null;   // (la carga del fuerte: no se sabe cuándo saldrá)
      const P = a.plan;
      if (P && !P.done) return (P.wind + P.hold + P.rel - P.t) / (a.speed || 1);
      const c = cumOf(this.M(), an(a));
      return (c[HF(a)] - (a.tt || 0)) * (a.slow || 1) / (a.speed || 1) / (a.prepK || 1);
    }
    // ---- entradas ------------------------------------------------------------------------
    input(type, data) {
      if (!this.alive) return false;
      if (type === "guardDown") {
        const pt = W.pressTime(data && data.ts, this.team === "player");
        // FINTA: guardia durante la preparación de tu ataque = lo cancelas (gasta stamina) y la pulsación sigue
        // como guardia
        const fa = this.act;
        if (fa && isAtk(fa) && fa.f < HF(fa) && !fa.plan && !fa.noFeint && this.st >= C.feintCost * 0.5) {
          this.st = Math.max(0, this.st - C.feintCost); this.stT = 0; this.act = null; this.atkHeld = false;
          if (W.combatLog) W.combatLog.push({ ev: "feint", who: this.name, anim: fa.name, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 });
          if (W.onFeint) W.onFeint(this, fa);
        }
        this.guardHeld = true;
        // spam: una pulsación seguida encoge la ventana del parry (se recupera sola); si la pulsación anterior desvió
        // algo, no es spam (golpes de varios enemigos, uno tras otro: un parry por golpe)
        if (pt - this.lastGuardT < C.spamGap && !this.pressDeflected) this.pen = Math.min(C.parryPenMax, this.pen + C.parryPen);
        this.pressDeflected = false;
        this.lastGuardT = pt;
        // entrenamiento: una pulsación justo después de que te alcanzara un golpe = «TARDE x ms»
        const li = W.lastFoeImpact;
        if (this.team === "player" && li && li.open && W.onLatePress) { const late = pt - li.t; if (late > 0 && late < 0.3) { li.open = false; W.onLatePress(late); } }
        this.buf = { type: "parry", t: this.time, pt, data };
        this.tryBuffered();
        return true;
      }
      if (type === "guardUp") { this.guardHeld = false; return true; }
      if (type === "attackUp") { this.atkHeld = false; return true; }          // suelta el golpe retenido
      // suelta la carga del fuerte (moves.js): si aún no ha empezado (en cola), sale con la carga mínima
      if (type === "chargeRelease") { this.chargeRel = true; return true; }
      if (type === "attack" && data && data.kind === "H") this.chargeRel = false;
      if (type === "attack" && data && data.hold) this.atkHeld = true;
      this.buf = { type, t: this.time, data, pt: type === "attack" ? (data && data.pt != null ? data.pt : W.pressTime(data && data.ts, this.team === "player")) : undefined };
      // L/H durante un golpe propio (combos, moves.js): a la cola del golpe (hasta 2 pulsaciones), no al búfer de una
      // plaza; así un toque rápido no se pierde aunque llegue antes de la ventana de encadenado
      const ca = this.act;
      if (type === "attack" && data && data.kind && ca && isAtk(ca) && ca.comboSeq != null && !ca.charging && !ca.noChain && !(ca.step && ca.step.end) && !this.body.jump) {
        const b = this.buf; this.buf = null; this.doAction("attack", b.data, b.pt); return true;
      }
      this.tryBuffered();
      return true;
    }
    tryBuffered() {
      const b = this.buf;
      if (!b) return;
      if (this.time - b.t > C.buffer) { this.buf = null; return; }
      if (this.can(b.type)) { this.buf = null; this.doAction(b.type, b.data, b.pt); }
    }
    // ¿se puede empezar esa acción ahora?
    can(type) {
      if (!this.alive) return false;
      if (this.body.jump) return type === "attack" && this.airCounterT > W.ct;   // contraataque en el aire
      const a = this.act;
      if (type === "jump") return !a;
      if (!a) {
        if (type === "dodge") return this.st >= C.dodgeCost * 0.5;
        return true;
      }
      if (a.name === "death" || a.name === "stun" || a.name === "deflected") return false;
      const cm = this.M().animations[an(a)] || {};
      const cancel = cm.cancel || {};
      const f = a.f;
      if (isAtk(a)) {
        if (type === "attack") {
          // riposte encadenado y remate: los decide duel.js (null = regla normal)
          const r = W.duelCan ? W.duelCan(this, a) : null;
          if (r != null) return r;
          // jugador con L/H (moves.js): en la ventana de encadenado de cualquier golpe que no cierre su combo
          if (a.comboSeq != null) return !a.noChain && !(a.step && a.step.end) && !a.charging && f >= HF(a);
          return !!cm.next && !a.noChain && f >= HF(a);               // ventana de encadenado: IMPACT..RECOVERY
        }
        if (type === "dodge") return (cancel.dodge || []).indexOf(f) >= 0 && this.st >= C.dodgeCost * 0.5;
        if (type === "parry") return f >= 4;
        return false;
      }
      if (a.name === "block") return type === "dodge" ? this.st >= C.dodgeCost * 0.5 : type === "attack" || type === "parry";
      // tras un parry perfecto se puede contraatacar al instante (ventana de contraataque)
      if (a.name === "parry") return type === "attack" && (this.counterT > W.ct || (this.rip && W.ct <= this.rip.until)) ? true : (type === "attack" || type === "dodge") ? f >= 4 : type === "parry" && f >= 3;
      if (a.name === "dodge") return f >= 5;
      if (a.name === "hit") return a.gb ? false : (type === "dodge" || type === "parry") ? f >= 4 : f >= 5;
      return false;
    }
    doAction(type, data, t0) {
      if (type === "attack" && this.body.jump) {
        // contraataque en el aire tras saltar un barrido: golpe de salto (attack3) que no se puede defender
        this.body.jump = null; this.airCounterT = 0; this.counterT = W.ct + 0.1;
        this.startAttack("attack3", data); this.act.air = true;
        return;
      }
      if (type === "attack") {
        // Duelo 3: riposte tras un parry (y su ritmo), remate al enemigo aturdido (duel.js)
        const dn = W.duelAttack ? W.duelAttack(this, data, t0) : null;
        if (dn === "queued" || dn === "none") return;
        if (dn) { this.act = null; this.startAttack(dn, data); return; }
        const a = this.act;
        if (data && data.kind && W.movesNext) {
          // L/H: la tabla de combos decide el golpe; pulsado antes de la recuperación queda en cola
          if (a && isAtk(a) && a.chain) { if (!a.chain2) a.chain2 = { data, pt: t0 }; return; }   // 2.ª en la cola
          // pulsado durante un golpe del combo (aunque sea antes de su ventana): sigue la secuencia
          const mv = W.movesNext(this, data.kind, t0, !!(a && isAtk(a) && a.comboSeq != null));
          if (a && isAtk(a) && a.f < HF(a) + 1) { a.chain = true; a.chainName = mv.step.anim; a.chainData = data; a.chainMv = mv; a.chainPt = t0; return; }
          this.act = null; this.startAttack(mv.step.anim, data, mv, t0); return;
        }
        const next = a && isAtk(a) && !a.noChain ? (this.M().animations[an(a)] || {}).next : null;
        // pulsado en IMPACT: queda marcado y el golpe siguiente empieza al entrar en FOLLOW THROUGH
        if (next && a.f < HF(a) + 1) { a.chain = true; a.chainData = data; return; }
        this.startAttack(next && next.startsWith("attack") ? next : "attack1", data);
      } else if (type === "parry") { this.guardT = t0 != null ? t0 : W.ct; this.start("parry", { pressT: this.guardT }); }
      else if (type === "dodge") this.startDodge(data);
      else if (type === "jump") this.body.doJump();
    }
    // ---- acciones --------------------------------------------------------------------------------
    start(name, extra) {
      const b = this.body;
      b.stop(); b.speed = 0; b.following = false;
      this.act = Object.assign({ name, t: 0, f: 0, fPrev: -1, hitDone: false, speed: 1 }, extra || {});
      // objetivo fijado (target.js): guardar o hacer parry gira al jugador al instante hacia él
      if ((name === "parry" || name === "block") && W.faceTarget) W.faceTarget(this);
      if (W.onCombatAct) W.onCombatAct(this, this.act);
      return this.act;
    }
    startAttack(name, data, mv, pt) {
      const k = name === "attack3" || name === "deathblow" ? 2 : name === "attack2" ? 1 : 0;
      // coste de stamina: el de su paso del combo (moves.js) o el de siempre; sin stamina, preparación más lenta
      const cost = mv && W.movesCost ? W.movesCost(mv.step, 1) : C.attackCost[k] * (name === "riposte" ? 0.5 : 1);
      const tired = !!mv && this.st < cost;
      this.st = Math.max(0, this.st - cost); this.stT = 0;
      const a = this.start(name, { chain: false, atk: true });
      a.slow = this.prepK;
      // hoja propia o sustituto (W.DUEL): riposte → attack1 ×1.4, deathblow → attack3, counter → attack1 rápido
      const R = W.duelSheet ? W.duelSheet(this, name) : null;
      if (R) { a.sheet = R.sheet; a.speed = R.speed; a.fb = R.fb; if (R.trail) a.trail = R.trail; if (R.noChain) a.noChain = true; a.slow = 1; }
      a.hf = hitFrame(this.M(), an(a));
      if (tired) { a.slow = (a.slow || 1) * W.MOVES.tiredSlow; a.tired = true; }
      if (mv && W.movesStarted) {
        W.movesStarted(this, a, mv.seq, mv.step, mv.rhythm);
        if (mv.step.charge) {
          // FUERTE: carga mientras se mantiene (frames de carga de su hoja en bucle; el sustituto, su frame de carga)
          const A = this.M().animations[an(a)] || {};
          // la carga cuenta desde la pulsación (en tiempo de juego, la da controls.js); 0,4 s ya pasaron al empezar
          a.charging = true; a.press = data && data.pressCt != null ? data.pressCt : pt != null ? pt : W.ct; a.chargeK = 0; a.level = 1;
          a.cl = A.carga && A.carga.length && an(a) === name ? A.carga : [Math.max(0, a.hf - 2)];
          a.lungeFrom = "release";
        }
      }
      if (data) {
        if (data.plan) { a.plan = Object.assign({ t: 0, hold: 0 }, data.plan); a.slow = 1; }
        if (data.move) a.move = data.move;
        if (data.show) a.show = data.show;
        if (data.crouch) a.crouch = data.crouch;
        if (data.lungeFrom) a.lungeFrom = data.lungeFrom;
        if (data.track) a.track = true;                // persigue al objetivo hasta el impacto (agarre, barrido)
        if (data.hold) a.holdable = true;              // retraso: se queda en la carga mientras se mantenga
      }
      // TOQUE: el ligero sale al SOLTAR (mantener = fuerte), así que el toque (~80-150 ms) se sumaba al golpe. Si sale
      // en el mismo paso en que se suelta, se recupera ese tiempo acelerando la preparación (hasta un 40 % de ella:
      // la anticipación se sigue viendo): el impacto llega como si hubiera empezado al pulsar
      if (data && data.tap > 0 && data.relCt === W.ct && !a.charging && !a.plan && name.startsWith("attack")) {
        const wd = cumOf(this.M(), an(a))[HF(a)] * (a.slow || 1) / (a.speed || 1), cut = Math.min(data.tap, wd * 0.4);
        if (cut > 0.005) { a.prepK = wd / (wd - cut); a.tapCut = +cut.toFixed(3); }
      }
      if (this.counterT && W.ct <= this.counterT && name !== "riposte" && name !== "deathblow") { a.counter = true; this.counterT = 0; }   // contraataque
      // atracción suave hacia el enemigo más cercano (delante, a menos de 3.4 u): gira hacia él y se acerca
      // durante la preparación hasta quedar a distancia de golpe
      // con objetivo fijado (jugador), va a por él (a ≤ 6 u) y se gira al instante; si no, el más cercano delante
      const lock = this === W.pf && W.getTarget ? W.getTarget() : null;
      const lockOk = lock && Math.hypot(lock.body.x - this.body.x, lock.body.z - this.body.z) <= 6;
      const tgt = lockOk ? lock : W.nearestFoe ? W.nearestFoe(this, (data && data.seek) || 3.4, 2.0) : null;
      if (lockOk) W.faceTarget(this);
      const b = this.body;
      if (data && data.dir != null && !tgt) b.heading = data.dir;
      if (tgt) {
        const dx = tgt.body.x - b.x, dz = tgt.body.z - b.z, d = Math.hypot(dx, dz);
        a.aim = Math.atan2(dz, dx);
        const want = (data && data.want) || this.attackWant[name] || 1.0;
        a.want = want; a.cap = (data && data.cap) || (name === "attack3" ? 1.6 : 0.9);
        a.lunge = Math.max(0, Math.min(d - want, a.cap));
        a.target = tgt;
      } else a.lunge = name === "attack3" ? 0.9 : name === "attack2" ? 0.35 : 0.25;   // estocada al aire
      a.moved = 0;
      if (W.duelStarted) W.duelStarted(this, a);     // riposte n.º, remate (duel.js)
    }
    startDodge(data) {
      const b = this.body;
      let dir = data && data.dir != null ? data.dir : b.heading + Math.PI;           // sin dirección: hacia atrás
      this.st = Math.max(0, this.st - C.dodgeCost); this.stT = 0;
      const a = this.start("dodge", { dir, moved: 0, ct0: W.ct });
      // la hoja pinta un paso atrás: el personaje mira al lado contrario de hacia donde se aparta (con objetivo
      // fijado, mira al objetivo: se aparta sin dejar de encararlo)
      b.heading = dir + Math.PI;
      if (W.faceTarget) W.faceTarget(this);
      return a;
    }
    hurt(opts) {
      // opts: {dmg, dir (rumbo del golpe), kb, heavy, guardBreak}
      this.hp = Math.max(0, this.hp - opts.dmg);
      this.flash = 1;
      const b = this.body;
      if (this.hp <= 0) { b.heading = opts.dir + Math.PI; this.start("death", { kb: (opts.kb || 0.4) * 0.8 * this.kbK, kdir: opts.dir, moved: 0 }); return "death"; }
      // Duelo 3 · reacción según el peso (enemigos): durante sus golpes pesados aguanta sin interrumpirse (hyper
      // armor: recibe el daño y destella); golpe ligero = respingo corto (IMPACT y RECOIL de hit, ~160 ms, casi sin
      // retroceso); golpe pesado = tambaleo completo con retroceso
      if (this.team !== "player" && !opts.guardBreak) {
        const a = this.act;
        if (a && isAtk(a) && a.armor && a.f < HF(a) + 1) { this.armorT = 0.2; return "armor"; }
        if (!opts.heavy) {
          b.heading = opts.dir + Math.PI;
          this.start("hit", { kb: (opts.kb || 0.35) * 0.3 * this.kbK, kdir: opts.dir, moved: 0, flinch: true, flinchEnd: 2 });
          return "flinch";
        }
      }
      b.heading = opts.dir + Math.PI;                   // mira a quien le golpea
      this.start("hit", { kb: (opts.kb || 0.35) * this.kbK * (opts.heavy && this.team !== "player" ? 1.25 : 1), kdir: opts.dir, moved: 0, gb: !!opts.guardBreak, speed: opts.guardBreak ? 0.62 : 1 });
      return "hit";
    }
    addPosture(v, o) {
      // o.noBreak: suma pero nunca rompe (el coste de desviar)
      if (o && o.noBreak) { this.post = Math.min(this.postMax, this.post + v); this.postT = 0; return false; }
      this.post = Math.min(this.postMax, this.post + v); this.postT = 0;
      if (this.post >= this.postMax && this.alive && !this.stunned && this.team !== "player") {
        this.start("stun", { t: 0, dur: this.stunTime });
        if (W.onStun) W.onStun(this);
        return true;
      }
      if (this.post >= this.postMax && this.alive && this.team === "player") {
        // el jugador con la postura rota (el enemigo le ha hecho parry): tambaleo largo, sin defensa
        this.post = this.postMax * 0.3;
        this.guardHeld = false;
        this.start("hit", { kb: 0.3, kdir: this.body.heading + Math.PI, moved: 0, gb: true, speed: 0.5 });
        if (W.onStun) W.onStun(this);
        return true;
      }
      return false;
    }
    // ---- defensa: qué pasa si un golpe llega AHORA -------------------------------------------
    // impactT: instante exacto del impacto (W.ct). Devuelve "evade" | "perfect" | "parry" | "partial" |
    // "block" | "open" | "none"; la antelación de la pulsación queda en this.lastEarly (s)
    defense(impactT) {
      if (!this.alive) return "none";
      if (this.invulnerable) return "evade";
      const a = this.act;
      if (a && (a.name === "stun")) return "open";
      const early = (impactT != null ? impactT : W.ct) - this.guardT;
      this.lastEarly = early;
      const pw = this.parryWindow();
      const inParry = a && a.name === "parry";
      // la pulsación cuenta aunque se mantenga (el parry ya pasó a guardia sostenida)
      const guarding = inParry || (a && a.name === "block");
      if (guarding && early >= -0.004 && early <= pw) return early <= Math.min(C.perfectWin, pw * 0.5) ? "perfect" : "parry";
      if (inParry && early > pw && early <= pw + C.parryPartial) return "partial";   // parry parcial = bloqueo
      if (a && a.name === "block") return "block";
      if (inParry && this.guardHeld) return "block";
      return "open";
    }
    // ---- paso ---------------------------------------------------------------------------------------
    update(dt) {
      this.time += dt;
      this.flash = Math.max(0, this.flash - dt / 0.11);
      this.pen = Math.max(0, this.pen - C.parryPenDecay * dt);
      // stamina: se recupera tras un momento sin gastarla (más despacio con la guardia alta)
      this.stT += dt;
      if (this.stT > C.staminaDelay) this.st = Math.min(this.stMax, this.st + this.stRegen * dt * (this.act && this.act.name === "block" ? C.blockRegenK : 1));
      // postura: baja sola si pasa un rato sin recibir; más deprisa con la guardia alta; más despacio con poca vida
      this.postT += dt;
      const guarding = this.act && this.act.name === "block" && this.guardHeld;
      if (this.postT > (guarding ? C.guardRecovDelay : (this.postDelay || C.postureDelay)) && !this.stunned) {
        const hpK = C.hpRecovMin + (1 - C.hpRecovMin) * Math.pow(Math.max(0, this.hp / this.hpMax), C.hpRecovPow);
        this.post = Math.max(0, this.post - (this.postDecay || C.postureDecay) * dt * hpK * (guarding ? C.guardRecovK : 1));   // (el relleno: su fatiga, más lenta)
      }
      if (this.buf) this.tryBuffered();
      // guardia mantenida al terminar otra acción (golpe, rotura de guardia...): vuelve a bloquear
      if (!this.act && this.guardHeld && this.alive && !this.body.jump) { this.start("block"); this.act.tt = 0.07; }
      const a = this.act, b = this.body;
      if (!a) return;
      b.path.length = 0; b.speed = 0;
      a.t += dt;
      if (a.name === "stun") {
        a.f = this.stunPose ? this.stunPose(a.t) : 2 + (Math.floor(a.t * this.stunRate) % 2);   // tambaleo (frames STAGGER de hit; el relleno, su pose)
        if (a.t >= a.dur) { if (!a.keepPost) this.post = this.postMax * 0.35; this.act = null; }   // (aturdido corto del relleno: conserva su fatiga)
        return;
      }
      // preparación más lenta (enemigo): los frames anteriores al activo avanzan más despacio
      let sp = a.speed, over = null;
      const P = a.plan;
      if (P && !P.done && isAtk(a)) {
        // plan del golpe: CARGA (0-1) → RETENCIÓN (1 fijo) → SUELTA (2) → impacto
        const c = cumOf(this.M(), an(a)), t1 = P.wind, t2 = t1 + P.hold, t3 = t2 + P.rel, h = HF(a);
        if (P.feintNow) a.tt = c[h - 1] - 1e-4;                   // finta: congelado al final de la carga
        else if (P.feint && P.t + dt * a.speed >= t1) { P.t = t1; a.tt = c[h - 1] - 1e-4; P.feintNow = true; if (this.onPhase) this.onPhase(a, "feint"); }
        else {
          P.t += dt * a.speed;
          if (P.hold > 0 && !P.held && P.t >= t1) { P.held = true; if (this.onPhase) this.onPhase(a, "hold"); }
          if (!P.released && P.t >= t2) { P.released = true; if (this.onPhase) this.onPhase(a, "release"); }
          if (P.t < t1) a.tt = P.t / t1 * c[h - 1];
          else if (P.t < t2) a.tt = c[h - 1] - 1e-4;
          else if (P.t < t3) a.tt = c[h - 1] + (P.t - t2) / P.rel * (c[h] - c[h - 1]);
          else { a.tt = c[h] + (P.t - t3); P.done = true; over = (P.t - t3) / (a.speed || 1); }
        }
      } else if (a.charging) {
        // carga del fuerte: CROUCH y luego los frames de carga en bucle; a 1,2 s nivel 2; a 1,8 s se suelta solo
        const c = cumOf(this.M(), an(a)), l0 = c[a.cl[0]], l1 = c[a.cl[a.cl.length - 1] + 1], M = W.MOVES;
        let nt = (a.tt || 0) + dt * sp;
        if (nt >= l1) nt = l0 + ((nt - l0) % Math.max(1e-3, l1 - l0));
        a.tt = nt;
        this.stT = 0;                                              // cargar también gasta: la stamina no se recupera
        const held = W.ct - a.press;
        a.chargeK = Math.max(0, Math.min(1, held / M.holdH2));
        if (a.level < 2 && held >= M.holdH2) { a.level = 2; if (W.onCharge2) W.onCharge2(this, a); }
        if (this.chargeRel || held >= M.holdMax) {
          // suelta: RELEASE → IMPACT → RECOVERY; el nivel 2 cuesta más stamina y pega más
          this.chargeRel = false; a.charging = false; a.held = +held.toFixed(3);
          if (a.level === 2) { const ex = W.movesCost(a.step, 2) - W.movesCost(a.step, 1); if (this.st < ex) { a.slow = (a.slow || 1) * M.tiredSlow; a.tired = true; } this.st = Math.max(0, this.st - ex); this.stT = 0;
            a.dmgK = (a.dmgK || 1) * M.level2.dmg; a.postK = (a.postK || 1) * M.level2.post; a.stopK = M.level2.stop; }
          a.tt = c[HF(a) - 1];
          if (W.onChargeRelease) W.onChargeRelease(this, a);
        }
      } else {
        if (a.slow && a.slow !== 1 && isAtk(a) && a.f < HF(a)) sp /= a.slow;
        if (a.prepK && isAtk(a) && a.f < HF(a)) sp *= a.prepK;        // toque recuperado (startAttack)
        if (a.recK && isAtk(a) && a.f > HF(a)) sp *= a.recK;          // recuperación larga (remate giratorio)
        let nt = (a.tt || 0) + dt * sp;
        // RETRASO: mientras se mantenga el ataque, la preparación se queda al final de la carga (frame 1)
        if (a.holdable && isAtk(a) && a.f < HF(a)) {
          const c2 = cumOf(this.M(), an(a))[HF(a) - 1];
          if (this.atkHeld && nt >= c2 && (a.heldT || 0) < C.holdMax) { nt = c2 - 1e-4; a.heldT = (a.heldT || 0) + dt; if (a.heldT >= C.holdMax) this.atkHeld = false; }
        }
        a.tt = nt;
      }
      const f = frameAt(an(a), a.tt, this.M());
      if (a.name === "block") {
        // bucle de la guardia (HOLD 1-2) mientras se mantiene; 3 = recibe un golpe; 5 = baja
        if (a.react != null) { a.react -= dt; a.f = 3; if (a.react <= 0) a.react = null; }
        else if (this.guardHeld && this.alive) { a.f = a.tt < 0.06 ? 0 : 1 + (Math.floor((a.tt - 0.06) / 0.09) % 2); }
        else { a.lowerT = (a.lowerT || 0) + dt; a.f = 5; if (a.lowerT > 0.08) this.act = null; }
        this.motion(a, dt);
        return;
      }
      if (a.name === "parry" && this.guardHeld && a.tt > 0.17) {
        // mantener = bloquear: del parry pasa a la guardia sostenida
        this.start("block", { tt: 0.06 });
        this.act.tt = 0.07;
        return;
      }
      if (f >= 6 || (a.flinchEnd != null && f >= a.flinchEnd)) {
        if (a.name === "death") { a.f = 5; return; }
        if (a.comboSeq != null && W.movesEnded) W.movesEnded(this, a);
        this.act = null;
        return;
      }
      a.fPrev = a.f; a.f = f;
      if (a.f !== a.fPrev) {
        // instante exacto del impacto: lo que el frame se pasó en este paso no cuenta (20 fps en móvil = hasta
        // 50 ms de error si se midiera con el frame)
        if (isAtk(a) && a.f >= HF(a) && a.fPrev < HF(a) && a.impactT == null) {
          const c = cumOf(this.M(), an(a));
          a.impactT = W.ct - Math.max(0, over != null ? over : (a.tt - c[HF(a)]) / Math.max(1e-6, sp));
          if (a.comboSeq != null && W.movesImpact) W.movesImpact(this, a);
        }
        if (W.onCombatFrame) W.onCombatFrame(this, a);
      }
      // combo: pulsación dentro de la ventana de encadenado
      if (isAtk(a) && a.chain && a.f >= HF(a) + 1) {
        a.chain = false; const nx = a.chainName || this.M().animations[an(a)].next; const mv = a.chainMv, pt = a.chainPt, q2 = a.chain2;
        this.act = null; this.startAttack(nx, a.chainData, mv, pt != null ? Math.max(pt, W.ct - 0.05) : null);
        // la 2.ª pulsación de la cola pasa a ser la siguiente del golpe que empieza
        if (q2 && this.act && W.movesNext) { const mv2 = W.movesNext(this, q2.data.kind, q2.pt, true); Object.assign(this.act, { chain: true, chainName: mv2.step.anim, chainData: q2.data, chainMv: mv2, chainPt: q2.pt }); }
        return;
      }
      this.motion(a, dt);
    }
    // desplazamientos del cuerpo durante las acciones (estocada, esquiva, retroceso)
    motion(a, dt) {
      const b = this.body;
      if (isAtk(a)) {
        if (a.track && a.target && a.target.alive && a.f < HF(a)) {
          const tb = a.target.body, d = Math.hypot(tb.x - b.x, tb.z - b.z);
          a.aim = Math.atan2(tb.z - b.z, tb.x - b.x);
          a.lunge = Math.max(a.moved, Math.min(a.cap, a.moved + Math.max(0, d - a.want)));
        }
        if (a.aim != null) {
          const d = norm(a.aim - b.heading);
          b.heading += d * Math.min(1, dt * 22);
        }
        // la estocada ocurre durante la preparación y el impacto (frames 1-3)
        const c = cumOf(this.M(), an(a)), h = HF(a);
        const t0 = a.lungeFrom === "release" ? c[h - 1] : c[h - 2], t1 = c[h + 1];
        const u = Math.min(1, Math.max(0, (a.tt - t0) / (t1 - t0)));
        const want = a.lunge * (1 - Math.pow(1 - u, 2));
        const step = want - a.moved;
        if (step > 0) {
          // no atravesar al objetivo
          let s = step;
          if (a.target && a.target.alive) {
            const d = Math.hypot(a.target.body.x - b.x, a.target.body.z - b.z);
            s = Math.min(s, Math.max(0, d - 0.85));
          }
          b.tryMove(Math.cos(b.heading) * s, Math.sin(b.heading) * s);
          a.moved += step;
        }
      } else if (a.name === "dodge") {
        const c = cumOf(this.M(), "dodge");
        const u = Math.min(1, Math.max(0, (a.tt - c[1] * 0.5) / (c[5] - c[1] * 0.5)));
        const want = this.dodgeDist * (1 - Math.pow(1 - u, 2.2));
        const step = want - a.moved;
        if (step > 0) { b.tryMove(Math.cos(a.dir) * step, Math.sin(a.dir) * step); a.moved += step; }
      } else if (a.name === "hit" || a.name === "death" || a.name === "deflected") {
        const T = 0.28, u = Math.min(1, a.tt / T);
        const want = (a.kb || 0) * (1 - Math.pow(1 - u, 2));
        const step = want - a.moved;
        if (step > 0) { b.tryMove(Math.cos(a.kdir) * step, Math.sin(a.kdir) * step); a.moved += step; }
      }
    }
    respawn(x, z) {
      this.hp = this.hpMax; this.st = this.stMax; this.post = 0; this.act = null; this.buf = null; this.flash = 0;
      this.guardHeld = false; this.pen = 0; this.counterT = 0; this.airCounterT = 0; this._defl = null; this.rip = null;
      if (x != null) { const b = this.body; b.x = x; b.z = z; b.y = b.ground = W.heightAt(x, z); b.path = []; b.speed = 0; }
    }
  }
  W.Fighter = Fighter;
})();
