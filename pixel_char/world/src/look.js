// look.js — dirección de arte "fantasía oscura": un mundo que murió hace mucho y la naturaleza se lo traga.
//
// - Mapa de cobertura (R = copas/techo que apagan sol y cielo; G = densidad de niebla), textura sobre el mapa
//   que leen los shaders del mundo (core.js: W.patchCover), el post-proceso y el personaje (W.coverAt).
// - Post-proceso de ilustración sobre el render a baja resolución: contornos de tinta por bordes de
//   profundidad y de normales (reconstruidas de la profundidad), sombreado de líneas en lo oscuro, niebla
//   por altura con jirones, viñeta, grano y posterizado a la paleta de la dirección de arte con dither.
//   Los patrones (líneas, dither) van anclados al mundo: se desplazan con la cámara píxel a píxel.
// - Partículas: hojas que caen, ceniza, esporas y luciérnagas que se apartan del personaje.
// - Rayos de luz tenues entre las copas (quads instanciados, una llamada).
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  // interruptores del look (antes/después y depuración)
  W.ART = {
    flags: { quant: 1, ink: 1, fog: 1, extra: 1 },       // extra = sombreado de líneas + viñeta + grano
    ink: [0.03, 0.047, 0.047],
    fogA: [0.36, 0.43, 0.41],        // niebla a cielo abierto (gris verdoso)
    fogB: [0.07, 0.1, 0.1],          // niebla bajo las copas (casi negra)
    fog: { top: 0.35, k: 1.6, wisp: 0.5 },     // top: altura de la capa sobre el suelo (u)
    edge: { sil: 0.22, crease: 0.82 },
  };

  // ---------------------------------------------------------------------------
  // Mapa de cobertura
  // ---------------------------------------------------------------------------
  const CR = 4;                                   // celdas por unidad
  W.cover = null;
  W.addCover = function (x, z, r, s) {            // copa / techo: disco suave de radio r y fuerza s (0..1)
    (W._coverSplats || (W._coverSplats = [])).push([x, z, r, s == null ? 1 : s]);
  };
  W.addFog = function (x, z, r, s) {              // niebla extra (charcas, cementerio...)
    (W._fogSplats || (W._fogSplats = [])).push([x, z, r, s == null ? 1 : s]);
  };
  function blur(a, n, rad) {
    const t = new Float32Array(n * n);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? t : a, dst = pass ? a : t;
      for (let i = 0; i < n; i++) {
        let acc = 0, cnt = 0;
        for (let k = -rad; k <= rad; k++) { const j = k; if (j >= 0 && j < n) { acc += pass ? src[j * n + i] : src[i * n + j]; cnt++; } }
        for (let j = 0; j < n; j++) {
          if (pass) dst[j * n + i] = acc / cnt; else dst[i * n + j] = acc / cnt;
          const out = j - rad, inn = j + rad + 1;
          if (out >= 0) { acc -= pass ? src[out * n + i] : src[i * n + out]; cnt--; }
          if (inn < n) { acc += pass ? src[inn * n + i] : src[i * n + inn]; cnt++; }
        }
      }
    }
  }
  W.buildCover = function () {
    const n = W.N * CR, HALF = W.HALF;
    const R = new Float32Array(n * n), G = new Float32Array(n * n), Hm = new Float32Array(n * n);
    const splat = (arr, list, max) => {
      for (const [x, z, r, s] of list || []) {
        const c0x = Math.max(0, Math.floor((x - r + HALF) * CR)), c1x = Math.min(n - 1, Math.ceil((x + r + HALF) * CR));
        const c0z = Math.max(0, Math.floor((z - r + HALF) * CR)), c1z = Math.min(n - 1, Math.ceil((z + r + HALF) * CR));
        for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
          const px = (cx + 0.5) / CR - HALF, pz = (cz + 0.5) / CR - HALF, d = Math.hypot(px - x, pz - z) / r;
          if (d >= 1) continue;
          const v = s * (1 - d * d);
          arr[cz * n + cx] = Math.min(max, arr[cz * n + cx] + v);   // fila = z, columna = x (u = x, v = z)
        }
      }
    };
    splat(R, W._coverSplats, 1.3);
    // niebla: más densa en lo bajo, sobre el agua y donde se pida (charcas, cementerio)
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      const x = (cx + 0.5) / CR - HALF, z = (cz + 0.5) / CR - HALF, h = W.heightAt(x, z), k = W.kindAt(x, z);
      let g = 0.08 + W.clamp((1.6 - h) * 0.5, 0, 0.5);
      if (k === W.K.WATER) g += 0.35; else if (k === W.K.PUDDLE) g += 0.15;
      G[cz * n + cx] = g;
      Hm[cz * n + cx] = k === W.K.WATER ? 0.78 : h;       // altura del suelo (la niebla va sobre él)
    }
    splat(G, W._fogSplats, 1.6);
    blur(R, n, 3); blur(G, n, 6); blur(Hm, n, 2);
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      data[i * 4] = Math.round(W.clamp(R[i], 0, 1) * 255);
      data[i * 4 + 1] = Math.round(W.clamp(G[i] / 1.6, 0, 1) * 255);
      data[i * 4 + 2] = Math.round(W.clamp(Hm[i] / 6, 0, 1) * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    W.cover = { n, R, G, tex };
    W.U.uCover.value = tex; W.U.uHalf.value = HALF;
    return W.cover;
  };
  // lectura en CPU (bilineal): {c: copas 0..1, f: niebla 0..1.6}
  W.coverAt = function (x, z) {
    const C = W.cover; if (!C) return { c: 0, f: 0 };
    const n = C.n, fx = W.clamp((x + W.HALF) * CR - 0.5, 0, n - 1.001), fz = W.clamp((z + W.HALF) * CR - 0.5, 0, n - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
    const at = (A) => { const a = A[iz * n + ix], b = A[iz * n + ix + 1], c = A[(iz + 1) * n + ix], d = A[(iz + 1) * n + ix + 1];
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v; };
    return { c: W.clamp(at(C.R), 0, 1), f: at(C.G) };
  };

  // ---------------------------------------------------------------------------
  // Post-proceso de ilustración
  // ---------------------------------------------------------------------------
  W.makePost = function () {
    const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    rt.depthTexture = new THREE.DepthTexture(4, 4);
    rt.depthTexture.type = THREE.UnsignedIntType;
    const pal = (W.PALETTE || [[0, 0, 0], [1, 1, 1]]).map((c) => new THREE.Vector3(c[0], c[1], c[2]));
    const A = W.ART;
    const uniforms = {
      tDiff: { value: rt.texture }, tDepth: { value: rt.depthTexture }, uCover: W.U.uCover, uHalf: W.U.uHalf,
      uRes: { value: new THREE.Vector2(4, 4) }, uCamPx: { value: new THREE.Vector2() },
      uOrtho: { value: new THREE.Vector4(-1, 1, -1, 1) }, uNF: { value: new THREE.Vector2(0.1, 200) },
      uCamWorld: { value: new THREE.Matrix4() }, uTime: W.U.uTime,
      uPal: { value: pal }, uInk: { value: new THREE.Vector3().fromArray(A.ink) },
      uFogA: { value: new THREE.Vector3().fromArray(A.fogA) }, uFogB: { value: new THREE.Vector3().fromArray(A.fogB) },
      uFog: { value: new THREE.Vector4(A.fog.top, A.fog.k, A.fog.wisp, 0) },
      uEdge: { value: new THREE.Vector2(A.edge.sil, A.edge.crease) },
      uFlags: { value: new THREE.Vector4(1, 1, 1, 1) },
      uPlayer: { value: new THREE.Vector4(0, -99, 0, 0) },       // xyz + radio del hueco en la niebla (etapa 3)
      uWpp: { value: 0.03 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: `
        #define NP ${pal.length}
        uniform sampler2D tDiff, tDepth, uCover;
        uniform vec2 uRes, uCamPx, uNF, uEdge;
        uniform vec4 uOrtho, uFog, uFlags, uPlayer;
        uniform mat4 uCamWorld;
        uniform float uTime, uHalf, uWpp;
        uniform vec3 uPal[NP];
        uniform vec3 uInk, uFogA, uFogB;
        varying vec2 vUv;
        float b2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
        float bayer4(vec2 a){ return b2(.5 * a) * .25 + b2(a); }
        float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        // posición en espacio de vista (cámara ortográfica: la profundidad es lineal)
        vec3 VP(vec2 uv){
          float d = texture2D(tDepth, uv).r;
          return vec3(mix(uOrtho.x, uOrtho.y, uv.x), mix(uOrtho.z, uOrtho.w, uv.y), -(uNF.x + d * (uNF.y - uNF.x)));
        }
        // normal reconstruida: en cada eje, la diferencia del lado más continuo (no cruza siluetas)
        vec3 NRM(vec3 c, vec3 l, vec3 r, vec3 u, vec3 d){
          vec3 dx = abs(r.z - c.z) < abs(c.z - l.z) ? r - c : c - l;
          vec3 dy = abs(u.z - c.z) < abs(c.z - d.z) ? u - c : c - d;
          return normalize(cross(dx, dy));
        }
        vec3 quant(vec3 c, vec2 q){
          vec3 c1 = uPal[0], c2 = uPal[0]; float d1 = 1e9, d2 = 1e9;
          for (int i = 0; i < NP; i++) {
            vec3 e = (uPal[i] - c) * vec3(1.0, 1.3, 0.8);
            float d = dot(e, e);
            if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = uPal[i]; } else if (d < d2) { d2 = d; c2 = uPal[i]; }
          }
          vec3 g = (c1 - c2) * vec3(1.0, 1.3, 0.8);
          float t = sqrt(d1) / (sqrt(d1) + sqrt(d2) + 1e-5);
          return (dot(g, g) < 0.022 && bayer4(q) < t) ? c2 : c1;   // dither solo entre tonos vecinos
        }
        void main(){
          vec2 e = 1.0 / uRes, uv = vUv;
          vec2 q = floor(gl_FragCoord.xy) + uCamPx;              // píxel anclado al mundo
          vec3 col = texture2D(tDiff, uv).rgb;
          float dC = texture2D(tDepth, uv).r;
          float sky = step(0.99999, dC);
          vec3 c = VP(uv), l = VP(uv - vec2(e.x, 0.)), r = VP(uv + vec2(e.x, 0.)), u = VP(uv + vec2(0., e.y)), d = VP(uv - vec2(0., e.y));
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          // --- sombreado de líneas en lo oscuro (como la tinta de la referencia 01) ---------------------
          if (uFlags.w > 0.5 && sky < 0.5) {
            float h1 = step(mod(q.x + q.y, 4.0), 0.5), h2 = step(mod(q.x - q.y + 2.0, 4.0), 0.5);
            float k1 = 1.0 - smoothstep(0.075, 0.15, lum), k2 = 1.0 - smoothstep(0.03, 0.075, lum);
            col = mix(col, uInk, clamp(h1 * k1 + h2 * k2, 0.0, 1.0) * 0.75);
          }
          // --- tinta: siluetas (salto de profundidad) y pliegues (cambio de normal) ----------------------
          if (uFlags.y > 0.5 && sky < 0.5) {
            float zc = -c.z, lapx = -l.z - r.z - 2.0 * zc, lapy = -u.z - d.z - 2.0 * zc;
            float sil = step(uEdge.x, max(lapx, lapy));          // vecinos más lejos: este píxel es el borde cercano
            vec3 r2 = VP(uv + vec2(2. * e.x, 0.)), ru = VP(uv + e), rd = VP(uv + vec2(e.x, -e.y));
            vec3 d2 = VP(uv - vec2(0., 2. * e.y)), dl = VP(uv - e);
            vec3 nC = NRM(c, l, r, u, d), nR = NRM(r, c, r2, ru, rd), nD = NRM(d, dl, rd, c, d2);
            float farR = step(abs(r.z - c.z), 0.6), farD = step(abs(d.z - c.z), 0.6);   // mismo objeto
            float cr = max(step(dot(nC, nR), uEdge.y) * farR, step(dot(nC, nD), uEdge.y) * farD);
            col = mix(col, uInk, max(sil, cr * 0.6));
          }
          // --- niebla por altura, con jirones que se mueven -------------------------------------------------
          vec3 wp = (uCamWorld * vec4(c, 1.0)).xyz;
          if (uFlags.z > 0.5) {
            vec4 cov = texture2D(uCover, (wp.xz + uHalf) / (2.0 * uHalf));
            float dens = cov.g * 1.6;
            float wisp = vnoise(wp.xz * 0.32 + vec2(uTime * 0.06, uTime * 0.035)) * 0.65 + vnoise(wp.xz * 0.9 - vec2(uTime * 0.11, -uTime * 0.05)) * 0.35;
            float top = cov.b * 6.0 + uFog.x + dens * 0.55 + (wisp - 0.5) * uFog.z;   // capa sobre el suelo local
            // hueco alrededor del personaje (etapa 3): la niebla se abre y se arremolina
            float hole = uPlayer.w > 0.0 ? smoothstep(uPlayer.w, uPlayer.w * 0.35, length(wp.xz - uPlayer.xz) * (0.85 + 0.3 * wisp)) : 0.0;
            float fa = 1.0 - exp(-uFog.y * max(0.0, top - wp.y) * (0.25 + dens));
            fa *= 1.0 - hole * 0.85;
            fa = max(fa, sky);
            vec3 fcol = mix(uFogA, uFogB, clamp(cov.r * 1.1, 0.0, 1.0)) * (0.9 + 0.2 * wisp);
            col = mix(col, fcol, clamp(fa, 0.0, 0.92 + 0.08 * sky));
          }
          if (uFlags.w > 0.5) {
            vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
            col *= 1.0 - 0.45 * smoothstep(0.3, 0.85, length(p) * 1.25);          // viñeta
            col += (hash(q + floor(uTime * 12.0) * vec2(37.0, 17.0)) - 0.5) * 0.014; // grano
          }
          if (uFlags.x > 0.5) col = quant(clamp(col, 0.0, 1.0), q);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    // cada frame: cámara y anclaje de patrones
    function update(camera, camPx, w, h) {
      uniforms.uRes.value.set(w, h);
      uniforms.uOrtho.value.set(camera.left / camera.zoom, camera.right / camera.zoom, camera.bottom / camera.zoom, camera.top / camera.zoom);
      uniforms.uNF.value.set(camera.near, camera.far);
      uniforms.uCamWorld.value.copy(camera.matrixWorld);
      uniforms.uCamPx.value.copy(camPx);
      const F = W.ART.flags;
      uniforms.uFlags.value.set(F.quant, F.ink, F.fog, F.extra);
    }
    return { rt, mat, scene, cam, uniforms, update };
  };

  // ---------------------------------------------------------------------------
  // Partículas ambientales: 0 hoja, 1 ceniza, 2 espora, 3 luciérnaga
  // ---------------------------------------------------------------------------
  W.makeAmbient = function (scene, n) {
    const R = W.rng(31), g = new THREE.BufferGeometry();
    const P = new Float32Array(n * 3), T = new Float32Array(n), S = new Float32Array(n), V = new Float32Array(n * 3);
    const mix = [0.3, 0.3, 0.2, 0.2];   // proporción de cada tipo
    for (let i = 0; i < n; i++) {
      const u = R(); let t = 0, a = 0; for (; t < 3; t++) { a += mix[t]; if (u < a) break; }
      T[i] = t; S[i] = R();
      P[i * 3 + 1] = -100;              // se colocan al empezar (junto a la cámara)
    }
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("aType", new THREE.BufferAttribute(T, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(S, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: W.U.uTime, uPx: { value: 1 } },
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aType, aSeed; uniform float uTime, uPx; varying float vT, vS, vA;
        void main(){ vT = aType; vS = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float sz = aType < 0.5 ? 3.0 : aType < 1.5 ? 1.0 : aType < 2.5 ? 1.5 : 3.0;
          gl_PointSize = sz * uPx;
          // luciérnagas: parpadeo lento; esporas: pulso
          vA = aType > 2.5 ? pow(0.5 + 0.5 * sin(uTime * (1.3 + aSeed) + aSeed * 40.0), 3.0) : aType > 1.5 ? 0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 30.0) : 1.0;
          if (position.y < -50.0) gl_PointSize = 0.0; }`,
      fragmentShader: `uniform float uTime; varying float vT, vS, vA;
        void main(){ vec2 p = gl_PointCoord - 0.5; vec3 c; float a;
          if (vT < 0.5) {            // hoja: rombo que gira
            float an = uTime * (1.5 + vS * 2.0) + vS * 20.0; float cs = cos(an), sn = sin(an);
            vec2 r = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
            if (abs(r.x) * 2.2 + abs(r.y) > 0.5) discard;
            c = mix(vec3(0.55, 0.3, 0.2), vec3(0.3, 0.38, 0.3), step(0.55, vS)); a = 0.95;
          } else if (vT < 1.5) { c = vec3(0.6, 0.63, 0.6); a = 0.7; }
          else if (vT < 2.5) { c = mix(vec3(0.3, 0.9, 1.0), vec3(0.5, 1.0, 0.6), step(0.5, vS)); a = 0.85 * vA; }
          else { float r = length(p) * 2.0; if (r > 1.0) discard;
            c = mix(vec3(1.0, 0.92, 0.55), vec3(0.95, 0.7, 0.3), r); a = vA * (1.0 - r * r); }
          gl_FragColor = vec4(c, a); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false; pts.renderOrder = 3;
    scene.add(pts);
    return { pts, P, T, S, V, n, mat, init: false };
  };
  // Reparte partículas en la vista; se reponen cuando caen o se alejan
  function respawn(A, i, cx, cz, R, anyHeight) {
    const t = A.T[i];
    for (let k = 0; k < 6; k++) {
      const x = cx + (Math.random() * 2 - 1) * R, z = cz + (Math.random() * 2 - 1) * R;
      const g = W.heightAt(x, z), cv = W.coverAt(x, z);
      // hojas: donde hay copas; esporas: sobre agua y en zonas húmedas; luciérnagas: en lo oscuro
      if (t === 0 && cv.c < 0.25 && Math.random() < 0.8) continue;
      if (t === 2 && cv.f < 0.55 && Math.random() < 0.85) continue;
      if (t === 3 && cv.c < 0.3 && Math.random() < 0.7) continue;
      const P = A.P, j = i * 3;
      P[j] = x; P[j + 2] = z;
      P[j + 1] = t === 0 ? g + (anyHeight ? Math.random() * 4.5 : 3.5 + Math.random() * 1.5)
               : t === 1 ? g + (anyHeight ? Math.random() * 5 : 4.5 + Math.random())
               : t === 2 ? g + Math.random() * (anyHeight ? 2.5 : 0.3)
               : g + 0.3 + Math.random() * 1.6;
      A.V[j] = A.V[j + 1] = A.V[j + 2] = 0;
      return;
    }
    A.P[i * 3 + 1] = -100;
  }
  W.updateAmbient = function (A, dt, t, player, cx, cz, viewR) {
    const P = A.P, T = A.T, S = A.S, V = A.V, R = viewR;
    if (!A.init) { for (let i = 0; i < A.n; i++) respawn(A, i, cx, cz, R, true); A.init = true; }
    const px = player.x, py = player.y + 0.8, pz = player.z, spd = player.speed || 0;
    for (let i = 0; i < A.n; i++) {
      const j = i * 3, ty = T[i], s = S[i];
      if (P[j + 1] < -50 || Math.abs(P[j] - cx) > R * 1.15 || Math.abs(P[j + 2] - cz) > R * 1.15) { respawn(A, i, cx, cz, R, false); continue; }
      let vx = V[j], vy = V[j + 1], vz = V[j + 2];
      const x = P[j], y = P[j + 1], z = P[j + 2];
      if (ty === 0) {            // hoja: cae meciéndose
        vx = Math.sin(t * (1.1 + s) + s * 9) * 0.35 + 0.12; vz = Math.cos(t * (0.9 + s) + s * 5) * 0.25; vy = -0.32 - 0.2 * s;
      } else if (ty === 1) {     // ceniza: deriva lenta
        vx = 0.08 + Math.sin(t * 0.3 + s * 20) * 0.06; vz = 0.05; vy = -0.07 - 0.05 * s;
      } else if (ty === 2) {     // espora: sube despacio
        vx = Math.sin(t * 0.7 + s * 30) * 0.08; vz = Math.cos(t * 0.6 + s * 12) * 0.08; vy = 0.1 + 0.08 * s;
      } else {                   // luciérnaga: vaga
        vx += (Math.sin(t * 0.8 + s * 50) * 0.5 - vx) * dt * 1.5; vz += (Math.cos(t * 0.7 + s * 70) * 0.5 - vz) * dt * 1.5;
        vy = Math.sin(t * 1.3 + s * 11) * 0.15;
      }
      // se apartan del personaje (más las luciérnagas, y más si corre)
      const dx = x - px, dy = y - py, dz = z - pz, d2 = dx * dx + dy * dy * 0.5 + dz * dz;
      const rr = ty === 3 ? 2.2 : 1.1;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) + 1e-3, k = (1 - d / rr) * (ty === 3 ? 3.5 : 1.8) * (1 + spd * 0.3);
        vx += dx / d * k; vz += dz / d * k; vy += (ty === 3 ? 0.8 : 0.4) * k * 0.5;
      }
      V[j] = vx; V[j + 1] = vy; V[j + 2] = vz;
      P[j] = x + vx * dt; P[j + 1] = y + vy * dt; P[j + 2] = z + vz * dt;
      const g = W.heightAt(P[j], P[j + 2]);
      if (ty === 0 || ty === 1) { if (P[j + 1] < g + 0.02) respawn(A, i, cx, cz, R, false); }
      else if (ty === 2) { if (P[j + 1] > g + 3.2) respawn(A, i, cx, cz, R, false); }
      else if (P[j + 1] < g + 0.2) { P[j + 1] = g + 0.2; V[j + 1] = Math.abs(vy); }
    }
    A.pts.geometry.attributes.position.needsUpdate = true;
  };

  // ---------------------------------------------------------------------------
  // Rayos de luz entre las copas: quads orientados al sol y girados hacia la cámara
  // ---------------------------------------------------------------------------
  W.shaftSpots = [];
  W.addShaft = function (x, y, z, len, w) { W.shaftSpots.push([x, y, z, len, w]); };
  W.makeShafts = function (scene) {
    const n = W.shaftSpots.length;
    if (!n) return null;
    const base = new THREE.PlaneGeometry(1, 1, 1, 4);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const C = new Float32Array(n * 3), D = new Float32Array(n * 3);
    W.shaftSpots.forEach(([x, y, z, len, w], i) => { C.set([x, y, z], i * 3); D.set([len, w, Math.random() * 6.28], i * 3); });
    g.setAttribute("aC", new THREE.InstancedBufferAttribute(C, 3));
    g.setAttribute("aD", new THREE.InstancedBufferAttribute(D, 3));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: W.U.uTime, uSun: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3() }, uI: { value: 0.42 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec3 aC, aD; uniform vec3 uSun, uCamDir; uniform float uTime; varying vec2 vUv; varying float vPh;
        void main(){ vUv = uv; vPh = aD.z;
          vec3 S = -normalize(uSun), side = normalize(cross(S, uCamDir));
          vec3 p = aC + S * (0.5 - uv.y) * aD.x + side * position.x * aD.y * (1.0 + 0.6 * (0.5 - uv.y));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uTime, uI; varying vec2 vUv; varying float vPh;
        void main(){ float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float fl = 0.65 + 0.35 * sin(uTime * 0.4 + vPh) * sin(uTime * 0.23 + vPh * 2.0);
          float streak = 0.7 + 0.3 * sin(vUv.x * 18.0 + vPh * 5.0);
          gl_FragColor = vec4(vec3(0.75, 0.85, 0.8) * edge * along * fl * streak * uI, 1.0); }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, mat };
  };
})();
// Sitios para los rayos: claros pequeños junto a copas densas (la luz se cuela entre ellas)
(function () {
  const W = window.W;
  W.autoShafts = function (count) {
    const R = W.rng(71), S = W.SUN_DIR, out = [];
    for (let k = 0; k < 4000 && out.length < count; k++) {
      const x = (R() * 2 - 1) * (W.HALF - 6), z = (R() * 2 - 1) * (W.HALF - 6);
      const c = W.coverAt(x, z).c;
      if (c < 0.12 || c > 0.6) continue;
      let dense = false;
      for (let a = 0; a < 6 && !dense; a++) if (W.coverAt(x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2).c > 0.75) dense = true;
      if (!dense || out.some((o) => Math.hypot(o[0] - x, o[2] - z) < 3)) continue;
      const len = 5 + R() * 2, g = W.heightAt(x, z);
      out.push([x + S.x * len * 0.5, g + S.y * len * 0.5, z + S.z * len * 0.5, len, 1.2 + R() * 1.2]);
    }
    out.forEach((o) => W.addShaft(...o));
    return out.length;
  };
})();
