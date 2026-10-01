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
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  const C = (W.COMBAT = {
    buffer: 0.18,
    parryWin: 0.2, perfectWin: 0.07, parryPartial: 0.12, parryPen: 0.045, parryPenMax: 0.13, parryPenDecay: 0.12, spamGap: 0.7,
    counterWin: 0.35, counterDmg: 1.6, counterPost: 1.5,   // contraataque tras un parry perfecto
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
      const ref = W.manual ? performance.now() : (W.ctReal || performance.now());
      t += Math.max(-0.12, Math.min(0.05, (ts - ref) / 1000));
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
      if (!a || !a.name.startsWith("attack") || a.f >= 3) return null;
      const c = cumOf(this.M(), a.name);
      return (c[3] - (a.tt || 0)) * (a.slow || 1) / (a.speed || 1);
    }
    // ---- entradas ------------------------------------------------------------------------
    input(type, data) {
      if (!this.alive) return false;
      if (type === "guardDown") {
        const pt = W.pressTime(data && data.ts, this.team === "player");
        this.guardHeld = true;
        // spam: una pulsación seguida encoge la ventana del parry (se recupera sola)
        if (pt - this.lastGuardT < C.spamGap) this.pen = Math.min(C.parryPenMax, this.pen + C.parryPen);
        this.lastGuardT = pt;
        this.buf = { type: "parry", t: this.time, pt, data };
        this.tryBuffered();
        return true;
      }
      if (type === "guardUp") { this.guardHeld = false; return true; }
      this.buf = { type, t: this.time, data };
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
      if (!this.alive || this.body.jump) return false;
      const a = this.act;
      if (type === "jump") return !a;
      if (!a) {
        if (type === "dodge") return this.st >= C.dodgeCost * 0.5;
        return true;
      }
      if (a.name === "death" || a.name === "stun") return false;
      const cm = this.M().animations[a.name] || {};
      const cancel = cm.cancel || {};
      const f = a.f;
      if (a.name.startsWith("attack")) {
        if (type === "attack") return !!cm.next && f >= 3;            // ventana de encadenado: IMPACT..RECOVERY
        if (type === "dodge") return (cancel.dodge || []).indexOf(f) >= 0 && this.st >= C.dodgeCost * 0.5;
        if (type === "parry") return f >= 4;
        return false;
      }
      if (a.name === "block") return type === "dodge" ? this.st >= C.dodgeCost * 0.5 : type === "attack" || type === "parry";
      // tras un parry perfecto se puede contraatacar al instante (ventana de contraataque)
      if (a.name === "parry") return type === "attack" && this.counterT > W.ct ? true : (type === "attack" || type === "dodge") ? f >= 4 : type === "parry" && f >= 3;
      if (a.name === "dodge") return f >= 5;
      if (a.name === "hit") return a.gb ? false : (type === "dodge" || type === "parry") ? f >= 4 : f >= 5;
      return false;
    }
    doAction(type, data, t0) {
      if (type === "attack") {
        const a = this.act;
        const next = a && a.name.startsWith("attack") ? this.M().animations[a.name].next : null;
        // pulsado en IMPACT: queda marcado y el golpe siguiente empieza al entrar en FOLLOW THROUGH
        if (next && a.f < 4) { a.chain = true; a.chainData = data; return; }
        this.startAttack(next || "attack1", data);
      } else if (type === "parry") { this.guardT = t0 != null ? t0 : W.ct; this.start("parry", { pressT: this.guardT }); }
      else if (type === "dodge") this.startDodge(data);
      else if (type === "jump") this.body.doJump();
    }
    // ---- acciones --------------------------------------------------------------------------------
    start(name, extra) {
      const b = this.body;
      b.stop(); b.speed = 0; b.following = false;
      this.act = Object.assign({ name, t: 0, f: 0, fPrev: -1, hitDone: false, speed: 1 }, extra || {});
      if (W.onCombatAct) W.onCombatAct(this, this.act);
      return this.act;
    }
    startAttack(name, data) {
      const k = name === "attack3" ? 2 : name === "attack2" ? 1 : 0;
      this.st = Math.max(0, this.st - C.attackCost[k]); this.stT = 0;
      const a = this.start(name, { chain: false });
      a.slow = this.prepK;
      if (this.counterT && W.ct <= this.counterT) { a.counter = true; this.counterT = 0; }   // contraataque
      // atracción suave hacia el enemigo más cercano (delante, a menos de 3.4 u): gira hacia él y se acerca
      // durante la preparación hasta quedar a distancia de golpe
      const tgt = W.nearestFoe ? W.nearestFoe(this, 3.4, 2.0) : null;
      const b = this.body;
      if (data && data.dir != null && !tgt) b.heading = data.dir;
      if (tgt) {
        const dx = tgt.body.x - b.x, dz = tgt.body.z - b.z, d = Math.hypot(dx, dz);
        a.aim = Math.atan2(dz, dx);
        const want = this.attackWant[name] || 1.0;
        a.lunge = Math.max(0, Math.min(d - want, name === "attack3" ? 1.6 : 0.9));
        a.target = tgt;
      } else a.lunge = name === "attack3" ? 0.9 : name === "attack2" ? 0.35 : 0.25;   // estocada al aire
      a.moved = 0;
    }
    startDodge(data) {
      const b = this.body;
      let dir = data && data.dir != null ? data.dir : b.heading + Math.PI;           // sin dirección: hacia atrás
      this.st = Math.max(0, this.st - C.dodgeCost); this.stT = 0;
      const a = this.start("dodge", { dir, moved: 0 });
      // la hoja pinta un paso atrás: el personaje mira al lado contrario de hacia donde se aparta
      b.heading = dir + Math.PI;
      return a;
    }
    hurt(opts) {
      // opts: {dmg, dir (rumbo del golpe), kb, heavy, guardBreak}
      this.hp = Math.max(0, this.hp - opts.dmg);
      this.flash = 1;
      const b = this.body;
      if (this.hp <= 0) { b.heading = opts.dir + Math.PI; this.start("death", { kb: (opts.kb || 0.4) * 0.8 * this.kbK, kdir: opts.dir, moved: 0 }); return "death"; }
      b.heading = opts.dir + Math.PI;                   // mira a quien le golpea
      this.start("hit", { kb: (opts.kb || 0.35) * this.kbK, kdir: opts.dir, moved: 0, gb: !!opts.guardBreak, speed: opts.guardBreak ? 0.62 : 1 });
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
      if (this.postT > (guarding ? C.guardRecovDelay : C.postureDelay) && !this.stunned) {
        const hpK = C.hpRecovMin + (1 - C.hpRecovMin) * Math.pow(Math.max(0, this.hp / this.hpMax), C.hpRecovPow);
        this.post = Math.max(0, this.post - C.postureDecay * dt * hpK * (guarding ? C.guardRecovK : 1));
      }
      if (this.buf) this.tryBuffered();
      // guardia mantenida al terminar otra acción (golpe, rotura de guardia...): vuelve a bloquear
      if (!this.act && this.guardHeld && this.alive && !this.body.jump) { this.start("block"); this.act.tt = 0.07; }
      const a = this.act, b = this.body;
      if (!a) return;
      b.path.length = 0; b.speed = 0;
      a.t += dt;
      if (a.name === "stun") {
        a.f = 2 + (Math.floor(a.t * this.stunRate) % 2);   // tambaleo (frames STAGGER de hit)
        if (a.t >= a.dur) { this.post = this.postMax * 0.35; this.act = null; }
        return;
      }
      // preparación más lenta (enemigo): los frames anteriores al activo avanzan más despacio
      let sp = a.speed;
      if (a.slow && a.slow !== 1 && a.name.startsWith("attack") && a.f < 3) sp /= a.slow;
      a.tt = (a.tt || 0) + dt * sp;
      const f = frameAt(a.name, a.tt, this.M());
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
      if (f >= 6) {
        if (a.name === "death") { a.f = 5; return; }
        this.act = null;
        return;
      }
      a.fPrev = a.f; a.f = f;
      if (a.f !== a.fPrev) {
        // instante exacto del impacto: lo que el frame se pasó en este paso no cuenta (20 fps en móvil = hasta
        // 50 ms de error si se midiera con el frame)
        if (a.name.startsWith("attack") && a.f >= 3 && a.fPrev < 3 && a.impactT == null) {
          const c = cumOf(this.M(), a.name);
          a.impactT = W.ct - Math.max(0, (a.tt - c[3]) / Math.max(1e-6, sp));
        }
        if (W.onCombatFrame) W.onCombatFrame(this, a);
      }
      // combo: pulsación dentro de la ventana de encadenado
      if (a.name.startsWith("attack") && a.chain && a.f >= 4) { a.chain = false; this.startAttack(this.M().animations[a.name].next, a.chainData); return; }
      this.motion(a, dt);
    }
    // desplazamientos del cuerpo durante las acciones (estocada, esquiva, retroceso)
    motion(a, dt) {
      const b = this.body;
      if (a.name.startsWith("attack")) {
        if (a.aim != null) {
          const d = norm(a.aim - b.heading);
          b.heading += d * Math.min(1, dt * 22);
        }
        // la estocada ocurre durante la preparación y el impacto (frames 1-3)
        const c = cumOf(this.M(), a.name);
        const t0 = c[1], t1 = c[4];
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
      } else if (a.name === "hit" || a.name === "death") {
        const T = 0.28, u = Math.min(1, a.tt / T);
        const want = (a.kb || 0) * (1 - Math.pow(1 - u, 2));
        const step = want - a.moved;
        if (step > 0) { b.tryMove(Math.cos(a.kdir) * step, Math.sin(a.kdir) * step); a.moved += step; }
      }
    }
    respawn(x, z) {
      this.hp = this.hpMax; this.st = this.stMax; this.post = 0; this.act = null; this.buf = null; this.flash = 0;
      this.guardHeld = false; this.pen = 0; this.counterT = 0; this._defl = null;
      if (x != null) { const b = this.body; b.x = x; b.z = z; b.y = b.ground = W.heightAt(x, z); b.path = []; b.speed = 0; }
    }
  }
  W.Fighter = Fighter;
})();
