// enemies/echo/echo.js — el "eco" (enemigo de prueba, guardado; se activa desde el panel de pruebas ⚙ →
// Enemigo → Eco, con W.setEnemyType("echo") o con #enemy=echo en la dirección): un segundo personaje con las mismas animaciones (recoloreadas en tonos fríos, visor y
// cuchilla cian que brillan) y la misma máquina de estados de combate (fighter.js).
//
// IA: dormido junto a su claro hasta que el jugador se acerca (4.5 u) o le ataca; entonces persigue con A*
// (re-planifica cada 0.35 s; corre si está lejos), se detiene a distancia de golpe y ataca: attack1 (a veces
// encadena attack2) o attack3 (el salto, sobre todo si el jugador está a media distancia). Su preparación es más
// lenta que la del jugador (×1.7) y antes de cada golpe da un DESTELLO DE AVISO (visor y cuerpo se encienden,
// chispa en la cabeza y un tono: cian = golpe normal, naranja = attack3 pesado) para poder leerlo y desviarlo.
// Tras atacar retrocede un poco y espera 0.9-1.6 s. Aturdido al perder la postura (fighter.js). Si se aleja más
// de 14 u de su claro, vuelve. Botón REAPARECER (y el jugador, si ha muerto).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function spawnEcho(x, z, assets, opts) {
    opts = opts || {};
    const body = new W.Player(x, z);
    const ch = W.makeCharacter(W.scene, assets.tex, assets.meta, assets.ctex, assets.cmeta, { echo: true });
    body.ch = ch;
    const f = W.addFighter(new W.Fighter(body, { team: "foe", name: "eco", hp: 120, stamina: 100, posture: 100, prepK: opts.prepK || 1.7 }), ch);
    f.dmgK = opts.dmgK || 1.3;
    f.home = { x, z, heading: opts.heading != null ? opts.heading : -Math.PI / 2 };
    body.heading = f.home.heading;
    f.ai = opts.ai === false ? null : makeEchoAI(f);
    f.label = "ECO";
    return f;
  }

  function makeEchoAI(f) {
    const ai = {
      enabled: true, state: "dormant", t: 0, replan: 0, cool: 0.6, warnT: -1, warnKind: "", backT: 0, strafe: 1,
      rand: (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(),   // determinista
      update(dt) {
        const b = f.body, p = W.pf;
        this.t += dt;
        // destello de aviso (decae en 0.3 s)
        if (this.warnT >= 0) { this.warnT += dt; if (this.warnT > 0.32) this.warnT = -1; }
        f.ch.uniforms.uWarn.value = this.warnT >= 0 ? Math.sin(Math.min(1, this.warnT / 0.32) * Math.PI) * (this.warnKind === "heavy" ? 1.2 : 1) : 0;
        if (!this.enabled || !f.alive || !p) return;
        if (f.act) {
          // combo del eco: a veces encadena attack1 → attack2
          if (f.act.name === "attack1" && f.act.f === 3 && this.chain && !f.act.chain) { f.input("attack", { dir: b.heading }); this.chain = false; }
          return;
        }
        const dx = p.body.x - b.x, dz = p.body.z - b.z, d = Math.hypot(dx, dz), toP = Math.atan2(dz, dx);
        const fromHome = Math.hypot(b.x - f.home.x, b.z - f.home.z);
        if (!p.alive) { this.goHome(); return; }
        if (this.state === "dormant") {
          if (d < 4.5 || f.hp < f.hpMax) { this.state = "chase"; this.cool = 0.5; }
          else { b.heading += norm(f.home.heading - b.heading) * Math.min(1, dt * 3); return; }
        }
        if (this.state === "home") {
          if (fromHome < 0.6) { this.state = "dormant"; b.stop(); return; }
          if (d < 5 && fromHome < 10) this.state = "chase";
          else { this.goHome(); return; }
        }
        if (fromHome > 14) { this.state = "home"; this.goHome(); return; }
        this.cool -= dt;
        // de cara al jugador cuando está cerca
        if (d < 3.5) b.heading += norm(toP - b.heading) * Math.min(1, dt * 8);
        if (this.cool <= 0 && d <= 2.4 && (!p.act || p.act.name !== "death")) {
          // ataque: attack3 (salto) a media distancia o a veces de cerca; attack1 (+ attack2) si no
          b.stop(); b.heading = toP;
          const heavy = d > 1.75 ? this.rand() < 0.7 : this.rand() < 0.25;
          this.chain = !heavy && this.rand() < 0.35;
          if (heavy) f.startAttack("attack3", { dir: toP }); else f.input("attack", { dir: toP });
          this.cool = 0.9 + this.rand() * 0.7 + (heavy ? 0.4 : 0);
          this.backT = 0.5;
          return;
        }
        if (this.backT > 0 && d < 1.9) {
          // se aparta un poco tras golpear (y rodea al jugador)
          this.backT -= dt;
          const a = toP + Math.PI + this.strafe * 0.6;
          b.gait = "walk"; b.following = false;
          b.path = [{ x: b.x + Math.cos(a) * 0.8, z: b.z + Math.sin(a) * 0.8 }];
          return;
        }
        if (d > 1.75) {
          // persecución por A*
          this.replan -= dt;
          if (this.replan <= 0 || !b.path.length) {
            this.replan = 0.35;
            const tx = p.body.x - Math.cos(toP) * 1.45, tz = p.body.z - Math.sin(toP) * 1.45;
            const path = W.findPath(b.x, b.z, tx, tz, 9000);
            if (path.length) { b.setPath(path, { noDelay: true }); b.gait = d > 5 ? "run" : "walk"; }
          }
        } else if (b.path.length) b.stop();
      },
      goHome() {
        const b = f.body;
        this.replan -= 1 / 60;
        if (this.replan <= 0 || !b.path.length) {
          this.replan = 0.5;
          const path = W.findPath(b.x, b.z, f.home.x, f.home.z, 12000);
          if (path.length) b.setPath(path, { noDelay: true });
        }
        this.state = "home";
      },
    };
    return ai;
  }

  // aviso antes de cada golpe del eco: al empezar WIND UP (o LEAP)
  function onFrame(f, a) {
    if (!f.ai) return;
    if (a.name.startsWith("attack") && a.f === 1) {
      f.ai.warnT = 0; f.ai.warnKind = a.name === "attack3" ? "heavy" : "light";
      if (W.combatStar) W.combatStar(f.body.x, f.body.y + W.CHAR_H * 0.92, f.body.z, a.name === "attack3" ? 0.9 : 0.7, a.name === "attack3" ? 0xffa050 : 0x9ff4ff, 0.3);
      if (W.sfx) W.sfx.combat("warn");
      W.combatLog.push({ ev: "warn", who: f.name, anim: a.name, t: +W.U.uTime.value.toFixed(3) });
    }
  };

  W.registerEnemy("echo", {
    label: "Eco (prueba)",
    // el claro junto al inicio (a ~4.9 u; 4 u de suelo libre y llano alrededor)
    spawnPoints() {
      const p = W.player, s = W.findSpot(2.8, -10.2, p.y);
      return s ? [{ x: s.x, z: s.z, heading: Math.atan2(p.z - s.z, p.x - s.x), zone: "heart" }] : [];
    },
    spawn(p, assets) { return spawnEcho(p.x, p.z, assets, { heading: p.heading }); },
    onFrame,
    respawn(f) { f.respawn(f.home.x, f.home.z); f.body.heading = f.home.heading; if (f.ai) { f.ai.state = "dormant"; f.ai.cool = 0.6; f.ai.warnT = -1; } },
  });
})();
