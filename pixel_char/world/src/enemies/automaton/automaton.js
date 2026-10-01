// enemies/automaton/automaton.js — el Autómata del bosque (enemigo por defecto).
//
// Cuerpo: su propio atlas (idle, walk, run, attack1, attack2, parry, hit, block, dodge, death × 8 direcciones),
// 1.4 veces la altura del personaje, pies anclados y sombras como el personaje, ojo cian emisivo con una
// luz puntual que ilumina un poco su entorno (y lo delata en la oscuridad).
//
// Comportamiento (un duelista: pesado y amenazante, pero legible y justo):
//   · patrulla lenta (walk) alrededor de su punto; al ver al jugador (8 u, o si le ataca) se acerca
//     corriendo (run) por A* y se para a distancia de golpe
//   · ataca en CADENAS de 2-4 golpes (attack1 = zarpazo, attack2 = barrido amplio) con ritmos distintos
//     (rápido-rápido-lento, lento-pausa-rápido...). Cada golpe tiene un plan en dos tiempos:
//       CARGA (el ojo parpadea: aviso) → [RETENCIÓN: ojo fijo encendido, solo en los retrasados] →
//       SUELTA (destello del ojo + chasquido: el golpe llega en 0.36-0.46 s) → impacto
//     preparación visible ≥ 350 ms siempre; avisos más evidentes cuanto más fuerte es el golpe
//   · trucos (como mucho uno por cadena y nunca en dos cadenas seguidas): golpe retrasado (castiga pulsar de
//     memoria) o finta (corta la carga y cambia de golpe)
//   · ataques PELIGROSOS (aviso rojo + sonido grave; no se desvían ni se bloquean), cada uno con su pose y su
//     respuesta: BARRIDO bajo (agachado; se salta, y en el aire se contraataca), ESTOCADA (encogido y lanzado;
//     esquivar HACIA él en el momento justo = contraataque que le quita mucha postura) y AGARRE (brazos en alto;
//     se esquiva de lado)
//   · nunca ataca si estás en el suelo o encajando un golpe; tras cada cadena, ventana de castigo clara (se
//     queda resoplando: ni ataca ni se defiende)
//   · defensa: te LEE en vez de tirar dados (modelo de trigramas de tus golpes y su ritmo): si te repites,
//     alza la guardia (ojo ámbar) un poco antes del impacto previsto y te hace parry (quita postura); si varías el
//     ritmo, retrasas o fintas, su parry falla y queda expuesto. Reacciona como un humano (200-260 ms): solo
//     bloquea lo que tarda más que eso. Su conocimiento se reinicia al reaparecer
//   · esquiva (dodge) de lado cuando está bajo de vida o tras encajar un combo, si le da tiempo
//   · dificultad adaptativa suave: muertes seguidas → pausas más largas; parries perfectos seguidos → pausas
//     más cortas y más trucos
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
      // peligrosos: no se desvían ni se bloquean; perilous = la respuesta correcta
      sweep: { dmg: 24, reach: 2.7, arc: 150, stop: 0.12, kb: 0.8, heavy: true, perilous: "jump", post: 0 },
      thrust: { dmg: 26, reach: 1.75, arc: 35, stop: 0.13, kb: 0.9, heavy: true, perilous: "mikiri", mikiriPost: 42, post: 0 },
      grab: { dmg: 30, reach: 2.15, arc: 70, stop: 0.15, kb: 1.3, heavy: true, perilous: "side", throw: true, post: 0 },
    },
    // golpes: animación, pose (frames de otras hojas), aviso (1 leve, 2 fuerte, 3 peligroso) y tiempo de SUELTA (s)
    moves: {
      attack1: { anim: "attack1", level: 1, rel: 0.36, want: 1.55 },
      attack2: { anim: "attack2", level: 2, rel: 0.4, want: 1.75 },
      sweep: { anim: "attack2", level: 3, rel: 0.46, want: 1.6, cap: 1.3, track: true, crouch: 0.2 },
      thrust: { anim: "attack1", level: 3, rel: 0.46, want: 0.95, cap: 2.3, seek: 4.4, lungeFrom: "release",
        show: [["dodge", 0], ["dodge", 1], ["dodge", 2], ["dodge", 3], ["dodge", 4], ["attack1", 5]] },
      grab: { anim: "attack1", level: 3, rel: 0.46, want: 1.2, cap: 2.4, track: true, seek: 4.4,
        show: [["block", 0], ["block", 1], ["parry", 1], ["attack1", 3], ["attack1", 4], ["attack1", 5]] },
    },
    wind: { f: 0.12, n: 0.32, s: 0.55, feint: 0.16 },   // carga según el ritmo (rápido, normal, lento)
    hold: [0.32, 0.5],                                  // retención de un golpe retrasado
    // cadenas: [golpe, ritmo, pausa desde la recuperación del anterior (s)]
    chains: [
      { id: "rrl", name: "rápido-rápido-lento", w: 3, steps: [["attack1", "f", 0], ["attack1", "f", 0.05], ["attack2", "s", 0.2]] },
      { id: "lpr", name: "lento-pausa-rápido", w: 3, steps: [["attack2", "s", 0], ["attack1", "f", 0.6]] },
      { id: "dos", name: "zarpazo y barrido", w: 3, steps: [["attack1", "n", 0], ["attack2", "n", 0.1]] },
      { id: "cuatro", name: "cuatro golpes", w: 2, steps: [["attack1", "f", 0], ["attack1", "n", 0.08], ["attack2", "f", 0.25], ["attack1", "s", 0.05]] },
      { id: "barrido", name: "zarpazo y barrido bajo", w: 1.2, steps: [["attack1", "n", 0], ["sweep", "n", 0.2]] },
      { id: "estocada", name: "barrido y estocada", w: 1.2, steps: [["attack2", "n", 0], ["thrust", "n", 0.3]] },
      { id: "agarre", name: "zarpazo y agarre", w: 1.2, steps: [["attack1", "f", 0], ["grab", "n", 0.25]] },
    ],
    trick: 0.4,                  // probabilidad de un truco (retraso o finta) en una cadena
    vent: 0.95,                  // ventana de castigo tras cada cadena (resopla: ni ataca ni se defiende)
    pause: [0.9, 1.6],           // pausa entre cadenas
    lastRecK: 0.7,               // la recuperación del último golpe de la cadena, más lenta
    exposed: 0.6,                // su parry falló (le engañaste): expuesto este tiempo (más postura por tus golpes)
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
    f.onPhase = (a, ph) => onPhase(f, a, ph);
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
      lastHits: [], chain: null, chainN: 0, vent: 0, lastTrick: false, forced: null, stanceUntil: 0, pAtks: [],
      adapt: 0, deaths: 0, perfStreak: 0, sawDeath: false,
      update(dt) {
        const b = f.body, pl = W.pf, D = W.ENEMY_DIFF;
        this.t += dt;
        if (this.warnT >= 0) this.warnT += dt;
        if (this.vent > 0) this.vent = Math.max(0, this.vent - dt);
        this.adaptStep(dt);
        if (!this.enabled || !f.alive || !pl) return;
        // tus golpes: cada impacto es una ficha para el modelo
        for (let i = this.pAtks.length - 1; i >= 0; i--) {
          const a = this.pAtks[i];
          if (a.impactT != null) { this.pAtks.splice(i, 1); this.addToken(a.name === "attack1" ? "a1" : a.name === "attack2" ? "a2" : "a3", a.impactT); }
          else if (pl.act !== a) this.pAtks.splice(i, 1);
        }
        // defensa: compromiso por lectura y reacción humana
        if (!this.training) { this.defendStep(); this.reactStep(); }   // en entrenamiento no te lee ni se defiende
        if (this.stanceUntil && W.ct > this.stanceUntil) { this.stanceUntil = 0; if (f.act && f.act.name === "block") f.guardHeld = false; }
        // cadena en curso: el siguiente golpe sale en la recuperación del anterior (con su pausa)
        if (this.chain) this.runChain(dt);
        if (f.act || this.chain) return;
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
        if (this.vent <= 0) this.cool -= dt;
        if (d < 3.6) b.heading += norm(toP - b.heading) * Math.min(1, dt * 5);
        // si espera tu golpe (te ha leído), no ataca: se queda a defender
        const waiting = this.commit && W.ct > this.commit.stance - 0.7;
        if (this.cool <= 0 && this.vent <= 0 && !waiting && !this.passive && d <= 2.6 && this.canStrike()) { b.stop(); b.heading = toP; this.startChain(this.pickChain(d)); return; }
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
      // ---- cadenas -------------------------------------------------------------------------------------
      // nunca ataca si estás en el suelo o encajando un golpe
      canStrike() { const p = W.pf; return !!p && p.alive && !(p.act && (p.act.name === "hit" || p.act.name === "death")); },
      pauseK() { return 1 - 0.25 * Math.max(-1.2, Math.min(1, this.adapt || 0)); },   // dificultad adaptativa (etapa 4)
      pickChain(d) {
        const L = CFG.chains;
        if (this.forced) { const c = L.find((x) => x.id === this.forced); if (c) return c; }
        let tot = 0; for (const c of L) tot += c.w;
        let r = rand() * tot;
        for (const c of L) { r -= c.w; if (r <= 0) return c; }
        return L[0];
      },
      startChain(def) {
        // pasos: {m, r, gap, delay, feint}; como mucho un truco por cadena y nunca en dos cadenas seguidas
        const steps = def.steps.map(([m, r, gap]) => ({ m, r, gap }));
        let trick = null;
        const pT = CFG.trick * (1 + 0.5 * Math.max(0, this.adapt || 0));
        if (!this.lastTrick && !this.noTricks && (this.forcedTrick || rand() < pT)) {
          const kind = this.forcedTrick || (rand() < 0.5 ? "delay" : "feint");
          const cand = steps.map((s, i) => i).filter((i) => !CFG.attacks[steps[i].m].perilous);
          if (cand.length) {
            const i = cand[Math.floor(rand() * cand.length)];
            if (kind === "delay") steps[i].delay = CFG.hold[0] + rand() * (CFG.hold[1] - CFG.hold[0]);
            else steps[i].feint = steps[i].m === "attack1" ? "attack2" : "attack1";
            trick = { kind, step: i };
          }
        }
        this.lastTrick = !!trick;
        this.chain = { uid: ++this.chainN, id: def.id, steps, i: 0, readyT: null, trick, t0: this.t };
        W.combatLog.push({ ev: "chainStart", who: f.name, chain: def.id, uid: this.chain.uid, steps: steps.map((s) => s.m + (s.delay ? "(retrasado)" : "") + (s.feint ? "(finta→" + s.feint + ")" : "")), t: +W.U.uTime.value.toFixed(3) });
        this.strike(steps[0].m, steps[0].r, steps[0]);
      },
      endChain(clean) {
        const C = this.chain; if (!C) return;
        this.chain = null;
        this.addToken("E", W.ct);                     // para el modelo: «terminó su cadena»
        // ventana de castigo: resopla (ni ataca ni se defiende) y luego una pausa antes de la siguiente cadena
        if (clean && f.alive) this.vent = CFG.vent;
        this.cool = this.training ? 1.1 : (CFG.pause[0] + rand() * (CFG.pause[1] - CFG.pause[0])) * this.pauseK();
        W.combatLog.push({ ev: "chainEnd", who: f.name, chain: C.id, uid: C.uid, clean, t: +W.U.uTime.value.toFixed(3) });
      },
      runChain(dt) {
        const C = this.chain, a = f.act;
        if (!f.alive || f.stunned || !W.pf.alive) return this.endChain(false);
        if (a && a.name === "hit") { if (!a.recoil) return this.endChain(false); C.readyT = this.t; return; }   // desviado: retrocede y sigue
        if (a && a.name === "dodge") return;
        if (a && a.name.startsWith("attack")) {
          const st = C.steps[C.i], P = a.plan;
          // finta: al terminar la carga, corta y cambia de golpe
          if (st.feint && !C.feinted && P && P.feintNow) {
            C.feinted = true; f.act = null;
            W.combatLog.push({ ev: "feint", who: f.name, from: st.m, to: st.feint, chain: C.id, t: +W.U.uTime.value.toFixed(3) });
            f.eyeBlink = 0.09;
            this.strike(st.feint, "feint", st, true);
            return;
          }
          if (a.f < 4) return;
          if (C.i + 1 >= C.steps.length) { a.speed = CFG.lastRecK; return; }   // último golpe: recuperación más lenta
          if (C.readyT == null) C.readyT = this.t;
        } else if (a) return;
        if (C.i + 1 >= C.steps.length) { if (!a) this.endChain(true); return; }
        if (C.readyT == null) C.readyT = this.t;
        const nx = C.steps[C.i + 1];
        if (this.t - C.readyT < nx.gap * this.pauseK()) return;
        if (!this.canStrike()) { if (this.t - C.readyT > 1.2) this.endChain(false); return; }
        f.act = null; C.i++; C.readyT = null; C.feinted = false;
        this.strike(nx.m, nx.r, nx);
      },
      // un golpe con su plan: CARGA (ojo parpadeando) → RETENCIÓN (si va retrasado) → SUELTA → impacto
      strike(m, rhythm, step, afterFeint) {
        const mv = CFG.moves[m], pl = W.pf, b = f.body;
        const toP = Math.atan2(pl.body.z - b.z, pl.body.x - b.x);
        b.stop(); b.heading = toP;
        const plan = { wind: CFG.wind[rhythm] || CFG.wind.n, hold: step && step.delay && !afterFeint ? step.delay : 0, rel: mv.rel, feint: !!(step && step.feint && !afterFeint) };
        f.startAttack(mv.anim, { dir: toP, plan, move: m, show: mv.show, crouch: mv.crouch, want: mv.want, cap: mv.cap, seek: mv.seek, lungeFrom: mv.lungeFrom, track: mv.track });
        const a = f.act; a.level = mv.level; a.chainId = this.chain ? this.chain.uid : null;
        this.warnT = 0; this.warnKind = m;
        // aviso: más evidente cuanto más fuerte es el golpe (rojo en los peligrosos)
        const e = eyeWorld(f), red = mv.level >= 3;
        if (W.combatStar) W.combatStar(e.p.x, e.p.y, e.p.z, [0.85, 1.1, 1.4][mv.level - 1], red ? 0xff3a2a : 0x9ff4ff, red ? 0.5 : 0.35);
        if (W.sfx) W.sfx.combat(red ? "perilous" : mv.level === 2 ? "chargeHeavy" : "charge");
        if (red && W.combatPop) W.combatPop("¡PELIGRO!", "#ff4a3a", f);
        W.combatLog.push({ ev: "warn", who: f.name, anim: mv.anim, move: m, level: mv.level, chain: this.chain ? this.chain.id : null,
          step: this.chain ? this.chain.i : 0, wind: plan.wind, hold: +plan.hold.toFixed(3), rel: plan.rel, prep: +(plan.wind + plan.hold + plan.rel).toFixed(3), t: +W.U.uTime.value.toFixed(3) });
      },
      // un golpe suelto (pruebas y compatibilidad)
      attack(name, dir) { this.chain = { uid: ++this.chainN, id: "suelto", steps: [{ m: name, r: "n", gap: 0 }], i: 0, readyT: null }; this.strike(name, "n", null); },
      // ---- defensa: te LEE (modelo del jugador), no tira dados -----------------------------------------
      // Fichas: cada impacto de tu ataque (a1/a2/a3), cada finta tuya (F), el final de su cadena (E) y una pausa
      // larga (·). Cada ficha lleva el ritmo desde la anterior (q < 0.45 s, m < 1 s, s más). Tabla de trigramas:
      // (dos fichas anteriores) → siguiente ficha, con su intervalo medio. Si la siguiente es un ataque y la
      // confianza basta, se compromete a defender en el instante previsto: guardia visible (ojo ámbar) unos ms
      // antes y parry (o bloqueo, si está menos seguro). Si te repites, te lee; si varías el ritmo, retrasas el
      // golpe o fintas, falla: su parry se queda en el aire y queda EXPUESTO un momento.
      // Además reacciona como un humano (200-260 ms): solo a lo que tarda más que eso (golpe de salto, golpes
      // retenidos) y solo bloqueando.
      tokens: [], grams: {}, predict: null, commit: null, exposed: 0, react1: 0,
      bucket(g) { return g < 0.45 ? "q" : g < 1.0 ? "m" : "s"; },
      resetModel() { this.tokens = []; this.grams = {}; this.predict = null; this.commit = null; },
      // nueva ficha (instante en el reloj de combate)
      addToken(kind, t) {
        const T = this.tokens, last = T[T.length - 1];
        if (last && t - last.t > 2.5 && kind !== "·") this.addToken("·", last.t + 2.5);
        const gap = last ? t - last.t : 9;
        const key = kind === "E" || kind === "·" ? kind : kind + this.bucket(gap);
        // trigrama (dos fichas anteriores) y bigrama (la última) → esta ficha, con su intervalo medio
        const ctxs = [];
        if (T.length >= 2) ctxs.push(T[T.length - 2].key + "|" + T[T.length - 1].key);
        if (T.length >= 1) ctxs.push(T[T.length - 1].key);
        for (const ctx of ctxs) {
          // memoria reciente: lo anterior pesa cada vez menos (×0.8), así sigue tus cambios de hábito
          const g = this.grams[ctx] || (this.grams[ctx] = { n: 0, next: {} });
          for (const k in g.next) g.next[k].n *= 0.8;
          const nx = g.next[key] || (g.next[key] = { n: 0, gap: 0, seen: 0 });
          nx.n += 1; nx.seen++; nx.gap += (gap - nx.gap) / Math.min(nx.seen, 3);   // intervalo medio (las últimas)
          g.n = 0; for (const k in g.next) g.n += g.next[k].n;
        }
        T.push({ kind, key, t }); if (T.length > 40) T.shift();
        // ¿un compromiso pendiente para este instante? (si la ficha llega, ya se ha resuelto o ha fallado)
        this.forecast(t);
      },
      // predicción de la siguiente ficha a partir de las dos últimas
      forecast(now) {
        const T = this.tokens; this.predict = null;
        if (T.length < 1) return;
        // trigrama si ya lo ha visto al menos 2 veces; si no, el bigrama
        let ctx = T.length >= 2 ? T[T.length - 2].key + "|" + T[T.length - 1].key : null, g = ctx && this.grams[ctx];
        if (!g || g.n < 1.7) { ctx = T[T.length - 1].key; g = this.grams[ctx]; }
        if (!g || g.n < 1.7) return;
        let best = null; for (const k in g.next) if (!best || g.next[k].n > g.next[best].n) best = k;
        const nx = g.next[best], conf = nx.n / g.n;
        this.predict = { key: best, conf, at: now + nx.gap, n: nx.n, ctx };
        const D = W.ENEMY_DIFF, parryConf = 1 - 0.5 * D.parry, blockConf = 0.9 - 0.6 * D.block;
        if (!/^a/.test(best) || nx.seen < 2 || conf < Math.min(parryConf, blockConf)) return;
        const kind = conf >= parryConf ? "parry" : "block";
        // guardia visible 280-340 ms antes del impacto previsto (≥ 190 ms antes de su parry); el parry, 90 ms antes
        const lead = 0.28 + rand() * 0.06;
        this.commit = { kind, at: this.predict.at, stance: this.predict.at - lead, press: this.predict.at - 0.09, conf, key: best, done: false };
        W.combatLog.push({ ev: "foeRead", ct: +W.ct.toFixed(3), who: f.name, key: best, conf: +conf.toFixed(2), kind, in: +(this.predict.at - now).toFixed(2), t: +W.U.uTime.value.toFixed(3) });
      },
      // libre para defenderse: sin acción (o en guardia), no atacando, no resoplando
      freeToDefend() {
        const a = f.act;
        if (!f.alive || this.vent > 0 || this.exposed > W.ct || f.stunned) return false;
        // pesado: se repone del golpe recibido enseguida (desde su 2.º frame) para defender el siguiente
        return !a || a.name === "block" || a.name === "parry" || (a.name === "hit" && !a.gb && !a.exposed && a.f >= 1) ||
          (a.name.startsWith("attack") && a.f >= 5 && !this.chain);
      },
      defendStep() {
        const c = this.commit, now = W.ct;
        if (!c) return;
        if (now > c.at + 0.3) { this.commit = null; return; }
        if (!this.freeToDefend()) { if (!f.act || !f.act.name.startsWith("attack")) return; this.commit = null; return; }
        const b = f.body, pl = W.pf;
        // te ve tambaleándote (le has dado a su guardia o te ha desviado): no va a llegar ese golpe
        if (!c.stanceOn && now >= c.stance && pl.act && (pl.act.name === "hit" || pl.act.name === "death")) { this.commit = null; return; }
        if (!c.stanceOn && now >= c.stance) {
          // se ve venir: alza la guardia (ojo ámbar)
          c.stanceOn = true; b.stop(); b.heading = Math.atan2(pl.body.z - b.z, pl.body.x - b.x);
          f.guardHeld = true; if (!f.act || f.act.name !== "block") { f.act = null; f.start("block"); f.act.tt = 0.07; }
          this.stanceUntil = c.at + 0.25;
          W.combatLog.push({ ev: "foeGuard", ct: +W.ct.toFixed(3), who: f.name, kind: c.kind, t: +W.U.uTime.value.toFixed(3) });
        }
        // ya defendió (parry o bloqueo): compromiso cumplido
        if ((c.pressed || c.stanceOn) && f.lastDefT != null && f.lastDefT >= (c.pressT || c.stance) - 1e-6) { this.commit = null; return; }
        if (c.kind === "parry" && c.stanceOn && !c.pressed && now >= c.press) {
          c.pressed = true; c.pressT = now;
          f.guardHeld = false; f.input("guardDown"); f.input("guardUp");
          W.combatLog.push({ ev: "foeParryTry", ct: +W.ct.toFixed(3), who: f.name, conf: +c.conf.toFixed(2), t: +W.U.uTime.value.toFixed(3) });
        }
        // su parry se quedó en el aire: expuesto un momento
        if (c.kind === "parry" && c.pressed && !c.hitSeen && now > c.pressT + 0.22) {
          this.commit = null; this.exposed = now + CFG.exposed;
          f.act = null; f.start("hit", { kb: 0, kdir: 0, moved: 0, speed: 0.55, exposed: true, recoil: true });
          W.combatLog.push({ ev: "foeParryWhiff", ct: +W.ct.toFixed(3), who: f.name, t: +W.U.uTime.value.toFixed(3) });
          if (W.combatPop) W.combatPop("¡EXPUESTO!", "#ffd34a", f);
        }
        if (c.kind === "block" && c.stanceOn && now > this.stanceUntil) { f.guardHeld = false; this.commit = null; }
      },
      // reacción humana a un ataque que empieza (200-260 ms + variación): solo bloquea lo que tarda más que eso
      onPlayerAttack(act) {
        if (!f.alive || this.state === "home") return;
        const pl = W.pf, b = f.body, D = W.ENEMY_DIFF;
        if (Math.hypot(pl.body.x - b.x, pl.body.z - b.z) > 3.6) return;
        this.state = "chase";
        const rt = this.reactionTime();
        this.react1 = { act, at: W.ct + rt };
      },
      reactionTime() {
        // dificultad: reacción 200-260 ms (deslizador «Reacción» ×0.5-1.6: más alto = más rápido) ± 25 ms
        const D = W.ENEMY_DIFF, base = 0.25 - 0.04 * Math.max(0, Math.min(1, (D.react - 0.5) / 1.1));
        return Math.max(0.2, Math.min(0.26, base + (rand() - 0.5) * 0.04));
      },
      reactStep() {
        const q = this.react1; if (!q || W.ct < q.at) return;
        this.react1 = null;
        const pl = W.pf, a = pl.act;
        if (!a || a !== q.act || !this.freeToDefend() || this.commit) return;
        const left = pl.toImpact(); if (left == null) return;
        // tras encajar un combo o con poca vida: se aparta de lado si le da tiempo
        this.lastHits = this.lastHits.filter((t) => this.t - t < 2.2);
        const b = f.body, dir = Math.atan2(pl.body.z - b.z, pl.body.x - b.x);
        if ((f.hp < f.hpMax * 0.35 || this.lastHits.length >= 2) && left > 0.12 && f.st > 10) {
          f.act = null; const side = rand() < 0.5 ? 1 : -1;
          f.startDodge({ dir: dir + side * Math.PI / 2 + Math.PI * 0.15 * side });
          W.combatLog.push({ ev: "foeDodge", ct: +W.ct.toFixed(3), who: f.name, t: +W.U.uTime.value.toFixed(3) });
          return;
        }
        if (left > 0.05 && W.ENEMY_DIFF.block > 0) {
          f.guardHeld = true; f.act = null; f.start("block"); f.act.tt = 0.07; this.stanceUntil = W.ct + left + 0.3;
          this.commit = { kind: "block", at: W.ct + left, stance: W.ct, press: 0, stanceOn: true, conf: 0, reactive: true };
          W.combatLog.push({ ev: "foeBlock", ct: +W.ct.toFixed(3), who: f.name, reactive: true, t: +W.U.uTime.value.toFixed(3) });
        }
      },
      // dificultad adaptativa suave: muertes seguidas → más pausa; parries perfectos seguidos → menos pausa y más trucos
      adaptStep(dt) {
        const pl = W.pf; if (!pl) return;
        if (!pl.alive && !this.sawDeath) { this.sawDeath = true; this.deaths++; this.perfStreak = 0; this.adapt = Math.max(-1.2, this.adapt - 0.35); W.combatLog.push({ ev: "adapt", who: f.name, adapt: +this.adapt.toFixed(2), why: "muerte", t: +W.U.uTime.value.toFixed(3) }); }
        if (pl.alive) this.sawDeath = false;
        this.adapt -= Math.sign(this.adapt) * Math.min(Math.abs(this.adapt), 0.004 * dt);     // vuelve despacio a 0
      },
      onDeflected(level) {
        if (level === "perfect") { this.perfStreak++; if (this.perfStreak >= 2) { this.adapt = Math.min(1, this.adapt + 0.12); W.combatLog.push({ ev: "adapt", who: f.name, adapt: +this.adapt.toFixed(2), why: "perfectos", t: +W.U.uTime.value.toFixed(3) }); } }
        else this.perfStreak = 0;
      },
      onPlayerHit() { this.perfStreak = 0; },
    };
  }

  // ---- ganchos -----------------------------------------------------------------------------------------
  function onAct(f, actor, act) {
    if (actor === W.pf && act.name.startsWith("attack") && f.ai) { f.ai.pAtks.push(act); if (f.ai.enabled) f.ai.onPlayerAttack(act); }
  }
  function onFrame(f, a) {
    if (a.name === "hit" && a.f === 0 && f.ai) f.ai.lastHits.push(f.ai.t);
    if (a.name.startsWith("attack") && a.f === 2 && W.sfx) W.sfx.combat(a.name === "attack2" || (a.level || 0) >= 2 ? "swingHeavy" : "swing");
    if (a.name.startsWith("attack") && a.f === 3 && a.move === "sweep" && W.fx) {
      // barrido bajo: tierra a ras de suelo a lo largo del arco
      const b = f.body;
      for (let k = -2; k <= 2; k++) { const h = b.heading + k * 0.45, x = b.x + Math.cos(h) * 1.6, z = b.z + Math.sin(h) * 1.6; W.fx.dust(x, W.heightAt(x, z), z, 5, { spd: 1.4, up: 0.5, life: 0.4 }); }
    }
    if (a.name === "death" && a.f === 3 && W.sfx) W.sfx.combat("death");
  }
  // fases del plan de un golpe: retención (ojo fijo) y suelta (destello + chasquido: llega en rel s)
  function onPhase(f, a, ph) {
    const lvl = a.level || 1, red = lvl >= 3;
    if (ph === "hold") { W.combatLog.push({ ev: "hold", who: f.name, move: a.move, t: +W.U.uTime.value.toFixed(3) }); return; }
    if (ph === "release") {
      f.relFlash = 1;
      const e = eyeWorld(f);
      if (W.combatStar) W.combatStar(e.p.x, e.p.y, e.p.z, 0.55 + 0.3 * lvl, red ? 0xff5040 : 0xd8fbff, 0.22);
      if (W.sfx) W.sfx.combat("release", lvl);
      W.combatLog.push({ ev: "release", who: f.name, move: a.move, level: lvl, rel: a.plan.rel, t: +W.U.uTime.value.toFixed(3) });
    }
  }
  function update(f, dt) {
    const ch = f.ch, U = ch.uniforms, ai = f.ai;
    // ojo: parpadeo fuerte durante la preparación del ataque (aviso)
    let k = 1;
    const a = f.act, tt = ai ? ai.t : 0;
    let red = false;
    f.relFlash = Math.max(0, (f.relFlash || 0) - dt / 0.18);
    if (a && a.name.startsWith("attack") && a.f < 3) {
      const P = a.plan;
      red = (a.level || 0) >= 3;
      if (!P || P.t < P.wind) k = 1.6 + 1.8 * (0.5 + 0.5 * Math.sign(Math.sin(tt * 2 * Math.PI * (red ? 9 : 7))));   // CARGA: parpadea
      else if (P.t < P.wind + P.hold) k = 3.4;                                                                      // RETENCIÓN: fijo
      else k = 3.0 + 3.0 * f.relFlash;                                                                             // SUELTA: destello
    } else if (a && a.name.startsWith("attack") && (a.level || 0) >= 3) red = true;
    if (a && a.name === "stun") k = 0.5 + 0.4 * Math.sin(tt * 10);
    if (f.eyeBlink > 0) { f.eyeBlink -= dt; k = 0.25; }                                                           // finta: se apaga un instante
    // resoplando tras la cadena (ventana de castigo): ojo apagado y vapor
    if (ai && ai.vent > 0 && !a) {
      k = 0.45;
      if (W.fx && Math.floor(tt * 8) !== Math.floor((tt - dt) * 8)) { const b = f.body; W.fx.dust(b.x, b.y + W.CHAR_H * 1.15, b.z, 2, { pal: [[0.8, 0.82, 0.85], [0.65, 0.68, 0.72]], spd: 0.2, up: 0.8, life: 0.9 }); }
    }
    // guardia leída (se ve venir su parry): ojo ámbar
    const guardEye = ai && ai.commit && ai.commit.stanceOn && a && (a.name === "block" || a.name === "parry");
    if (guardEye) k = Math.max(k, 2.2);
    const col = U.uEyeCol.value, want = red ? [1.0, 0.22, 0.14] : guardEye ? [1.0, 0.72, 0.22] : [0.35, 0.95, 1.0];
    col.set(want[0], want[1], want[2]);
    if (f.eyeLight) f.eyeLight.color.setRGB(want[0], want[1], want[2]);
    if (f.eyeHalo) f.eyeHalo.material.color.setRGB(red || guardEye ? 1 : 0.5, red ? 0.35 : guardEye ? 0.8 : 0.94, red ? 0.3 : guardEye ? 0.35 : 1);
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
    if (f.ai) {
      const ai = f.ai; Object.assign(ai, { state: "patrol", cool: 1.2, warnT: -1, chain: null, vent: 0, lastTrick: false, stanceUntil: 0, react1: null, exposed: 0, pAtks: [] });
      ai.resetModel();                               // su conocimiento de tus hábitos se reinicia al reaparecer
      if (!W.pf || W.pf.alive) ai.deaths = 0;        // (las muertes seguidas cuentan aunque reaparezca)
    }
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
  // tus fintas también son fichas para su modelo
  const prevFeint = W.onFeint;
  W.onFeint = function (actor, a) { if (prevFeint) prevFeint(actor, a); if (actor !== W.pf) return; for (const f of W.foes || []) if (f.type === "automaton" && f.ai) f.ai.addToken("F", W.ct); };
  // texto para el panel de pruebas: qué te está leyendo y la dificultad adaptativa
  W.automatonInfo = function () {
    const p = W.pf; if (!p) return "";
    let e = null, bd = 1e9; for (const f of W.foes || []) { if (f.type !== "automaton" || !f.alive) continue; const d = Math.hypot(f.body.x - p.body.x, f.body.z - p.body.z); if (d < bd) { bd = d; e = f; } }
    if (!e) return "";
    const ai = e.ai, pr = ai.predict, k = ai.pauseK();
    const NAME = { a1: "golpe 1", a2: "golpe 2", a3: "golpe 3", F: "finta", E: "fin de su cadena" }, RIT = { q: "rápido", m: "medio", s: "lento" };
    const say = (key) => key ? (NAME[key.slice(0, 2)] || NAME[key[0]] || key) + (RIT[key[2]] ? " " + RIT[key[2]] : "") : "";
    const D = W.ENEMY_DIFF, ms = Math.round(1000 * (0.25 - 0.04 * Math.max(0, Math.min(1, (D.react - 0.5) / 1.1))));
    return "Te lee: " + (pr ? say(pr.key) + " " + Math.round(pr.conf * 100) + "%" + (ai.commit ? " → " + (ai.commit.kind === "parry" ? "PARRY" : "BLOQUEO") : "") : "aún no") +
      "<br>Fichas: " + ai.tokens.length + " · reacción ~" + ms + " ms" +
      "<br>Adaptativa: " + (ai.adapt >= 0 ? "+" : "") + ai.adapt.toFixed(2) + " (pausas ×" + k.toFixed(2) + ", muertes seguidas " + ai.deaths + ")";
  };
})();
