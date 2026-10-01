// enemies/automaton/automaton.js — el Autómata del bosque (enemigo por defecto).
//
// Cuerpo: su propio atlas (idle, walk, run, attack1, attack2, parry, hit, block, dodge, death × 8 direcciones),
// 1.4 veces la altura del personaje, pies anclados y sombras como el personaje, ojo cian emisivo con una
// luz puntual que ilumina un poco su entorno (y lo delata en la oscuridad).
//
// Comportamiento (pesado y amenazante, pero legible):
//   · patrulla lenta (walk) alrededor de su punto; al ver al jugador (8 u, o si le ataca) se acerca
//     corriendo (run) por A* y se para a distancia de golpe
//   · ataques: attack1 = zarpazo rápido, attack2 = barrido amplio (arco de 115°). Antes de cada uno, una
//     preparación larga (×1.9 más lenta, ajustable) con el ojo parpadeando fuerte, un destello y un zumbido
//     grave: se puede leer y desviar
//   · defensa ante los golpes del jugador (dificultad del panel): a veces bloquea (block) y a veces hace
//     parry (sobre todo si el jugador repite el mismo ataque); su parry quita postura al jugador
//   · esquiva (dodge) de lado cuando está bajo de vida o tras encajar un combo
//   · postura: los parries del jugador la llenan rápido (40-50 cada uno); llena = aturdido 3.2 s (frames
//     STAGGER de hit en bucle lento), expuesto a un remate (×3)
//   · al perder vida: hit con retroceso; al morir: death, se queda en el suelo y a los 3 s se desvanece
//     mientras se levantan esporas
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  const CFG = (W.AUTOMATON = {
    height: 1.4,                 // × altura del personaje
    hp: 260, stamina: 120, staminaRegen: 12, posture: 100,   // stamina: su guardia se agota si se le presiona
    prepK: 1.9,                  // preparación de los ataques (× más lenta)
    see: 8, leash: 15, patrolR: 3.2,
    attacks: {
      // post = postura que gana al desviárselo (NORMAL; PERFECTO ×1.33): 18-24 y 21-28, + racha en la cadena
      attack1: { dmg: 18, reach: 2.2, arc: 75, stop: 0.09, kb: 0.45, post: 18 },
      attack2: { dmg: 26, reach: 2.5, arc: 115, stop: 0.12, kb: 0.7, heavy: true, post: 21 },
    },
    eyeLight: { color: 0x5fe8ff, intensity: 0.9, distance: 4.5 },
  });
  let seed = 4242;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ---- cuerpo y personaje ---------------------------------------------------------------------------
  function spawn(p, A) {
    const meta = A.emeta;
    // fps de las animaciones en bucle (idle, walk, run) a partir de la duración de sus frames
    for (const an of meta.anims) { const m = meta.animations[an]; if (!m.fps) m.fps = Math.round(6000 / m.ms.reduce((x, y) => x + y, 0)); }
    const body = new W.Player(p.x, p.z);
    body.radius = 0.42; body.runMul = 0.6;
    const ch = W.makeCharacter(W.scene, A.etex, meta, null, null,
      { feet: meta.feet, height: CFG.height * W.CHAR_H, emit: 1, emitCol: [0.35, 0.95, 1.0], locoFps: 11 });
    body.ch = ch;
    const f = W.addFighter(new W.Fighter(body, {
      team: "foe", name: "autómata", hp: CFG.hp, stamina: CFG.stamina, staminaRegen: CFG.staminaRegen, posture: CFG.posture, meta,
      prepK: CFG.prepK, stunTime: 3.2, stunRate: 2.2, dodgeDist: 2.6, kbK: 0.45, dodgeInv: [1, 3],
      attackWant: { attack1: 1.55, attack2: 1.75 },
    }), ch);
    f.attacks = CFG.attacks; f.radiusHit = 0.5; f.label = "AUTÓMATA";
    f.home = { x: p.x, z: p.z, heading: p.heading };
    body.heading = p.heading;
    // luz del ojo
    const L = new THREE.PointLight(CFG.eyeLight.color, CFG.eyeLight.intensity, CFG.eyeLight.distance, 2);
    W.scene.add(L); f.eyeLight = L;
    // halo del ojo: lo delata en la oscuridad y entre la niebla (pero no a través de los objetos)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: 0x7ff0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    halo.scale.set(0.9, 0.9, 1); halo.renderOrder = 4; W.scene.add(halo); f.eyeHalo = halo;
    f.ai = makeAI(f);
    f.fade = 1; f.deadT = 0;
    ch.onStep = (e, kind, P) => heavyStep(f, e, kind, P);
    return f;
  }

  let _halo = null;
  function haloTex() {
    if (_halo) return _halo;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.15, "rgba(200,250,255,0.8)"); gr.addColorStop(0.45, "rgba(90,220,255,0.18)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (_halo = new THREE.CanvasTexture(c));
  }
  // posición del ojo en el mundo (del JSON: píxeles del atlas respecto al pivote)
  const _v = new THREE.Vector3();
  function eyeWorld(f) {
    const ch = f.ch, st = ch.st, meta = ch.meta;
    const e = meta.eye_px[st.anim + "_" + DIRS[st.dir]] && meta.eye_px[st.anim + "_" + DIRS[st.dir]][Math.min(5, st.frame)];
    const th = W.ui ? W.ui.theta : Math.PI / 4;
    const rx = Math.cos(th), rz = -Math.sin(th), tx = Math.sin(th), tz = Math.cos(th);
    const b = f.body;
    const ex = e ? e[0] : 0, ey = e ? e[1] : -95;
    _v.set(b.x + rx * ex * ch.unitsH + tx * 0.35, b.y + (st.hgt || 0) - ey * ch.unitsV, b.z + rz * ex * ch.unitsH + tz * 0.35);
    return { p: _v, visible: !!e };
  }

  // ---- pisadas pesadas: la cámara tiembla un poco (según la distancia), polvo o esporas y un golpe grave ----
  const SPORES = [[0.55, 0.75, 0.35], [0.8, 0.95, 0.55], [0.45, 0.9, 0.85]];
  function heavyStep(f, e, kind, P) {
    const run = e.anim === "run", pl = W.player;
    const d = Math.hypot(e.x - pl.x, e.z - pl.z), near = Math.max(0, 1 - d / 13);
    const y = W.heightAt(e.x, e.z);
    W.fx.dust(e.x, kind === "water" ? y + 0.045 : y, e.z, Math.round(P.n * (run ? 2.2 : 1.6)), Object.assign({}, P, { spd: (P.spd || 1) * 1.3, up: (P.up || 1) * 1.2 }));
    // esporas del musgo que lleva encima (en hierba, hojas y tierra)
    if (kind !== "water" && kind !== "metal") W.fx.dust(e.x, y + 0.5, e.z, run ? 4 : 3, { pal: SPORES, spd: 0.35, up: 0.9, life: 1.2 });
    if (kind === "water") W.fx.ripple(e.x, y + 0.045, e.z, run ? 1.1 : 0.8);
    else if (kind !== "metal") W.fx.footprint(e.x, y, e.z, e.heading, 0.5);
    if (near > 0) {
      if (W.shakeCam) W.shakeCam(0, 1, (run ? 0.045 : 0.028) * near, 0.18);
      if (W.sfx) W.sfx.combat("stomp", (run ? 1.1 : 0.8) * near);
    }
    f.steps = (f.steps || 0) + 1;
  }

  // ---- IA -------------------------------------------------------------------------------------------
  function makeAI(f) {
    return {
      enabled: true, state: "patrol", t: 0, replan: 0, cool: 1.2, idleT: 0, warnT: -1, pending: null,
      hold: 0, playerSeq: [], lastHits: [],
      update(dt) {
        const b = f.body, pl = W.pf, D = W.ENEMY_DIFF;
        this.t += dt;
        if (this.warnT >= 0) this.warnT += dt;
        if (!this.enabled || !f.alive || !pl) return;
        // reacciones programadas (bloqueo, parry, esquiva)
        if (this.pending && this.t >= this.pending.at) { const q = this.pending; this.pending = null; this.react(q); }
        if (this.hold > 0) { this.hold -= dt; if (this.hold <= 0 && f.act && f.act.name === "block") f.guardHeld = false; }
        if (f.act) return;
        const dx = pl.body.x - b.x, dz = pl.body.z - b.z, d = Math.hypot(dx, dz), toP = Math.atan2(dz, dx);
        const fromHome = Math.hypot(b.x - f.home.x, b.z - f.home.z);
        const plHome = Math.hypot(pl.body.x - f.home.x, pl.body.z - f.home.z);
        if (!pl.alive || plHome > CFG.leash + 3) { this.state = fromHome > 1 ? "home" : "patrol"; }
        else if (this.state === "patrol" || this.state === "home") { if (d < CFG.see || f.hp < f.hpMax) { this.state = "chase"; this.cool = Math.max(this.cool, 0.8); } }
        if (this.state === "home") {
          if (fromHome < 0.8) { this.state = "patrol"; b.stop(); return; }
          this.goTo(f.home.x, f.home.z, "walk"); return;
        }
        if (this.state === "patrol") {
          // paseo lento entre puntos cercanos a su casa, con pausas
          if (!b.path.length) {
            this.idleT -= dt;
            if (this.idleT <= 0) {
              const a = rand() * Math.PI * 2, r = 1 + rand() * CFG.patrolR;
              const s = W.findSpot(f.home.x + Math.cos(a) * r, f.home.z + Math.sin(a) * r, W.heightAt(f.home.x, f.home.z));
              if (s) { const path = W.findPath(b.x, b.z, s.x, s.z, 6000); if (path.length) { b.setPath(path, { noDelay: true }); b.gait = "walk"; } }
              this.idleT = 1.8 + rand() * 2.2;
            }
          } else b.gait = "walk";
          return;
        }
        // persecución y combate
        this.cool -= dt * D.react;
        if (d < 3.6) b.heading += norm(toP - b.heading) * Math.min(1, dt * 5);
        if (this.cool <= 0 && d <= 2.5 && pl.alive) {
          b.stop(); b.heading = toP;
          const wide = d > 1.9 ? rand() < 0.7 : rand() < 0.3;
          this.attack(wide ? "attack2" : "attack1", toP);
          this.cool = (1.3 + rand() * 0.9 + (wide ? 0.4 : 0));
          return;
        }
        if (d > 1.9) {
          this.replan -= dt;
          if (this.replan <= 0 || !b.path.length) {
            this.replan = 0.4;
            const tx = pl.body.x - Math.cos(toP) * 1.7, tz = pl.body.z - Math.sin(toP) * 1.7;
            const path = W.findPath(b.x, b.z, tx, tz, 9000);
            if (path.length) { b.setPath(path, { noDelay: true }); b.gait = d > 4.5 ? "run" : "walk"; }
          }
        } else if (b.path.length) b.stop();
      },
      goTo(x, z, gait) {
        const b = f.body;
        this.replan -= 1 / 60;
        if (this.replan <= 0 || !b.path.length) { this.replan = 0.6; const p = W.findPath(b.x, b.z, x, z, 12000); if (p.length) { b.setPath(p, { noDelay: true }); b.gait = gait; } }
      },
      attack(name, dir) {
        f.startAttack(name, { dir });
        // aviso: el ojo parpadea fuerte durante la preparación (update del tipo), destello y zumbido grave
        this.warnT = 0; this.warnKind = name;
        const e = eyeWorld(f);
        if (W.combatStar) W.combatStar(e.p.x, e.p.y, e.p.z, name === "attack2" ? 1.1 : 0.85, 0x9ff4ff, 0.35);
        if (W.sfx) W.sfx.combat(name === "attack2" ? "chargeHeavy" : "charge");
        W.combatLog.push({ ev: "warn", who: f.name, anim: name, t: +W.U.uTime.value.toFixed(3) });
      },
      // el jugador empieza un ataque cerca: decidir (con el tiempo de reacción de la dificultad)
      onPlayerAttack(act) {
        const pl = W.pf, b = f.body, D = W.ENEMY_DIFF;
        if (!f.alive || this.state !== "chase" && this.state !== "patrol") return;
        const d = Math.hypot(pl.body.x - b.x, pl.body.z - b.z);
        if (d > 3.4) return;
        // en mitad del tambaleo (tras encajar golpes) solo puede esquivar
        const inHit = f.act && f.act.name === "hit" && f.act.f >= 2 && !f.act.gb;
        if (f.act && !inHit && !(f.act.name === "block" || (f.act.name.startsWith("attack") && f.act.f >= 5))) return;
        this.state = "chase";
        // repetición: el mismo ataque varias veces seguidas -> más parry
        const now = this.t;
        this.playerSeq = this.playerSeq.filter((q) => now - q.t < 3.5); this.playerSeq.push({ t: now, n: act.name });
        let rep = 0; for (let i = this.playerSeq.length - 1; i >= 0 && this.playerSeq[i].n === act.name; i--) rep++;
        this.lastHits = this.lastHits.filter((t) => now - t < 2.2);
        const combo = this.lastHits.length >= 2;
        const pDodge = (f.hp < f.hpMax * 0.35 ? 0.35 : 0) + (combo ? 0.35 : 0);
        const pParry = Math.min(0.85, D.parry * (1 + 0.8 * (rep - 1)));
        const pBlock = D.block;
        const M = pl.M(), c = M.animations[act.name].ms;
        const toImpact = (c[0] + c[1] + c[2]) / 1000 - (act.tt || 0);
        const reactT = 0.14 / Math.max(0.3, D.react);
        const r = rand();
        let kind = null;
        if (inHit) { if (r < pDodge + 0.15) kind = "dodge"; }
        else if (r < pDodge) kind = "dodge";
        else if (r < pDodge + pParry * (1 - pDodge)) kind = "parry";
        else if (r < pDodge + (pParry + pBlock) * (1 - pDodge)) kind = "block";
        if (!kind) return;
        const at = kind === "parry" ? this.t + Math.max(reactT, toImpact - 0.1) : this.t + (kind === "dodge" ? reactT * 0.5 : reactT);
        if (kind !== "parry" && reactT > toImpact + 0.05) return;         // no le da tiempo
        this.pending = { kind, at, dir: Math.atan2(pl.body.z - b.z, pl.body.x - b.x), rep };
      },
      react(q) {
        const b = f.body;
        const inHit = f.act && f.act.name === "hit" && f.act.f >= 2 && !f.act.gb;
        if (!f.alive || (f.act && f.act.name !== "block" && !inHit && !(f.act.name.startsWith("attack") && f.act.f >= 5))) return;
        if (inHit && q.kind !== "dodge") return;
        if (q.kind === "block") {
          f.guardHeld = true; f.start("block"); f.act.tt = 0.07; this.hold = 0.75;
          W.combatLog.push({ ev: "foeBlock", who: f.name, t: +W.U.uTime.value.toFixed(3) });
        } else if (q.kind === "parry") {
          f.act = null; b.heading = q.dir; f.input("guardDown"); f.input("guardUp");
          W.combatLog.push({ ev: "foeParryTry", who: f.name, rep: q.rep, t: +W.U.uTime.value.toFixed(3) });
        } else if (q.kind === "dodge") {
          f.act = null; const side = rand() < 0.5 ? 1 : -1;
          f.startDodge({ dir: q.dir + side * Math.PI / 2 + Math.PI * 0.15 * side });
          W.combatLog.push({ ev: "foeDodge", who: f.name, t: +W.U.uTime.value.toFixed(3) });
        }
      },
    };
  }

  // ---- ganchos -----------------------------------------------------------------------------------------
  function onAct(f, actor, act) {
    if (actor === W.pf && act.name.startsWith("attack") && f.ai && f.ai.enabled) f.ai.onPlayerAttack(act);
    if (actor === W.pf && act.name === "hit" && f.ai) { /* el jugador golpeado: nada */ }
  }
  function onFrame(f, a) {
    if (a.name === "hit" && a.f === 0 && f.ai) f.ai.lastHits.push(f.ai.t);
    if (a.name.startsWith("attack") && a.f === 2 && W.sfx) W.sfx.combat(a.name === "attack2" ? "swingHeavy" : "swing");
    if (a.name === "death" && a.f === 3 && W.sfx) W.sfx.combat("death");
  }
  function update(f, dt) {
    const ch = f.ch, U = ch.uniforms, ai = f.ai;
    // ojo: parpadeo fuerte durante la preparación del ataque (aviso)
    let k = 1;
    const a = f.act;
    if (a && a.name.startsWith("attack") && a.f < 3) {
      const tt = ai ? ai.t : 0;
      k = 1.6 + 1.8 * (0.5 + 0.5 * Math.sign(Math.sin(tt * 2 * Math.PI * 7)));
    }
    if (a && a.name === "stun") k = 0.5 + 0.4 * Math.sin((ai ? ai.t : 0) * 10);
    if (!f.alive) k = Math.max(0, 1 - f.deadT / 1.2);
    U.uEyeK.value = k;
    // luz del ojo: sigue al ojo; más fuerte en el aviso; se apaga al morir
    const L = f.eyeLight;
    if (L) {
      const e = eyeWorld(f);
      L.position.copy(e.p);
      L.intensity = CFG.eyeLight.intensity * (e.visible ? 1 : 0.55) * Math.min(1.8, k) * f.fade;
      const h = f.eyeHalo;
      if (h) {
        h.position.copy(e.p);
        h.visible = e.visible && f.fade > 0.02 && !f.hidden;
        const s = (0.55 + 0.35 * Math.min(2.5, k) / 2.5) * (1 + 0.05 * Math.sin((ai ? ai.t : 0) * 3));
        h.scale.set(s, s, 1); h.material.opacity = 0.55 * Math.min(1, k) * f.fade;
      }
    }
    // muerte: en el suelo 3 s, luego se desvanece (2.5 s) con esporas que se levantan
    if (!f.alive) {
      f.deadT += dt;
      if (f.deadT > 3) {
        const u = Math.min(1, (f.deadT - 3) / 2.5);
        f.fade = 1 - u;
        if (W.fx && Math.floor(f.deadT * 12) !== Math.floor((f.deadT - dt) * 12) && f.fade > 0.05) {
          const b = f.body;
          W.fx.dust(b.x + (rand() - 0.5) * 1.4, b.y + 0.1, b.z + (rand() - 0.5) * 1.0, 3,
            { pal: [[0.55, 0.75, 0.35], [0.8, 0.95, 0.55], [0.45, 0.9, 0.85]], spd: 0.25, up: 1.4, life: 1.6 });
        }
        if (u >= 1 && !f.hidden) { f.hidden = true; ch.mesh.visible = ch.caster.visible = ch.blob.visible = ch.ghost.visible = false; for (const m of ch.boots) m.visible = false; }
      }
    } else { f.deadT = 0; f.fade = 1; }
    U.uFade.value = f.fade;
  }
  function respawn(f) {
    f.respawn(f.home.x, f.home.z); f.body.heading = f.home.heading;
    f.deadT = 0; f.fade = 1; f.hidden = false; f.ch.uniforms.uFade.value = 1;
    const ch = f.ch; ch.mesh.visible = ch.caster.visible = ch.blob.visible = ch.ghost.visible = true;
    if (f.ai) { f.ai.state = "patrol"; f.ai.cool = 1.2; f.ai.pending = null; f.ai.hold = 0; f.ai.warnT = -1; }
  }
  function remove(f) { if (f.eyeLight) { f.eyeLight.intensity = 0; W.scene.remove(f.eyeLight); } if (f.eyeHalo) W.scene.remove(f.eyeHalo); }

  W.registerEnemy("automaton", {
    label: "Autómata del bosque",
    spawnPoints() {
      const p = W.player, pts = [];
      // 1) el claro junto al titán (a ~11 u del inicio: no ataca nada más empezar)
      const s1 = W.findSpot(-8, 1, null, 1.6);
      if (s1) pts.push({ x: s1.x, z: s1.z, heading: Math.atan2(p.z - s1.z, p.x - s1.x), zone: "heart" });
      // 2) el bosque de raíces y 3) las ruinas del cementerio
      for (const [zn, dx, dz] of [["roots", 4, 5], ["ruins", 3, -4]]) {
        const Z = W.ZONES[zn]; if (!Z) continue;
        const s = W.findSpot(Z.x + dx, Z.z + dz, null, 1.6);
        if (s) pts.push({ x: s.x, z: s.z, heading: Math.atan2(-s.z, -s.x), zone: zn });
      }
      return pts;
    },
    spawn(p, A) { return spawn(p, A); },
    update, onFrame, onAct, respawn, remove,
  });
  W.automatonEye = eyeWorld;
})();
