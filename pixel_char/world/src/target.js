// target.js — fijar objetivo (Combate completo, etapa 2).
//
//  · tocar un enemigo lo SELECCIONA (no ataca): anillo bajo sus pies y retícula alrededor; tocar otro cambia el
//    objetivo; teclado: Tab pasa al siguiente (el más cercano primero)
//  · al caminar el personaje mira hacia donde va; al atacar, guardar, hacer parry o esquivar se gira AL INSTANTE
//    hacia el objetivo (rumbo y dirección del sprite, sin pasar por las intermedias)
//  · se suelta: a más de ~9 u, sin línea de visión más de 1,5 s o si muere; si muere y hay otro enemigo cerca en
//    combate (a ≤ 9 u y persiguiéndote o a ≤ 6 u), pasa a él
//  · la cámara se desplaza un poco hacia el objetivo (un 22 % de la distancia, como mucho 2 u)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const T = (W.TARGET = { f: null, losT: 0, maxD: 9, losMax: 1.5, camK: 0.22, camMax: 2.0, cam: { x: 0, z: 0 }, ring: null, ret: null, t: 0, why: null });

  const alive = (f) => !!f && f.alive && !f.hidden;
  W.getTarget = () => (alive(T.f) ? T.f : null);
  W.setTarget = function (f, why) {
    if (f === T.f) return f;
    T.f = alive(f) ? f : null; T.losT = 0; T.t = 0; T.why = why || "tap";
    if (W.combatLog) W.combatLog.push({ ev: "target", who: T.f ? T.f.name : null, idx: T.f ? (W.foes || []).indexOf(T.f) : -1, why: T.why, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 });
    if (T.f && W.sfx) W.sfx.combat("target");
    return T.f;
  };
  W.clearTarget = function (why) { if (!T.f) return; T.f = null; if (W.combatLog) W.combatLog.push({ ev: "targetLost", why, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 }); };
  const dist = (f) => Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z);
  // Tab: el siguiente enemigo vivo a ≤ 9 u, de más cercano a más lejano, empezando por el que sigue al actual
  W.cycleTarget = function () {
    const L = (W.foes || []).filter((f) => alive(f) && dist(f) <= T.maxD).sort((a, b) => dist(a) - dist(b));
    if (!L.length) { W.clearTarget("tab"); return null; }
    const i = L.indexOf(T.f);
    return W.setTarget(L[(i + 1) % L.length], "tab");
  };
  // ¿se ven? (a la altura del pecho: el terreno o un obstáculo alto en medio la cortan; troncos caídos, vallas,
  // raíces, lápidas, rocas y setas son bajos y no; los cuerpos tampoco)
  const TALL = { tree: 1, dead: 1, titan: 1, arch: 1, ruin: 1, wall: 1, crystal: 1, beacon: 1, hand: 1, heart: 1 };
  W.sightClear = function (a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(d / 0.3));
    const ha = a.y + 1.1, hb = b.y + 1.1;
    for (let k = 1; k < n; k++) {
      const u = k / n, s = u * d;
      if (s < 0.6 || d - s < 0.6) continue;
      const x = a.x + dx * u, z = a.z + dz * u;
      if (W.heightAt(x, z) > ha + (hb - ha) * u - 0.15) return false;
    }
    for (const o of W.obstacles || []) {
      if (!TALL[o.tag]) continue;
      // distancia del centro al segmento (sin los extremos: los cuerpos)
      const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / (d * d || 1)));
      if (t * d < 0.6 || (1 - t) * d < 0.6) continue;
      if (Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) < o.r * 0.8) return false;
    }
    return true;
  };
  // el jugador se gira al instante hacia el objetivo (rumbo y sprite); devuelve el rumbo o null
  W.faceTarget = function (f) {
    const t = W.getTarget(); if (!t || !f || f !== W.pf) return null;
    const b = f.body, h = Math.atan2(t.body.z - b.z, t.body.x - b.x);
    b.heading = h;
    const ch = f.ch; if (ch) ch.snapDir = true;     // character.js: salta a la dirección pedida sin intermedias
    return h;
  };

  // ---- anillo y retícula ----------------------------------------------------------------------------------
  function makeRing() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(255,255,255,1)"; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    // cuatro muescas hacia dentro
    g.lineWidth = 9; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); g.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xffb04a, transparent: true, depthWrite: false, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.renderOrder = 3; m.visible = false; W.scene.add(m);
    return m;
  }
  function makeReticle() {
    const d = document.createElement("div");
    d.id = "reticle";
    d.innerHTML = "<i></i><i></i><i></i><i></i>";
    const css = document.createElement("style");
    css.textContent = `#reticle{position:absolute;left:0;top:0;pointer-events:none;display:none;z-index:4}
      #reticle i{position:absolute;width:12px;height:12px;border:3px solid #ffb04a;filter:drop-shadow(1px 1px 0 #000)}
      #reticle i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}#reticle i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
      #reticle i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}#reticle i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
      #reticle.lost i{border-color:#9a8a7a;opacity:.6}`;
    document.head.appendChild(css);
    document.getElementById("wrap").appendChild(d);
    return d;
  }

  W.targetUpdate = function (dt) {
    if (!W.player || !W.scene) return;
    if (!T.ring) { T.ring = makeRing(); T.ret = makeReticle(); }
    T.t += dt;
    let f = T.f;
    if (f && !alive(f)) {
      // murió: si hay otro enemigo cerca en combate, pasa a él
      const n = (W.foes || []).filter((o) => o !== f && alive(o) && dist(o) <= T.maxD && (dist(o) <= 6 || (o.ai && o.ai.state === "chase"))).sort((a, b) => dist(a) - dist(b))[0];
      T.f = null;
      if (n) W.setTarget(n, "auto"); else W.clearTarget("muerto");
      f = T.f;
    }
    if (f) {
      const d = dist(f);
      if (d > T.maxD) { W.clearTarget("lejos"); f = null; }
      else {
        const see = W.sightClear(W.player, f.body);
        T.losT = see ? 0 : T.losT + dt;
        if (T.losT > T.losMax) { W.clearTarget("sin visión"); f = null; }
      }
    }
    // mientras guarda o bloquea, sigue mirando al objetivo (los enemigos se mueven)
    const pf = W.pf;
    if (f && pf && pf.act && (pf.act.name === "block" || pf.act.name === "parry")) pf.body.heading = Math.atan2(f.body.z - pf.body.z, f.body.x - pf.body.x);
    // anillo bajo sus pies (gira despacio; late al fijarlo) y retícula alrededor del sprite
    const R = T.ring, E = T.ret;
    if (!f) { R.visible = false; E.style.display = "none"; T.cam.x += (0 - T.cam.x) * Math.min(1, dt * 3); T.cam.z += (0 - T.cam.z) * Math.min(1, dt * 3); return; }
    const b = f.body, r = (f.radiusHit || 0.3) + 0.55, pop = Math.max(0, 1 - T.t / 0.25);
    R.visible = true; R.position.set(b.x, b.y + 0.04, b.z);
    const s = 2 * r * (1 + 0.35 * pop) * (1 + 0.03 * Math.sin(T.t * 4));
    R.scale.set(s, 1, s); R.rotation.y = T.t * 0.8;
    R.material.opacity = T.losT > 0 ? 0.45 : 0.9;
    const a = W.toScreen(b.x, b.y, b.z), h = W.toScreen(b.x, b.y + (f.ch.height || W.CHAR_H), b.z);
    const H = Math.abs(a[1] - h[1]), w = H * 0.62 + 12, k = 1 + 0.25 * pop;
    E.style.display = "block";
    E.style.width = (w * k) + "px"; E.style.height = ((H + 18) * k) + "px";
    E.style.transform = `translate(${a[0] - w * k / 2}px,${h[1] - 10 - (k - 1) * H / 2}px)`;
    E.classList.toggle("lost", T.losT > 0);
    // cámara: un poco hacia el objetivo
    const dx = b.x - W.player.x, dz = b.z - W.player.z, L = Math.hypot(dx, dz), m = Math.min(T.camMax, L * T.camK) / (L || 1);
    T.cam.x += (dx * m - T.cam.x) * Math.min(1, dt * 3); T.cam.z += (dz * m - T.cam.z) * Math.min(1, dt * 3);
  };
  // main.js: desplaza el punto que sigue la cámara
  W.camBias = function (v) { v.x += T.cam.x; v.z += T.cam.z; };
})();
