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
        if (!f.alive) { if (this.state !== "death" && W.fodderReleaseToken) W.fodderReleaseToken(f); this.state = "death"; return; }
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
          if ((d < C.see || f.hp < f.hpMax || this.alert) && !(this.giveUpT && W.ct - this.giveUpT < 6)) this.state = "chase";
          else { this.wander(dt, false); return; }
        }
        if (fromHome > C.leash && d > C.see) { this.state = "wander"; this.wander(dt, true); return; }
        if (d < 4 && !b.path.length) b.heading += norm(toP - b.heading) * Math.min(1, dt * 7);   // (caminando mira hacia donde va)
        // golpe: a su distancia, cuando le toca (grupos: un solo atacante a la vez, ver W.fodderCanAttack)
        if (d <= C.engage && this.cool <= 0 && (!W.fodderCanAttack || W.fodderCanAttack(f))) { this.strike(toP); return; }
        if (W.fodderOrbit && W.fodderOrbit(f, dt)) return;              // grupos: los que esperan rodean
        if (d > C.engage * 0.9) {
          this.replan -= dt;
          if (this.replan <= 0 || !b.path.length) {
            this.replan = 0.4;
            // hacia ti (se para a su distancia, abajo); si tu celda no se alcanza, hacia un punto libre a tu lado
            let path = W.findPath(b.x, b.z, pl.body.x, pl.body.z, 14000);
            if (!path.length) { const s = W.findSpot(pl.body.x - Math.cos(toP) * C.engage * 0.75, pl.body.z - Math.sin(toP) * C.engage * 0.75, null, 0.3); if (s) path = W.findPath(b.x, b.z, s.x, s.z, 14000); }
            // ¿llega? (A* devuelve el trozo hasta lo más cercano si estás en un saliente: el relleno no salta)
            const end = path[path.length - 1], reach = end && Math.hypot(end.x - pl.body.x, end.z - pl.body.z) <= C.engage + 0.6;
            this.unreach = reach ? 0 : (this.unreach || 0) + 0.4;
            if (this.unreach > 4) { this.state = "wander"; this.alert = false; this.unreach = 0; this.giveUpT = W.ct; return; }   // se rinde y vuelve
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
      update, hiddenUpdate: update, onFrame, respawn, remove,
    });
  }
  // ---- grupos en ritmo de metrónomo -------------------------------------------------------------------
  // TOKEN DE ATAQUE ÚNICO: solo uno en WINDUP/ATTACK a la vez. El turno se suelta al acabar su RECOVERY o su STUN
  // (o al morir) y el siguiente empieza su WINDUP 700 ms después; mientras, ese siguiente ya se coloca a su
  // distancia y los demás rodean al jugador a 2-3 baldosas, esperando.
  const TOK = (W.FODDER_TOKEN = { holder: null, next: null, freeAt: -9, gap: 0.7, stamp: -1, log: [] });
  const engagedFodder = (f) => f && f.fodder && f.alive && !f.hidden && f.ai && f.ai.enabled && (f.ai.state === "chase" || f.ai.state === "orbit" ||
    f.ai.state === "windup" || f.ai.state === "attack" || f.ai.state === "recovery" || f.ai.state === "stun" || f.ai.state === "hit");
  W.fodderReleaseToken = function (f) {
    if (TOK.holder !== f) return;
    TOK.holder = null; TOK.freeAt = W.ct + TOK.gap;
    TOK.log.push({ ev: "free", who: f.name, t: +W.ct.toFixed(3) });
  };
  function pickNext() {
    if (TOK.stamp === W.ct) return;
    TOK.stamp = W.ct;
    const p = W.pf; let best = null;
    for (const o of W.foes || []) {
      if (o === TOK.holder || !engagedFodder(o) || !p) continue;
      const d = Math.hypot(o.body.x - p.body.x, o.body.z - p.body.z);
      if (d > 9) continue;
      const k = (o.ai.lastAtk || -99) + d * 0.01;                // quien lleva más tiempo esperando (y, a igualdad, el más cercano)
      if (!best || k < best.k) best = { f: o, k };
    }
    TOK.next = best ? best.f : null;
  }
  W.fodderCanAttack = function (f) {
    if (TOK.holder === f) return true;
    if (TOK.holder) {
      const h = TOK.holder;
      if (h.alive && !h.hidden && (W.foes || []).indexOf(h) >= 0) return false;
      W.fodderReleaseToken(h);
      return false;
    }
    if (W.ct < TOK.freeAt) return false;
    pickNext();
    if (TOK.next && TOK.next !== f) return false;
    TOK.holder = f; f.ai.lastAtk = W.ct; TOK.next = null;
    TOK.log.push({ ev: "take", who: f.name, t: +W.ct.toFixed(3) });
    if (TOK.log.length > 200) TOK.log.splice(0, 100);
    return true;
  };
  // los que esperan rodean al jugador (devuelve true si este se queda esperando en el corro)
  W.fodderOrbit = function (f, dt) {
    const p = W.pf; if (!p) return false;
    let others = 0;
    for (const o of W.foes || []) if (o !== f && engagedFodder(o)) others++;
    if (!others) return false;                                    // solo: va a por ti
    pickNext();
    if (TOK.holder === f || (TOK.next === f && !TOK.holder)) return false;
    if (TOK.next === f && TOK.holder) {
      // el siguiente: se acerca hasta su distancia y espera allí su turno
      const d = Math.hypot(f.body.x - p.body.x, f.body.z - p.body.z);
      if (d <= f.fodder.engage * 1.05) { f.body.stop(); f.body.heading = Math.atan2(p.body.z - f.body.z, p.body.x - f.body.x); f.ai.state = "chase"; return true; }
      return false;
    }
    const b = f.body, ai = f.ai;
    ai.orbitDir = ai.orbitDir || (rand() < 0.5 ? -1 : 1);
    const R = 2.5, cur = Math.atan2(b.z - p.body.z, b.x - p.body.x);
    // separación angular con los demás del corro
    let push = 0;
    for (const o of W.foes || []) {
      if (o === f || !engagedFodder(o)) continue;
      const ao = Math.atan2(o.body.z - p.body.z, o.body.x - p.body.x), da = norm(cur - ao);
      if (Math.abs(da) < 1.0) push += (da >= 0 ? 1 : -1) * (1.0 - Math.abs(da));
    }
    const ang = cur + ai.orbitDir * 0.35 * dt * 3 + push * 0.25;
    const tx = p.body.x + Math.cos(ang) * R, tz = p.body.z + Math.sin(ang) * R;
    if (W.cellFree(tx, tz) && Math.hypot(tx - b.x, tz - b.z) > 0.12) { b.path = [{ x: tx, z: tz }]; b.following = false; b.gait = "walk"; }
    else {
      if (!W.cellFree(tx, tz)) ai.orbitDir *= -1;
      b.stop(); b.heading += norm(Math.atan2(p.body.z - b.z, p.body.x - b.x) - b.heading) * Math.min(1, dt * 6);   // quieto: te mira
    }
    ai.state = "orbit";
    return true;
  };

  // ---- GRUPO DE PRÁCTICA (panel ⚙ o #enemy=fodder): 4 junto al jugador; cada uno que cae vuelve enseguida -----
  const PRACTICE_MIX = ["zombie", "dog", "zombie", "dog"];
  function practiceSpots(n) {
    const p = W.player, pts = [];
    for (let i = 0; i < n; i++) {
      let s = null;
      for (let k = 0; k < 12 && !s; k++) {
        const a = (i / n) * Math.PI * 2 + 0.4 + k * 0.5, r = 4.2 + (k % 3) * 0.6;
        const c = W.findSpot(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, W.heightAt(p.x, p.z), 0.5);
        if (c && Math.hypot(c.x - p.x, c.z - p.z) > 3) s = c;
      }
      if (s) pts.push({ x: s.x, z: s.z, heading: Math.atan2(p.z - s.z, p.x - s.x), zone: "practice", kind: PRACTICE_MIX[i % PRACTICE_MIX.length] });
    }
    return pts;
  }
  function practiceUpdate(f, dt) {
    update(f, dt);
    // el que cae vuelve a 5 u del jugador (fuera del corro) 1 s después de desvanecerse, ya en guardia
    if (f.hidden) {
      f.backT = (f.backT || 0) + dt;
      if (f.backT > 1.0 && W.pf && W.pf.alive) {
        f.backT = 0;
        const p = W.player;
        for (let k = 0; k < 10; k++) {
          const a = rand() * Math.PI * 2, s = W.findSpot(p.x + Math.cos(a) * 5, p.z + Math.sin(a) * 5, W.heightAt(p.x, p.z), 0.5);
          if (s) { f.home = { x: s.x, z: s.z, heading: Math.atan2(p.z - s.z, p.x - s.x) }; break; }
        }
        respawn(f); f.ai.alert = true;
      }
    } else f.backT = 0;
  }
  W.registerEnemy("fodder", {
    label: "Grupo de práctica",
    spawnPoints() { return practiceSpots(4); },
    spawn(p) { const f = spawn(p.kind, p); f.practice = true; f.noAutoRespawn = true; f.ai.alert = true; return f; },
    update: practiceUpdate, hiddenUpdate: practiceUpdate, onFrame, respawn(f) { respawn(f); f.ai.alert = true; }, remove,
  });
  W.spawnPracticeGroup = function () { W.setEnemyType("fodder"); return W.foes; };

  // ---- grupos del mundo: en el cementerio del bosque muerto y en las charcas (el autómata sigue en sus 3 zonas) --
  // Aparecen cuando te acercas (a 24 u) y se retiran si te alejas mucho (42 u) sin estar peleando.
  const SITES = [
    { zone: "ruins", dx: -5, dz: 5, mix: ["zombie", "zombie", "dog"] },
    { zone: "ponds", dx: -4, dz: 3, mix: ["dog", "dog", "zombie", "zombie"] },
    { zone: "ponds", dx: 5, dz: -3, mix: ["zombie", "dog"] },
  ];
  const STREAM = (W.FODDER_WORLD = { on: true, groups: SITES.map(() => null), near: 24, far: 42 });
  W.fodderStream = function () {
    if (!STREAM.on || W.enemyType !== "automaton" || !W.player || !W.ZONES) return;
    const p = W.player;
    SITES.forEach((S, i) => {
      const Z = W.ZONES[S.zone]; if (!Z) return;
      const cx = Z.x + S.dx, cz = Z.z + S.dz, d = Math.hypot(p.x - cx, p.z - cz);
      const G = STREAM.groups[i];
      if (!G && d < STREAM.near) {
        const list = [];
        S.mix.forEach((kind, k) => {
          const a = k / S.mix.length * Math.PI * 2, s = W.findSpot(cx + Math.cos(a) * 1.8, cz + Math.sin(a) * 1.8, null, 0.6);
          if (!s) return;
          const f = W.addFoe(kind, { x: s.x, z: s.z, heading: a + Math.PI, zone: S.zone });
          if (f) { f.worldGroup = i; list.push(f); }
        });
        STREAM.groups[i] = list;
        W.combatLog.push({ ev: "fodderGroup", zone: S.zone, n: list.length, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 });
      } else if (G && d > STREAM.far && !G.some((f) => engagedFodder(f))) {
        for (const f of G) if (W.removeFoe) W.removeFoe(f);
        STREAM.groups[i] = null;
      }
    });
  };
  W.fodderStreamReset = function () { STREAM.groups = SITES.map(() => null); };

  // ---- contador en pantalla: parries seguidos, % de PERFECTOS y nivel del anillo ---------------------------
  let cnt = null;
  W.fodderHud = function () {
    const p = W.pf; if (!p) return;
    let near = null, bd = 1e9;
    for (const f of W.foes || []) { if (!f.fodder || !f.alive || f.hidden) continue; const d = Math.hypot(f.body.x - p.body.x, f.body.z - p.body.z); if (d < bd) { bd = d; near = f; } }
    const on = !!near && (bd < 10 || W.enemyType === "fodder");
    if (!cnt) {
      const w = document.getElementById("wrap"); if (!w) return;
      cnt = document.createElement("div"); cnt.id = "fodHud"; cnt.setAttribute("aria-live", "polite");
      w.appendChild(cnt);
      const css = document.createElement("style");
      css.textContent = `#fodHud{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));top:calc(112px + env(safe-area-inset-top,0px));font-size:8px;line-height:1.7;
        color:#cfe9ef;background:rgba(8,14,20,.62);border:1px solid rgba(120,220,240,.35);padding:5px 8px;pointer-events:none;z-index:4;display:none;white-space:nowrap}
        #fodHud b{color:#8ff0ff;font-weight:normal}#fodHud .pf{color:#ffd34a}`;
      document.head.appendChild(css);
    }
    if (cnt._on !== on) { cnt._on = on; cnt.style.display = on ? "block" : "none"; }
    if (!on) return;
    const pc = STATS.parries ? Math.round(100 * STATS.perfect / STATS.parries) : 0;
    const lv = (k) => ringLevel(k);
    const html = `PARRIES SEGUIDOS <b>${STATS.streak}</b><br>PERFECTOS <span class="pf">${pc} %</span> <span style="opacity:.7">(${STATS.perfect}/${STATS.parries})</span><br>ANILLO zombi <b>${lv("zombie")}</b> · perro <b>${lv("dog")}</b>`;
    if (cnt._h !== html) { cnt._h = html; cnt.innerHTML = html; }
  };

  // ---- panel ⚙: «Anillo de timing» Auto / Siempre / Nunca ----------------------------------------------
  W.initFodderUI = function (pn) {
    const row = document.createElement("label");
    row.innerHTML = `Anillo <select id="fodRing"><option value="auto">Auto</option><option value="always">Siempre</option><option value="never">Nunca</option></select>`;
    pn.insertBefore(row, pn.querySelector("#tResp"));
    const sel = row.querySelector("select"); sel.value = CFG.ringMode;
    sel.addEventListener("change", () => W.setFodderRingMode(sel.value));
    const b = document.createElement("button"); b.id = "tFod"; b.textContent = "Grupo de práctica";
    pn.insertBefore(b, pn.querySelector("#tResp"));
    b.addEventListener("click", () => W.spawnPracticeGroup());
  };
  W.spawnFodder = spawn;
  W.fodderRespawn = respawn;
  W.fodderPhase = phaseOf;
})();
