// controls.js — controles táctiles (y ratón/teclado en Mac):
//   · tocar/clic en el suelo: va ahí por un camino A* (camina si está cerca, corre si está lejos)
//   · mantener pulsado (> 170 ms o arrastrar): sigue al dedo (se re-planifica cada 0.2 s)
//   · tocar al enemigo: atacar (toques seguidos encadenan el combo); si está lejos va hacia él y ataca
//   · deslizar rápido: esquivar hacia allí
//   · botón GUARDIA: tocar = parry, mantener = bloquear
//   · doble toque en el suelo o botón SALTAR: salta en el sitio, o hacia delante si se mueve
//   · teclado: WASD/flechas mover (Mayús corre), J atacar, K guardia, Espacio esquivar, L saltar
//   · marcador en el suelo: círculo que se encoge y se desvanece
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const TAP_MS = 170, DOUBLE_MS = 320;
  const SWIPE_MS = 260, SWIPE_PX = 42;              // deslizar rápido = esquivar
  let pendingAttack = null, pendingMove = null;
  const ptr = { down: false, id: null, x0: 0, y0: 0, x: 0, y: 0, timer: 0 };
  let lastTap = null, following = false, replanT = 0, lastFollowGoal = null;
  const markers = [];
  let followMarker = null, ringGeo = null;

  function ring(color) {
    if (!ringGeo) { ringGeo = new THREE.RingGeometry(0.78, 1, 32); ringGeo.rotateX(-Math.PI / 2); }
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }));
    m.renderOrder = 3; W.scene.add(m);
    return m;
  }
  function addMarker(x, y, z) {
    const m = ring(0xffd27a);
    m.position.set(x, y + 0.04, z);
    markers.push({ m, t: 0 });
  }

  // dirección en el suelo de un vector de pantalla (px, y hacia abajo), deshaciendo el acortamiento isométrico
  W.screenDirToHeading = function (sx, sy) {
    const th = W.ui ? W.ui.theta : Math.PI / 4, EL = W.CAM_EL;
    const rx = Math.cos(th), rz = -Math.sin(th), ax = -Math.sin(th), az = -Math.cos(th);
    const wx = rx * sx + ax * (-sy / Math.sin(EL)), wz = rz * sx + az * (-sy / Math.sin(EL));
    return Math.atan2(wz, wx);
  };
  // ¿el toque cae sobre un enemigo? (rectángulo de su sprite en pantalla, con margen para el dedo)
  W.foeAt = function (cx, cy) {
    let best = null, bd = 1e9;
    for (const f of W.foes || []) {
      if (!f.alive) continue;
      const b = f.body, a = W.toScreen(b.x, b.y, b.z), h = W.toScreen(b.x, b.y + (f.ch.height || W.CHAR_H), b.z);
      const H = Math.abs(a[1] - h[1]), w = H * 0.42 + 22, top = h[1] - 18, bot = a[1] + 16;
      if (cx < a[0] - w || cx > a[0] + w || cy < top || cy > bot) continue;
      const d = Math.hypot(cx - a[0], cy - (a[1] + h[1]) / 2);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  };
  function attackFoe(f) {
    const p = W.player, pf = W.pf;
    const d = Math.hypot(f.body.x - p.x, f.body.z - p.z), dir = Math.atan2(f.body.z - p.z, f.body.x - p.x);
    if (d <= 3.2 || pf.act) { pf.input("attack", { dir }); pendingAttack = null; return "attack"; }
    // lejos: va hacia él y ataca al llegar
    const path = W.findPath(p.x, p.z, f.body.x - Math.cos(dir) * 1.1, f.body.z - Math.sin(dir) * 1.1);
    if (path.length) { p.setPath(path, { noDelay: true }); pendingAttack = { f, t: 0 }; }
    return "approach";
  }
  W.attackFoe = attackFoe;

  W.goTo = function (x, z, opts) {
    const p = W.player;
    // en mitad de una acción de combate el paseo queda pendiente hasta que termine
    if (W.pf && W.pf.act) { pendingMove = { x, z }; return { ok: true, pending: true, path: [{ x, z }] }; }
    const path = W.findPath(p.x, p.z, x, z);
    if (!path.length) return { ok: false };
    const wasIdle = p.setPath(path, opts);
    W.lastPath = path;
    return { ok: true, wasIdle, path, reached: path.reached, exact: path.exact };
  };

  function tapAt(cx, cy) {
    pendingAttack = null;
    const g = W.pick(cx, cy);
    if (!g) return { ok: false };
    const r = W.goTo(g.x, g.z);
    if (r.ok) { const e = r.path[r.path.length - 1]; addMarker(e.x, W.heightAt(e.x, e.z), e.z); }
    r.start = { x: W.player.x, z: W.player.z };
    return r;
  }
  function startFollow() {
    following = true;
    W.player.following = true;
    if (!followMarker) followMarker = ring(0x9ff4ff);
    followMarker.visible = true;
    replanT = 0; lastFollowGoal = null;
  }
  function followTick(dt) {
    const g = W.pick(ptr.x, ptr.y);
    if (!g) return;
    followMarker.position.set(g.x, g.y + 0.05, g.z);
    const s = 0.28 + 0.03 * Math.sin(performance.now() / 120);
    followMarker.scale.set(s, 1, s);
    replanT -= dt;
    const moved = !lastFollowGoal || Math.hypot(g.x - lastFollowGoal.x, g.z - lastFollowGoal.z) > 0.4;
    if (replanT <= 0 && moved) {
      replanT = 0.2; lastFollowGoal = g;
      const p = W.player;
      if (Math.hypot(g.x - p.x, g.z - p.z) < 0.18 * W.CHAR_H) { p.stop(); return; }
      const path = W.findPath(p.x, p.z, g.x, g.z, 12000);
      if (path.length) p.setPath(path, { noDelay: true });
    }
  }

  W.initControls = function (canvas) {
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (W.sfx) W.sfx.unlock();
      if (ptr.down) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      Object.assign(ptr, { down: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), foe: W.foeAt(e.clientX, e.clientY) });
      clearTimeout(ptr.timer);
      // sobre el enemigo no se sigue al dedo: es un ataque (o un deslizamiento)
      ptr.timer = setTimeout(() => { if (ptr.down && !ptr.foe) startFollow(); }, TAP_MS);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.x = e.clientX; ptr.y = e.clientY;
      // un deslizamiento rápido no arranca el seguimiento hasta ver si es una esquiva
      const moved = Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0), el = performance.now() - ptr.t0;
      if (!following && moved > 12 && (el > SWIPE_MS || moved / Math.max(el, 1) < 0.35)) startFollow();
    });
    const end = (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.down = false; clearTimeout(ptr.timer);
      // deslizar rápido: esquivar en esa dirección
      const dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0, el = performance.now() - ptr.t0;
      W.lastGesture = { dx, dy, ms: Math.round(el), following, foe: !!ptr.foe };
      if (e.type !== "pointercancel" && Math.hypot(dx, dy) > SWIPE_PX && el < SWIPE_MS) {
        if (following) { following = false; W.player.following = false; if (followMarker) followMarker.visible = false; }
        W.player.stop(); pendingAttack = null; pendingMove = null;
        W.pf.input("dodge", { dir: W.screenDirToHeading(dx, dy) });
        W.lastSwipe = { dx, dy, ms: el, dir: W.screenDirToHeading(dx, dy) };
        lastTap = null;
        return;
      }
      if (ptr.foe && !following) {
        if (e.type === "pointercancel") return;
        W.lastFoeTap = attackFoe(ptr.foe);
        lastTap = null;
        return;
      }
      if (following) {
        following = false; W.player.following = false;
        if (followMarker) followMarker.visible = false;
        tapAt(ptr.x, ptr.y);                     // termina en el último punto
        return;
      }
      if (e.type === "pointercancel") return;
      const now = performance.now();
      if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 60) {
        // doble toque: si el primer toque arrancó desde parado, se anula ese paseo y salta en el sitio
        if (lastTap.wasIdle) {
          const p = W.player; p.stop(); p.speed = 0;
          if (lastTap.start && Math.hypot(p.x - lastTap.start.x, p.z - lastTap.start.z) < 0.2) { p.x = lastTap.start.x; p.z = lastTap.start.z; }
          const m = markers.pop(); if (m) W.scene.remove(m.m);
        }
        W.player.doJump();
        lastTap = null;
        return;
      }
      const r = tapAt(e.clientX, e.clientY);
      lastTap = { t: now, x: e.clientX, y: e.clientY, wasIdle: !!r.wasIdle, start: r.start };
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    const jb = document.getElementById("jump");
    if (jb) jb.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); W.player.doJump(); });
    // botón de guardia: tocar = parry, mantener = bloquear (la máquina de estados distingue por la duración);
    // la pulsación lleva su marca de tiempo (event.timeStamp): el parry se mide desde ahí, no desde el frame
    const gb = document.getElementById("guard");
    if (gb) {
      const up = (e) => { e.preventDefault(); gb.setAttribute("aria-pressed", "false"); W.pf.input("guardUp"); };
      gb.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); if (W.sfx) W.sfx.unlock(); try { gb.setPointerCapture(e.pointerId); } catch (_) {} gb.setAttribute("aria-pressed", "true"); W.pf.input("guardDown", { ts: e.timeStamp }); });
      gb.addEventListener("pointerup", up); gb.addEventListener("pointercancel", up);
    }
    // teclado (Mac): WASD/flechas mover, Mayús correr, J atacar, K guardia, Espacio esquivar, L saltar
    const keys = W.keys = {};
    const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
    addEventListener("keydown", (e) => {
      if (e.repeat && !MOVE[e.code]) { if (["Space", "KeyJ", "KeyK", "KeyL"].indexOf(e.code) >= 0) e.preventDefault(); return; }
      if (W.sfx) W.sfx.unlock();
      if (MOVE[e.code]) { keys[e.code] = true; e.preventDefault(); return; }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") { keys.shift = true; return; }
      if (e.code === "KeyJ") {
        e.preventDefault();
        const f = W.nearestFoe ? W.nearestFoe(W.pf, 3.4, 2.0) : null;
        W.pf.input("attack", f ? { dir: Math.atan2(f.body.z - W.player.z, f.body.x - W.player.x) } : { dir: kbDir() });
      } else if (e.code === "KeyK") { e.preventDefault(); W.pf.input("guardDown", { ts: e.timeStamp }); }
      else if (e.code === "Space") {
        e.preventDefault();
        const d = kbDir();
        W.player.stop(); W.pf.input("dodge", { dir: d != null ? d : W.player.heading + Math.PI });
      } else if (e.code === "KeyL") { e.preventDefault(); W.player.doJump(); }
    });
    addEventListener("keyup", (e) => {
      if (MOVE[e.code]) { keys[e.code] = false; return; }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") { keys.shift = false; return; }
      if (e.code === "KeyK") W.pf.input("guardUp");
    });
    addEventListener("blur", () => { for (const k in keys) keys[k] = false; if (W.pf) W.pf.input("guardUp"); });
    function kbDir() {
      let sx = 0, sy = 0;
      for (const k in MOVE) if (keys[k]) { sx += MOVE[k][0]; sy += MOVE[k][1]; }
      if (!sx && !sy) return null;
      // en pantalla: arriba = alejarse de la cámara (con el acortamiento isométrico deshecho)
      return W.screenDirToHeading(sx, sy * Math.sin(W.CAM_EL));
    }
    W.kbDir = kbDir;
    // sin zoom ni scroll accidentales (iOS)
    for (const ev of ["gesturestart", "gesturechange", "dblclick", "contextmenu"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
  };

  let kbMoving = false;
  W.controlsUpdate = function (dt) {
    if (following) followTick(dt);
    const p = W.player, pf = W.pf;
    // teclado: un punto de destino siempre un poco por delante en la dirección pulsada
    const kd = W.kbDir ? W.kbDir() : null;
    if (kd != null && !following) {
      kbMoving = true; pendingAttack = null; pendingMove = null;
      if (!pf || !pf.act) {
        // con Mayús el destino va más lejos: el seguimiento pasa a carrera (> 1.2 alturas)
        const L = W.keys.shift ? 3.2 : 1.0;
        p.following = true;
        p.path = [{ x: p.x + Math.cos(kd) * L, z: p.z + Math.sin(kd) * L }];
        p.startDelay = 0;
      }
    } else if (kbMoving) { kbMoving = false; p.following = false; p.stop(); }
    // ataque pendiente al llegar junto al enemigo; paseo pendiente al terminar la acción
    if (pendingAttack) {
      pendingAttack.t += dt;
      const f = pendingAttack.f, d = Math.hypot(f.body.x - p.x, f.body.z - p.z);
      if (!f.alive || pendingAttack.t > 5) pendingAttack = null;
      else if (d <= 2.4 || (!p.path.length && d <= 3.4)) { pf.input("attack", { dir: Math.atan2(f.body.z - p.z, f.body.x - p.x) }); pendingAttack = null; }
      else if (!p.path.length) pendingAttack = null;
    }
    if (pendingMove && pf && !pf.act) { const m = pendingMove; pendingMove = null; W.goTo(m.x, m.z); }
    for (let i = markers.length - 1; i >= 0; i--) {
      const q = markers[i];
      q.t += dt / 0.6;
      if (q.t >= 1) { W.scene.remove(q.m); q.m.material.dispose(); markers.splice(i, 1); continue; }
      const s = 0.55 - 0.4 * (1 - Math.pow(1 - q.t, 3));
      q.m.scale.set(s, 1, s);
      q.m.material.opacity = 1 - q.t;
    }
  };
})();
