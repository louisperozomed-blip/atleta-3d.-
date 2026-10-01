// group.js — combate en grupo (Combate completo, etapa 7).
//
//  · TURNOS: como mucho 2 enemigos atacan a la vez (W.groupCanAttack: un enemigo pide turno antes de empezar su
//    cadena y lo suelta al acabarla); el resto RODEA al jugador a ~3,6 u, repartidos en círculo, sin echarse encima
//  · ataques por la espalda o fuera de pantalla: flecha en el borde de la pantalla (o junto al personaje, si viene
//    por detrás) mientras el enemigo prepara el golpe; roja si es peligroso
//  · PINZA ocasional: dos autómatas libres a lados opuestos atacan sincronizados (impactos a ≤ 40 ms), con un aviso
//    doble claro: los dos ojos destellan a la vez, sonido propio y «¡PINZA!»
//  · MULTI-PARRY: si varios impactos caen con ≤ 150 ms entre ellos, una sola pulsación desvía todos los que estén en su
//    ventana, cada uno con su nivel (lo hace la defensa de siempre: la guardia cubre 360° y su ventana vale para todos
//    los golpes que lleguen dentro). Todos perfectos = DOBLE / TRIPLE PERFECTO: estallido dorado radial, cámara lenta
//    breve (~150 ms al 30 %), todos DEFLECTED y bonus de postura. El riposte de después va al objetivo fijado
//  · impactos más separados = un parry por golpe, sin penalización por spam si cada pulsación desvía algo (fighter.js)
//  · panel de pruebas: aparecer 2 o 3 autómatas alrededor (con la opción de mezclar con el eco)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const G = (W.GROUP = { max: 2, holders: new Map(), orbitR: 3.6, pincerP: 0.35, pincerCool: 4, pincerT: 0, multiWin: 0.15, mpBonus: 15, slow: [0.15, 0.3], mp: null, ind: new Map() });
  const now3 = () => (W.U ? +W.U.uTime.value.toFixed(3) : 0);
  const log = (e) => { e.t = now3(); W.combatLog.push(e); };
  const engaged = (f) => f.alive && !f.hidden && f.ai && f.ai.enabled && f.ai.state === "chase" && Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z) < 9;

  // ---- turnos --------------------------------------------------------------------------------------------
  W.groupCanAttack = function (f) {
    if (G.holders.has(f)) return true;
    if (G.holders.size >= G.max) return false;
    G.holders.set(f, W.ct); return true;
  };
  W.groupRelease = function (f) { G.holders.delete(f); };
  W.groupHolds = (f) => G.holders.has(f);
  // ¿cuántos enemigos te están atacando en grupo? (para decidir si los demás rodean)
  W.groupActive = function () { let n = 0; for (const f of W.foes || []) if (engaged(f)) n++; return n >= 2; };
  // puesto en el círculo para el que no tiene turno: repartidos por ángulo alrededor del jugador
  W.groupOrbit = function (f) {
    const L = (W.foes || []).filter((o) => engaged(o) && !G.holders.has(o));
    const i = L.indexOf(f); if (i < 0) return null;
    const pl = W.player, base = Math.atan2(f.body.z - pl.z, f.body.x - pl.x);
    // cada uno se queda cerca de su ángulo actual, pero separados al menos 2π/(n+2)
    const n = L.length, ang = base + (i - (n - 1) / 2) * (2 * Math.PI / (n + 3)) * 0.35;
    return { x: pl.x + Math.cos(ang) * G.orbitR, z: pl.z + Math.sin(ang) * G.orbitR, ang };
  };

  // ---- pinza -------------------------------------------------------------------------------------------
  function tryPincer(dt) {
    G.pincerT -= dt;
    if (G.pincerT > 0) return;
    G.pincerT = 0.6;
    const pl = W.player;
    const free = (W.foes || []).filter((f) => engaged(f) && f.type === "automaton" && !f.act && !f.ai.chain && f.ai.vent <= 0 && !f.ai.passive && f.ai.cool <= 0.4 && !f.ai.training &&
      Math.hypot(f.body.x - pl.x, f.body.z - pl.z) < 3.4);
    if (free.length < 2 || G.holders.size > 0) return;
    // dos a lados opuestos (más de 100° entre ellos, vistos desde el jugador)
    let pair = null;
    for (let i = 0; i < free.length && !pair; i++) for (let j = i + 1; j < free.length && !pair; j++) {
      const a = Math.atan2(free[i].body.z - pl.z, free[i].body.x - pl.x), b = Math.atan2(free[j].body.z - pl.z, free[j].body.x - pl.x);
      let d = Math.abs(a - b); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 1.75) pair = [free[i], free[j]];
    }
    if (!pair || Math.random() > G.pincerP) { G.pincerT = 1.2; return; }
    W.groupPincer(pair[0], pair[1]);
  }
  // los dos golpean a la vez: misma carga y suelta; la retención alinea los impactos (≤ 40 ms de diferencia)
  W.groupPincer = function (a, b, spread) {
    for (const f of [a, b]) { G.holders.set(f, W.ct); f.act = null; f.guardHeld = false; f.ai.commit = null; }
    const at = W.ct + 1.05, off = spread == null ? (Math.random() - 0.5) * 0.08 : spread;
    a.ai.pincerStrike(at); b.ai.pincerStrike(at + off);
    for (const f of [a, b]) { f.eyeBlink = 0; f.pincerFlash = 0.6; const e = W.automatonEye ? W.automatonEye(f) : null; if (e && W.combatStar) W.combatStar(e.p.x, e.p.y, e.p.z, 1.5, 0xff8a2a, 0.45); }
    if (W.sfx) W.sfx.combat("pincer");
    if (W.combatPop) W.combatPop("¡PINZA!", "#ff9a4a", W.pf);
    G.pincerT = G.pincerCool;
    log({ ev: "pincer", who: [a.name, b.name], at: +at.toFixed(3), off: +off.toFixed(3) });
  };

  // ---- multi-parry ------------------------------------------------------------------------------------------
  // combat.js lo llama en cada parry del jugador: los que caen en la ventana de la misma pulsación forman grupo
  W.multiParryNote = function (t, att, perfect) {
    if (t !== W.pf) return;
    let M = G.mp;
    if (!M || M.press !== t.guardT || W.ct - M.t0 > G.multiWin + 0.02) M = G.mp = { press: t.guardT, t0: W.ct, list: [], done: false };
    M.list.push({ att, perfect });
    if (M.list.length >= 2) M.due = W.ct + 0.01;      // se resuelve en cuanto se cierra la ventana (o llega el 3.º)
  };
  function resolveMulti() {
    const M = G.mp; if (!M || M.done || M.list.length < 2) return;
    if (W.ct < M.t0 + G.multiWin && M.list.length < 3 && (W.foes || []).some((f) => f.act && W.isAtk(f.act) && f.toImpact() != null && f.toImpact() < G.multiWin)) return;
    M.done = true;
    const n = M.list.length, all = M.list.every((x) => x.perfect), p = W.pf;
    log({ ev: "multiParry", n, perfect: all, levels: M.list.map((x) => (x.perfect ? "perfect" : "normal")) });
    if (!all) { if (W.combatPop) W.combatPop(n === 2 ? "DOBLE PARRY" : "TRIPLE PARRY", "#ffe08a", p); return; }
    // DOBLE / TRIPLE PERFECTO: estallido dorado radial, cámara lenta, todos desequilibrados y bonus de postura
    const b = p.body, FX = W.combatFx;
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; W.fx.dust(b.x + Math.cos(a) * 0.5, b.y + 1.0, b.z + Math.sin(a) * 0.5, 5, { pal: FX.GOLD, spd: 3.2, up: 1.4, life: 0.6 }); }
    FX.flash(b.x, b.y + 1.2, b.z, 0xffc444, 8); FX.star(b.x, b.y + 1.1, b.z, 2.4, 0xffd040, 0.35);
    if (W.slowmo) W.slowmo(G.slow[0], G.slow[1]);
    if (W.duelFlash) W.duelFlash(0.5);
    if (W.sfx) W.sfx.combat("multiPerfect", n);
    if (W.combatPop) W.combatPop(n === 2 ? "¡DOBLE PERFECTO!" : "¡TRIPLE PERFECTO!", "#ffd34a", p);
    for (const x of M.list) {
      const f = x.att; if (!f.alive) continue;
      f.addPosture(G.mpBonus, { noBreak: false });
      if (!(f.act && f.act.name === "deflected") && !f.stunned && W.duelDeflect) { W.duelDeflect(f, Math.atan2(f.body.z - b.z, f.body.x - b.x) + Math.PI); }
    }
    if (W.duelFlushLog) W.duelFlushLog();
    // el riposte va al objetivo fijado (si es uno de los desviados)
    const tg = W.getTarget ? W.getTarget() : null;
    if (p.rip && tg && M.list.some((x) => x.att === tg)) p.rip.target = tg;
  }

  // ---- indicador de borde: ataques por la espalda o fuera de pantalla ------------------------------------------
  function indicator(f) {
    let el = G.ind.get(f);
    if (!el) {
      el = document.createElement("div"); el.className = "edgeInd";
      el.innerHTML = "<i></i>";
      document.getElementById("wrap").appendChild(el); G.ind.set(f, el);
    }
    return el;
  }
  let css = false;
  function updateIndicators() {
    if (!css) {
      css = true; const s = document.createElement("style");
      s.textContent = `.edgeInd{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:6;display:none}
        .edgeInd i{position:absolute;left:-15px;top:-15px;width:30px;height:30px;background:#9ff4ff;clip-path:polygon(100% 50%,0 0,22% 50%,0 100%);filter:drop-shadow(0 0 4px #000)}
        .edgeInd.red i{background:#ff4a3a}.edgeInd.heavy i{background:#ff9a2a}.edgeInd.pulse i{transform:scale(1.25)}`;
      document.head.appendChild(s);
    }
    const r = document.getElementById("wrap").getBoundingClientRect(), W_ = r.width, H_ = r.height, pl = W.player;
    const ps = W.toScreen(pl.x, pl.y + 1.0, pl.z);
    for (const f of W.foes || []) {
      const el = indicator(f), a = f.act;
      const winding = f.alive && !f.hidden && a && W.isAtk(a) && a.f < W.hitF(a);
      if (!winding) { if (el.style.display !== "none") el.style.display = "none"; continue; }
      const s = W.toScreen(f.body.x, f.body.y + 1.0, f.body.z);
      const off = s[0] < 24 || s[0] > W_ - 24 || s[1] < 24 || s[1] > H_ - 24;
      // por la espalda: más de 110° respecto a hacia donde mira el jugador
      let back = Math.abs(Math.atan2(f.body.z - pl.z, f.body.x - pl.x) - pl.heading); if (back > Math.PI) back = 2 * Math.PI - back;
      const behind = back > 1.92;
      if (!off && !behind) { el.style.display = "none"; continue; }
      const dx = s[0] - ps[0], dy = s[1] - ps[1], ang = Math.atan2(dy, dx);
      let x, y;
      if (off) {
        // en el borde, en la dirección del enemigo
        const kx = dx > 0 ? (W_ - 26 - ps[0]) / dx : (26 - ps[0]) / dx, ky = dy > 0 ? (H_ - 26 - ps[1]) / dy : (26 - ps[1]) / dy, k = Math.min(Math.abs(kx), Math.abs(ky));
        x = ps[0] + dx * k; y = ps[1] + dy * k;
      } else { x = ps[0] + Math.cos(ang) * 70; y = ps[1] + Math.sin(ang) * 70; }   // junto al personaje
      el.style.display = "block";
      el.style.transform = `translate(${x}px,${y}px) rotate(${ang}rad)`;
      const lvl = a.level || 1;
      el.classList.toggle("red", lvl >= 3); el.classList.toggle("heavy", lvl === 2);
      el.classList.toggle("pulse", Math.sin(W.ct * 18) > 0);
      el.dataset.foe = (W.foes || []).indexOf(f); el.dataset.kind = off ? "borde" : "espalda";
    }
  }

  W.groupUpdate = function (dt) {
    if (!W.foes || !W.pf) return;
    // turnos: se sueltan los que ya no atacan (sin cadena ni golpe en curso) y los muertos
    // (el que lo pidió tiene 2,5 s para acercarse y empezar)
    for (const [f, t0] of G.holders) { const busy = f.act || (f.ai && (f.ai.chain || f.ai.pincerAt != null)); if (busy) G.holders.set(f, W.ct); if (!f.alive || f.hidden || (!busy && W.ct - G.holders.get(f) > 2.5)) G.holders.delete(f); }
    if (W.groupActive()) tryPincer(dt);
    resolveMulti();
    updateIndicators();
  };
  W.groupState = () => ({ holders: [...G.holders.keys()].map((f) => (W.foes || []).indexOf(f)), active: W.groupActive() });

  // ---- panel: aparecer un grupo alrededor del jugador --------------------------------------------------------
  W.spawnGroup = function (n, mixEcho) {
    const types = [];
    for (let i = 0; i < n; i++) types.push("automaton");
    if (mixEcho) types.push("echo");
    const p = W.player, h = W.heightAt(p.x, p.z);
    if (W.clearFoes) W.clearFoes();
    G.holders.clear();
    const m = types.length;
    types.forEach((t, k) => {
      const a = k * 2 * Math.PI / m + 0.4;
      const s = W.findSpot(p.x + Math.cos(a) * 4.6, p.z + Math.sin(a) * 4.6, h, 0.8) || W.findSpot(p.x + Math.cos(a) * 3, p.z + Math.sin(a) * 3, null, 0.6);
      if (!s) return;
      W.addFoe(t, { x: s.x, z: s.z, heading: Math.atan2(p.z - s.z, p.x - s.x), zone: "grupo" });
    });
    W.enemyType = "grupo";
    log({ ev: "group", n: types.length, types });
    return W.foes;
  };
})();
