// combat.js — resolución de golpes y sensación de impacto.
//
//  · hitbox en el suelo: arco delante del atacante (generoso: ±70°, ±85° en attack3), activa SOLO en el
//    frame activo (IMPACT) de cada ataque; un golpe alcanza a cada objetivo una vez
//  · defensa del objetivo en ese instante (fighter.defense): esquiva (invulnerable), parry, bloqueo o golpe
//  · parry por niveles (fighter.defense, con el instante exacto del impacto):
//      PERFECTO  chispas doradas, sonido propio, hitstop más largo, mucha postura al atacante, 0 para ti y
//                ventana de contraataque (~350 ms: el golpe que empieces en ella hace daño extra y no se defiende)
//      NORMAL    postura media al atacante y un pequeño coste de postura para ti
//      BLOQUEO   sin postura al atacante, más coste para ti y gasto de stamina (sin stamina, guardia rota)
//  · bloqueo: daño reducido, gasta stamina; sin stamina se rompe la guardia
//  · postura llena = aturdido; golpear a un aturdido es un remate (daño ×3)
//  · ataques PELIGROSOS (AT.perilous): no se desvían ni se bloquean; cada uno tiene su respuesta:
//      "jump"   barrido bajo: saltar (y contraatacar en el aire)
//      "mikiri" estocada: esquivar HACIA el atacante en sus frames invulnerables = contraataque (mucha postura);
//               cualquier otra esquiva a tiempo, la evita sin más
//      "side"   agarre: esquivar de lado (la esquiva hacia delante o hacia atrás no basta: te atrapa)
//  · sensación: hitstop 60-120 ms (más en attack3 y en el parry), sacudida de cámara en la dirección del
//    golpe, destello blanco en quien lo recibe, partículas según el terreno y sonidos (audio.js)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const fighters = (W.fighters = []);
  // ataques del jugador; cada enemigo puede traer su tabla (f.attacks: dmg, reach, arc, stop, kb, heavy, post)
  const PLAYER_ATTACKS = {
    attack1: { dmg: 10, reach: 1.6, arc: 70, stop: 0.075, kb: 0.35, post: 38 },
    attack2: { dmg: 12, reach: 1.65, arc: 70, stop: 0.085, kb: 0.35, post: 38 },
    attack3: { dmg: 22, reach: 1.95, arc: 85, stop: 0.12, kb: 0.6, heavy: true, post: 48 },
  };
  const STOP = { attack1: 0.075, attack2: 0.085, attack3: 0.12, parry: 0.11, parryHeavy: 0.13, perfect: 0.16, perfectHeavy: 0.18, block: 0.06, deathblow: 0.16 };
  // recompensas por nivel (postura al atacante: × su "post"; coste de postura para quien defiende)
  const LEVEL = (W.PARRY_LEVELS = {
    perfect: { atkPost: 1.33, defPost: 0, defPostHeavy: 0 },
    parry: { atkPost: 1.0, defPost: 7, defPostHeavy: 10 },
    block: { atkPost: 0, defPost: 18, defPostHeavy: 26, st: 22, stHeavy: 36 },
  });
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // postura que gana el atacante desviado: su "post" × nivel + racha dentro de la misma cadena de ataques
  // (la cadena la marca la IA en act.chainId; si no, golpes seguidos a menos de chainGap s)
  W.parryPostGain = function (att, t, AT, level) {
    const C = W.COMBAT, base = (AT.post || 38) * LEVEL[level === "perfect" ? "perfect" : "parry"].atkPost;
    const s = att._defl || (att._defl = { n: 0, t: -9, key: null });
    const key = att.act && att.act.chainId != null ? att.act.chainId : null;
    const same = key != null ? key === s.key : W.ct - s.t < C.chainGap;
    s.n = same ? s.n + 1 : 1; s.t = W.ct; s.key = key;
    return base + C.chainBonus * (s.n - 1);
  };
  const breakStreak = (att) => { if (att._defl) att._defl.n = 0; };
  W.combatLog = [];
  function log(e) { e.t = W.U ? +W.U.uTime.value.toFixed(3) : 0; W.combatLog.push(e); if (W.combatLog.length > 400) W.combatLog.shift(); feedback(e); }
  // aviso sobre el personaje de lo que acaba de pasar (¡PARRY!, BLOQUEO...): así se ve si ha salido
  const FB = {
    parry: ["PARRY", "#ffe08a", "who"], block: ["BLOQUEO", "#b8d8ff", "who"], guardbreak: ["GUARDIA ROTA", "#ff6a4a", "who"],
    counter: ["¡CONTRA!", "#ffd34a", "from"], mikiri: ["¡CONTRAATAQUE!", "#ffd34a", "who"], grab: ["¡ATRAPADO!", "#ff6a4a", "who"],
    evade: ["ESQUIVA", "#9fe8c8", "who"], playerPostureBreak: ["POSTURA ROTA", "#ff8a5a", "who"], stun: ["ATURDIDO", "#fff3b0", "who"], deathblow: ["¡REMATE!", "#ffb070", "who"],
  };
  const pops = [];
  function feedback(e) {
    const d = FB[e.ev];
    if (!d || !hud) return;
    const f = fighters.find((x) => x.name === e[d[2]]);
    if (!f) return;
    // los avisos defensivos solo para el jugador; aturdido y remate, sobre el eco
    if ((e.ev === "block" || e.ev === "guardbreak" || e.ev === "evade") && f.team !== "player") return;
    if (e.ev === "parry" && f.team !== "player") { el0("¡DESVÍA!", "#9ff4ff", f); return; }
    const el = document.createElement("div");
    el.className = "cpop"; el.textContent = d[0]; el.style.color = d[1];
    if (e.ev === "parry" && e.level === "perfect") { el.textContent = "¡PERFECTO!"; el.style.color = "#ffd34a"; el.classList.add("gold"); }
    if (e.ev === "evade" && e.how === "jump") el.textContent = "¡SALTO!";
    if (e.ev === "mikiri") el.classList.add("gold");
    document.getElementById("wrap").appendChild(el);
    pops.push({ el, f, t: 0 });
  }
  function el0(txt, col, f) {
    if (!hud) return;
    const el = document.createElement("div"); el.className = "cpop"; el.textContent = txt; el.style.color = col;
    document.getElementById("wrap").appendChild(el); pops.push({ el, f, t: 0 });
  }
  W.combatPop = el0;
  function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const q = pops[i]; q.t += dt;
      if (q.t > 0.9) { q.el.remove(); pops.splice(i, 1); continue; }
      const b = q.f.body, s = W.toScreen(b.x, b.y + (q.f.ch && q.f.ch.height || W.CHAR_H) * 1.35, b.z);
      q.el.style.left = s[0] + "px"; q.el.style.top = (s[1] - q.t * 26) + "px";
      q.el.style.opacity = q.t < 0.6 ? 1 : 1 - (q.t - 0.6) / 0.3;
      q.el.style.transform = "translate(-50%,-100%) scale(" + (q.t < 0.08 ? 0.6 + q.t * 5 : 1) + ")";
    }
  }

  W.addFighter = function (f, ch) { f.ch = ch; fighters.push(f); return f; };
  W.nearestFoe = function (f, maxD, maxAng) {
    let best = null, bd = 1e9;
    for (const o of fighters) {
      if (o === f || o.team === f.team || !o.alive) continue;
      const dx = o.body.x - f.body.x, dz = o.body.z - f.body.z, d = Math.hypot(dx, dz);
      if (d > maxD) continue;
      if (maxAng != null && d > 0.8 && Math.abs(norm(Math.atan2(dz, dx) - f.body.heading)) > maxAng) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  // ---- hitstop y sacudida -----------------------------------------------------------------------------
  W.hitstop = 0;
  const shake = { x: 0, z: 0, amp: 0, t: 0, dur: 0.25 };
  W.shakeCam = function (dirx, dirz, amp, dur) {
    const l = Math.hypot(dirx, dirz) || 1;
    if (amp >= shake.amp * Math.max(0, 1 - shake.t / shake.dur)) Object.assign(shake, { x: dirx / l, z: dirz / l, amp, t: 0, dur: dur || 0.25 });
  };
  // desplazamiento de la cámara: primero empuja en la dirección del golpe y vuelve oscilando
  W.shakeOffset = function (dt, out) {
    if (shake.amp <= 0) { out.set(0, 0, 0); return out; }
    shake.t += dt;
    const u = shake.t / shake.dur;
    if (u >= 1) { shake.amp = 0; out.set(0, 0, 0); return out; }
    const k = shake.amp * Math.pow(1 - u, 2) * Math.cos(u * Math.PI * 5);
    out.set(shake.x * k, 0, shake.z * k);
    return out;
  };
  W.combatStep = function (dt) {
    W.ctReal = performance.now();
    if (W.hitstop > 0) { W.hitstop = Math.max(0, W.hitstop - dt); W.hitstopAcc = (W.hitstopAcc || 0) + dt; return 0; }
    W.ct += dt;                                      // reloj de combate (fighter.js)
    return dt;
  };
  function stop(v) { W.hitstop = Math.max(W.hitstop, v); }

  // ---- luz del destello (parry, remate) -----------------------------------------------------------------
  let flashL = null, flashT = 1, flashI = 0;
  function flashLight(x, y, z, color, I) {
    if (!flashL) return;
    flashL.position.set(x, y, z); flashL.color.setHex(color); flashI = I; flashT = 0;
  }

  // ---- destello en estrella en el punto de contacto (parry, golpe, bloqueo) --------------------------
  const stars = (W._stars = []);
  function makeStars(scene) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.18, "rgba(255,240,200,0.9)"); gr.addColorStop(0.5, "rgba(255,170,80,0.25)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = "lighter"; g.fillStyle = "rgba(255,245,220,0.9)";
    g.beginPath(); g.moveTo(32, 0); g.lineTo(35, 29); g.lineTo(64, 32); g.lineTo(35, 35); g.lineTo(32, 64); g.lineTo(29, 35); g.lineTo(0, 32); g.lineTo(29, 29); g.closePath(); g.fill();
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      m.visible = false; m.renderOrder = 20; scene.add(m); stars.push({ m, t: 1, dur: 0.15, size: 1 });
    }
  }
  let si = 0;
  function star(x, y, z, size, color, dur) {
    const s = stars[si++ % stars.length]; if (!s) return;
    s.m.position.set(x, y, z); s.m.material.color.setHex(color || 0xffffff); s.t = 0; s.dur = dur || 0.15; s.size = size; s.m.visible = true;
    s.m.material.rotation = Math.random() * Math.PI;
  }
  W.combatStar = function (x, y, z, size, color, dur) { star(x, y, z, size, color, dur); };
  function updateStars(dt) {
    for (const s of stars) {
      if (!s.m.visible) continue;
      s.t += dt / s.dur;
      if (s.t >= 1) { s.m.visible = false; continue; }
      const k = s.size * (0.6 + 0.8 * Math.sqrt(s.t));
      s.m.scale.set(k, k, 1); s.m.material.opacity = 1 - s.t * s.t;
    }
  }

  // ---- partículas según el terreno ------------------------------------------------------------------
  const PAL = {
    dust: [[0.55, 0.47, 0.38], [0.45, 0.38, 0.3], [0.62, 0.55, 0.45]],
    stone: [[0.6, 0.6, 0.58], [0.48, 0.48, 0.5], [0.7, 0.68, 0.62]],
    water: [[0.75, 0.97, 1], [0.5, 0.88, 0.95], [1, 1, 1]],
    grass: [[0.3, 0.42, 0.33], [0.36, 0.48, 0.38], [0.42, 0.55, 0.42]],
    leaves: [[0.45, 0.28, 0.2], [0.36, 0.3, 0.22], [0.5, 0.36, 0.24]],
    metal: [[1, 0.9, 0.62], [1, 0.72, 0.36], [1, 0.95, 0.8]],
  };
  const EMBER = [[1, 0.62, 0.2], [1, 0.85, 0.45], [1, 0.4, 0.12]];
  const SPARK = [[1, 0.95, 0.75], [1, 0.8, 0.4], [1, 1, 1]];
  const GOLD = [[1, 0.84, 0.3], [1, 0.95, 0.6], [1, 0.7, 0.16], [1, 1, 0.85]];
  function surf(x, z) { return (W.surfaceAt && W.surfaceAt(x, z)) || "dust"; }
  function groundBurst(x, z, n, heavy) {
    const k = surf(x, z), y = W.heightAt(x, z);
    W.fx.dust(x, k === "water" ? y + 0.045 : y, z, n, { pal: PAL[k] || PAL.dust, spd: heavy ? 1.6 : 1.1, up: heavy ? 1.6 : 1.1, life: 0.55 });
    if (k === "water") { W.fx.ripple(x, y + 0.045, z, heavy ? 1.0 : 0.6); }
    return k;
  }

  // ---- resolución --------------------------------------------------------------------------------
  const pendingHits = [];
  function flushHits() {
    for (let i = pendingHits.length - 1; i >= 0; i--) {
      const q = pendingHits[i];
      if (W.ct + 1e-6 < q.a.resolveAt) continue;
      pendingHits.splice(i, 1);
      if (q.f.alive && q.f.act === q.a) resolve(q.f, q.a);
    }
  }
  W.onCombatFrame = function (f, a) {
    if (a.name.startsWith("attack") && a.f >= 3 && !a.hitDone) {
      a.hitDone = true;
      // con calibración positiva (tus pulsaciones llegan tarde) el golpe que te lanzan se resuelve esos ms después
      // del impacto, para que una pulsación "tarde" llegue a contar
      const cal = (W.COMBAT.calib || 0) / 1000;
      if (cal > 0 && f.team !== "player") { a.resolveAt = (a.impactT != null ? a.impactT : W.ct) + cal; pendingHits.push({ f, a }); }
      else resolve(f, a);
    }
    if (a.name.startsWith("attack") && a.f === 2 && W.sfx) W.sfx.combat(a.name === "attack3" ? "swingHeavy" : "swing");
    if (a.name === "attack3" && a.f === 3) {
      // el golpe contra el suelo levanta tierra aunque no alcance a nadie
      const b = f.body, x = b.x + Math.cos(b.heading) * 0.9, z = b.z + Math.sin(b.heading) * 0.9;
      groundBurst(x, z, 22, true);
      W.shakeCam(Math.cos(b.heading), Math.sin(b.heading), 0.07, 0.3);
    }
    if (a.name === "dodge" && a.f === 1 && W.sfx) W.sfx.combat("dodge");
    if (a.name === "dodge" && a.f === 4) groundBurst(f.body.x, f.body.z, 6, false);
    if (a.name === "death" && a.f === 3) { groundBurst(f.body.x, f.body.z, 16, true); if (W.sfx) W.sfx.combat("death"); }
    if (W.onCombatFrameExtra) W.onCombatFrameExtra(f, a);
  };
  function resolve(att, a) {
    const AT = (att.attacks || PLAYER_ATTACKS)[a.move || a.name] || PLAYER_ATTACKS.attack1;
    const b = att.body, reach = AT.reach, arc = AT.arc * Math.PI / 180;
    let any = false;
    for (const t of fighters) {
      if (t === att || t.team === att.team || !t.alive) continue;
      const dx = t.body.x - b.x, dz = t.body.z - b.z, d = Math.hypot(dx, dz);
      const ang = Math.abs(norm(Math.atan2(dz, dx) - b.heading));
      const inArc = d <= reach + (t.radiusHit || 0.3) && (ang <= arc || d < 0.6 + (t.radiusHit || 0));
      log({ ev: "swing", who: att.name, anim: a.name, d: +d.toFixed(2), ang: Math.round(ang * 180 / Math.PI), inArc });
      // la estocada: quien esquiva HACIA ella cuenta aunque se cuele por su lado
      if (!inArc && !(AT.perilous === "mikiri" && t.invulnerable && d <= AT.reach + 1.5)) continue;
      any = true;
      const dir = Math.atan2(dz, dx);
      let def = t.defense(a.impactT);
      if (a.counter && def !== "evade") def = "open";        // el contraataque no se puede defender
      if (def === "partial") def = "block";                     // parry parcial = bloqueo
      const heavy = !!AT.heavy;
      const cx = (b.x + t.body.x) / 2, cz = (b.z + t.body.z) / 2, cy = Math.max(b.y, t.body.y) + 1.05;
      const dmg = AT.dmg * (att.dmgK || 1);
      const toPlayer = t === W.pf && att.team !== "player";
      if (toPlayer) W.lastFoeImpact = { t: a.impactT != null ? a.impactT : W.ct, open: false };
      if (AT.perilous) {
        // peligroso: guardia y parry no sirven; solo su respuesta
        const how = perilousAvoid(AT.perilous, t, att);
        if (toPlayer && W.onDefenseInfo) W.onDefenseInfo({ perilous: AT.perilous, how: how || "hit", move: a.move });
        if (toPlayer && !how) W.lastFoeImpact.open = true;
        if (how === "mikiri") {
          // esquivar HACIA la estocada: se la pisa; mucha postura y retrocede; tú quedas listo para contraatacar
          W.fx.dust(cx, cy - 0.45, cz, 40, { pal: GOLD, spd: 2.8, up: 2.0, life: 0.5 });
          flashLight(cx, cy, cz, 0xffc444, 6); star(cx, cy - 0.2, cz, 1.7, 0xffd040, 0.28);
          stop(STOP.perfectHeavy); W.shakeCam(dx, dz, 0.08, 0.3);
          if (W.sfx) W.sfx.combat("parryPerfect");
          const broke = att.addPosture(AT.mikiriPost || 40);
          if (!broke) att.start("hit", { kb: 0.55, kdir: dir + Math.PI, moved: 0, speed: 0.8, recoil: true });
          if (t.act && t.act.name === "dodge") t.act = null;
          t.counterT = W.ct + W.COMBAT.counterWin;
          log({ ev: "mikiri", who: t.name, from: att.name, anim: a.name, move: a.move, post: Math.round(att.post), broke });
          continue;
        }
        if (how) {
          if (how === "jump") t.airCounterT = W.ct + 0.6;
          log({ ev: "evade", how, who: t.name, from: att.name, anim: a.name, move: a.move });
          continue;
        }
        def = "open";
      } else if (toPlayer) {
        if (def === "open") W.lastFoeImpact.open = true;
        if (W.onDefenseInfo) W.onDefenseInfo({ def, early: t.lastEarly, guardT: t.lastGuardT, impactT: a.impactT, move: a.move || a.name });
      }
      if (def === "evade") {
        log({ ev: "evade", who: t.name, anim: a.name });
        continue;
      }
      if (def === "perfect" || def === "parry") {
        // sin daño; el atacante pierde postura y retrocede; destello que ilumina a los dos
        const perfect = def === "perfect", L = LEVEL[def];
        W.fx.dust(cx, cy - 0.35, cz, perfect ? 44 : 26, { pal: perfect ? GOLD : SPARK, spd: perfect ? 3.1 : 2.6, up: perfect ? 2.6 : 2.2, life: perfect ? 0.55 : 0.4 });
        flashLight(cx, cy, cz, perfect ? 0xffc444 : 0xffe2a8, (heavy ? 5.5 : 4.2) * (perfect ? 1.4 : 1));
        star(cx, cy - 0.1, cz, (heavy ? 1.6 : 1.3) * (perfect ? 1.3 : 1), perfect ? 0xffd040 : 0xfff0c8, perfect ? 0.28 : 0.2);
        stop(perfect ? (heavy ? STOP.perfectHeavy : STOP.perfect) : (heavy ? STOP.parryHeavy : STOP.parry));
        W.shakeCam(dx, dz, perfect ? 0.065 : 0.05, 0.22);
        if (W.sfx) W.sfx.combat(perfect ? "parryPerfect" : "parry");
        const gain = (W.parryPostGain ? W.parryPostGain(att, t, AT, def) : (AT.post || (heavy ? 48 : 38)) * L.atkPost);
        const broke = att.addPosture(gain);
        if (!broke) att.start("hit", { kb: 0.3, kdir: dir + Math.PI, moved: 0, speed: 1.35, recoil: true });
        // quien desvía: un parry nunca le rompe la postura
        const cost = heavy ? L.defPostHeavy : L.defPost;
        if (cost) t.addPosture(cost, { noBreak: true });
        if (perfect) t.counterT = W.ct + W.COMBAT.counterWin;
        t.parries = (t.parries || 0) + 1; t.lastDefT = W.ct;
        if (att.ai && att.ai.onDeflected) att.ai.onDeflected(perfect ? "perfect" : "normal");
        log({ ev: "parry", level: perfect ? "perfect" : "normal", early: Math.round(t.lastEarly * 1000), who: t.name, from: att.name, anim: a.name,
          win: +t.parryWindow().toFixed(3), gain: Math.round(gain), cost, post: Math.round(att.post), broke });
        continue;
      }
      if (def === "block") {
        breakStreak(att); t.lastDefT = W.ct;
        const L = LEVEL.block, cost = heavy ? L.stHeavy : L.st;
        t.st -= cost; t.stT = 0;
        if (t.st <= 0) {
          t.st = 0;
          t.hurt({ dmg: dmg * 0.5, dir, kb: 0.45, guardBreak: true });
          stop(0.1); W.shakeCam(dx, dz, 0.07, 0.3);
          if (W.sfx) W.sfx.combat("guardBreak");
          W.fx.dust(cx, cy - 0.35, cz, 14, { pal: SPARK, spd: 1.6, up: 1.4, life: 0.35 });
          log({ ev: "guardbreak", who: t.name, from: att.name, anim: a.name, hp: Math.round(t.hp) });
          continue;
        }
        t.hp = Math.max(0, t.hp - dmg * 0.15);
        if (t.act && t.act.name === "block") t.act.react = 0.11;
        else t.start("block", { tt: 0.07, react: 0.11 });
        t.body.tryMove(Math.cos(dir) * 0.12, Math.sin(dir) * 0.12);
        const pc = heavy ? L.defPostHeavy : L.defPost;
        if (t.addPosture(pc)) { log({ ev: "block", who: t.name, from: att.name, anim: a.name, st: Math.round(t.st), hp: Math.round(t.hp), postBreak: true }); continue; }
        W.fx.dust(cx, cy - 0.35, cz, 8, { pal: SPARK, spd: 1.3, up: 1.2, life: 0.28 });
        star(cx, cy - 0.15, cz, 0.7, 0xffd8a0, 0.12);
        stop(STOP.block); W.shakeCam(dx, dz, 0.03, 0.18);
        if (W.sfx) W.sfx.combat("block");
        log({ ev: "block", early: Math.round((t.lastEarly || 0) * 1000), who: t.name, from: att.name, anim: a.name, st: Math.round(t.st), hp: Math.round(t.hp), post: Math.round(t.post) });
        continue;
      }
      // golpe limpio (remate si está aturdido)
      breakStreak(att);
      if (att.ai && att.ai.onPlayerHit && t === W.pf) att.ai.onPlayerHit();
      const exposed = !!(t.act && t.act.exposed);          // su parry falló (le engañaste): más postura
      const deathblow = t.stunned;
      const counter = !!a.counter && !deathblow;
      const dm = deathblow ? Math.max(40, dmg * 3) : counter ? dmg * W.COMBAT.counterDmg : dmg;
      const res = t.hurt({ dmg: dm, dir, kb: AT.kb || (heavy ? 0.6 : 0.35), guardBreak: !!AT.throw });
      if (AT.throw) log({ ev: "grab", who: t.name, from: att.name, anim: a.name, move: a.move });
      if (!deathblow && t.alive) t.addPosture(dm * 0.7 * (counter ? W.COMBAT.counterPost : 1) * (exposed ? 1.5 : 1));
      if (counter) { log({ ev: "counter", who: t.name, from: att.name, anim: a.name, dmg: Math.round(dm) }); W.fx.dust(t.body.x, t.body.y + 1.0, t.body.z, 18, { pal: GOLD, spd: 2.2, up: 1.6, life: 0.4 }); }
      const kind = groundBurst(t.body.x, t.body.z, heavy ? 14 : 9, heavy);
      W.fx.dust(t.body.x - Math.cos(dir) * 0.1, t.body.y + 0.9, t.body.z - Math.sin(dir) * 0.1, heavy ? 16 : 10, { pal: EMBER, spd: 1.8, up: 1.3, life: 0.35 });
      if (deathblow) flashLight(t.body.x, t.body.y + 1.1, t.body.z, 0xffd0a0, 6);
      star(t.body.x - Math.cos(dir) * 0.15, t.body.y + 1.0, t.body.z - Math.sin(dir) * 0.15, deathblow ? 1.8 : heavy ? 1.1 : 0.8, deathblow ? 0xfff4d8 : 0xffc890, deathblow ? 0.24 : 0.13);
      stop(deathblow ? STOP.deathblow : AT.stop);
      W.shakeCam(dx, dz, deathblow ? 0.14 : heavy ? 0.11 : 0.06, heavy || deathblow ? 0.32 : 0.22);
      if (W.sfx) W.sfx.combat(deathblow ? "deathblow" : heavy ? "hitHeavy" : "hit", kind);
      log({ ev: deathblow ? "deathblow" : "hit", who: t.name, from: att.name, anim: a.name, dmg: Math.round(dm), hp: Math.round(t.hp), res, surface: kind });
    }
    if (!any) log({ ev: "whiff", who: att.name, anim: a.name });
  }
  // ¿esquiva bien el ataque peligroso? (null = le alcanza)
  function perilousAvoid(kind, t, att) {
    const b = t.body;
    if (kind === "jump") return b.jump && b.jump.h > 0.12 * W.CHAR_H ? "jump" : null;
    if (!t.invulnerable) return null;                        // frames invulnerables de la esquiva
    // dirección de la esquiva respecto al golpe (contra su rumbo = hacia él), no respecto a la posición: al
    // esquivar hacia la estocada los dos se cruzan
    const ang = Math.abs(norm(t.act.dir - (att.body.heading + Math.PI)));
    if (kind === "mikiri") return ang < 1.05 ? "mikiri" : "dodge";
    if (kind === "side") return ang > 0.8 && ang < 2.35 ? "side" : null;
    return "dodge";
  }
  W.onStun = function (f) {
    if (W.sfx) W.sfx.combat("stun");
    flashLight(f.body.x, f.body.y + 1.3, f.body.z, 0xfff0c0, 3);
    log({ ev: f.team === "player" ? "playerPostureBreak" : "stun", who: f.name });
  };

  // ---- barras ---------------------------------------------------------------------------------------
  let hud = null;
  function makeHud() {
    const wrap = document.getElementById("wrap");
    const el = document.createElement("div");
    el.id = "cbars";
    el.innerHTML = `<div class="cb"><span>VIDA</span><div class="bb"><i id="hpP"></i></div></div>
      <div class="cb"><span>STAM</span><div class="bb"><i id="stP"></i></div></div>
      <div class="cb"><span>POST</span><div class="bb"><i id="poP"></i></div></div>
      <div class="cb" id="ctrW"><span>CONTRA</span><div class="bb"><i id="ctP"></i></div></div>`;
    wrap.appendChild(el);
    const foe = document.createElement("div");
    foe.id = "ebars";
    foe.innerHTML = `<div class="en">ECO</div><div class="bb"><i id="hpE"></i></div><div class="bb post"><i id="poE"></i></div>`;
    wrap.appendChild(foe);
    // botón de guardia grande y aparte (abajo a la derecha, al alcance del pulgar), con lo que hace escrito
    const pad = document.createElement("div");
    pad.id = "cpad";
    pad.innerHTML = `<button id="guard" aria-pressed="false" aria-label="Guardia: tocar para desviar (parry), mantener para bloquear"><b>GUARDIA</b><small>toca: parry<br>mantén: bloqueo</small></button>`;
    wrap.appendChild(pad);
    const css = document.createElement("style");
    css.textContent = `#cbars{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));top:calc(58px + env(safe-area-inset-top,0px));pointer-events:none;font-size:7px;color:var(--dim)}
      #cbars .cb{display:flex;align-items:center;gap:6px;margin-bottom:5px}#cbars span{width:34px}
      .bb{width:96px;height:7px;background:rgba(0,0,0,.55);border:1px solid #3a2a22;position:relative;overflow:hidden}
      .bb i{position:absolute;left:0;top:0;bottom:0;background:#e8743a;transition:width .08s}
      #stP{background:#9fd7a8!important}#poP{background:#ffd27a!important}#ebars{position:absolute;pointer-events:none;transform:translate(-50%,-100%);display:none;text-align:center}
      #ebars .bb{width:70px;height:5px;margin:2px auto}#ebars .en{font-size:6px;color:#9fe8ff;margin-bottom:2px}
      #hpE{background:#c9483a!important}#poE{background:#ffd27a!important;left:auto!important;right:50%!important;transform:translateX(50%)}
      #cpad{position:absolute;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(128px + env(safe-area-inset-bottom,0px));pointer-events:none}
      #guard{pointer-events:auto;width:112px;height:112px;border-radius:50%;border:3px solid #ffb070;background:rgba(40,22,14,.78);color:#ffe7c8;
        font:inherit;font-size:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer;touch-action:none;
        box-shadow:0 0 0 3px rgba(0,0,0,.45);-webkit-user-select:none;user-select:none}
      #guard small{font-size:6px;line-height:1.6;color:#e8c9a8}#guard[aria-pressed="true"]{background:#8a3a1a;border-color:#fff0c0;transform:scale(.95)}
      @media (min-width:700px){#cpad{bottom:calc(84px + env(safe-area-inset-bottom,0px))}}
      .cpop{position:absolute;pointer-events:none;font-size:11px;text-shadow:2px 2px 0 #000,-1px -1px 0 #000;white-space:nowrap;z-index:5}
      #ctrW{visibility:hidden}#ctrW.on{visibility:visible}#ctrW span{color:#ffd34a}#ctP{background:#ffd34a!important;box-shadow:0 0 6px #ffb020}
      .cpop.gold{font-size:14px;text-shadow:2px 2px 0 #000,-1px -1px 0 #000,0 0 8px #ffb020}
      #ebars.stun .en{color:#fff3b0}#respawn{display:none}#respawn.hot{display:inline-block;background:#6a2a1a!important;border-color:#ff9a5a!important}#cbars.low #hpP{background:#ff4a3a!important}`;
    document.head.appendChild(css);
    return { hpP: el.querySelector("#hpP"), stP: el.querySelector("#stP"), poP: el.querySelector("#poP"), ctW: el.querySelector("#ctrW"), ctP: el.querySelector("#ctP"), box: el, foe, hpE: foe.querySelector("#hpE"), poE: foe.querySelector("#poE"), en: foe.querySelector(".en") };
  }
  function updateHud() {
    if (!hud) return;
    const p = W.pf;
    hud.hpP.style.width = (100 * p.hp / p.hpMax).toFixed(1) + "%";
    hud.stP.style.width = (100 * p.st / p.stMax).toFixed(1) + "%";
    hud.poP.style.width = (100 * p.post / p.postMax).toFixed(1) + "%";
    hud.box.classList.toggle("low", p.hp < p.hpMax * 0.3);
    // ventana de contraataque (tras un parry perfecto): barra dorada que se vacía
    const cw = Math.max(0, p.counterT - W.ct) / W.COMBAT.counterWin, con = cw > 0;
    if (hud.ctW._on !== con) { hud.ctW._on = con; hud.ctW.classList.toggle("on", con); }
    if (con) hud.ctP.style.width = (100 * cw).toFixed(1) + "%";
    // barras del enemigo más cercano (vivo o recién caído, sin desvanecer)
    let e = null, bd = 1e9;
    for (const f of fighters) { if (f.team === "player" || f.hidden) continue; const d = Math.hypot(f.body.x - p.body.x, f.body.z - p.body.z); if (d < bd) { bd = d; e = f; } }
    if (e && bd > 14) e = null;
    if (!e || !W.toScreen) { hud.foe.style.display = "none"; return; }
    const s = W.toScreen(e.body.x, e.body.y + (e.ch.height || W.CHAR_H) * 1.15, e.body.z);
    hud.foe.style.display = "block";
    hud.foe.style.left = s[0] + "px"; hud.foe.style.top = s[1] + "px";
    hud.hpE.style.width = (100 * e.hp / e.hpMax).toFixed(1) + "%";
    hud.poE.style.width = (100 * e.post / e.postMax).toFixed(1) + "%";
    hud.foe.classList.toggle("stun", e.stunned);
    const nm = e.label || "ECO";
    const lbl = e.stunned ? "ATURDIDO" : !e.alive ? nm + " ✕" : nm;
    if (hud.en.textContent !== lbl) hud.en.textContent = lbl;
    hud.foe.style.opacity = e.alive ? 1 : 0.35;
  }

  // ---- inicio y paso -----------------------------------------------------------------------------------
  W.initCombat = function (scene, assets) {
    flashL = new THREE.PointLight(0xffe2a8, 0, 7, 2);
    scene.add(flashL);
    makeStars(scene);
    W.pf = W.addFighter(new W.Fighter(W.player, { team: "player", name: "jugador", hp: 100, stamina: 100 }), W.character);
    hud = makeHud();
    W.assets = assets;
    // enemigos del tipo elegido (enemies/core.js: por defecto el Autómata del bosque; el eco, desde el panel)
    if (W.spawnEnemies) W.spawnEnemies();
    if (W.initFoeUI) W.initFoeUI();
  };
  // punto libre (sin obstáculo ni agua, al nivel h) más cercano a (x, z)
  // clear: radio de suelo libre alrededor (por defecto 0.5 u)
  W.findSpot = function (x, z, h, clear) {
    clear = clear || 0.5;
    for (let r = 0; r < 6; r += 0.25) {
      for (let k = 0; k < Math.max(1, Math.round(r * 12)); k++) {
        const a = k / Math.max(1, Math.round(r * 12)) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!W.cellFree(px, pz) || W.kindAt(px, pz) === W.K.PUDDLE) continue;
        if (h != null && Math.abs(W.heightAt(px, pz) - h) > 0.3) continue;
        let ok = true;
        for (let rr = 0.5; rr <= clear + 1e-6 && ok; rr += 0.5)
          for (let j = 0; j < 8 && ok; j++) { const b = j * Math.PI / 4; ok = W.cellFree(px + Math.cos(b) * rr, pz + Math.sin(b) * rr) && (h == null || Math.abs(W.heightAt(px + Math.cos(b) * rr, pz + Math.sin(b) * rr) - W.heightAt(px, pz)) < 0.3); }
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  };
  W.combatAfter = function (dt) {
    if (pendingHits.length) flushHits();
    updateStars(dt);
    updatePops(dt);
    // destello de luz: sube de golpe y cae en ~0.3 s
    if (flashL) {
      flashT += dt;
      flashL.intensity = flashI * Math.max(0, 1 - flashT / 0.3) * (flashT < 0.03 ? flashT / 0.03 : 1);
    }
    for (const f of fighters) if (f.ch) f.ch.uniforms.uFlash.value = f.flash;
    updateHud();
    if (W.practiceAfter) W.practiceAfter(dt);         // barras de postura centrales, entrenamiento (practice.js)
  };
})();
