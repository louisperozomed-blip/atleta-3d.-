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
      // piezas fusionadas (árboles, titán, raíces): reciben sombra pero no la proyectan (día nublado; la
      // oscuridad bajo las copas la da el mapa de cobertura) → la pasada de sombras cuesta la mitad
      const s = c.solid.build(); if (s) addMesh(s, worldMat, false, true);
      const o = c.outline.build(); if (o) addMesh(o, outlineMat, false, false);
      const k = c.crys.build(); if (k) addMesh(k, crysMat, true, false);
    }
    // módulos instanciados (calaveras, huesos, cercas, tumbas, placas, terminales, hongos, flores...)
    const mstats = W.M.build(scene, worldMat, depthMat);
    stats.meshes += mstats.meshes; stats.tris += mstats.tris;
    stats.modules = mstats;
    const refl = (W.refl = W.makeReflections(scene));
    const ambient = (W.ambient = W.makeAmbient(scene, 1100));
    W.autoShafts(40);
    const shafts = (W.shafts = W.makeShafts(scene));
    const fx = (W.fx = W.makeFx(scene));
    stats.buildMs = Math.round(performance.now() - t0);
    W.stats = stats;

    // --- personaje -------------------------------------------------------------------
    const player = (W.player = new W.Player(0, -6.2));
    const character = (W.character = W.makeCharacter(scene, assets.tex, assets.meta, assets.ctex, assets.cmeta));
    player.ch = character;
    W.CMETA = assets.cmeta;
    if (W.initFeel) W.initFeel(scene);
    if (W.initCombat && assets.cmeta) W.initCombat(scene, assets);

    // --- cámara isométrica + post-proceso pixel art ----------------------------------
    const cam = (W.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200));
    const post = (W.post = W.makePost());
    let rh = 1;
    let vw = 1, vh = 1;
    // proyección (zoom del jugador × acercamiento suave de la cámara en reposo/carrera, feel.js)
    function setProj() {
      const a = vw / vh, zk = (W.FEEL && W.FEEL.zoomK) || 1, fh = (12 / (ui.zoom * zk)) * Math.max(1, (1 / a) / 1.3);   // en vertical se ve más alto
      cam.left = -fh * a / 2; cam.right = fh * a / 2; cam.top = fh / 2; cam.bottom = -fh / 2; cam.updateProjectionMatrix();
      W.viewHalf = Math.max(fh * a, fh) * 0.75 + 4;
    }
    W.setProj = setProj;
    function resize() {
      const px = PIX[ui.pi], w = Math.max(1, Math.floor(wrap.clientWidth * dpr / px)), h = Math.max(1, Math.floor(wrap.clientHeight * dpr / px));
      renderer.setSize(w, h, false); post.rt.setSize(w, h); rh = h; vw = w; vh = h;
      if (W.ambient) W.ambient.mat.uniforms.uPx.value = 1;
      setProj();
      const a = w / h, fh = cam.top - cam.bottom;
      const pxBtn = $("px"); if (pxBtn) pxBtn.textContent = "px" + px + (W.resAuto && W.resAuto.on ? " auto" : "");
    }
    W.resize = resize;
    // --- RESOLUCIÓN AUTOMÁTICA ---------------------------------------------------------------------------------
    // Empieza en px2 si el buffer cabe en ~0,42 MP (portátiles y monitores hasta ~1440×900), si no en px3 (móviles:
    // 1 píxel de juego por píxel CSS; nunca más grueso que antes). Cada 2 s mira los fps REALES: con ≥ 57 fps
    // sostenidos prueba un píxel más fino (hasta px2); por debajo de 45 pasa a uno más grueso (hasta px4) y no vuelve
    // a ese nivel; si el más grueso no sube los fps (p. ej. un móvil en ahorro, limitado a 30) vuelve y se queda.
    // El botón px pasa a manual (y tras px8 vuelve a «auto»). Las pruebas (navigator.webdriver) lo tienen apagado
    // salvo con #res=auto: sus capturas y tiempos no cambian.
    const AUTO = (W.resAuto = { on: !navigator.webdriver || /res=auto/.test(location.hash), min: 1, max: 3, bad: {}, acc: 0, n: 0, good: 0, warm: 0, prev: null, lock: false, fps: 0, log: [] });
    function autoInit() {
      const cw = wrap.clientWidth * dpr, ch = wrap.clientHeight * dpr;
      ui.pi = cw * ch / (PIX[1] * PIX[1]) <= 4.2e5 ? 1 : 2;
      Object.assign(AUTO, { bad: {}, acc: 0, n: 0, good: 0, warm: 0, prev: null, lock: false });
    }
    function autoSet(pi, why) { ui.pi = pi; AUTO.log.push(why + " → px" + PIX[pi]); resize(); }
    function autoStep(real) {
      if (!AUTO.on || W.skipRender || document.hidden || real > 0.25) return;   // (una pestaña que vuelve no cuenta)
      AUTO.acc += real; AUTO.n++;
      if (AUTO.acc < 2) return;
      const fps = AUTO.n / AUTO.acc; AUTO.acc = 0; AUTO.n = 0; AUTO.fps = fps;
      if (AUTO.warm++ < 1) return;                                // la primera ventana (carga) no cuenta
      if (AUTO.prev) {                                            // acaba de bajar: ¿sirvió?
        const P = AUTO.prev; AUTO.prev = null;
        if (fps < P.fps * 1.1) { AUTO.lock = true; autoSet(P.pi, "sin mejora (" + fps.toFixed(0) + " fps)"); return; }
      }
      if (fps < 45 && !AUTO.lock && ui.pi < AUTO.max) { AUTO.bad[ui.pi] = true; AUTO.prev = { pi: ui.pi, fps }; AUTO.good = 0; autoSet(ui.pi + 1, fps.toFixed(0) + " fps"); }
      else if (fps >= 57) { if (++AUTO.good >= 2 && ui.pi > AUTO.min && !AUTO.bad[ui.pi - 1]) { AUTO.good = 0; autoSet(ui.pi - 1, fps.toFixed(0) + " fps"); } }
      else AUTO.good = 0;
    }
    W.resAutoStep = autoStep;
    if (AUTO.on) autoInit();
    addEventListener("resize", resize);
    if (window.visualViewport) visualViewport.addEventListener("resize", resize);
    resize();

    const camT = new THREE.Vector3(player.x, player.y + 1.2, player.z);
    const tmp = new THREE.Vector3(), rv = new THREE.Vector3(), uv = new THREE.Vector3(), shk = new THREE.Vector3();
    const lightView = new THREE.Matrix4(), lv = new THREE.Vector3(), camPx = new THREE.Vector2(), _cp = new THREE.Vector3();

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
    on("px", () => {
      // auto → manual (siguiente tamaño); tras el último, vuelve a auto
      if (AUTO.on) { AUTO.on = false; ui.pi = (ui.pi + 1) % PIX.length; }
      else if (ui.pi === PIX.length - 1) { AUTO.on = true; autoInit(); }
      else ui.pi++;
      resize();
    });
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
      // a pocos fps el paso se recorta a 50 ms (el juego va más lento que el reloj): se guarda el tiempo real del
      // frame para que las pulsaciones se conviertan a tiempo de juego con el ritmo de verdad (W.pressTime)
      const real = clock.getDelta(), rdt = Math.min(0.05, real);
      if (!W.manual) { W.frameReal = real; step(rdt); autoStep(real); }
      requestAnimationFrame(frame);
    }
    W.tick = function (dt, n) { for (let i = 0; i < (n || 1); i++) step(dt); };
    function step(dt) {
      t += dt; W.U.uTime.value = t;
      // hitstop: el tiempo de juego se congela un instante (la cámara, la luz y las partículas siguen)
      const gdt = W.combatStep ? W.combatStep(dt) : dt;
      if (W.controlsUpdate) W.controlsUpdate(dt);
      if (W.animViewerStep) W.animViewerStep(dt);
      if (W.pf) W.pf.update(gdt);
      player.update(gdt);
      W.U.uPlayer.value.set(player.x, player.y, player.z);
      W.U.uPush.value += ((player.speed > 0.1 ? 1 : 0.3) - W.U.uPush.value) * Math.min(1, dt * 6);
      ui.theta += (ui.thetaT - ui.theta) * (1 - Math.exp(-dt * 7));
      if (Math.abs(ui.thetaT - ui.theta) < 1e-4) ui.theta = ui.thetaT;
      character.update(gdt, player, ui.theta, ui.thetaT);
      if (W.updateFoes) W.updateFoes(gdt, ui.theta, ui.thetaT);
      if (W.targetUpdate) W.targetUpdate(dt);                    // objetivo fijado (target.js)
      if (W.groupUpdate) W.groupUpdate(gdt);                     // turnos, pinza, multi-parry, indicador de borde (group.js)
      if (W.afterCharacter) W.afterCharacter(dt, t);
      if (W.combatAfter) W.combatAfter(dt);
      const beat = 0;
      if (refl) refl.mat.uniforms.uTheta.value = ui.theta;
      if (W.updateFeel) W.updateFeel(dt, t, camT, cam);
      // cámara: sigue con suavidad
      // seguimiento con un leve retraso y un poco de anticipación hacia donde camina (feel.js: F.on.cam)
      const ahead = W.FEEL && W.FEEL.on.cam ? Math.min(player.speed || 0, 4.5) * 0.22 : 0;
      tmp.set(player.x + Math.cos(player.heading) * ahead, player.y + 1.0, player.z + Math.sin(player.heading) * ahead);
      if (W.camFocus) tmp.set(W.camFocus.x, W.camFocus.y + 1.0, W.camFocus.z);   // visor de animaciones
      else if (W.camBias) W.camBias(tmp);                                          // sesgo hacia el objetivo (target.js)
      camT.lerp(tmp, W.camSnap ? 1 : 1 - Math.exp(-dt * (W.FEEL && W.FEEL.on.cam ? 3 : 4)));
      W.camSnap = false;
      // sacudida en la dirección del golpe (combat.js); se suma solo a la vista, no al seguimiento
      if (W.shakeOffset) W.shakeOffset(dt, shk); else shk.set(0, 0, 0);
      camT.add(shk);
      const EL = W.CAM_EL;
      cam.position.set(Math.sin(ui.theta) * Math.cos(EL), Math.sin(EL), Math.cos(ui.theta) * Math.cos(EL)).multiplyScalar(40).add(camT);
      cam.lookAt(camT); cam.updateMatrixWorld();
      const wpp = (W.wpp = (cam.top - cam.bottom) / rh);
      rv.setFromMatrixColumn(cam.matrixWorld, 0); uv.setFromMatrixColumn(cam.matrixWorld, 1);
      const tr = camT.dot(rv), tu = camT.dot(uv);
      cam.position.addScaledVector(rv, Math.round(tr / wpp) * wpp - tr).addScaledVector(uv, Math.round(tu / wpp) * wpp - tu);
      camPx.set(Math.round(tr / wpp), Math.round(tu / wpp));     // anclaje de los patrones del post al mundo
      camT.sub(shk);                                              // la sacudida también va ajustada a píxeles
      // recorte de copas: posición del personaje en píxeles del RT y su profundidad
      cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      _cp.set(player.x, player.y + 0.9, player.z).project(cam);
      W.U.uCutP.value.set((_cp.x * 0.5 + 0.5) * post.rt.width, (_cp.y * 0.5 + 0.5) * post.rt.height, _cp.z * 0.5 + 0.5);
      W.U.uCutR.value = W.CUTAWAY === false ? 0 : 2.4 / wpp;
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
      if (W.skipRender) return;                                   // pruebas: simular sin pintar
      // render a baja resolución + post
      renderer.info.reset();
      renderer.setRenderTarget(post.rt); renderer.render(scene, cam);
      post.update(cam, camPx, post.rt.width, post.rt.height);
      W.lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, points: renderer.info.render.points };
      renderer.setRenderTarget(null); renderer.render(post.scene, post.cam);
      // suelta las texturas del post (la profundidad del RT no puede seguir enlazada mientras se pinta en él)
      for (let u = 0; u < 4; u++) { renderer.state.activeTexture(gl.TEXTURE0 + u); renderer.state.bindTexture(gl.TEXTURE_2D, null); }
      if (W.renderForeground) W.renderForeground(renderer);      // ramas y lianas en primer plano (paralaje)
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
