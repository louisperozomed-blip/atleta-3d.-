// main.js — renderer, escena, luces, cámara isométrica que sigue al personaje, bucle.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  W.CAM_EL = Math.atan(0.5);           // elevación de la cámara (isométrica 2:1, como la referencia)
  const PIX = [1, 2, 3, 4, 5, 6, 8];

  W.start = function (assets) {
    const wrap = document.getElementById("wrap");
    const $ = (id) => document.getElementById(id);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const ui = W.ui = { pi: 2, zoom: 1.6, palette: true, theta: Math.PI / 4, thetaT: Math.PI / 4 };

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    wrap.insertBefore(renderer.domElement, wrap.firstChild);
    W.renderer = renderer;
    const gl = renderer.getContext();
    const scene = (W.scene = new THREE.Scene());
    (function () {
      const c = document.createElement("canvas"); c.width = 2; c.height = 64;
      const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, "#0c1413"); gr.addColorStop(0.6, "#1a2523"); gr.addColorStop(1, "#27332f");
      g.fillStyle = gr; g.fillRect(0, 0, 2, 64);
      scene.background = new THREE.CanvasTexture(c);
    })();
    // (la niebla es un pase del post-proceso: por altura y por zona, look.js)
    W.U.uPlayer.value = new THREE.Vector3(0, -99, 0);

    // --- luces: día nublado apagado (cielo gris verdoso, sol velado), pool de puntuales -----
    // bajo las copas el sol y el cielo se apagan (mapa de cobertura, W.patchCover)
    const hemi = (W.hemi = new THREE.HemisphereLight(0xa9bab4, 0x121816, 0.5));
    scene.add(hemi);
    const sun = (W.sun = new THREE.DirectionalLight(0xc9d0c6, 0.62));
    W.SUN_DIR = new THREE.Vector3(-10, 18, 7).normalize();
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 70 });
    sun.shadow.bias = -0.0015;
    scene.add(sun); scene.add(sun.target);
    W.CU.lightDir.value.copy(W.SUN_DIR);
    const lightPool = W.makeLightPool(scene);

    // --- mundo -------------------------------------------------------------------
    const t0 = performance.now();
    W.generateTerrain(1337);
    W.placeProps();
    // niebla densa en lo bajo y húmedo (charcas) y en el bosque muerto (ruinas → cementerio)
    W.addFog(W.ZONES.ponds.x, W.ZONES.ponds.z, W.ZONES.ponds.r + 3, 0.9);
    W.addFog(W.ZONES.ruins.x, W.ZONES.ruins.z, W.ZONES.ruins.r + 3, 1.1);
    W.buildCover();
    const gm = W.makeGradientMap();
    const worldMat = (W.worldMat = W.makeWorldMaterial(gm));
    const outlineMat = W.makeOutlineMaterial();
    const depthMat = W.makeSwayDepthMaterial();
    const crysMat = W.makeCrystalMaterial();
    const waterMat = W.makeWaterMaterial();
    const { meshes, wmeshes } = W.buildTerrainMeshes();
    const stats = { chunks: 0, tris: 0, meshes: 0 };
    const addMesh = (g, m, cast, recv) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = !!cast; mesh.receiveShadow = !!recv;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      if (cast && m === worldMat) mesh.customDepthMaterial = depthMat;
      scene.add(mesh);
      stats.meshes++; stats.tris += g.attributes.position.count / 3;
      return mesh;
    };
    meshes.forEach((m) => addMesh(m.geometry, worldMat, true, true));
    wmeshes.forEach((m) => addMesh(m.geometry, waterMat, false, true));
    for (const c of W.chunks.values()) {
      stats.chunks++;
      const s = c.solid.build(); if (s) addMesh(s, worldMat, true, true);
      const o = c.outline.build(); if (o) addMesh(o, outlineMat, false, false);
      const k = c.crys.build(); if (k) addMesh(k, crysMat, true, false);
    }
    // vaina del árbol-corazón (late)
    const podMat = new THREE.MeshToonMaterial({ color: 0xff5ac8, emissive: 0xff2ab0, emissiveIntensity: 1, gradientMap: gm });
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1).toNonIndexed(), podMat);
    pod.geometry.computeVertexNormals();
    pod.position.copy(W.heartPos); pod.castShadow = true; scene.add(pod);
    const podOut = new THREE.Mesh(pod.geometry, new THREE.MeshBasicMaterial({ color: 0x2a0020, side: THREE.BackSide }));
    podOut.scale.setScalar(1.08); pod.add(podOut);
    const ambient = (W.ambient = W.makeAmbient(scene, 1100));
    W.autoShafts(40);
    const shafts = (W.shafts = W.makeShafts(scene));
    const fx = (W.fx = W.makeFx(scene));
    stats.buildMs = Math.round(performance.now() - t0);
    W.stats = stats;

    // --- personaje -------------------------------------------------------------------
    const player = (W.player = new W.Player(0, -6.2));
    const character = (W.character = W.makeCharacter(scene, assets.tex, assets.meta));

    // --- cámara isométrica + post-proceso pixel art ----------------------------------
    const cam = (W.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200));
    const post = (W.post = W.makePost());
    let rh = 1;
    function resize() {
      const px = PIX[ui.pi], w = Math.max(1, Math.floor(wrap.clientWidth * dpr / px)), h = Math.max(1, Math.floor(wrap.clientHeight * dpr / px));
      renderer.setSize(w, h, false); post.rt.setSize(w, h); rh = h;
      if (W.ambient) W.ambient.mat.uniforms.uPx.value = 1;
      const a = w / h, fh = (12 / ui.zoom) * Math.max(1, (1 / a) / 1.3);   // en vertical se ve más alto
      cam.left = -fh * a / 2; cam.right = fh * a / 2; cam.top = fh / 2; cam.bottom = -fh / 2; cam.updateProjectionMatrix();
      const pxBtn = $("px"); if (pxBtn) pxBtn.textContent = "px" + px;
      W.viewHalf = Math.max(fh * a, fh) * 0.75 + 4;
    }
    W.resize = resize;
    addEventListener("resize", resize);
    if (window.visualViewport) visualViewport.addEventListener("resize", resize);
    resize();

    const camT = new THREE.Vector3(player.x, player.y + 1.2, player.z);
    const tmp = new THREE.Vector3(), rv = new THREE.Vector3(), uv = new THREE.Vector3();
    const lightView = new THREE.Matrix4(), lv = new THREE.Vector3(), camPx = new THREE.Vector2();

    // --- selección de un punto del suelo desde la pantalla (marcha sobre el mapa de alturas)
    const _o = new THREE.Vector3(), _d = new THREE.Vector3();
    W.pick = function (clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = -(((clientY - r.top) / r.height) * 2 - 1);
      _o.set(nx, ny, -1).unproject(cam);
      cam.getWorldDirection(_d);
      let prev = 0;
      for (let t = 0; t < 140; t += 0.05) {
        const x = _o.x + _d.x * t, y = _o.y + _d.y * t, z = _o.z + _d.z * t;
        if (Math.abs(x) > W.HALF || Math.abs(z) > W.HALF) { prev = t; continue; }
        if (y <= W.heightAt(x, z)) {
          // refina (bisección) el cruce con la cara superior
          let a = prev, b = t;
          for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (_o.y + _d.y * m <= W.heightAt(_o.x + _d.x * m, _o.z + _d.z * m)) b = m; else a = m; }
          return { x: _o.x + _d.x * b, y: W.heightAt(_o.x + _d.x * b, _o.z + _d.z * b), z: _o.z + _d.z * b };
        }
        prev = t;
      }
      return null;
    };
    // Proyección mundo -> pantalla (px CSS), para pruebas y para el marcador
    W.toScreen = function (x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(cam), r = renderer.domElement.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
    };

    // --- botones -----------------------------------------------------------------------
    const Q = Math.PI / 2;
    const on = (id, f) => { const b = $(id); if (b) b.addEventListener("click", (e) => { e.stopPropagation(); f(); }); };
    on("rl", () => { ui.thetaT -= Q; });
    on("rr", () => { ui.thetaT += Q; });
    on("zi", () => { ui.zoom = Math.min(4, ui.zoom * 1.25); resize(); });
    on("zo", () => { ui.zoom = Math.max(0.45, ui.zoom / 1.25); resize(); });
    on("px", () => { ui.pi = (ui.pi + 1) % PIX.length; resize(); });
    const wb = $("walk");
    const setWalk = (m) => { W.walkMode = m; if (wb) wb.textContent = "andar " + m; };
    on("walk", () => { const M = W.WALK_MODES; setWalk(M[(M.indexOf(W.walkMode) + 1) % M.length]); });
    W.setWalk = setWalk;
    on("snd", () => { const b = $("snd"), onNow = !(W.sfx && W.sfx.enabled); if (W.sfx) W.sfx.setEnabled(onNow); b.setAttribute("aria-pressed", String(onNow)); b.textContent = onNow ? "sonido" : "silencio"; });
    if (W.initControls) W.initControls(renderer.domElement);

    // --- bucle -------------------------------------------------------------------------------
    const clock = new THREE.Clock();
    let t = 0, fpsN = 0, fpsT = 0;
    W.fps = 0;
    const zoneEl = $("zone");
    let lastZone = "";
    // Paso de simulación: frame() en tiempo real; W.tick(dt) avanza a paso fijo cuando W.manual
    // (pruebas y GIF deterministas: el antes y el después ven exactamente el mismo recorrido)
    function frame() {
      const rdt = Math.min(0.05, clock.getDelta());
      if (!W.manual) step(rdt);
      requestAnimationFrame(frame);
    }
    W.tick = function (dt, n) { for (let i = 0; i < (n || 1); i++) step(dt); };
    function step(dt) {
      t += dt; W.U.uTime.value = t;
      if (W.controlsUpdate) W.controlsUpdate(dt);
      player.update(dt);
      W.U.uPlayer.value.set(player.x, player.y, player.z);
      W.U.uPush.value += ((player.speed > 0.1 ? 1 : 0.3) - W.U.uPush.value) * Math.min(1, dt * 6);
      ui.theta += (ui.thetaT - ui.theta) * (1 - Math.exp(-dt * 7));
      if (Math.abs(ui.thetaT - ui.theta) < 1e-4) ui.theta = ui.thetaT;
      character.update(dt, player, ui.theta, ui.thetaT);
      if (W.afterCharacter) W.afterCharacter(dt, t);
      // latido
      const beat = Math.pow(Math.max(0, Math.sin(t * 2.4)), 8);
      pod.scale.setScalar(1 + beat * 0.12);
      podMat.emissiveIntensity = 0.8 + beat * 0.6;
      // cámara: sigue con suavidad
      camT.lerp(tmp.set(player.x, player.y + 1.0, player.z), W.camSnap ? 1 : 1 - Math.exp(-dt * 4));
      W.camSnap = false;
      const EL = W.CAM_EL;
      cam.position.set(Math.sin(ui.theta) * Math.cos(EL), Math.sin(EL), Math.cos(ui.theta) * Math.cos(EL)).multiplyScalar(40).add(camT);
      cam.lookAt(camT); cam.updateMatrixWorld();
      const wpp = (W.wpp = (cam.top - cam.bottom) / rh);
      rv.setFromMatrixColumn(cam.matrixWorld, 0); uv.setFromMatrixColumn(cam.matrixWorld, 1);
      const tr = camT.dot(rv), tu = camT.dot(uv);
      cam.position.addScaledVector(rv, Math.round(tr / wpp) * wpp - tr).addScaledVector(uv, Math.round(tu / wpp) * wpp - tu);
      camPx.set(Math.round(tr / wpp), Math.round(tu / wpp));     // anclaje de los patrones del post al mundo
      cam.updateMatrixWorld(); cam.getWorldDirection(W.CU.camDir.value);
      // sol: la sombra sigue a la vista, con el centro ajustado a texeles (sin parpadeo)
      const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
      lightView.lookAt(W.SUN_DIR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
      lv.copy(camT).applyMatrix4(lightView.clone().invert());
      lv.x = Math.round(lv.x / texel) * texel; lv.y = Math.round(lv.y / texel) * texel;
      lv.applyMatrix4(lightView);
      sun.target.position.copy(lv); sun.position.copy(lv).addScaledVector(W.SUN_DIR, 30);
      sun.target.updateMatrixWorld();
      // luces puntuales cercanas, esporas, efectos
      W.updateLightPool(lightPool, camT.x, camT.z, W.viewHalf, t, beat);
      W.updateAmbient(ambient, dt, t, player, camT.x, camT.z, Math.min(W.viewHalf, 16));
      if (shafts) { shafts.mat.uniforms.uSun.value.copy(W.SUN_DIR); shafts.mat.uniforms.uCamDir.value.copy(W.CU.camDir.value); }
      fx.update(dt);
      // render a baja resolución + post
      renderer.info.reset();
      renderer.setRenderTarget(post.rt); renderer.render(scene, cam);
      post.update(cam, camPx, post.rt.width, post.rt.height);
      W.lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, points: renderer.info.render.points };
      renderer.setRenderTarget(null); renderer.render(post.scene, post.cam);
      // suelta las texturas del post (la profundidad del RT no puede seguir enlazada mientras se pinta en él)
      for (let u = 0; u < 4; u++) { renderer.state.activeTexture(gl.TEXTURE0 + u); renderer.state.bindTexture(gl.TEXTURE_2D, null); }
      if (W.afterRender) W.afterRender();
      fpsN++; fpsT += dt;
      if (fpsT > 0.5) { W.fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
      const zn = W.zoneAt(player.x, player.z);
      if (zn !== lastZone && zoneEl) { lastZone = zn; zoneEl.textContent = (W.ZONES[zn] && W.ZONES[zn].name) || "Sendero"; }
    }
    // teletransporte (pruebas y depuración)
    W.teleport = function (x, z) { player.x = x; player.z = z; player.y = player.ground = W.heightAt(x, z); player.path = []; player.speed = 0; W.camSnap = true; };
    W.ready = true;
    frame();
  };
})();
