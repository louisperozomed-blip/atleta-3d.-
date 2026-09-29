// controls.js — mismos controles que la demo anterior, sobre el mundo 3D:
//   · tocar/clic en un punto: va ahí por un camino A* (camina si está cerca, corre si está lejos)
//   · mantener pulsado (> 170 ms o arrastrar): sigue al dedo (se re-planifica cada 0.2 s)
//   · doble toque o botón SALTAR (o Espacio): salta en el sitio, o hacia delante si se mueve
//   · marcador en el suelo: círculo que se encoge y se desvanece
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const TAP_MS = 170, DOUBLE_MS = 320;
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

  W.goTo = function (x, z, opts) {
    const p = W.player;
    const path = W.findPath(p.x, p.z, x, z);
    if (!path.length) return { ok: false };
    const wasIdle = p.setPath(path, opts);
    W.lastPath = path;
    return { ok: true, wasIdle, path, reached: path.reached, exact: path.exact };
  };

  function tapAt(cx, cy) {
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
      if (ptr.down) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      Object.assign(ptr, { down: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      clearTimeout(ptr.timer);
      ptr.timer = setTimeout(() => { if (ptr.down) startFollow(); }, TAP_MS);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.x = e.clientX; ptr.y = e.clientY;
      if (!following && Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0) > 12) startFollow();
    });
    const end = (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.down = false; clearTimeout(ptr.timer);
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
    addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); W.player.doJump(); } });
    // sin zoom ni scroll accidentales (iOS)
    for (const ev of ["gesturestart", "gesturechange", "dblclick", "contextmenu"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
  };

  W.controlsUpdate = function (dt) {
    if (following) followTick(dt);
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
