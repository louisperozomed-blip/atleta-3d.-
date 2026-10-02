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
  });
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
    return f;
  }

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
        if (f.act) { f.act.move = "attack"; f.act.fodderT0 = W.ct; }
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
  function hide(f, h) {
    const ch = f.ch; f.hidden = h;
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
      update, onFrame, respawn,
    });
  }
  W.spawnFodder = spawn;
  W.fodderRespawn = respawn;
  W.fodderPhase = phaseOf;
})();
