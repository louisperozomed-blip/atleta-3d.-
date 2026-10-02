// controls.js — controles táctiles (y ratón/teclado en Mac):
//   · tocar/clic en el suelo: va ahí por un camino A* (camina si está cerca, corre si está lejos)
//   · mantener pulsado (> 170 ms o arrastrar): sigue al dedo (se re-planifica cada 0.2 s)
//   · tocar al enemigo: atacar (toques seguidos encadenan el combo); si está lejos va hacia él y ataca;
//     mantener el dedo sobre él = golpe RETRASADO (se suelta al levantar el dedo)
//   · deslizar rápido: esquivar hacia allí
//   · botón GUARDIA: tocar = parry, mantener = bloquear
//   · botón SALTAR (y tecla L): salta en el sitio, o hacia delante si se mueve (combate: el barrido bajo)
//   · salto CONTEXTUAL: si el camino pasa por un desnivel de hasta 2 cabezas, camina hasta el borde y salta
//     (sube o baja); si tocas una zona más alta inalcanzable, el marcador sale en ROJO y no se mueve
//     (el doble toque ya no salta)
//   · teclado: WASD/flechas mover (Mayús corre), J atacar (mantener = retrasar el golpe), K guardia (durante la
//     preparación de tu golpe = finta), Espacio esquivar, L saltar
//   · marcador en el suelo: círculo que se encoge y se desvanece
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const TAP_MS = 170;
  const SWIPE_MS = 260, SWIPE_PX = 42;              // deslizar rápido = esquivar
  let pendingAttack = null, pendingMove = null;
  const ptr = { down: false, id: null, x0: 0, y0: 0, x: 0, y: 0, timer: 0 };
  let following = false, replanT = 0, lastFollowGoal = null;
  const markers = [];
  let followMarker = null, ringGeo = null;

  function ring(color) {
    if (!ringGeo) { ringGeo = new THREE.RingGeometry(0.78, 1, 32); ringGeo.rotateX(-Math.PI / 2); }
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }));
    m.renderOrder = 3; W.scene.add(m);
    return m;
  }
  // marcador rojo (zona inalcanzable): se dibuja encima de la imagen, fuera del post-proceso de paleta (que
  // convertía el aro rojo en naranja, igual que el normal): elipse en el suelo con una cruz, en rojo puro
  function redMark() {
    const d = document.createElement("div");
    d.className = "mark-red";
    d.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:5;transform-origin:0 0;will-change:transform,opacity";
    d.innerHTML = '<svg width="100" height="100" viewBox="-50 -50 100 100" style="display:block;overflow:visible">' +
      '<ellipse rx="44" ry="44" fill="rgba(255,40,30,0.18)" stroke="#ff2a1e" stroke-width="7"/>' +
      '<path d="M-20,-20 L20,20 M20,-20 L-20,20" stroke="#ff2a1e" stroke-width="9" stroke-linecap="round"/></svg>';
    document.body.appendChild(d);
    return d;
  }
  function placeRed(q, s) {
    // radio en pantalla: el de un círculo de radio s en el suelo (eje derecho de la cámara); alto acortado por la elevación
    const th = W.ui ? W.ui.theta : Math.PI / 4, c = W.toScreen(q.x, q.y, q.z),
      e = W.toScreen(q.x + Math.cos(th) * s, q.y, q.z - Math.sin(th) * s), r = Math.max(6, Math.hypot(e[0] - c[0], e[1] - c[1]));
    q.el.style.transform = `translate(${c[0] - r}px,${c[1] - r * Math.sin(W.CAM_EL)}px) scale(${r / 50},${r * Math.sin(W.CAM_EL) / 50})`;
  }
  function addMarker(x, y, z, red) {
    if (red) {
      const q = { x, y: y + 0.04, z, t: 0, red: true, el: redMark() };
      markers.push(q); placeRed(q, 0.42);
      W.lastMarker = { x, y, z, red: true, t: performance.now() };
      return;
    }
    const m = ring(0xffd27a);
    m.position.set(x, y + 0.04, z);
    markers.push({ m, t: 0, red: false });
    W.lastMarker = { x, y, z, red: false, t: performance.now() };
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
  function attackFoe(f, ts, pt, tap) {
    const p = W.player, pf = W.pf;
    const d = Math.hypot(f.body.x - p.x, f.body.z - p.z), dir = Math.atan2(f.body.z - p.z, f.body.x - p.x);
    // ts: instante del toque (para el ritmo del riposte cuenta cuándo bajó el dedo, no cuándo se levantó)
    if (d <= 3.2 || pf.act) { pf.input("attack", { dir, ts, pt, kind: "L", tap, relCt: W.ct }); pendingAttack = null; return "attack"; }
    // lejos: va hacia él y ataca al llegar
    const path = W.findPath(p.x, p.z, f.body.x - Math.cos(dir) * 1.1, f.body.z - Math.sin(dir) * 1.1, undefined, { jump: true });
    if (path.length) { p.setPath(path, { noDelay: true }); pendingAttack = { f, t: 0 }; }
    return "approach";
  }
  W.attackFoe = attackFoe;

  W.goTo = function (x, z, opts) {
    const p = W.player;
    // en mitad de una acción de combate el paseo queda pendiente hasta que termine
    if (W.pf && W.pf.act) { pendingMove = { x, z }; return { ok: true, pending: true, path: [{ x, z }] }; }
    const path = W.findPath(p.x, p.z, x, z, undefined, { jump: true });
    if (!path.length) return { ok: false };
    // toque en una zona libre a la que no se llega ni saltando (más de 2 cabezas de desnivel): no se mueve
    if (opts && opts.tap && !path.reached && W.cellFree(x, z)) return { ok: false, unreachable: true, path };
    const wasIdle = p.setPath(path, opts);
    W.lastPath = path;
    return { ok: true, wasIdle, path, reached: path.reached, exact: path.exact };
  };

  function tapAt(cx, cy) {
    pendingAttack = null;
    const g = W.pick(cx, cy);
    if (!g) return { ok: false };
    const r = W.goTo(g.x, g.z, { tap: true });
    if (r.ok) { const e = r.path[r.path.length - 1]; addMarker(e.x, W.heightAt(e.x, e.z), e.z); }
    else if (r.unreachable) { W.player.stop(); addMarker(g.x, W.heightAt(g.x, g.z), g.z, true); }
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
      const path = W.findPath(p.x, p.z, g.x, g.z, 12000, { jump: true });
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
      // sobre el enemigo no se sigue al dedo: es un ataque (o un deslizamiento); mantenerlo = golpe retrasado
      ptr.timer = setTimeout(() => { if (ptr.down && !ptr.foe) startFollow(); }, TAP_MS);
      ptr.atkHold = false;
      // tocar un enemigo que no es el objetivo lo SELECCIONA (target.js); tocar el objetivo, ataca
      ptr.select = !!ptr.foe && W.getTarget && W.getTarget() !== ptr.foe;
      // sobre el objetivo: tocar = LIGERO, mantener ≥ 0,4 s = FUERTE con carga (W.attackPress / attackRelease)
      if (ptr.foe && !ptr.select) W.attackPress("touch", e.timeStamp, ptr.foe);
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
      ptr.down = false; clearTimeout(ptr.timer); clearTimeout(ptr.holdTimer);
      // deslizar rápido: esquivar en esa dirección
      const dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0, el = performance.now() - ptr.t0;
      W.lastGesture = { dx, dy, ms: Math.round(el), following, foe: !!ptr.foe };
      if (e.type !== "pointercancel" && Math.hypot(dx, dy) > SWIPE_PX && el < SWIPE_MS) {
        if (following) { following = false; W.player.following = false; if (followMarker) followMarker.visible = false; }
        W.player.stop(); pendingAttack = null; pendingMove = null;
        if (atk && atk.src === "touch") { if (atk.charging) W.pf.input("chargeRelease"); atk = null; }   // era una esquiva
        W.pf.input("dodge", { dir: W.screenDirToHeading(dx, dy) });
        W.lastSwipe = { dx, dy, ms: el, dir: W.screenDirToHeading(dx, dy) };
        return;
      }
      if (ptr.foe && !following) {
        if (e.type === "pointercancel") return;
        if (ptr.select) { W.setTarget(ptr.foe, "tap"); W.lastFoeTap = "select"; return; }
        W.lastFoeTap = W.attackRelease("touch");
        return;
      }
      if (following) {
        following = false; W.player.following = false;
        if (followMarker) followMarker.visible = false;
        tapAt(ptr.x, ptr.y);                     // termina en el último punto
        return;
      }
      if (e.type === "pointercancel") return;
      // (el doble toque ya no salta: cada toque es un destino; los saltos los decide el camino)
      W.lastTap = tapAt(e.clientX, e.clientY);
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
      if (e.code === "Tab") { e.preventDefault(); if (W.cycleTarget) W.cycleTarget(); return; }   // objetivo siguiente
      if (e.code === "KeyJ") {
        e.preventDefault();
        // J tocada = LIGERO, J mantenida ≥ 0,4 s = FUERTE con carga
        const f = (W.getTarget && W.getTarget()) || (W.nearestFoe ? W.nearestFoe(W.pf, 3.4, 2.0) : null);
        W.attackPress("key", e.timeStamp, f, f ? null : kbDir());
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
      if (e.code === "KeyJ") W.attackRelease("key");
    });
    addEventListener("blur", () => { for (const k in keys) keys[k] = false; if (W.pf) { W.pf.input("guardUp"); W.pf.input("attackUp"); if (atk) W.attackRelease(atk.src); } });
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

  // ---- pulsación de ataque (toque sobre el objetivo, J o el botón ATACAR): L o H según cuánto se mantiene ----------
  // se mide en tiempo de paso (incluido el hitstop: si no, un fuerte justo tras un golpe tardaba más en salir); las
  // pruebas a paso fijo y el juego real ven lo mismo
  let atk = null;
  W.attackPress = function (src, ts, foe, dir) {
    if (atk) return;
    // pt: instante de la pulsación en el reloj de combate (marca del evento + calibración): para el ritmo
    atk = { src, ts, pt: W.pressTime(ts, true), foe: foe || null, dir: dir == null ? null : dir, ct0: W.ct, held: 0, charging: false };
  };
  W.attackRelease = function (src) {
    if (!atk || atk.src !== src) return null;
    const A = atk; atk = null;
    if (A.charging) { W.pf.input("chargeRelease"); return "heavy"; }
    // tap: lo que se mantuvo (el ligero sale al soltar; fighter.js lo recupera si el golpe empieza ya)
    if (A.foe && A.foe.alive) return attackFoe(A.foe, A.ts, A.pt, A.held);
    W.pf.input("attack", { dir: A.dir != null ? A.dir : W.player.heading, ts: A.ts, pt: A.pt, kind: "L", tap: A.held, relCt: W.ct });
    return "attack";
  };
  W.attackHold = () => (atk ? { src: atk.src, held: atk.held, charging: atk.charging } : null);
  function attackHoldStep(dt) {
    if (!atk) return;
    atk.held += dt;
    if (atk.charging || atk.held < W.MOVES.holdH) return;
    const f = atk.foe, p = W.player;
    if (f && (!f.alive || (Math.hypot(f.body.x - p.x, f.body.z - p.z) > 3.4 && !W.pf.act))) return;   // lejos: al soltar irá a por él
    const dir = f ? Math.atan2(f.body.z - p.z, f.body.x - p.x) : atk.dir != null ? atk.dir : p.heading;
    atk.charging = true;
    W.pf.input("attack", { dir, ts: atk.ts, pt: atk.pt, kind: "H", pressCt: W.ct - atk.held });
  }

  let kbMoving = false;
  W.controlsUpdate = function (dt) {
    attackHoldStep(dt);
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
      else if (d <= 2.4 || (!p.path.length && d <= 3.4)) { pf.input("attack", { dir: Math.atan2(f.body.z - p.z, f.body.x - p.x), kind: "L" }); pendingAttack = null; }
      else if (!p.path.length) pendingAttack = null;
    }
    if (pendingMove && pf && !pf.act) { const m = pendingMove; pendingMove = null; W.goTo(m.x, m.z); }
    for (let i = markers.length - 1; i >= 0; i--) {
      const q = markers[i];
      q.t += dt / (q.red ? 1.0 : 0.6);
      if (q.t >= 1) { if (q.el) q.el.remove(); else { W.scene.remove(q.m); q.m.material.dispose(); } markers.splice(i, 1); continue; }
      // rojo (inalcanzable): no se encoge, late dos veces y se apaga
      const s = q.red ? 0.42 + 0.06 * Math.sin(q.t * Math.PI * 4) : 0.55 - 0.4 * (1 - Math.pow(1 - q.t, 3));
      if (q.el) { placeRed(q, s); q.el.style.opacity = Math.min(1, 1.6 * (1 - q.t)); continue; }
      q.m.scale.set(s, 1, s);
      q.m.material.opacity = q.red ? Math.min(1, 1.6 * (1 - q.t)) : 1 - q.t;
    }
  };
})();
