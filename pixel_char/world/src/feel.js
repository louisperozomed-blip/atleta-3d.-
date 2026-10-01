// feel.js — sentimiento al caminar:
//  - luz que envuelve al personaje: bajo las copas se apaga poco a poco; junto a hongos y agua toma luz fría
//    desde abajo; junto al farol, cálida (luz puntual del farol, con prioridad en el pool)
//  - brillo propio muy tenue del visor (más visible cuanto más oscuro está)
//  - superficie bajo el pie (W.surfaceAt): agua, hojas secas, metal, piedra, tierra, hierba
//  - su reflejo en las charcas
//  - la niebla se abre a su paso, se arremolina y se cierra detrás (estela en el post)
//  - cámara: sigue con retraso suave, se acerca un poco en reposo y se aleja al correr
//  - primer plano: ramas, lianas y ramitas muertas en los bordes que pasan por delante con paralaje
//  - audio ambiental (viento, goteo, zumbido eléctrico junto a las máquinas)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const F = (W.FEEL = {
    on: { light: 1, visor: 1, fog: 1, cam: 1, fg: 1, reflection: 1, ambient: 1 },
    cov: 0, up: new THREE.Vector3(), zoomK: 1, idleT: 0, trail: [], trailT: 0, fgDens: 0,
  });

  // ---------------------------------------------------------------------------
  // Superficie bajo el pie
  // ---------------------------------------------------------------------------
  W.surfaceAt = function (x, z) {
    const K = W.K, k = W.kindAt(x, z);
    if (k === K.PUDDLE || k === K.WATER) return "water";
    for (const p of W.plates || []) if (Math.abs(p[0] - x) < p[2] && Math.abs(p[1] - z) < p[2] && Math.hypot(p[0] - x, p[1] - z) < p[2]) return "metal";
    const H = W.HAND;
    if (H && x >= H.x0 && x < H.x1 && z >= H.z0 && z < H.z1) return "metal";
    if (k === K.PLAZA || k === K.STONE) return "stone";
    if (k === K.PATH) return "dust";
    const zn = W.zoneAt(x, z);
    if (zn === "ruins" || zn === "roots" || W.coverAt(x, z).c > 0.45) return "leaves";
    return "grass";
  };

  // ---------------------------------------------------------------------------
  // Reflejo del personaje en las charcas: el mismo frame volteado bajo el suelo, oscuro y ondulado
  // ---------------------------------------------------------------------------
  let refl = null;
  function makeReflection(scene) {
    const ch = W.character, U = ch.uniforms;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: U.uColor, uRect: U.uRect, uTime: W.U.uTime, uA: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D uColor; uniform vec4 uRect; uniform float uTime, uA; varying vec2 vUv;
        void main(){
          float fall = 1.0 - vUv.y;                                     // 0 en los pies, 1 lejos
          vec2 q = vec2(vUv.x + sin(vUv.y * 40.0 - uTime * 3.0) * 0.012 * (0.3 + fall), 1.0 - vUv.y);
          vec4 c = texture2D(uColor, vec2(uRect.x + q.x * uRect.z, uRect.y + q.y * uRect.w));
          if (c.a < 0.5) discard;
          float a = uA * (1.0 - smoothstep(0.35, 0.95, 1.0 - vUv.y)) * (0.7 + 0.3 * step(0.5, fract(vUv.y * 22.0 + uTime)));
          gl_FragColor = vec4(mix(c.rgb * 0.45, vec3(0.05, 0.14, 0.15), 0.45), a);
        }`,
    });
    const m = new THREE.Mesh(ch.mesh.geometry, mat);
    m.renderOrder = 1; m.frustumCulled = false; m.visible = false;
    scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Primer plano: siluetas dibujadas en un lienzo (atlas 4×1) y pintadas encima con paralaje
  // ---------------------------------------------------------------------------
  let fg = null;
  function drawAtlas() {
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const g = c.getContext("2d"), R = W.rng(5);
    const ink = "#070b0b", dark = "#142420", mid = "#1d302c", terra = "#3a2a24";
    g.lineCap = "round";
    // 0: rama con hojas (entra por un lado)
    function branch(ox, oy, w, h) {
      g.strokeStyle = ink;
      for (let k = 0; k < 3; k++) {
        g.lineWidth = 10 - k * 3; g.beginPath(); let x = ox, y = oy + h * (0.3 + k * 0.25); g.moveTo(x, y);
        for (let j = 0; j < 6; j++) { x += w / 6; y += (R() - 0.5) * 26; g.lineTo(x, y);
          for (let l = 0; l < 3; l++) { g.fillStyle = [ink, dark, mid, terra][Math.floor(R() * (l ? 3 : 4))]; g.beginPath(); g.ellipse(x + (R() - 0.5) * 30, y + (R() - 0.5) * 24, 9 + R() * 12, 5 + R() * 7, R() * 3, 0, 6.3); g.fill(); } }
        g.stroke();
      }
    }
    // 1: lianas colgando (entran por arriba)
    function vines(ox, oy, w, h) {
      for (let k = 0; k < 7; k++) {
        let x = ox + 10 + k * (w - 20) / 6 + (R() - 0.5) * 12, y = oy; const L = h * (0.4 + R() * 0.6);
        g.strokeStyle = k % 2 ? ink : dark; g.lineWidth = 3 + R() * 3; g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 10; j++) { y += L / 10; x += Math.sin(j * 0.9 + k) * 3; g.lineTo(x, y);
          if (R() < 0.35) { g.fillStyle = R() < 0.5 ? mid : dark; g.fillRect(x - 5, y - 2, 10, 4); } }
        g.stroke();
      }
      g.fillStyle = ink; g.fillRect(ox, oy, w, 14);
    }
    // 2: ramitas muertas
    function twigs(ox, oy, w, h) {
      g.strokeStyle = ink;
      const rec = (x, y, a, L, d) => { if (d > 4 || L < 6) return; const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
        g.lineWidth = Math.max(1.5, 7 - d * 1.6); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        rec(x2, y2, a - 0.5 - R() * 0.3, L * 0.7, d + 1); rec(x2, y2, a + 0.4 + R() * 0.3, L * 0.65, d + 1); };
      rec(ox, oy + h * 0.8, -0.5, w * 0.35, 0); rec(ox, oy + h * 0.4, -0.15, w * 0.3, 1);
    }
    // 3: helechos / hierba alta (entran por abajo)
    function ferns(ox, oy, w, h) {
      for (let k = 0; k < 9; k++) {
        const bx = ox + 8 + k * (w - 16) / 8, L = h * (0.5 + R() * 0.5), a = -Math.PI / 2 + (R() - 0.5) * 0.9;
        g.strokeStyle = k % 3 ? ink : dark; g.lineWidth = 4; g.beginPath(); g.moveTo(bx, oy + h);
        const ex = bx + Math.cos(a) * L, ey = oy + h + Math.sin(a) * L; g.quadraticCurveTo(bx, oy + h - L * 0.5, ex, ey); g.stroke();
        for (let j = 1; j < 6; j++) { const t = j / 6, px = bx + (ex - bx) * t, py = oy + h + (ey - oy - h) * t;
          g.fillStyle = j % 2 ? ink : mid; g.beginPath(); g.ellipse(px + 7, py, 8, 3, -0.4, 0, 6.3); g.ellipse(px - 7, py, 8, 3, 0.4, 0, 6.3); g.fill(); }
      }
    }
    branch(0, 0, 128, 256); vines(128, 0, 128, 256); twigs(256, 0, 128, 256); ferns(384, 0, 128, 256);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter;
    return t;
  }
  function makeForeground() {
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    const tex = drawAtlas(), items = [];
    // lado: 0 izquierda (rama), 1 arriba (lianas), 2 derecha (ramitas), 3 abajo (helechos)
    const defs = [[0, -0.2, 0], [0, 0.6, 0], [1, -0.5, 1], [1, 0.3, 1], [2, 0.1, 2], [2, -0.7, 0], [3, -0.4, 3], [3, 0.5, 3]];
    defs.forEach(([side, along, tile], i) => {
      const mat = new THREE.MeshBasicMaterial({ map: tex.clone(), transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      mat.map.needsUpdate = true;
      mat.map.repeat.set(0.25, 1); mat.map.offset.set(tile * 0.25, 0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      scene.add(m);
      items.push({ m, side, along, tile, par: 1.35 + (i % 3) * 0.2, size: 0.55 + (i % 2) * 0.2 });
    });
    return { scene, cam, items };
  }
  // tipo de silueta según la zona
  function tileFor(side) {
    const z = W.zoneAt(W.player.x, W.player.z);
    if (side === 1) return z === "ponds" ? 1 : z === "ruins" || z === "heart" ? 2 : 1;
    if (side === 3) return z === "ruins" ? 2 : 3;
    return z === "ruins" || z === "heart" ? 2 : 0;
  }

  // ---------------------------------------------------------------------------
  W.initFeel = function (scene) {
    refl = makeReflection(scene);
    fg = makeForeground();
    W.fg = fg;
  };

  const _up = new THREE.Vector3(), _t = new THREE.Vector3();
  W.updateFeel = function (dt, t, camT, cam) {
    const p = W.player, ch = W.character, U = ch.uniforms, st = ch.st;
    U.uTime.value = t;
    // --- luz envolvente --------------------------------------------------------------------------------
    const cv = W.coverAt(p.x, p.z).c;
    F.cov += (cv - F.cov) * (1 - Math.exp(-dt * 2.2));              // ~0.5 s: se oscurece poco a poco
    const k = F.on.light ? F.cov : 0;
    U.uCovC.value.set(1 - k * 0.62, 1 - k * 0.55);      // se oscurece, pero siempre se le distingue
    _t.set(0, 0, 0);
    if (F.on.light) {
      for (const e of W.emitters) {
        if (e.kind !== "bio" && e.kind !== "screen") continue;
        const dx = e.x - p.x, dz = e.z - p.z;
        if (Math.abs(dx) > e.distance || Math.abs(dz) > e.distance) continue;
        const d = Math.hypot(dx, dz); if (d > e.distance) continue;
        const f = Math.pow(1 - d / e.distance, 2) * e.intensity * 0.55;
        _t.x += e.color.r * f; _t.y += e.color.g * f; _t.z += e.color.b * f;
      }
      let wat = 0;
      for (let a = 0; a < 6; a++) { const kd = W.kindAt(p.x + Math.cos(a) * 0.7, p.z + Math.sin(a) * 0.7); if (kd === W.K.PUDDLE || kd === W.K.WATER) wat++; }
      if (W.kindAt(p.x, p.z) === W.K.PUDDLE) wat += 3;
      _t.x += 0.12 * wat * 0.18; _t.y += 0.5 * wat * 0.18; _t.z += 0.55 * wat * 0.18;
      const m = Math.max(_t.x, _t.y, _t.z); if (m > 0.9) _t.multiplyScalar(0.9 / m);
    }
    F.up.lerp(_t, 1 - Math.exp(-dt * 3));
    U.uUp.value.copy(F.up);
    // envolvente cálida del farol
    _up.set(0, 0, 0);
    if (F.on.light) for (const e of W.emitters) {
      if (!e.warm) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z); if (d > e.distance) continue;
      const f = Math.pow(1 - d / e.distance, 1.5) * 0.75;
      _up.set(e.color.r * f, e.color.g * f, e.color.b * f);
    }
    F.warm = (F.warm || new THREE.Vector3()).lerp(_up, 1 - Math.exp(-dt * 2.5));
    U.uWarm.value.copy(F.warm);
    U.uVisor.value = F.on.visor ? 0.35 + 0.9 * F.cov : 0;           // más visible cuanto más oscuro
    // --- reflejo en las charcas ---------------------------------------------------------------------------
    if (refl) {
      const onW = F.on.reflection && !p.jump && W.kindAt(p.x, p.z) === W.K.PUDDLE;
      refl.material.uniforms.uA.value += ((onW ? 0.55 : 0) - refl.material.uniforms.uA.value) * (1 - Math.exp(-dt * 6));
      refl.visible = refl.material.uniforms.uA.value > 0.01;
      if (refl.visible) {
        const M = ch.mesh, g = p.ground + 0.04;
        refl.position.set(M.position.x, 2 * g - M.position.y, M.position.z);
        refl.rotation.copy(M.rotation);
        refl.scale.set(M.scale.x, -M.scale.y, 1);
      }
    }
    // --- niebla: hueco alrededor del personaje + estela que se cierra detrás ------------------------------
    const post = W.post;
    if (post && post.uniforms.uTrail) {
      const r = F.on.fog ? 1.5 + Math.min(p.speed || 0, 4) * 0.12 : 0;
      post.uniforms.uPlayer.value.set(p.x, p.y, p.z, r);
      post.uniforms.uFog.value.w = p.speed || 0;
      F.trailT += dt;
      if (F.trailT > 0.22) { F.trailT = 0; F.trail.unshift([p.x, p.z, t]); F.trail.length = Math.min(F.trail.length, 3); }
      post.uniforms.uTrail.value.forEach((v, i) => {
        const q = F.trail[i];
        if (!q || !F.on.fog) { v.set(0, 0, 0, 0); return; }
        const age = t - q[2];
        v.set(q[0], q[1], 0, Math.max(0, r * (1 - age / 1.3)));       // se cierra en ~1.3 s
      });
    }
    // --- cámara: más cerca en reposo, más lejos al correr -------------------------------------------------
    if (st.anim === "idle" && !p.path.length) F.idleT += dt; else F.idleT = 0;
    const dz = W.duelZoom ? W.duelZoom() : 0;             // remate: la cámara se acerca un poco (duel.js)
    const zt = (!F.on.cam ? 1 : st.anim === "run" ? 0.9 : F.idleT > 0.8 ? 1.09 : 1) * (1 + dz);
    const zk = dz > 0 ? F.zoomK + (zt - F.zoomK) * Math.min(1, dt * 12) : F.zoomK + (zt - F.zoomK) * (1 - Math.exp(-dt * (zt < F.zoomK ? 1.6 : 0.7)));
    if (Math.abs(zk - F.zoomK) > 1e-5) { F.zoomK = zk; if (W.setProj) W.setProj(); }
    // --- primer plano con paralaje --------------------------------------------------------------------------
    if (fg) {
      const dens = W.coverAt(camT.x, camT.z).c, zn = W.zoneAt(p.x, p.z);
      const want = !F.on.fg ? 0 : W.clamp(dens * 1.2 + (zn === "ruins" || zn === "ponds" ? 0.35 : 0) + (zn === "heart" ? 0.1 : 0), 0, 1);
      F.fgDens += (want - F.fgDens) * (1 - Math.exp(-dt * 0.8));
      const th = W.ui.theta, rx = Math.cos(th), rz = -Math.sin(th);
      const sx = camT.x * rx + camT.z * rz, sy = camT.x * Math.sin(th) + camT.z * Math.cos(th);  // plano de pantalla
      const hw = (cam.right - cam.left) / 2, hh = (cam.top - cam.bottom) / 2, asp = hw / hh;
      fg.items.forEach((it, i) => {
        const horiz = it.side === 1 || it.side === 3;
        const shift = horiz ? -sx * (it.par - 1) / hw : sy * Math.sin(W.CAM_EL) * (it.par - 1) / hh;
        let a = it.along + shift;
        const span = 3.2, w0 = ((a + 1.6) % span + span) % span - 1.6;
        if (Math.abs(w0 - (it.lastA == null ? w0 : it.lastA)) > 1.5) {   // da la vuelta: cambia de silueta según la zona
          it.tile = tileFor(it.side); it.m.material.map.offset.x = it.tile * 0.25;
        }
        it.lastA = w0;
        const size = it.size * (0.9 + 0.1 * Math.sin(i));
        const vis = (i % 4 < Math.ceil(F.fgDens * 4)) ? 1 : 0;
        const o = it.m.material;
        o.opacity += (vis * Math.min(1, F.fgDens * 1.4) - o.opacity) * (1 - Math.exp(-dt * 2));
        it.m.visible = o.opacity > 0.01;
        const sway = Math.sin(t * 0.6 + i) * 0.015;
        if (it.side === 0) { it.m.position.set(-1 + size * 0.28 / asp + sway, w0, 0); it.m.scale.set(size * 0.6 / asp, size, 1); }
        else if (it.side === 2) { it.m.position.set(1 - size * 0.28 / asp + sway, w0, 0); it.m.scale.set(-size * 0.6 / asp, size, 1); }
        else if (it.side === 1) { it.m.position.set(w0, 1 - size * 0.4 + sway, 0); it.m.scale.set(size * 0.5 / asp, size * 0.9, 1); }
        else { it.m.position.set(w0, -1 + size * 0.3, 0); it.m.scale.set(size * 0.5 / asp, size * 0.6, 1); }
      });
    }
    // --- audio ambiental ---------------------------------------------------------------------------------------
    if (W.sfx && W.sfx.ambient) {
      const zn = W.zoneAt(p.x, p.z);
      let hum = 0;
      for (const q of W.machines || []) { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < q[2]) hum = Math.max(hum, 1 - d / q[2]); }
      W.sfx.ambient({
        wind: F.on.ambient ? 0.55 + 0.45 * (1 - F.cov) : 0,
        drip: F.on.ambient ? (zn === "ponds" ? 1 : F.cov > 0.6 ? 0.3 : 0.05) : 0,
        hum: F.on.ambient ? hum : 0,
      }, dt);
    }
  };
  W.renderForeground = function (renderer) {
    if (!fg || F.fgDens < 0.01) return;
    renderer.autoClear = false;
    renderer.render(fg.scene, fg.cam);
    renderer.autoClear = true;
  };
})();
