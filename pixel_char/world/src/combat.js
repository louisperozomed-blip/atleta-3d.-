// combat.js — resolución de golpes y sensación de impacto.
//
//  · hitbox en el suelo: arco delante del atacante (generoso: ±70°, ±85° en attack3), activa SOLO en el
//    frame activo (IMPACT) de cada ataque; un golpe alcanza a cada objetivo una vez
//  · defensa del objetivo en ese instante (fighter.defense): esquiva (invulnerable), parry, bloqueo o golpe
//  · parry: chispas, destello de luz que ilumina a ambos, sin daño y mucha postura para el atacante
//  · bloqueo: daño reducido, gasta stamina; sin stamina se rompe la guardia
//  · postura llena = aturdido; golpear a un aturdido es un remate (daño ×3)
//  · sensación: hitstop 60-120 ms (más en attack3 y en el parry), sacudida de cámara en la dirección del
//    golpe, destello blanco en quien lo recibe, partículas según el terreno y sonidos (audio.js)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const fighters = (W.fighters = []);
  const DMG = { attack1: 10, attack2: 12, attack3: 22 };
  const REACH = { attack1: 1.6, attack2: 1.65, attack3: 1.95 };
  const ARC = { attack1: 70, attack2: 70, attack3: 85 };
  const STOP = { attack1: 0.075, attack2: 0.085, attack3: 0.12, parry: 0.11, parryHeavy: 0.13, block: 0.06, deathblow: 0.16 };
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  W.combatLog = [];
  function log(e) { e.t = W.U ? +W.U.uTime.value.toFixed(3) : 0; W.combatLog.push(e); if (W.combatLog.length > 400) W.combatLog.shift(); }

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
    if (W.hitstop > 0) { W.hitstop = Math.max(0, W.hitstop - dt); W.hitstopAcc = (W.hitstopAcc || 0) + dt; return 0; }
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
  function surf(x, z) { return (W.surfaceAt && W.surfaceAt(x, z)) || "dust"; }
  function groundBurst(x, z, n, heavy) {
    const k = surf(x, z), y = W.heightAt(x, z);
    W.fx.dust(x, k === "water" ? y + 0.045 : y, z, n, { pal: PAL[k] || PAL.dust, spd: heavy ? 1.6 : 1.1, up: heavy ? 1.6 : 1.1, life: 0.55 });
    if (k === "water") { W.fx.ripple(x, y + 0.045, z, heavy ? 1.0 : 0.6); }
    return k;
  }

  // ---- resolución --------------------------------------------------------------------------------
  W.onCombatFrame = function (f, a) {
    if (a.name.startsWith("attack") && a.f === 3 && !a.hitDone) { a.hitDone = true; resolve(f, a); }
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
    const b = att.body, reach = REACH[a.name], arc = ARC[a.name] * Math.PI / 180;
    let any = false;
    for (const t of fighters) {
      if (t === att || t.team === att.team || !t.alive) continue;
      const dx = t.body.x - b.x, dz = t.body.z - b.z, d = Math.hypot(dx, dz);
      const ang = Math.abs(norm(Math.atan2(dz, dx) - b.heading));
      const inArc = d <= reach + 0.3 && (ang <= arc || d < 0.6);
      log({ ev: "swing", who: att.name, anim: a.name, d: +d.toFixed(2), ang: Math.round(ang * 180 / Math.PI), inArc });
      if (!inArc) continue;
      any = true;
      const dir = Math.atan2(dz, dx);
      const def = t.defense();
      const heavy = a.name === "attack3";
      const cx = (b.x + t.body.x) / 2, cz = (b.z + t.body.z) / 2, cy = Math.max(b.y, t.body.y) + 1.05;
      const dmg = DMG[a.name] * (att.dmgK || 1);
      if (def === "evade") {
        log({ ev: "evade", who: t.name, anim: a.name });
        continue;
      }
      if (def === "parry") {
        // sin daño; el atacante pierde mucha postura y retrocede; destello que ilumina a los dos
        W.fx.dust(cx, cy - 0.35, cz, 26, { pal: SPARK, spd: 2.6, up: 2.2, life: 0.4 });
        flashLight(cx, cy, cz, 0xffe2a8, heavy ? 5.5 : 4.2);
        star(cx, cy - 0.1, cz, heavy ? 1.6 : 1.3, 0xfff0c8, 0.2);
        stop(heavy ? STOP.parryHeavy : STOP.parry);
        W.shakeCam(dx, dz, 0.05, 0.22);
        if (W.sfx) W.sfx.combat("parry");
        const broke = att.addPosture(heavy ? 48 : 38);
        if (!broke) att.start("hit", { kb: 0.3, kdir: dir + Math.PI, moved: 0, speed: 1.35, recoil: true });
        t.parries = (t.parries || 0) + 1;
        log({ ev: "parry", who: t.name, from: att.name, anim: a.name, win: +t.parryWindow().toFixed(3), post: Math.round(att.post), broke });
        continue;
      }
      if (def === "block") {
        const cost = heavy ? 36 : 22;
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
        t.addPosture(6);
        W.fx.dust(cx, cy - 0.35, cz, 8, { pal: SPARK, spd: 1.3, up: 1.2, life: 0.28 });
        star(cx, cy - 0.15, cz, 0.7, 0xffd8a0, 0.12);
        stop(STOP.block); W.shakeCam(dx, dz, 0.03, 0.18);
        if (W.sfx) W.sfx.combat("block");
        log({ ev: "block", who: t.name, from: att.name, anim: a.name, st: Math.round(t.st), hp: Math.round(t.hp) });
        continue;
      }
      // golpe limpio (remate si está aturdido)
      const deathblow = t.stunned;
      const dm = deathblow ? Math.max(40, dmg * 3) : dmg;
      const res = t.hurt({ dmg: dm, dir, kb: heavy ? 0.6 : 0.35 });
      if (!deathblow && t.alive) t.addPosture(dm * 0.7);
      const kind = groundBurst(t.body.x, t.body.z, heavy ? 14 : 9, heavy);
      W.fx.dust(t.body.x - Math.cos(dir) * 0.1, t.body.y + 0.9, t.body.z - Math.sin(dir) * 0.1, heavy ? 16 : 10, { pal: EMBER, spd: 1.8, up: 1.3, life: 0.35 });
      if (deathblow) flashLight(t.body.x, t.body.y + 1.1, t.body.z, 0xffd0a0, 6);
      star(t.body.x - Math.cos(dir) * 0.15, t.body.y + 1.0, t.body.z - Math.sin(dir) * 0.15, deathblow ? 1.8 : heavy ? 1.1 : 0.8, deathblow ? 0xfff4d8 : 0xffc890, deathblow ? 0.24 : 0.13);
      stop(deathblow ? STOP.deathblow : STOP[a.name]);
      W.shakeCam(dx, dz, deathblow ? 0.14 : heavy ? 0.11 : 0.06, heavy || deathblow ? 0.32 : 0.22);
      if (W.sfx) W.sfx.combat(deathblow ? "deathblow" : heavy ? "hitHeavy" : "hit", kind);
      log({ ev: deathblow ? "deathblow" : "hit", who: t.name, from: att.name, anim: a.name, dmg: Math.round(dm), hp: Math.round(t.hp), res, surface: kind });
    }
    if (!any) log({ ev: "whiff", who: att.name, anim: a.name });
  }
  W.onStun = function (f) {
    if (W.sfx) W.sfx.combat("stun");
    flashLight(f.body.x, f.body.y + 1.3, f.body.z, 0xfff0c0, 3);
    log({ ev: "stun", who: f.name });
  };

  // ---- barras ---------------------------------------------------------------------------------------
  let hud = null;
  function makeHud() {
    const wrap = document.getElementById("wrap");
    const el = document.createElement("div");
    el.id = "cbars";
    el.innerHTML = `<div class="cb"><span>VIDA</span><div class="bb"><i id="hpP"></i></div></div>
      <div class="cb"><span>STAM</span><div class="bb"><i id="stP"></i></div></div>`;
    wrap.appendChild(el);
    const foe = document.createElement("div");
    foe.id = "ebars";
    foe.innerHTML = `<div class="en">ECO</div><div class="bb"><i id="hpE"></i></div><div class="bb post"><i id="poE"></i></div>`;
    wrap.appendChild(foe);
    const css = document.createElement("style");
    css.textContent = `#cbars{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));top:calc(58px + env(safe-area-inset-top,0px));pointer-events:none;font-size:7px;color:var(--dim)}
      #cbars .cb{display:flex;align-items:center;gap:6px;margin-bottom:5px}#cbars span{width:34px}
      .bb{width:96px;height:7px;background:rgba(0,0,0,.55);border:1px solid #3a2a22;position:relative;overflow:hidden}
      .bb i{position:absolute;left:0;top:0;bottom:0;background:#e8743a;transition:width .08s}
      #stP{background:#9fd7a8!important}#ebars{position:absolute;pointer-events:none;transform:translate(-50%,-100%);display:none;text-align:center}
      #ebars .bb{width:70px;height:5px;margin:2px auto}#ebars .en{font-size:6px;color:#9fe8ff;margin-bottom:2px}
      #hpE{background:#c9483a!important}#poE{background:#ffd27a!important;left:auto!important;right:50%!important;transform:translateX(50%)}
      #ebars.stun .en{color:#fff3b0}#respawn{display:none}#respawn.hot{display:inline-block;background:#6a2a1a!important;border-color:#ff9a5a!important}#cbars.low #hpP{background:#ff4a3a!important}`;
    document.head.appendChild(css);
    return { hpP: el.querySelector("#hpP"), stP: el.querySelector("#stP"), box: el, foe, hpE: foe.querySelector("#hpE"), poE: foe.querySelector("#poE"), en: foe.querySelector(".en") };
  }
  function updateHud() {
    if (!hud) return;
    const p = W.pf;
    hud.hpP.style.width = (100 * p.hp / p.hpMax).toFixed(1) + "%";
    hud.stP.style.width = (100 * p.st / p.stMax).toFixed(1) + "%";
    hud.box.classList.toggle("low", p.hp < p.hpMax * 0.3);
    const e = fighters.find((f) => f.team !== "player");
    if (!e || !W.toScreen) { hud.foe.style.display = "none"; return; }
    const s = W.toScreen(e.body.x, e.body.y + W.CHAR_H * 1.15, e.body.z);
    hud.foe.style.display = "block";
    hud.foe.style.left = s[0] + "px"; hud.foe.style.top = s[1] + "px";
    hud.hpE.style.width = (100 * e.hp / e.hpMax).toFixed(1) + "%";
    hud.poE.style.width = (100 * e.post / e.postMax).toFixed(1) + "%";
    hud.foe.classList.toggle("stun", e.stunned);
    const lbl = e.stunned ? "ATURDIDO" : !e.alive ? "ECO ✕" : "ECO";
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
    // el eco aparece en el claro junto al inicio (a ~4.9 u; 4 u de suelo libre y llano alrededor)
    const p = W.player;
    const s = W.findSpot(2.8, -10.2, p.y);
    W.foeSpawn = s;
    if (W.spawnFoe && s) W.foe = W.spawnFoe(s.x, s.z, assets, { heading: Math.atan2(p.z - s.z, p.x - s.x) });
    if (W.initFoeUI) W.initFoeUI();
  };
  // punto libre (sin obstáculo ni agua, al nivel h) más cercano a (x, z)
  W.findSpot = function (x, z, h) {
    for (let r = 0; r < 6; r += 0.25) {
      for (let k = 0; k < Math.max(1, Math.round(r * 12)); k++) {
        const a = k / Math.max(1, Math.round(r * 12)) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!W.cellFree(px, pz) || W.kindAt(px, pz) === W.K.PUDDLE) continue;
        if (h != null && Math.abs(W.heightAt(px, pz) - h) > 0.3) continue;
        let ok = true;
        for (let j = 0; j < 8 && ok; j++) { const b = j * Math.PI / 4; ok = W.cellFree(px + Math.cos(b) * 0.5, pz + Math.sin(b) * 0.5); }
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  };
  W.combatAfter = function (dt) {
    updateStars(dt);
    // destello de luz: sube de golpe y cae en ~0.3 s
    if (flashL) {
      flashT += dt;
      flashL.intensity = flashI * Math.max(0, 1 - flashT / 0.3) * (flashT < 0.03 ? flashT / 0.03 : 1);
    }
    for (const f of fighters) if (f.ch) f.ch.uniforms.uFlash.value = f.flash;
    updateHud();
  };
})();
