// enemies/fodder/fodder.js — enemigos de RELLENO para practicar el parry: el ZOMBI y el PERRO ZOMBI.
//
// Muy fáciles de leer y de desviar, con un bucle corto: aviso claro → parry → recompensa → siguiente. Lo que se
// aprende con ellos sirve contra el Autómata del bosque. La facilidad sale del enemigo (un solo golpe, siempre con
// el MISMO ritmo, sin lectura, sin fintas, sin retrasos, sin cadenas) y de las ayudas; nunca de agrandar la ventana
// de parry del jugador.
//
// Controlador genérico dirigido por datos (W.FODDER[tipo]); la IA del autómata no se toca. Usa la misma máquina de
// estados de combate que los demás (fighter.js): su golpe se desvía, se bloquea o te alcanza como cualquier otro.
//   IDLE → WANDER → CHASE (A*) → WINDUP → ATTACK (golpe en arco SOLO en el frame IMPACT) → RECOVERY
//        → (STUN | HIT | DEATH)
// Solo existen idle, walk, attack, hit y death: nunca pide run, parry, block ni dodge (character.js lo vigila).
// STUN = frames de hit (IMPACT, RECOIL y STAGGER congelado) con temblor y un tinte leve. Muerte con el mismo
// desvanecimiento que el autómata (esporas que se levantan).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const KINDS = ["zombie", "dog"];
  const CFG = (W.FODDER = {
    // ZOMBI: zarpazo descendente, lento y pesado. windup = desde que empieza hasta el IMPACT (exacto);
    // rel = la parte final (SWING) del windup. Recuperación: la de su hoja (IMPACT → final = 1000 ms)
    zombie: {
      label: "Zombi", height: 1.05, hits: 3, speedK: 0.6, windup: 0.8, rel: 0.18,
      reach: 1.7, arc: 80, dmg: 6, want: 1.15, cap: 0.5, engage: 1.65,
      see: 7.5, leash: 12, radius: 0.36, stunKB: 0.3, kbK: 0.9, cool: 0.6,
    },
    // PERRO: mordisco en salto, rápido. Se agacha (CROUCH, WIND UP) y salta en la suelta (LUNGE): el IMPACT
    // (BITE) llega cuando aterriza junto a ti. Recuperación 900 ms. Corre con su walk acelerado
    dog: {
      label: "Perro zombi", height: 0.6, hits: 2, speedK: 1.3, windup: 0.6, rel: 0.2,
      reach: 1.45, arc: 75, dmg: 6, want: 0.85, cap: 2.0, engage: 2.6, lunge: true,
      see: 9, leash: 14, radius: 0.32, stunKB: 1.5, kbK: 1, cool: 0.5,
    },
    deadWait: 1.6, fade: 1.6, respawnT: 9,   // en el suelo, desvanecerse, reaparecer (si no estás encima)
    // anillo de timing: radio inicial (u), grosor, color; nivel 1 = solo los últimos 250 ms
    ring: { r0: { zombie: 1.05, dog: 0.85 }, w: 0.05, color: [0.12, 0.78, 0.95], late: 0.25 },
    // andamio adaptativo por tipo: 4 parries seguidos bajan un nivel; 3 fallos seguidos lo suben
    scaf: { down: 4, up: 3 },
  });
  // modo del anillo (panel ⚙): auto (andamio), always (siempre), never (nunca); se recuerda en este navegador
  const RKEY = "bosque.fodderRing";
  CFG.ringMode = (() => { try { const v = localStorage.getItem(RKEY); return v === "always" || v === "never" ? v : "auto"; } catch (_) { return "auto"; } })();
  const SCAF = (W.FODDER_SCAF = { zombie: { level: 2, streak: 0, fails: 0 }, dog: { level: 2, streak: 0, fails: 0 } });
  // estadísticas de la práctica (contador en pantalla y modo entrenamiento)
  const STATS = (W.FODDER_STATS = { streak: 0, best: 0, parries: 0, perfect: 0, fails: 0, last: null });
  let seed = 777;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let serial = 0;

  // ---- cuerpo y personaje ---------------------------------------------------------------------------
  function spawn(kind, p) {
    const A = W.assets && W.assets.fodder && W.assets.fodder[kind];
    if (!A) return null;
    const C = CFG[kind], meta = A.meta;
    for (const an of meta.anims) { const m = meta.animations[an]; if (!m.fps) m.fps = Math.round(6000 / m.ms.reduce((x, y) => x + y, 0)); }
    const body = new W.Player(p.x, p.z);
    body.radius = C.radius; body.gait = "walk";
    const ch = W.makeCharacter(W.scene, A.tex, meta, null, null, { feet: meta.feet, height: C.height * W.CHAR_H, emit: 0, name: kind, locoFps: 12 });
    body.ch = ch;
    // velocidad: proporción de tu caminar; la cadencia del walk sale de ella (pies sin patinar; el perro, acelerado)
    const base = (W.player && W.player.walkV) || W.CHAR_H;
    body.walkVFn = () => base * C.speedK * (W.speedMul || 1);
    ch.vFree = true;
    if (W.locoParams) {
      const vs = [];
      for (let d = 0; d < 8; d++) { const lp = W.locoParams("walk", d, ch); if (lp && lp.v > 0) vs.push(lp.v); }
      vs.sort((a, b) => a - b);
      if (vs.length) ch.locoFps = Math.max(4, Math.min(26, 12 * base * C.speedK / vs[vs.length >> 1]));
    }
    const f = W.addFighter(new W.Fighter(body, {
      team: "foe", name: kind + "-" + (++serial), hp: C.hits * 10, stamina: 999, posture: 1e6, meta,
      prepK: 1, stunTime: 1.2, kbK: C.kbK,
    }), ch);
    f.kind = kind; f.fodder = C; f.label = C.label.toUpperCase(); f.radiusHit = C.radius;
    f.attacks = { attack: { dmg: C.dmg, reach: C.reach, arc: C.arc, stop: 0.07, kb: 0.3, post: 0 } };
    // aturdido: IMPACT, RECOIL y STAGGER congelado (el temblor y el tinte, en update)
    f.stunPose = (t) => Math.min(2, Math.floor(t / 0.08));
    f.home = { x: p.x, z: p.z, heading: p.heading || 0 };
    body.heading = f.home.heading;
    f.ai = makeAI(f);
    f.fade = 1; f.deadT = 0;
    ch.onStep = (e, sk, P) => step(f, e, sk, P);
    f.ringMesh = makeRing(CFG.ring.r0[kind]);
    if (kind === "zombie") {
      // ojos que se encienden en el WINDUP (sobre la calavera; no se ven de espaldas)
      const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff7040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      e.scale.set(0.42, 0.42, 1); e.renderOrder = 4; W.scene.add(e); f.eyeGlow = e;
    }
    return f;
  }

  // ---- anillo de timing: banda fina de grosor constante en el suelo, cian bioluminiscente -------------------
  function makeRing(r0) {
    const R = r0 + 0.25;
    const geo = new THREE.PlaneGeometry(2 * R, 2 * R); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uR: { value: r0 }, uW: { value: CFG.ring.w }, uA: { value: 0 }, uFlash: { value: 0 }, uHalf: { value: R },
        uCol: { value: new THREE.Vector3().fromArray(CFG.ring.color) } },
      vertexShader: "varying vec2 vP; uniform float uHalf; void main(){ vP = (uv * 2.0 - 1.0) * uHalf; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `varying vec2 vP; uniform float uR, uW, uA, uFlash; uniform vec3 uCol;
        void main(){
          // celdas de 0.035 u (pixel art: la banda se pinta a escalones, sin degradado fino)
          vec2 q = floor(vP / 0.035 + 0.5) * 0.035;
          float d = length(q);
          float band = step(abs(d - uR), uW * 0.5);
          float dot = step(d, 0.07) * 0.8;                 // el centro: a donde llega
          float fl = uFlash * step(d, 0.32 + 0.25 * (1.0 - uFlash));
          float a = max(band * uA, max(dot * uA * 0.8, fl));
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(uCol, vec3(0.85, 1.0, 1.0), fl * 0.6) * (0.85 + 0.6 * fl), a);
        }`,
    });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 3; m.visible = false; m.frustumCulled = false;
    W.scene.add(m);
    return m;
  }
  let _glow = null;
  function glowTex() {
    if (_glow) return _glow;
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d");
    // dos puntos (los ojos) con su halo
    for (const x of [11, 21]) { const gr = g.createRadialGradient(x, 16, 0, x, 16, 9); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,200,140,0.75)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
    return (_glow = new THREE.CanvasTexture(c));
  }
  // nivel de ayuda que toca ahora para este tipo (2 = anillo completo, 1 = últimos 250 ms, 0 = sin anillo)
  function ringLevel(kind) { return CFG.ringMode === "always" ? 2 : CFG.ringMode === "never" ? 0 : SCAF[kind].level; }
  W.fodderRingLevel = ringLevel;
  W.setFodderRingMode = function (m) { CFG.ringMode = m; try { localStorage.setItem(RKEY, m); } catch (_) {} const sel = document.getElementById("fodRing"); if (sel) sel.value = m; return m; };

  // ---- peso: el zombi arrastra los pies (polvo bajo y un roce grave); el perro pisa ligero ----------------
  function step(f, e, kind, P) {
    const pl = W.player, d = Math.hypot(e.x - pl.x, e.z - pl.z), near = Math.max(0, 1 - d / 11);
    const y = W.heightAt(e.x, e.z), zombie = f.kind === "zombie";
    if (W.fx) {
      W.fx.dust(e.x, kind === "water" ? y + 0.045 : y, e.z, zombie ? Math.round(P.n * 1.1) : Math.max(1, Math.round(P.n * 0.4)),
        Object.assign({}, P, zombie ? { spd: (P.spd || 1) * 0.7, up: (P.up || 1) * 0.45, life: (P.life || 0.5) * 1.3 } : { spd: (P.spd || 1) * 0.8, up: (P.up || 1) * 0.7 }));
      if (kind === "water") W.fx.ripple(e.x, y + 0.045, e.z, zombie ? 0.6 : 0.35);
      else if (kind !== "metal") W.fx.footprint(e.x, y, e.z, e.heading, zombie ? 0.36 : 0.16);
    }
    if (near > 0 && W.sfx) W.sfx.combat(zombie ? "dragStep" : "pawStep", near);
    f.steps = (f.steps || 0) + 1;
  }

  // ---- IA: sin lectura, sin fintas, sin retrasos, sin cadenas ------------------------------------------
  function phaseOf(f) {
    const a = f.act;
    if (!a) return null;
    if (a.name === "attack") return a.f < W.hitF(a) ? "windup" : a.f === W.hitF(a) ? "attack" : "recovery";
    if (a.name === "stun") return "stun";
    if (a.name === "death") return "death";
    if (a.name === "hit") return "hit";
    return a.name;
  }
  function makeAI(f) {
    const C = f.fodder;
    return {
      enabled: true, state: "idle", t: 0, replan: 0, cool: 0.8, idleT: 0.5 + rand() * 1.5, lastEnd: -9,
      update(dt) {
        const b = f.body, pl = W.pf;
        this.t += dt;
        if (!f.alive) { this.state = "death"; return; }
        if (!this.enabled) return;
        const ph = phaseOf(f);
        if (ph) { this.state = ph; return; }
        if (this.state === "windup" || this.state === "attack" || this.state === "recovery" || this.state === "stun" || this.state === "hit") {
          this.lastEnd = W.ct; this.cool = Math.max(this.cool, C.cool); this.state = "chase";
          if (W.fodderReleaseToken) W.fodderReleaseToken(f);
        }
        this.cool -= dt;
        const dx = pl ? pl.body.x - b.x : 0, dz = pl ? pl.body.z - b.z : 0, d = pl ? Math.hypot(dx, dz) : 1e9, toP = Math.atan2(dz, dx);
        const fromHome = Math.hypot(b.x - f.home.x, b.z - f.home.z);
        if (!pl || !pl.alive || this.passive) { this.state = fromHome > 1.5 ? "wander" : "idle"; this.wander(dt, fromHome > 1.5); return; }
        if (this.state === "idle" || this.state === "wander") {
          if (d < C.see || f.hp < f.hpMax || this.alert) this.state = "chase";
          else { this.wander(dt, false); return; }
        }
        if (fromHome > C.leash && d > C.see) { this.state = "wander"; this.wander(dt, true); return; }
        if (d < 4) b.heading += norm(toP - b.heading) * Math.min(1, dt * 7);
        // golpe: a su distancia, cuando le toca (grupos: un solo atacante a la vez, ver W.fodderCanAttack)
        if (d <= C.engage && this.cool <= 0 && (!W.fodderCanAttack || W.fodderCanAttack(f))) { this.strike(toP); return; }
        if (W.fodderOrbit && W.fodderOrbit(f, dt)) return;              // grupos: los que esperan rodean
        if (d > C.engage * 0.9) {
          this.replan -= dt;
          if (this.replan <= 0 || !b.path.length) {
            this.replan = 0.4;
            const r = C.engage * 0.75, tx = pl.body.x - Math.cos(toP) * r, tz = pl.body.z - Math.sin(toP) * r;
            const path = W.findPath(b.x, b.z, tx, tz, 9000);
            if (path.length) { b.setPath(path, { noDelay: true }); b.gait = "walk"; }
            else this.stuck = (this.stuck || 0) + 1;
          }
        } else if (b.path.length) b.stop();
      },
      strike(toP) {
        const b = f.body;
        b.stop(); b.heading = toP;
        f.startAttack("attack", { dir: toP, plan: { wind: C.windup - C.rel, hold: 0, rel: C.rel }, want: C.want, cap: C.cap, seek: C.engage + 1.2,
          lungeFrom: C.lunge ? "release" : undefined });
        if (f.act) { f.act.move = "attack"; f.act.fodderT0 = W.ct; f.act.ringLv = ringLevel(f.kind); }
        this.state = "windup"; this.cool = C.cool;
        W.combatLog.push({ ev: "fodderWindup", who: f.name, kind: f.kind, impactIn: +C.windup.toFixed(3), t: +W.U.uTime.value.toFixed(3) });
        if (W.onFodderWindup) W.onFodderWindup(f);
      },
      wander(dt, home) {
        const b = f.body;
        if (home) {
          this.replan -= dt;
          if (this.replan <= 0 || !b.path.length) { this.replan = 0.6; const p = W.findPath(b.x, b.z, f.home.x, f.home.z, 9000); if (p.length) { b.setPath(p, { noDelay: true }); b.gait = "walk"; } }
          return;
        }
        if (b.path.length) return;
        this.state = "idle";
        this.idleT -= dt;
        if (this.idleT <= 0) {
          const a = rand() * Math.PI * 2, r = 0.8 + rand() * 2.4;
          const s = W.findSpot(f.home.x + Math.cos(a) * r, f.home.z + Math.sin(a) * r, W.heightAt(f.home.x, f.home.z));
          if (s) { const path = W.findPath(b.x, b.z, s.x, s.z, 4000); if (path.length) { b.setPath(path, { noDelay: true }); b.gait = "walk"; this.state = "wander"; } }
          this.idleT = 2 + rand() * 2.5;
        }
      },
    };
  }

  // ---- cada paso: aturdido (temblor y tinte), muerte y desvanecimiento, reaparición ----------------------
  function update(f, dt) {
    const ch = f.ch, U = ch.uniforms, a = f.act;
    updateRing(f, dt);
    updateEyes(f, dt);
    // retroceso del aturdido (el perro sale despedido ~1,5 baldosas)
    if (f.slide) {
      const sl = f.slide, k = Math.min(dt, Math.max(0, sl.dur - sl.t)) / sl.dur;
      if (k > 0) f.body.tryMove(sl.vx * k, sl.vz * k);
      sl.t += dt; if (sl.t >= sl.dur) f.slide = null;
    }
    if (a && a.name === "stun") {
      f.jitter = Math.sin(a.t * 70) * 0.012 * W.CHAR_H * Math.max(0, 1 - a.t / (a.dur || 1.2) * 0.6);
      f.flash = Math.max(f.flash, 0.18 + 0.08 * Math.sin(a.t * 18));
    } else f.jitter = 0;
    if (!f.alive) {
      f.deadT += dt;
      if (f.deadT > CFG.deadWait) {
        const u = Math.min(1, (f.deadT - CFG.deadWait) / CFG.fade);
        f.fade = 1 - u;
        if (W.fx && Math.floor(f.deadT * 12) !== Math.floor((f.deadT - dt) * 12) && f.fade > 0.05) {
          const b = f.body;
          W.fx.dust(b.x + (rand() - 0.5) * 1.0, b.y + 0.1, b.z + (rand() - 0.5) * 0.8, 3,
            { pal: [[0.55, 0.75, 0.35], [0.8, 0.95, 0.55], [0.9, 0.5, 0.35]], spd: 0.25, up: 1.4, life: 1.4 });
        }
        if (u >= 1 && !f.hidden) { hide(f, true); f.respawnAt = W.ct + CFG.respawnT; }
      }
      // reaparece en su sitio si no estás encima (el grupo de práctica lo gestiona él mismo)
      if (f.hidden && !f.noAutoRespawn && f.respawnAt && W.ct >= f.respawnAt && W.pf &&
          Math.hypot(W.pf.body.x - f.home.x, W.pf.body.z - f.home.z) > 6) respawn(f);
    } else { f.deadT = 0; f.fade = 1; }
    U.uFade.value = f.fade;
  }
  function updateRing(f, dt) {
    const m = f.ringMesh; if (!m) return;
    const U = m.material.uniforms, a = f.act, C = f.fodder, R = CFG.ring, b = f.body;
    f.ringFlash = Math.max(0, (f.ringFlash || 0) - dt / 0.16);
    let alpha = 0, r = 0;
    if (a && a.name === "attack" && a.ringLv > 0 && a.f < W.hitF(a) && f.alive) {
      const ti = f.toImpact();
      if (ti != null) {
        r = R.r0[f.kind] * Math.max(0, Math.min(1, ti / C.windup));
        alpha = a.ringLv >= 2 ? Math.min(1, (C.windup - ti) / 0.08) : ti <= R.late ? Math.min(1, (R.late - ti) / 0.05) : 0;
        f.ring = { r, alpha, ti, t: W.ct };
      }
    } else f.ring = null;
    const show = alpha > 0.01 || f.ringFlash > 0.01;
    m.visible = show && !f.hidden;
    if (!show) return;
    m.position.set(b.x, W.heightAt(b.x, b.z) + 0.03, b.z);
    U.uR.value = r; U.uA.value = alpha * 0.95; U.uFlash.value = f.ringFlash;
  }
  // posición de los ojos en el mundo (eye_px del atlas: la parte alta de la cabeza, respecto al pivote)
  const BACK = { 3: 1, 4: 1, 5: 1 };
  function updateEyes(f, dt) {
    const e = f.eyeGlow; if (!e) return;
    const ch = f.ch, st = ch.st, a = f.act, b = f.body;
    let k = 0;
    if (a && a.name === "attack" && a.f < W.hitF(a) && f.alive) { const ti = f.toImpact(); k = ti == null ? 1 : Math.min(1, 0.35 + 0.65 * (1 - ti / f.fodder.windup)); }
    f.eyeK = (f.eyeK || 0) + (k - (f.eyeK || 0)) * Math.min(1, dt * 14);
    const P = ch.meta.eye_px[st.anim + "_" + DIRS8[st.dir]];
    const p = P && P[Math.min(5, st.frame)];
    e.visible = f.eyeK > 0.02 && !!p && !BACK[st.dir] && !f.hidden;
    if (!e.visible) return;
    const th = W.ui ? W.ui.theta : Math.PI / 4;
    const rx = Math.cos(th), rz = -Math.sin(th), tx = Math.sin(th), tz = Math.cos(th);
    const ey = p[1] + 0.07 * ch.meta.standing_height_px;
    e.position.set(b.x + rx * p[0] * ch.unitsH + tx * 0.3, b.y + (st.hgt || 0) - ey * ch.unitsV, b.z + rz * p[0] * ch.unitsH + tz * 0.3);
    e.material.opacity = Math.min(1, f.eyeK) * 0.95 * f.fade;
    const sc = 0.3 + 0.14 * f.eyeK; e.scale.set(sc, sc * 0.6, 1);
  }
  const DIRS8 = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  // aviso del golpe: gruñido (grave el zombi, agudo el perro)
  W.onFodderWindup = function (f) {
    if (!W.sfx) return;
    const d = W.player ? Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z) : 0;
    W.sfx.combat(f.kind === "zombie" ? "growlLow" : "growlHigh", Math.max(0.25, 1 - d / 14));
  };
  // recompensas del parry contra el relleno (combat.js): perfecto = rematado al instante; normal = aturdido 1,2 s
  W.fodderOnParry = function (t, f, perfect, dir, a) {
    const FX = W.combatFx, b = f.body, cy = b.y + f.ch.height * 0.55;
    if (perfect) {
      f.hp = 0; f.flash = 1; b.heading = dir + Math.PI;
      f.start("death", { kb: 0.3 * f.kbK, kdir: dir, moved: 0 });
      // fogonazo: la misma señal dorada que el parry perfecto, más grande
      if (FX) { FX.flash(b.x, cy + 0.4, b.z, 0xffd060, 7.5); FX.star(b.x, cy, b.z, 1.9, 0xfff0b0, 0.3); }
      if (W.fx && FX) W.fx.dust(b.x, cy, b.z, 34, { pal: FX.GOLD, spd: 2.6, up: 2.2, life: 0.6 });
      if (W.sfx) W.sfx.combat("deathblow");
      if (W.combatPop) W.combatPop("¡REMATADO!", "#ffd34a", f, null, "gold");
      W.combatLog.push({ ev: "fodderKill", who: f.name, kind: f.kind, how: "perfect", t: +W.U.uTime.value.toFixed(3) });
    } else {
      f.start("stun", { t: 0, dur: 1.2 });
      const d = f.fodder.stunKB;
      f.slide = { vx: Math.cos(dir) * d, vz: Math.sin(dir) * d, t: 0, dur: f.kind === "dog" ? 0.28 : 0.18, x0: b.x, z0: b.z };
      if (W.sfx) W.sfx.combat("stun");
      W.combatLog.push({ ev: "fodderStun", who: f.name, kind: f.kind, dur: 1.2, kb: d, t: +W.U.uTime.value.toFixed(3) });
    }
    W.fodderOnDefense(f, perfect ? "perfect" : "normal");
    return true;
  };
  // andamio: aciertos y fallos seguidos POR TIPO de enemigo
  W.fodderOnDefense = function (f, res) {
    const S = SCAF[f.kind], C = CFG.scaf, ok = res === "perfect" || res === "normal";
    const lv0 = S.level;
    if (ok) { S.streak++; S.fails = 0; if (S.streak >= C.down && S.level > 0) { S.level--; S.streak = 0; } }
    else { S.fails++; S.streak = 0; if (S.fails >= C.up && S.level < 2) { S.level++; S.fails = 0; } }
    if (S.level !== lv0) {
      const down = S.level < lv0;
      if (W.combatPop && CFG.ringMode === "auto") W.combatPop(down ? "ritmo aprendido" : "ayuda activada", down ? "#8ff0ff" : "#ffc070", W.pf, null, "small");
      W.combatLog.push({ ev: "fodderLevel", kind: f.kind, level: S.level, from: lv0, t: +W.U.uTime.value.toFixed(3) });
    }
    // contador de la práctica
    if (ok) { STATS.streak++; STATS.parries++; if (res === "perfect") STATS.perfect++; STATS.best = Math.max(STATS.best, STATS.streak); }
    else { STATS.streak = 0; STATS.fails++; }
    STATS.last = { res, kind: f.kind, early: W.pf ? Math.round((W.pf.lastEarly || 0) * 1000) : null, level: S.level };
    W.combatLog.push({ ev: "fodderDef", kind: f.kind, res, level: S.level, streak: S.streak, fails: S.fails, t: +W.U.uTime.value.toFixed(3) });
  };
  W.fodderResetScaffold = function () { for (const k of KINDS) Object.assign(SCAF[k], { level: 2, streak: 0, fails: 0 }); Object.assign(STATS, { streak: 0, best: 0, parries: 0, perfect: 0, fails: 0, last: null }); };

  function hide(f, h) {
    const ch = f.ch; f.hidden = h;
    if (h && f.ringMesh) f.ringMesh.visible = false;
    if (h && f.eyeGlow) f.eyeGlow.visible = false;
    ch.mesh.visible = ch.caster.visible = ch.blob.visible = ch.ghost.visible = !h;
    for (const m of ch.boots || []) m.visible = !h;
  }
  function respawn(f) {
    f.respawn(f.home.x, f.home.z); f.body.heading = f.home.heading;
    f.deadT = 0; f.fade = 1; f.respawnAt = 0; f.ch.uniforms.uFade.value = 1; f.jitter = 0;
    hide(f, false);
    if (f.ai) Object.assign(f.ai, { state: "idle", cool: 0.8, idleT: 0.5, alert: false });
    W.combatLog.push({ ev: "fodderRespawn", who: f.name, t: +W.U.uTime.value.toFixed(3) });
  }
  function onFrame(f, a) {
    if (a.name === "death" && a.f === 2 && W.sfx) W.sfx.combat("death");
    if (a.name === "attack" && a.f === W.hitF(a) && !a.clicked) {
      // IMPACT: clic sincronizado (en todos los niveles) y destello del anillo (si se veía)
      a.clicked = true;
      if (a.ringLv > 0) f.ringFlash = 1;
      if (W.sfx) W.sfx.combat("fodderClick");
      W.combatLog.push({ ev: "fodderImpact", who: f.name, kind: f.kind, ringLv: a.ringLv, t0: a.fodderT0, t: +W.ct.toFixed(4) });
    }
  }
  function remove(f) {
    if (f.ringMesh) { W.scene.remove(f.ringMesh); f.ringMesh.geometry.dispose(); }
    if (f.eyeGlow) W.scene.remove(f.eyeGlow);
  }

  // los mismos tres sitios que el autómata (claro del titán, bosque retorcido, cementerio)
  function sites() {
    const p = W.player, pts = [];
    const s1 = W.findSpot(-8, 1, null, 1.6);
    if (s1) pts.push({ x: s1.x, z: s1.z, heading: Math.atan2(p.z - s1.z, p.x - s1.x), zone: "heart" });
    for (const [zn, dx, dz] of [["roots", 4, 5], ["ruins", 3, -4]]) {
      const Z = W.ZONES[zn]; if (!Z) continue;
      const s = W.findSpot(Z.x + dx, Z.z + dz, null, 1.6);
      if (s) pts.push({ x: s.x, z: s.z, heading: Math.atan2(-s.z, -s.x), zone: zn });
    }
    return pts;
  }
  for (const kind of KINDS) {
    W.registerEnemy(kind, {
      label: CFG[kind].label,
      spawnPoints: sites,
      spawn(p) { return spawn(kind, p); },
      update, onFrame, respawn, remove,
    });
  }
  // ---- panel ⚙: «Anillo de timing» Auto / Siempre / Nunca ----------------------------------------------
  W.initFodderUI = function (pn) {
    const row = document.createElement("label");
    row.innerHTML = `Anillo <select id="fodRing"><option value="auto">Auto</option><option value="always">Siempre</option><option value="never">Nunca</option></select>`;
    pn.insertBefore(row, pn.querySelector("#tResp"));
    const sel = row.querySelector("select"); sel.value = CFG.ringMode;
    sel.addEventListener("change", () => W.setFodderRingMode(sel.value));
  };
  W.spawnFodder = spawn;
  W.fodderRespawn = respawn;
  W.fodderPhase = phaseOf;
})();
