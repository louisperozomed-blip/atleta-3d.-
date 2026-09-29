// terrain.js — mapa de alturas por baldosas, zonas, senderos, agua y rejilla de navegación.
// La generación (W.generateTerrain) no usa THREE: se puede ejecutar en Node para validar
// conectividad; W.buildTerrainMeshes crea la geometría fusionada por chunks.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const { clamp, smoothstep, fbm, vnoise, hash2 } = W;

  W.N = 80;              // baldosas por lado (la referencia tenía 30 -> ~7x de superficie)
  W.HALF = W.N / 2;
  W.STEP = 0.5;          // altura de un escalón
  W.MAX_STEP = 0.5;      // desnivel máximo que se puede subir andando

  // Tipos de baldosa
  const K = (W.K = { GRASS: 0, PATH: 1, WATER: 2, PUDDLE: 3, PLAZA: 4, STONE: 5, CRYSTAL: 6, BORDER: 7 });

  // ---------------------------------------------------------------------------
  // Zonas y senderos
  // ---------------------------------------------------------------------------
  W.ZONES = {
    heart:   { x: 0,   z: 0,   r: 9,  name: "Claro del árbol-corazón" },
    roots:   { x: -23, z: -21, r: 13, name: "Bosque de raíces" },
    crystal: { x: 23,  z: -21, r: 11, name: "Campo de cristales" },
    ponds:   { x: 23,  z: 22,  r: 12, name: "Charcas" },
    ruins:   { x: -22, z: 23,  r: 11, name: "Ruinas" },
  };
  const Z = W.ZONES;
  // Polilíneas de control (se suavizan con Catmull-Rom). h = altura de sendero en cada punto.
  W.PATHS = [
    // radiales desde el claro
    { pts: [[0, -6.2], [-6, -11], [-13, -15], [-20, -19]], h: [1, 1, 1.5, 1.5] },
    { pts: [[0, -6.2], [7, -10], [13, -15], [19, -19]], h: [1, 1, 1.5, 2.5] },
    { pts: [[8.5, 0], [13, 6], [17, 14], [21, 19]], h: [1, 1, 1, 1] },
    { pts: [[-8.5, 0], [-12, 7], [-16, 15], [-20, 21]], h: [1, 1, 1.5, 2.5] },
    // anillo exterior entre zonas
    { pts: [[-17, -24], [-6, -29], [6, -29], [17, -25]], h: [1.5, 1.5, 1.5, 2.5] },
    { pts: [[28, -13], [31, -3], [31, 7], [27, 15]], h: [2.5, 1.5, 1, 1] },
    { pts: [[17, 28], [6, 31], [-6, 31], [-15, 28]], h: [1, 1, 1.5, 1.5] },
    { pts: [[-28, 16], [-31, 6], [-31, -5], [-28, -13]], h: [1.5, 1.5, 1.5, 1.5] },
    // senderos internos de las zonas
    { pts: [[-20, -19], [-25, -24], [-29, -20], [-26, -15], [-20, -19]], h: [1.5, 1.5, 1.5, 1.5, 1.5] },
    { pts: [[19, -19], [24, -22], [28, -18], [28, -13]], h: [2.5, 2.5, 2.5, 2.5] },
    { pts: [[21, 19], [25, 24], [20, 27], [17, 28]], h: [1, 1, 1, 1] },
    { pts: [[-20, 21], [-23, 25], [-19, 28], [-15, 28]], h: [2.5, 3, 2, 1.5] },
    { pts: [[-17, -24], [-20, -19]], h: [1.5, 1.5] },
    { pts: [[-28, 16], [-24, 18], [-20, 21]], h: [1.5, 2, 2.5] },
  ];
  // Elipse alrededor del árbol-corazón (como en la referencia)
  const EA = 8.5, EB = 6.2;

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  // Muestras densas de cada sendero: [x, z, h]
  function samplePaths() {
    const out = [];
    for (const P of W.PATHS) {
      const pts = P.pts, hs = P.h, s = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
        const len = Math.hypot(c[0] - b[0], c[1] - b[1]);
        const n = Math.max(2, Math.ceil(len * 3));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          // la altura sube en la última parte del tramo (escalones al entrar en la zona)
          const ht = smoothstep(0.25, 0.9, t);
          s.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t), hs[i] + (hs[i + 1] - hs[i]) * ht]);
        }
      }
      const e = pts[pts.length - 1];
      s.push([e[0], e[1], hs[hs.length - 1]]);
      out.push(s);
    }
    // elipse
    const s = [];
    for (let k = 0; k <= 160; k++) { const u = (k / 160) * Math.PI * 2; s.push([EA * Math.cos(u), EB * Math.sin(u), 1]); }
    out.push(s);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Generación
  // ---------------------------------------------------------------------------
  W.generateTerrain = function (seed) {
    const N = W.N, HALF = W.HALF;
    const R = W.rng(seed || 1337);
    const H = new Float32Array(N * N), kind = new Uint8Array(N * N);
    const pdist = new Float32Array(N * N), ph = new Float32Array(N * N);
    const zoneId = new Uint8Array(N * N);   // 0 heart 1 roots 2 crystal 3 ponds 4 ruins 5 fuera
    const col = new Uint32Array(N * N);
    const paths = samplePaths();
    W.pathSamples = paths;
    const zoneKeys = ["heart", "roots", "crystal", "ponds", "ruins"];
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) {
      const x = ix - HALF + 0.5, z = iz - HALF + 0.5, i = ix * N + iz;
      // distancia al sendero más cercano y su altura
      let best = 1e9, bh = 1;
      for (const s of paths) for (let k = 0; k < s.length - 1; k++) {
        const ax = s[k][0], az = s[k][1], bx = s[k + 1][0], bz = s[k + 1][1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < best) { best = d; bh = s[k][2] + (s[k + 1][2] - s[k][2]) * t; }
      }
      pdist[i] = best; ph[i] = bh;
      // zona dominante
      let zi = 5, zb = 1e9;
      zoneKeys.forEach((k, j) => { const q = Z[k], d = Math.hypot(x - q.x, z - q.z) / q.r; if (d < 1 && d < zb) { zb = d; zi = j; } });
      zoneId[i] = zi;
    }
    W.zoneKeys = zoneKeys;
    const greens = [0x2c4a3c, 0x35604a, 0x3f7654, 0x4d8a5c, 0x5f9a62, 0x6aa66a];
    const nz = (x, z) => Math.sin(x * 0.33 + 1.3) * Math.cos(z * 0.29 - 0.7) * 1.3 + Math.sin((x + z) * 0.17) * 0.9 +
      Math.sin(x * 0.87 + z * 0.61) * 0.3 + Math.cos(z * 0.73 - x * 0.21) * 0.25;
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) {
      const x = ix - HALF + 0.5, z = iz - HALF + 0.5, i = ix * N + iz;
      const d = pdist[i], zi = zoneId[i];
      const edge = Math.max(Math.abs(x), Math.abs(z));
      let h, k = K.GRASS, c;
      const noise = nz(x, z);
      // terreno "natural" según zona
      const q = zi < 5 ? Z[zoneKeys[zi]] : null;
      const rz = q ? Math.hypot(x - q.x, z - q.z) : 99;
      if (zi === 0) {                         // claro: ondulado suave
        h = 1 + Math.max(0, noise) * 0.6;
        if (rz < 2.4) { h = 1.5; k = K.PLAZA; }
      } else if (zi === 1) {                  // raíces: colinas escalonadas
        h = 1.5 + noise * 1.3;
      } else if (zi === 2) {                  // cristales: meseta con borde en acantilado
        h = rz < q.r - 1.5 ? 2.5 + Math.max(0, noise) * 0.4 : 1.5 + noise * 0.3;
        if (rz < q.r - 1.5) k = K.CRYSTAL;
      } else if (zi === 3) {                  // charcas: bajo, con lagunas
        h = 1 + Math.max(0, noise) * 0.4;
        const pn = fbm(x * 0.22 + 3, z * 0.22 - 1);
        if (pn > 0.47 && d > 2.0 && rz < q.r) { h = 0.5; k = K.WATER; }
      } else if (zi === 4) {                  // ruinas: terrazas cuadradas
        const cheb = Math.max(Math.abs(x - q.x), Math.abs(z - q.z));
        const lvl = clamp(Math.floor((q.r - 1 - cheb) / 2.0), 0, 3);
        h = 1.5 + lvl * 0.5;
        // plataformas elevadas (+1 m, sin escalera) en las esquinas de las ruinas
        if (cheb > 3 && Math.abs(Math.abs(x - q.x) - Math.abs(z - q.z)) < 2.2 && d > 2.2) h += 1;
        k = K.STONE;
      } else {                                // entre zonas
        h = 1.5 + noise * 0.7;
      }
      // mesetas: plataformas altas con borde en acantilado, lejos de los senderos
      if (zi !== 2 && zi !== 4 && zi !== 3 && k === K.GRASS) {
        const m = fbm(x * 0.11 + 11, z * 0.11 - 4);
        if (m > 0.6 && d > 3.2 && rz > 3) h += 1.5 + (m > 0.68 ? 1 : 0);
      }
      // borde del mundo: acantilados altos
      if (edge > HALF - 4) { h = 3.5 + (edge - (HALF - 4)) * 0.6 + Math.abs(noise) * 0.5; k = K.BORDER; }
      // senderos: altura guiada; mezcla suave hacia el sendero
      const pathH = Math.round(ph[i] * 2) / 2;
      if (d < 1.15 && k !== K.BORDER) {
        h = pathH; k = k === K.PLAZA ? K.PLAZA : (k === K.STONE ? K.STONE : K.PATH);
      } else if (d < 3.0 && k !== K.WATER && k !== K.BORDER && h < pathH + 1.4) {
        const w = smoothstep(1.15, 3.0, d);
        h = pathH + (h - pathH) * w;
      }
      if (k !== K.WATER) h = Math.max(1, Math.round(h * 2) / 2);
      // charquitos poco profundos (transitables) junto a los senderos de las charcas
      if (zi === 3 && k !== K.WATER && d < 2.6 && d > 0.6) {
        const pn2 = fbm(x * 0.5 - 7, z * 0.5 + 2);
        if (pn2 > 0.55) k = K.PUDDLE;
      }
      if (zi === 0 && d < 1.15 && k !== K.PLAZA) k = K.PATH;
      H[i] = h; kind[i] = k;
      // color
      const r = R();
      switch (k) {
        case K.PATH: c = r < 0.45 ? 0x5d6b6a : r < 0.8 ? 0x66756f : 0x4f6a58; break;
        case K.PLAZA: c = r < 0.5 ? 0x3a4a44 : 0x44584c; break;
        case K.WATER: c = 0x1d2f35; break;
        case K.PUDDLE: c = 0x2f4d52; break;
        case K.STONE: c = d < 1.15 ? (r < 0.5 ? 0x6b7480 : 0x747d88) : (r < 0.3 ? 0x3f7a4c : r < 0.65 ? 0x5a6470 : 0x646e7a); break;
        case K.CRYSTAL: c = r < 0.35 ? 0x43386a : r < 0.6 ? 0x383a60 : r < 0.85 ? 0x35604a : 0x5c5890; break;
        case K.BORDER: c = r < 0.5 ? 0x243a33 : 0x2c4a3c; break;
        default: c = greens[Math.min(5, Math.floor((h - 1) * 1.6))]; if (r < 0.07) c = 0x4a3a5e;
      }
      col[i] = c;
    }
    W.T = { H, kind, pdist, zoneId, col };
    W.buildNav();
    return W.T;
  };

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------
  W.tileIndex = function (x, z) {
    const ix = Math.floor(x + W.HALF), iz = Math.floor(z + W.HALF);
    if (ix < 0 || iz < 0 || ix >= W.N || iz >= W.N) return -1;
    return ix * W.N + iz;
  };
  W.heightAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? 5 : W.T.H[i]; };
  W.kindAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? K.BORDER : W.T.kind[i]; };
  W.zoneAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? "fuera" : (W.zoneKeys[W.T.zoneId[i]] || "sendero"); };
  W.pathDistAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? 99 : W.T.pdist[i]; };

  // ---------------------------------------------------------------------------
  // Rejilla de navegación (celdas de 0.5): bloqueos por agua, borde y obstáculos.
  // Los desniveles se comprueban entre celdas vecinas (|Δh| <= MAX_STEP).
  // ---------------------------------------------------------------------------
  W.NAV_RES = 2;                          // celdas por baldosa
  W.buildNav = function () {
    const n = W.N * W.NAV_RES;
    W.NAV = { n, blocked: new Uint8Array(n * n) };
    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) {
      const x = (cx + 0.5) / W.NAV_RES - W.HALF, z = (cz + 0.5) / W.NAV_RES - W.HALF;
      const k = W.kindAt(x, z);
      if (k === K.WATER || k === K.BORDER) W.NAV.blocked[cx * n + cz] = 1;
    }
  };
  // Obstáculo circular (tronco, roca, cristal...) en la rejilla de navegación
  W.obstacles = [];
  W.addObstacle = function (x, z, r, tag) {
    W.obstacles.push({ x, z, r, tag });
    const n = W.NAV.n, res = W.NAV_RES;
    const c0x = Math.floor((x - r + W.HALF) * res), c1x = Math.floor((x + r + W.HALF) * res);
    const c0z = Math.floor((z - r + W.HALF) * res), c1z = Math.floor((z + r + W.HALF) * res);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
      const px = (cx + 0.5) / res - W.HALF, pz = (cz + 0.5) / res - W.HALF;
      if (Math.hypot(px - x, pz - z) < r + 0.18) W.NAV.blocked[cx * n + cz] = 1;
    }
  };
  // ¿Está libre un punto? (celda no bloqueada)
  W.cellFree = function (x, z) {
    const n = W.NAV.n, cx = Math.floor((x + W.HALF) * W.NAV_RES), cz = Math.floor((z + W.HALF) * W.NAV_RES);
    if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
    return !W.NAV.blocked[cx * n + cz];
  };
  // ¿Se puede pasar de (x0,z0) a (x1,z1)? (celda libre y desnivel <= MAX_STEP)
  W.canStep = function (x0, z0, x1, z1) {
    if (!W.cellFree(x1, z1)) return false;
    return Math.abs(W.heightAt(x1, z1) - W.heightAt(x0, z0)) <= W.MAX_STEP + 1e-3;
  };

  // ---------------------------------------------------------------------------
  // Malla del terreno por chunks: caras superiores + laterales expuestas
  // ---------------------------------------------------------------------------
  W.buildTerrainMeshes = function () {
    const N = W.N, HALF = W.HALF, { H, kind, col } = W.T;
    const C = new THREE.Color(), S = new THREE.Color();
    const R = W.rng(77);
    const byChunk = new Map();
    function B(ix, iz) {
      const key = Math.floor(ix / W.CHUNK) + "," + Math.floor(iz / W.CHUNK);
      let b = byChunk.get(key);
      if (!b) { b = { p: [], n: [], c: [] }; byChunk.set(key, b); }
      return b;
    }
    function quad(b, a, bb, c, d, nx, ny, nz, color) {
      b.p.push(...a, ...bb, ...c, ...a, ...c, ...d);
      for (let k = 0; k < 6; k++) { b.n.push(nx, ny, nz); b.c.push(color.r, color.g, color.b); }
    }
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) {
      const i = ix * N + iz, h = H[i];
      const x0 = ix - HALF, z0 = iz - HALF, x1 = x0 + 1, z1 = z0 + 1;
      C.setHex(col[i]).multiplyScalar(0.9 + R() * 0.2);
      const b = B(ix, iz);
      quad(b, [x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], 0, 1, 0, C);
      S.copy(C).multiplyScalar(0.92);
      const nb = (jx, jz) => (jx < 0 || jz < 0 || jx >= N || jz >= N) ? 0 : H[jx * N + jz];
      let hn;
      if ((hn = nb(ix + 1, iz)) < h) quad(b, [x1, h, z0], [x1, h, z1], [x1, hn, z1], [x1, hn, z0], 1, 0, 0, S);
      if ((hn = nb(ix - 1, iz)) < h) quad(b, [x0, h, z1], [x0, h, z0], [x0, hn, z0], [x0, hn, z1], -1, 0, 0, S);
      if ((hn = nb(ix, iz + 1)) < h) quad(b, [x1, h, z1], [x0, h, z1], [x0, hn, z1], [x1, hn, z1], 0, 0, 1, S);
      if ((hn = nb(ix, iz - 1)) < h) quad(b, [x0, h, z0], [x1, h, z0], [x1, hn, z0], [x0, hn, z0], 0, 0, -1, S);
    }
    const meshes = [];
    for (const [key, b] of byChunk) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
      const nv = b.p.length / 3;
      g.setAttribute("aGlow", new THREE.Float32BufferAttribute(new Float32Array(nv), 1));
      g.setAttribute("aPhase", new THREE.Float32BufferAttribute(new Float32Array(nv), 1));
      g.setAttribute("aSway", new THREE.Float32BufferAttribute(new Float32Array(nv), 1));
      g.computeBoundingSphere();
      meshes.push({ key, geometry: g });
    }
    // Agua: planos por chunk sobre baldosas de agua (y) y charquitos (y más alto)
    const water = new Map();
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) {
      const i = ix * N + iz, k = kind[i];
      if (k !== K.WATER && k !== K.PUDDLE) continue;
      const y = k === K.WATER ? 0.78 : H[i] + 0.04;
      const key = Math.floor(ix / W.CHUNK) + "," + Math.floor(iz / W.CHUNK);
      let b = water.get(key); if (!b) { b = { p: [], n: [], c: [] }; water.set(key, b); }
      const x0 = ix - HALF, z0 = iz - HALF;
      quad(b, [x0, y, z0], [x0, y, z0 + 1], [x0 + 1, y, z0 + 1], [x0 + 1, y, z0], 0, 1, 0, C.setHex(k === K.WATER ? 0x0e5a68 : 0x1f7482));
    }
    const wmeshes = [];
    for (const [key, b] of water) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
      g.computeBoundingSphere();
      wmeshes.push({ key, geometry: g });
    }
    return { meshes, wmeshes };
  };
})();
