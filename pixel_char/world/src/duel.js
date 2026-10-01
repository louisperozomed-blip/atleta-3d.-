// duel.js — mejora del duelo: la recompensa del parry perfecto.
//
//  · DESEQUILIBRADO: tras tu parry perfecto el enemigo entra en DEFLECTED (~0,7 s) con el pecho expuesto: no se
//    defiende y tus golpes le quitan más postura. Hoja «deflected» (autómata) o, si no hay, sus frames de hit
//    (RECOIL/STAGGER) con retroceso y el cuerpo rebotando por código
//  · RIPOSTE: si atacas en esa ventana sale un contraataque rápido (hoja «riposte» o attack1 ×1,4 con estela
//    naranja). Hasta 3 golpes pulsando con buen ritmo; cada uno quita más postura y vida, con hitstop y sacudida
//    crecientes, y lo vuelve a desequilibrar. El 3.º solo entra si pulsas dentro de la VENTANA DE RITMO (anillo
//    sutil que se cierra sobre ti: ideal a los 170 ms del impacto del 2.º, ±80 ms); pronto o tarde, el enemigo se
//    recupera y lo desvía (sigue siendo un duelo, no un premio automático)
//  · parry normal: ventana de riposte más corta (0,32 s) y un solo golpe
//  · si su postura se rompe durante el riposte: DEATHBLOW directo (hoja «deathblow» o attack3 con efectos), con la
//    cámara un poco más cerca y un destello (fuera del riposte, el aturdido se remata como siempre)
//  · cada animación nueva es configurable: W.DUEL.sheets[nombre] = "auto" (la hoja si está en el atlas) o
//    "sustituto" (fuerza el sustituto de W.DUEL.fallback). Al añadir una hoja basta con procesarla
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const D = (W.DUEL = {
    sheets: { riposte: "auto", deathblow: "auto", deflected: "auto", counter: "auto" },
    fallback: {
      riposte: { sheet: "attack1", speed: 1.4, trail: 0xff8a2a },        // attack1 acelerado con estela naranja
      deathblow: { sheet: "attack3", speed: 1.0, fx: true },             // attack3 con destello y estallido
      deflected: { sheet: "hit", bounce: true },                          // RECOIL/STAGGER + rebote por código
      counter: { sheet: "attack1", speed: 1.35 },                         // attack1 rápido
    },
    deflectT: 0.7,                 // desequilibrado tras tu parry perfecto (s)
    ripWin: { perfect: 0.7, normal: 0.32 },   // ventana para empezar el riposte
    ripMax: { perfect: 3, normal: 1 },
    restagger: 0.45,               // cada golpe de riposte lo deja desequilibrado al menos esto más
    beat: 0.17, beatWin: 0.08,     // 3.er golpe: ritmo ideal tras el impacto del 2.º y su margen (±)
    // golpes del riposte: daño, postura, hitstop y sacudida crecientes
    // (postura: un riposte completo tras un parry perfecto deja la barra en ~3/4; romperla pide otro intercambio)
    hits: [{ dmg: 8, post: 10, stop: 0.07, shake: 0.05 }, { dmg: 10, post: 14, stop: 0.09, shake: 0.075 }, { dmg: 13, post: 20, stop: 0.13, shake: 0.11 }],
    deathblowDmg: 100, deathblowZoom: 0.16,
    recoverCost: 12,               // postura que te cuesta que desvíe tu 3.er golpe fuera de ritmo
  });
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const now3 = () => (W.U ? +W.U.uTime.value.toFixed(3) : 0);
  const logE = (e) => { e.t = now3(); W.combatLog.push(e); if (W.combatLog.length > 400) W.combatLog.shift(); };
  // eventos que van detrás del que los provoca (el «parry» lo escribe combat.js después de llamarnos)
  const pend = [];
  W.duelFlushLog = function () { while (pend.length) logE(pend.shift()); };

  // ---- hojas: la propia o el sustituto ----------------------------------------------------------------
  function dur(M, an) { return (M.animations[an] ? M.animations[an].ms : [100, 100, 100, 100, 100, 100]).reduce((x, y) => x + y, 0) / 1000; }
  W.duelSheet = function (f, name) {
    if (!(name in D.sheets)) return null;
    const M = f.M();
    if (D.sheets[name] !== "sustituto" && M.animations[name]) return { sheet: name, speed: 1, fb: false, noChain: true };
    const F = D.fallback[name];
    return { sheet: F.sheet, speed: F.speed || 1, fb: true, trail: F.trail, bounce: !!F.bounce, fx: !!F.fx, noChain: true };
  };
  W.duelUsesSheet = function (f, name) { const R = W.duelSheet(f, name); return !!R && !R.fb; };

  // ---- desequilibrado ----------------------------------------------------------------------------------
  // dir: rumbo del golpe desviado (del atacante hacia quien desvía); retrocede en sentido contrario
  W.duelDeflect = function (t, dir, T) {
    const R = W.duelSheet(t, "deflected");
    const sp = dur(t.M(), R.sheet) / (T || D.deflectT);
    t.act = null; t.guardHeld = false;
    t.body.heading = dir + Math.PI;
    const a = t.start("deflected", { sheet: R.sheet, speed: sp, fb: R.fb, bounce: R.bounce, kb: 0.38 * (t.kbK || 1), kdir: dir + Math.PI, moved: 0, exposed: true, ct0: W.ct });
    if (t.ai && t.ai.onDeflectedState) t.ai.onDeflectedState();
    pend.push({ ev: "deflected", who: t.name, sheet: R.sheet, fb: R.fb });
    return a;
  };
  // otro golpe lo vuelve a desequilibrar (vuelve a OFF BALANCE)
  function restagger(t, dir) {
    const a = t.act;
    if (a && a.name === "deflected") {
      const c = W.combatFrameAt ? cumStart(t, a.sheet, 2) : 0;
      if (a.tt > c) { a.tt = c + 1e-3; a.f = 2; }
      a.bt = 0;                                          // rebote de nuevo
      return;
    }
    if (!t.stunned && t.alive) { W.duelDeflect(t, dir + Math.PI); W.duelFlushLog(); }
  }
  function cumStart(f, an, i) { const ms = f.M().animations[an].ms; let s = 0; for (let k = 0; k < i; k++) s += ms[k] / 1000; return s; }

  // ---- parry: abre el riposte ---------------------------------------------------------------------------
  // t: quien desvía, att: el desviado, dir: rumbo del golpe. true = ya se encargó de la reacción del atacante
  W.duelOnParry = function (t, att, perfect, dir, a) {
    if (t.team !== "player") return false;
    // intercambio de desvíos (clin-clin): desviaste su COUNTER. Si es perfecto, él puede volver a contraatacar
    // (cada vez más deprisa y con más probabilidad de fallar); pierde quien falla primero
    if (a && a.xchg && att.ai && att.ai.onExchange) {
      const r = att.ai.onExchange(perfect, a);
      if (r === "again") {
        att.act = null; att.start("hit", { kb: 0.18, kdir: dir + Math.PI, moved: 0, speed: 1.7, recoil: true, xchgRecoil: true });
        t.rip = null; t.counterT = 0;
        pend.push({ ev: "xchg", n: a.xchg, result: "again" });
        return true;
      }
      pend.push({ ev: "xchg", n: a.xchg, result: perfect ? "foeFails" : "end" });
      if (perfect) {
        // falla él: más desequilibrado que nunca → riposte
        t.rip = { target: att, until: W.ct + D.ripWin.perfect + 0.2, max: 3, n: 0, level: "perfect", beat: null, bad: false, t0: W.ct };
        pend.push({ ev: "ripOpen", level: "perfect", max: 3, win: D.ripWin.perfect + 0.2, xchg: true });
        W.duelDeflect(att, dir, D.deflectT + 0.2);
        return true;
      }
    }
    const k = perfect ? "perfect" : "normal";
    t.rip = { target: att, until: W.ct + D.ripWin[k], max: D.ripMax[k], n: 0, level: k, beat: null, bad: false, t0: W.ct };
    pend.push({ ev: "ripOpen", level: k, max: t.rip.max, win: D.ripWin[k] });      // tras el «parry» (combat.js)
    if (!perfect) return false;                          // normal: retrocede como siempre
    W.duelDeflect(att, dir);
    return true;
  };

  // ---- pulsaciones de ataque del jugador ---------------------------------------------------------------
  function stunnedFoe(f) {
    let best = null, bd = 2.7;
    for (const o of W.fighters) {
      if (o.team === f.team || !o.alive || !o.stunned) continue;
      const d = Math.hypot(o.body.x - f.body.x, o.body.z - f.body.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  W.duelCan = function (f, a) {
    if (f.team !== "player") return null;
    if (a.name === "riposte") return true;               // lo decide duelAttack (ritmo)
    if (a.name === "deathblow") return false;
    return null;
  };
  // devuelve el golpe que sale ("riposte", "deathblow"), "queued" (encadenado), "none" (se ignora) o null (normal)
  W.duelAttack = function (f, data, pt) {
    if (f.team !== "player") return null;
    const a = f.act, inRip = a && a.name === "riposte";
    if (a && a.name === "deathblow") return "none";
    if (pt == null) pt = W.ct;
    const R = f.rip;
    if (!R || R.done) return inRip ? "none" : null;
    if (W.ct > R.until || !R.target.alive || R.n >= R.max) { if (!inRip) R.done = true; return inRip ? "none" : null; }
    if (inRip && a.chain) return "none";
    const n = R.n + 1;
    if (n === 3) {
      // ritmo del 3.er golpe: respecto al impacto del 2.º (si aún no ha llegado, es que machacas: pronto)
      if (R.beat == null) { R.err = null; R.bad = true; }
      else { R.err = pt - R.beat; R.bad = Math.abs(R.err) > D.beatWin; }
      logE({ ev: "ripBeat", err: R.err == null ? null : Math.round(R.err * 1000), ok: !R.bad, early: R.beat == null });
      if (W.onRipBeat) W.onRipBeat(!R.bad, R.err);
      ring.hit = R.bad ? "bad" : "ok"; ring.hitT = 0;
    }
    R.n = n;
    if (inRip && a.f < 4) { a.chain = true; a.chainName = "riposte"; a.chainData = data; return "queued"; }
    return "riposte";
  };
  W.duelStarted = function (f, a) {
    if (a.name === "riposte" && f.rip) {
      const R = f.rip;
      a.ripN = R.n; a.ripBad = R.n === 3 && R.bad; a.noFeint = true; a.ripTarget = R.target;
      // el contraataque va a por el desequilibrado aunque esté a un paso más
      if (R.target && R.target.alive) { const b = f.body, tb = R.target.body, d = Math.hypot(tb.x - b.x, tb.z - b.z);
        a.target = R.target; a.aim = Math.atan2(tb.z - b.z, tb.x - b.x); a.want = 1.05; a.cap = 1.2; a.lunge = Math.max(0, Math.min(d - 1.05, 1.2)); }
      logE({ ev: "ripStart", n: a.ripN, bad: a.ripBad, sheet: a.sheet });
    }
    if (a.name === "deathblow") {
      a.noFeint = true;
      const sf = stunnedFoe(f) || (f.rip && f.rip.target);
      if (sf) { const b = f.body, tb = sf.body, d = Math.hypot(tb.x - b.x, tb.z - b.z); a.target = sf; a.aim = Math.atan2(tb.z - b.z, tb.x - b.x); a.want = 1.1; a.cap = 1.6; a.lunge = Math.max(0, Math.min(d - 1.1, 1.6)); }
      if (f.rip) f.rip.done = true;
      cam.k = D.deathblowZoom; cam.t = 0; cam.on = true;
      logE({ ev: "deathblowStart", sheet: a.sheet, fb: a.fb });
    }
  };
  // transición directa al remate cuando su postura se rompe durante el riposte
  function deathblowNow(p, t) {
    p.act = null; p.buf = null;
    p.startAttack("deathblow", { dir: Math.atan2(t.body.z - p.body.z, t.body.x - p.body.x) });
  }
  W.duelDeathblowNow = deathblowNow;

  // ---- resolución de los golpes del duelo ------------------------------------------------------------------
  W.duelResolve = function (att, a, t, AT, c) {
    if (a.name !== "riposte" && a.name !== "deathblow") return false;
    if (t.invulnerable) return false;
    const FX = W.combatFx, b = att.body;
    if (a.name === "riposte") {
      const R = att.rip, n = Math.max(1, Math.min(3, a.ripN || 1)), P = D.hits[n - 1];
      if (a.ripBad && t === a.ripTarget && !t.stunned) {
        // fuera de ritmo: se ha recuperado y lo desvía
        t.act = null; t.guardHeld = false;
        t.body.heading = Math.atan2(b.z - t.body.z, b.x - t.body.x);
        t.start("parry", { pressT: W.ct }); t.lastDefT = W.ct;
        W.fx.dust(c.cx, c.cy - 0.35, c.cz, 26, { pal: FX.SPARK, spd: 2.6, up: 2.2, life: 0.4 });
        FX.star(c.cx, c.cy - 0.1, c.cz, 1.3, 0x9ff4ff, 0.2); FX.flash(c.cx, c.cy, c.cz, 0xbfefff, 4); FX.stop(FX.STOP.parry);
        W.shakeCam(c.dx, c.dz, 0.05, 0.22);
        if (W.sfx) W.sfx.combat("parry");
        att.addPosture(D.recoverCost, { noBreak: true });
        att.start("hit", { kb: 0.3, kdir: c.dir + Math.PI, moved: 0, speed: 1.3, recoil: true });
        if (R) R.done = true;
        FX.log({ ev: "ripDeflected", who: t.name, from: att.name, n, err: R && R.err != null ? Math.round(R.err * 1000) : null });
        if (t.ai && t.ai.onRipDeflected) t.ai.onRipDeflected(att);
        return true;
      }
      // golpe del riposte: no se puede defender; más daño, postura, hitstop y sacudida en cada uno
      const exposed = !!(t.act && t.act.exposed);
      t.hp = Math.max(0, t.hp - P.dmg); t.flash = 1;
      let broke = false;
      if (t.hp <= 0) t.start("death", { kb: 0.4 * (t.kbK || 1), kdir: c.dir, moved: 0 });
      else broke = t.addPosture(P.post * (exposed ? 1.15 : 1));
      const gold = n === 3 ? FX.GOLD : FX.EMBER;
      W.fx.dust(t.body.x - Math.cos(c.dir) * 0.1, t.body.y + 0.95, t.body.z - Math.sin(c.dir) * 0.1, 10 + 6 * n, { pal: gold, spd: 1.6 + 0.4 * n, up: 1.2 + 0.3 * n, life: 0.35 + 0.05 * n });
      FX.star(t.body.x - Math.cos(c.dir) * 0.15, t.body.y + 1.0, t.body.z - Math.sin(c.dir) * 0.15, 0.8 + 0.25 * n, n === 3 ? 0xffd040 : 0xffb070, 0.12 + 0.03 * n);
      FX.stop(P.stop); W.shakeCam(c.dx, c.dz, P.shake, 0.2 + 0.04 * n);
      FX.burst(t.body.x, t.body.z, 6 + 3 * n, n === 3);
      if (W.sfx) W.sfx.combat("riposte", n);
      if (R) {
        R.until = Math.max(R.until, W.ct + D.restagger);
        if (n === 2 && R.max >= 3) { R.beat = (a.impactT != null ? a.impactT : W.ct) + D.beat; ring.t0 = W.ct; ring.beat = R.beat; ring.on = true; ring.hit = null; }
        if (n >= R.max) R.done = true;
      }
      FX.log({ ev: "riposte", n, who: t.name, from: att.name, dmg: P.dmg, post: Math.round(t.post), hp: Math.round(t.hp), broke, sheet: a.sheet, stop: P.stop, shake: P.shake });
      if (t.alive && broke) { if (R) R.done = true; deathblowNow(att, t); }
      else if (t.alive) restagger(t, c.dir + Math.PI);
      return true;
    }
    // deathblow: el remate (no se puede defender)
    const dm = D.deathblowDmg;
    t.hp = Math.max(0, t.hp - dm); t.flash = 1;
    if (t.hp <= 0) t.start("death", { kb: 0.6 * (t.kbK || 1), kdir: c.dir, moved: 0 });
    else { t.act = null; t.post = t.postMax * 0.35; t.start("hit", { kb: 0.6 * (t.kbK || 1), kdir: c.dir, moved: 0 }); }   // como al acabar el aturdido
    W.fx.dust(t.body.x, t.body.y + 0.9, t.body.z, 34, { pal: FX.GOLD, spd: 2.8, up: 2.2, life: 0.6 });
    W.fx.dust(t.body.x, t.body.y + 0.9, t.body.z, 18, { pal: FX.EMBER, spd: 1.8, up: 1.4, life: 0.5 });
    FX.flash(t.body.x, t.body.y + 1.1, t.body.z, 0xfff0d0, 8);
    FX.star(t.body.x - Math.cos(c.dir) * 0.15, t.body.y + 1.0, t.body.z - Math.sin(c.dir) * 0.15, 2.2, 0xfff4d8, 0.3);
    FX.stop(0.2); W.shakeCam(c.dx, c.dz, 0.16, 0.4);
    FX.burst(t.body.x, t.body.z, 24, true);
    screenFlash(0.9);
    if (W.sfx) W.sfx.combat("deathblow");
    FX.log({ ev: "deathblow", who: t.name, from: att.name, anim: "deathblow", dmg: dm, hp: Math.round(t.hp), sheet: a.sheet, fb: !!a.fb });
    return true;
  };

  // ---- choque: los dos golpes llegan a la vez -----------------------------------------------------------
  // a la vez = el del otro impacta a menos de 80 ms del tuyo, los dos os miráis y ninguno es peligroso ni de duelo
  const CLASH = 0.08;
  function peril(f, a) { const T = f.attacks || W.combatAttacks; const x = T && T[a.move || a.name]; return !!(x && x.perilous); }
  W.duelClash = function (att, a, t, AT, c) {
    const ta = t.act;
    if (!ta || !W.isAtk(ta) || AT.perilous || peril(t, ta) || a.counter || ta.counter) return false;
    if (["riposte", "deathblow"].includes(a.name) || ["riposte", "deathblow"].includes(ta.name) || t.body.jump || att.body.jump) return false;
    const tl = t.toImpact(), ti = a.impactT != null ? a.impactT : W.ct;
    const sync = (ta.f < 3 && tl != null && tl <= CLASH) || (ta.f >= 3 && ta.impactT != null && Math.abs(ta.impactT - ti) <= CLASH);
    if (!sync) return false;
    const face = Math.abs(norm(Math.atan2(att.body.z - t.body.z, att.body.x - t.body.x) - t.body.heading));
    if (face > 1.6) return false;
    const FX = W.combatFx;
    for (const [f, d] of [[att, c.dir + Math.PI], [t, c.dir]]) { f.act = null; f.start("hit", { kb: 0.5 * (f.kbK || 1) + 0.15, kdir: d, moved: 0, speed: 1.3, recoil: true, clash: true }); f.lastDefT = W.ct; }
    W.fx.dust(c.cx, c.cy - 0.3, c.cz, 56, { pal: FX.SPARK, spd: 3.6, up: 2.8, life: 0.55 });
    W.fx.dust(c.cx, c.cy - 0.3, c.cz, 20, { pal: FX.GOLD, spd: 2.4, up: 2.0, life: 0.5 });
    FX.star(c.cx, c.cy - 0.1, c.cz, 2.0, 0xfff4d0, 0.3); FX.flash(c.cx, c.cy, c.cz, 0xffe8c0, 7);
    FX.stop(0.13); W.shakeCam(c.dx, c.dz, 0.09, 0.3);
    if (W.sfx) W.sfx.combat("clash");
    FX.log({ ev: "clash", who: t.name, from: att.name, anim: a.name, other: ta.name, dt: Math.round(((ta.impactT != null ? ta.impactT : W.ct + (tl || 0)) - ti) * 1000) });
    for (const f of [att, t]) if (f.ai && f.ai.onClash) f.ai.onClash();
    return true;
  };

  // ---- destello de pantalla y cámara -------------------------------------------------------------------
  let flashEl = null, flashV = 0;
  function screenFlash(v) {
    if (!flashEl) {
      const wrap = document.getElementById("wrap"); if (!wrap) return;
      flashEl = document.createElement("div"); flashEl.id = "dflash";
      flashEl.style.cssText = "position:absolute;inset:0;pointer-events:none;background:#fff6e0;opacity:0;z-index:3;mix-blend-mode:screen";
      wrap.appendChild(flashEl);
    }
    flashV = Math.max(flashV, v);
  }
  W.duelFlash = screenFlash;
  const cam = (W.DUEL_CAM = { k: 0, t: 0, on: false, cur: 0 });
  // acercamiento de la cámara (feel.js lo multiplica en su zoom)
  W.duelZoom = function () { return cam.cur; };

  // ---- anillo del ritmo (sutil) --------------------------------------------------------------------------
  const ring = (W.DUEL_RING = { on: false, t0: 0, beat: 0, hit: null, hitT: 0, m: null });
  function ringTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(255,255,255,1)"; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.stroke();
    return new THREE.CanvasTexture(c);
  }
  function updateRing(dt) {
    if (!W.scene || typeof THREE === "undefined") return;
    if (!ring.m) {
      ring.m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex(), color: 0xffd34a, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      ring.m.renderOrder = 21; ring.m.visible = false; W.scene.add(ring.m);
    }
    const m = ring.m, p = W.pf;
    if (!ring.on || !p) { m.visible = false; return; }
    const span = Math.max(0.05, ring.beat - ring.t0), u = (W.ct - ring.t0) / span;
    const end = ring.beat + D.beatWin + 0.15;
    if (ring.hit) ring.hitT += dt;
    if (W.ct > end && (!ring.hit || ring.hitT > 0.3)) { ring.on = false; m.visible = false; return; }
    m.visible = true;
    m.position.set(p.body.x, p.body.y + W.CHAR_H * 0.55, p.body.z);
    let s = 1.6 - 0.9 * Math.min(1, u), op = 0.22 + 0.25 * Math.min(1, u);
    const inWin = Math.abs(W.ct - ring.beat) <= D.beatWin;
    let col = inWin ? 0xffe27a : 0xffb060;
    if (ring.hit === "ok") { s = 0.7 + ring.hitT * 2.2; op = Math.max(0, 0.85 - ring.hitT * 3); col = 0xffd040; }
    else if (ring.hit === "bad") { s = 0.7 + ring.hitT; op = Math.max(0, 0.6 - ring.hitT * 2.4); col = 0xff5a3a; }
    else if (W.ct > ring.beat + D.beatWin) op *= Math.max(0, 1 - (W.ct - ring.beat - D.beatWin) / 0.15);
    m.scale.set(s, s, 1); m.material.opacity = op; m.material.color.setHex(col);
  }

  // ---- paso: rebote, estela, cámara, destello ----------------------------------------------------------
  W.duelAfter = function (dt) {
    const th = W.ui ? W.ui.theta : Math.PI / 4;
    for (const f of W.fighters || []) {
      const a = f.act;
      if (!a) continue;
      // desequilibrado sin hoja: el cuerpo se echa atrás y vuelve (rebote amortiguado)
      if (a.name === "deflected" && a.bounce) {
        a.bt = (a.bt || 0) + dt;
        const hx = Math.cos(a.kdir), hz = Math.sin(a.kdir), xp = hx * Math.cos(th) - hz * Math.sin(th);
        a.bounceLean = (xp >= 0 ? 1 : -1) * 0.13 * Math.exp(-a.bt / 0.22) * Math.cos(a.bt * 16);
      }
      // estela naranja del riposte sustituto (attack1 acelerado)
      if (a.trail && a.f >= 2 && a.f <= 4 && W.fx) {
        const b = f.body, u = Math.min(1, (a.f - 2 + 0.5) / 3), ang = b.heading + (0.9 - 1.8 * u);
        for (let k = 0; k < 2; k++) {
          const r = 0.75 + Math.random() * 0.35, h = ang + (Math.random() - 0.5) * 0.25;
          W.fx.dust(b.x + Math.cos(h) * r, b.y + W.CHAR_H * (0.5 + 0.15 * Math.random()), b.z + Math.sin(h) * r, 1, { pal: [[1, 0.55, 0.16], [1, 0.75, 0.3], [1, 0.42, 0.1]], spd: 0.15, up: 0.2, life: 0.22 });
        }
      }
      // deathblow sustituto: brasas en la cuchilla mientras sube y baja
      if (a.name === "deathblow" && a.fb && a.f >= 1 && a.f <= 3 && W.fx && Math.random() < 0.6) {
        const b = f.body; W.fx.dust(b.x + Math.cos(b.heading) * 0.5, b.y + W.CHAR_H * 0.9, b.z + Math.sin(b.heading) * 0.5, 1, { pal: [[1, 0.8, 0.4], [1, 0.6, 0.2]], spd: 0.3, up: 0.6, life: 0.3 });
      }
    }
    // cámara un poco más cerca durante el remate
    const p = W.pf;
    if (cam.on) { cam.t += dt; if (!p || !p.act || p.act.name !== "deathblow") cam.on = cam.t < 0.25; }
    const want = cam.on ? cam.k : 0;
    cam.cur += (want - cam.cur) * (1 - Math.exp(-dt * (want > cam.cur ? 9 : 2.5)));
    if (Math.abs(cam.cur) < 1e-4) cam.cur = 0;
    if (flashEl) { flashV = Math.max(0, flashV - dt / 0.35); flashEl.style.opacity = (0.85 * flashV * flashV).toFixed(3); }
    updateRing(dt);
    // la ventana de riposte caduca
    if (p && p.rip && !p.rip.done && W.ct > p.rip.until && !(p.act && p.act.name === "riposte")) p.rip.done = true;
  };
  // para el HUD: fin de la ventana de riposte (o 0)
  W.duelRipUntil = function (p) { const R = p && p.rip; return R && !R.done && R.n < R.max ? R.until : 0; };
  W.duelRipSpan = function (p) { const R = p && p.rip; return R ? Math.max(0.1, R.until - R.t0) : 1; };
})();
