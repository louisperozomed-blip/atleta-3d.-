// props.js — elementos del bosque post-natural: arcos de raíces con vainas, árbol-corazón,
// árboles de raíces, hongos, tallos, cristales, ruinas, rocas, hierba y destellos.
// Cada elemento se hornea en la geometría fusionada de su chunk (core.js) y registra
// sus obstáculos (navegación) y emisores de luz (effects.js).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const { clamp } = W;
  const K = W.K;

  const M4 = () => new THREE.Matrix4();
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function mat(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    return M4().compose(_p.set(x, y, z), _q, _s.set(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
  }
  W.propMat = mat;

  // Geometrías base compartidas
  let G;
  function geos() {
    if (G) return G;
    G = {
      bulb: new THREE.IcosahedronGeometry(1, 0),
      cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
      cyl4: new THREE.CylinderGeometry(1, 1, 1, 4),
      stemTaper: new THREE.CylinderGeometry(0.6, 1, 1, 6),
      cap: new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      tip: new THREE.SphereGeometry(1, 6, 4),
      oct: new THREE.OctahedronGeometry(1, 0),
      box: new THREE.BoxGeometry(1, 1, 1),
      rock: new THREE.DodecahedronGeometry(1, 0),
      canopy: new THREE.IcosahedronGeometry(1, 0),
      podGeo: new THREE.IcosahedronGeometry(0.55, 1),
    };
    // hoja de hierba de doble cara (triángulo + inverso)
    const b = new THREE.BufferGeometry();
    b.setAttribute("position", new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 1, 0, 0.03, 0, 0, -0.03, 0, 0, 0, 1, 0], 3));
    b.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1, 0, 0.3, -1, 0, 0.3, -1, 0, 0.3, -1], 3));
    b.computeBoundingBox();
    G.blade = b;
    Object.values(G).forEach((g) => g.computeBoundingBox && g.computeBoundingBox());
    return G;
  }

  const PULSE = { glow: 1 };
  let R;
  const COL = {
    bark: 0x3b2a3a, barkDark: 0x2e2030, stem: 0xd8d0c0, stalk: 0x2d5a3a, canopy: 0x1f4a4a, canopy2: 0x24524a,
    stone: 0x6b7480, stone2: 0x5d6672, moss: 0x3f7a4c, cyan: 0x3fd8ff, lime: 0xb6ff4f, pink: 0xff4fd8,
    orange: 0xffb347, magenta: 0xff5ac8,
  };
  const CAPS = [COL.pink, COL.cyan, COL.lime, COL.orange];

  // ---------------------------------------------------------------------------
  // Lugares libres
  // ---------------------------------------------------------------------------
  const used = [];
  function farFromUsed(x, z, r) {
    for (const u of used) if (Math.hypot(u[0] - x, u[1] - z) < u[2] + r) return false;
    return true;
  }
  // opts: {zone, minPath, maxPath, r, kinds, box:[x0,z0,x1,z1], allowHigh}
  function spot(o) {
    for (let k = 0; k < 400; k++) {
      let x, z;
      if (o.zone) { const q = W.ZONES[o.zone], a = R() * Math.PI * 2, rr = Math.sqrt(R()) * q.r; x = q.x + Math.cos(a) * rr; z = q.z + Math.sin(a) * rr; }
      else { x = (R() * 2 - 1) * (W.HALF - 5); z = (R() * 2 - 1) * (W.HALF - 5); }
      const kd = W.kindAt(x, z), pd = W.pathDistAt(x, z);
      if (kd === K.WATER || kd === K.BORDER || kd === K.PUDDLE) continue;
      if (o.kinds && !o.kinds.includes(kd)) continue;
      if (pd < (o.minPath == null ? 1.6 : o.minPath)) continue;
      if (o.maxPath != null && pd > o.maxPath) continue;
      if (Math.hypot(x, z) < 3.2) continue;                    // plaza del árbol-corazón
      if (o.r && !farFromUsed(x, z, o.r)) continue;
      // no en el borde de un escalón (queda flotando)
      const h = W.heightAt(x, z);
      if (o.flat !== false) {
        let bad = false;
        for (const [dx, dz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) if (W.heightAt(x + dx, z + dz) !== h) bad = true;
        if (bad) continue;
      }
      return { x, z, y: h };
    }
    return null;
  }
  W.spot = (o) => spot(o || {});
  function claim(x, z, r) { used.push([x, z, r]); }

  // ---------------------------------------------------------------------------
  // Piezas
  // ---------------------------------------------------------------------------
  function root(pts, r, color, o) {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => V3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(c, o && o.seg || 24, r, 5, false);
    g.computeBoundingBox();
    // la pieza se asigna al chunk de su punto medio
    const mid = c.getPoint(0.5);
    const chunk = W.chunkOf(mid.x, mid.z);
    W.addPiece(g, M4(), color || COL.bark, { flat: true, chunk, outline: !(o && o.noOutline) });
    return c;
  }
  function bulb(x, y, z, color, rad, extra) {
    W.addPiece(geos().bulb, mat(x, y, z, 0, 0, 0, rad), color, Object.assign({ glow: 1.0, phase: R() * 6, flat: true }, extra));
  }

  // Arco de raíces sobre un sendero (p: punto del sendero, n: normal horizontal)
  function rootArch(px, pz, nx, nz, scale) {
    const s = scale || 1, y0 = W.heightAt(px, pz);
    const prof = [[-3.3, 0], [-2.3, 2], [-1, 3.2], [0, 3.45], [1, 3.2], [2.3, 2], [3.3, 0]];
    const pts = prof.map(([u, y]) => [px + nx * u * s, y0 + y * s + (Math.abs(u) > 3 ? W.heightAt(px + nx * u * s, pz + nz * u * s) - y0 : 0), pz + nz * u * s]);
    const c = root(pts, 0.28 * s);
    root(pts.map(([x, y, z], j) => [x + 0.25, y - 0.2 + Math.sin(j) * 0.2, z + 0.25]), 0.12 * s);
    [0.36, 0.5, 0.64].forEach((t) => {
      const q = c.getPoint(t);
      W.addPiece(geos().cyl4, mat(q.x, q.y - 0.25, q.z, 0, 0, 0, 0.02, 0.5, 0.02), COL.bark, { outline: false });
      bulb(q.x, q.y - 0.55, q.z, COL.cyan, 0.1);
    });
    const q = c.getPoint(0.5);
    W.addEmitter(q.x, q.y - 0.8, q.z, COL.cyan, 1.1, 7, { kind: "arch" });
    // pies del arco: obstáculos
    [-1, 1].forEach((sg) => { const fx = px + nx * 3.3 * s * sg, fz = pz + nz * 3.3 * s * sg; W.addObstacle(fx, fz, 0.35 * s, "arch"); claim(fx, fz, 0.6); });
  }

  // Árbol de raíces: troncos retorcidos que suben y una copa de poliedros aplanados
  function rootTree(x, z, s) {
    const y = W.heightAt(x, z);
    const n = 3 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + R() * 0.5, pts = [];
      for (let j = 0; j <= 5; j++) {
        const r = (j === 0 ? 0.9 : 0.55 - j * 0.07) * s, aa = a + j * 0.45;
        pts.push([x + Math.cos(aa) * r, y + j * 0.75 * s - (j === 0 ? 0.1 : 0), z + Math.sin(aa) * r]);
      }
      root(pts, 0.15 * s, k % 2 ? COL.bark : COL.barkDark, { seg: 16 });
    }
    const cy = y + 3.9 * s;
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + R(), r = k ? 1.1 * s : 0;
      W.addPiece(geos().canopy, mat(x + Math.cos(a) * r, cy + R() * 0.4 * s, z + Math.sin(a) * r, 0, R() * 3, 0, 0.95 * s, 0.52 * s, 0.95 * s), k % 2 ? COL.canopy : COL.canopy2, { flat: true });
      if (k && R() < 0.7) {
        const tx = x + Math.cos(a) * (r + 0.45 * s), tz = z + Math.sin(a) * (r + 0.45 * s);
        W.addPiece(geos().cyl4, mat(tx, cy - 0.7 * s, tz, 0, 0, 0, 0.02, 0.8 * s, 0.02), COL.bark, { outline: false });
        bulb(tx, cy - 1.15 * s, tz, COL.lime, 0.08 * s);
      }
    }
    W.addObstacle(x, z, 0.75 * s, "tree");
    claim(x, z, 1.4 * s);
    if (W.addCover) W.addCover(x, z, 2.6 * s, 0.9);
    if (R() < 0.5) W.addEmitter(x, cy - 1.2 * s, z, COL.lime, 0.6, 5, { kind: "tree" });
  }

  function mushroomCluster(x, z, big) {
    const n = 1 + Math.floor(R() * 3), cc = CAPS[Math.floor(R() * 4)];
    for (let j = 0; j < n; j++) {
      const sc = (big ? 1.6 : 0.6) + R() * (big ? 0.8 : 0.9);
      const mx = x + (R() - 0.5) * 0.8, mz = z + (R() - 0.5) * 0.8, y = W.heightAt(mx, mz), tilt = (R() - 0.5) * 0.3;
      W.addPiece(geos().stemTaper, mat(mx, y + 0.3 * sc, mz, 0, 0, tilt, 0.07 * sc, 0.6 * sc, 0.07 * sc), COL.stem, {});
      W.addPiece(geos().cap, mat(mx - Math.sin(tilt) * 0.58 * sc, y + 0.58 * sc, mz, 0, R() * 3, tilt, 0.32 * sc, 0.32 * sc, 0.32 * sc), cc, { glow: 0.8, phase: R() * 6, flat: true });
      if (big) W.addObstacle(mx, mz, 0.2 * sc, "mushroom");
    }
    W.addEmitter(x, W.heightAt(x, z) + (big ? 1.6 : 0.9), z, cc, big ? 0.9 : 0.55, big ? 5 : 3.5, { kind: "mushroom" });
    claim(x, z, 0.7);
  }

  function stalk(x, z) {
    const y = W.heightAt(x, z), h = 1 + R() * 1.2, ph = R() * 6;
    W.addPiece(geos().cyl4, mat(x, y + h / 2, z, 0, 0, 0, 0.03, h, 0.03), COL.stalk,
      { outline: false, sway: 1.2 * h, phase: ph, swayByHeight: [-0.5, 0.5] });
    W.addPiece(geos().tip, mat(x, y + h, z, 0, 0, 0, 0.08), COL.lime, { glow: 1, phase: ph, sway: 1.2 * h, swayByHeight: [-1, -1 + 1e-3] });
    claim(x, z, 0.25);
  }

  function crystalCluster(x, z, s) {
    const y = W.heightAt(x, z), n = 3 + Math.floor(R() * 3);
    for (let j = 0; j < n; j++) {
      const sc = (0.5 + R() * 0.9) * s;
      W.addPiece(geos().oct, mat(x + (R() - 0.5) * 0.7 * s, y + 0.3 * sc, z + (R() - 0.5) * 0.7 * s, (R() - 0.5) * 0.7, R() * 3, (R() - 0.5) * 0.7, 0.16 * sc, 0.7 * sc, 0.16 * sc),
        0xffffff, { crystal: true, outlineColor: 0x4a8cff });
    }
    W.addObstacle(x, z, 0.45 * s, "crystal");
    W.addEmitter(x, y + 0.9 * s, z, 0x7a6cff, 0.7, 4.5, { kind: "crystal" });
    claim(x, z, 0.9 * s);
  }

  function pillar(x, z, nBlocks) {
    let y = W.heightAt(x, z);
    for (let j = 0; j < nBlocks; j++) {
      W.addPiece(geos().box, mat(x + (R() - 0.5) * 0.12, y + 0.35, z + (R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.3, j === nBlocks - 1 ? (R() - 0.5) * 0.35 : 0, 0.8, 0.7, 0.8), j % 2 ? COL.stone : COL.stone2, { flat: true });
      y += 0.7;
    }
    W.addPiece(geos().box, mat(x, y + 0.03, z, 0, R(), 0, 0.9, 0.12, 0.9), COL.moss, { flat: true });
    W.addObstacle(x, z, 0.55, "ruin");
    claim(x, z, 0.8);
  }
  // Muro en ruinas entre dos puntos
  function wall(x0, z0, x1, z1, hMax) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 0.85)), ang = Math.atan2(z1 - z0, x1 - x0);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (W.pathDistAt(x, z) < 1.4) continue;
      const hh = 1 + Math.floor(R() * hMax);
      let y = W.heightAt(x, z);
      for (let j = 0; j < hh; j++) { W.addPiece(geos().box, mat(x, y + 0.3, z, 0, -ang, 0, 0.85, 0.6, 0.55), j % 2 ? COL.stone2 : COL.stone, { flat: true }); y += 0.6; }
      if (R() < 0.6) W.addPiece(geos().box, mat(x, y + 0.03, z, 0, -ang, 0, 0.8, 0.1, 0.5), COL.moss, { flat: true });
      W.addObstacle(x, z, 0.45, "wall");
      claim(x, z, 0.5);
    }
  }
  // Arco de piedra sobre un sendero
  function stoneArch(px, pz, nx, nz) {
    const y0 = W.heightAt(px, pz), w = 1.9;
    let top = 0;
    [-1, 1].forEach((sg) => {
      const x = px + nx * w * sg, z = pz + nz * w * sg;
      let y = W.heightAt(x, z);
      for (let j = 0; j < 4; j++) { W.addPiece(geos().box, mat(x, y + 0.35, z, 0, 0, 0, 0.7, 0.7, 0.7), j % 2 ? COL.stone : COL.stone2, { flat: true }); y += 0.7; }
      top = Math.max(top, y);
      W.addObstacle(x, z, 0.45, "arch");
      claim(x, z, 0.6);
    });
    const ang = Math.atan2(nz, nx);
    W.addPiece(geos().box, mat(px, top + 0.25, pz, 0, -ang, 0, 2 * w + 0.8, 0.5, 0.75), COL.stone, { flat: true });
    W.addPiece(geos().box, mat(px, top + 0.55, pz, 0, -ang, 0, 2 * w + 0.4, 0.1, 0.6), COL.moss, { flat: true });
  }
  function fallenBlock(x, z) {
    const y = W.heightAt(x, z);
    W.addPiece(geos().box, mat(x, y + 0.25, z, 0.2, R() * 3, 0.5, 0.7, 0.6, 0.7), COL.stone, { flat: true });
    W.addObstacle(x, z, 0.45, "ruin");
    claim(x, z, 0.6);
  }
  function rock(x, z, s) {
    const y = W.heightAt(x, z);
    W.addPiece(geos().rock, mat(x, y + 0.2 * s, z, R(), R() * 3, R(), 0.55 * s, 0.4 * s, 0.5 * s), R() < 0.5 ? 0x4c5660 : 0x56606a, { flat: true });
    W.addObstacle(x, z, 0.45 * s, "rock");
    claim(x, z, 0.6 * s);
  }
  function grassTuft(x, z, c) {
    const y = W.heightAt(x, z), ph = R() * 6;
    for (let k = 0; k < 4; k++) {
      const a = R() * Math.PI, h = 0.18 + R() * 0.2, ox = (R() - 0.5) * 0.25, oz = (R() - 0.5) * 0.25;
      W.addPiece(geos().blade, mat(x + ox, y, z + oz, (R() - 0.5) * 0.4, a, (R() - 0.5) * 0.5, 1, h, 1), c,
        { outline: false, sway: 1.6, phase: ph, swayByHeight: [0, 1] });
    }
  }
  function glint(x, z, c) {
    const y = W.heightAt(x, z);
    W.addPiece(geos().box, mat(x, y + 0.03, z, 0, R() * 3, 0, 0.09, 0.06, 0.09), c, { outline: false, glow: 1.4, phase: R() * 6 });
  }

  // ---------------------------------------------------------------------------
  // Árbol-corazón (centro)
  // ---------------------------------------------------------------------------
  function heartTree() {
    const hy = 1.5, S = 1.25;
    for (let k = 0; k < 4; k++) {
      const pts = [];
      for (let j = 0; j <= 7; j++) { const a = k * Math.PI / 2 + j * 0.55, r = (j < 1 ? 1.5 : 1 - j * 0.07) * S; pts.push([Math.cos(a) * r, hy + j * 0.5 * S, Math.sin(a) * r]); }
      root(pts, 0.2 * S);
    }
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05 + R() * 0.3, pts = [];
      for (let j = 0; j < 6; j++) { const r = 1.2 + j * 0.72, aa = a + Math.sin(j * 1.3) * 0.25, x = Math.cos(aa) * r, z = Math.sin(aa) * r; pts.push([x, W.heightAt(x, z) + 0.12 + (j === 2 || j === 3 ? 0.22 : 0), z]); }
      root(pts, 0.16);
    }
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9, r = k ? 1.6 : 0;
      W.addPiece(geos().canopy, mat(Math.cos(a) * r, hy + 4.6 + R() * 0.4, Math.sin(a) * r, 0, R() * 3, 0, 1.25, 0.66, 1.25), COL.canopy, { flat: true });
      if (k) { const tx = Math.cos(a) * (r + 0.6), tz = Math.sin(a) * (r + 0.6);
        W.addPiece(geos().cyl4, mat(tx, hy + 3.7, tz, 0, 0, 0, 0.02, 0.9, 0.02), COL.bark, { outline: false });
        bulb(tx, hy + 3.2, tz, COL.lime, 0.08); }
    }
    W.addObstacle(0, 0, 1.55, "heart");
    if (W.addCover) W.addCover(0, 0, 4.2, 1);
    claim(0, 0, 2.6);
    W.heartPos = V3(0, hy + 2.3, 0);
    W.addEmitter(0, hy + 2.3, 0, 0xff4fc8, 1.6, 11, { kind: "heart", beat: true });
  }

  // ---------------------------------------------------------------------------
  // Colocación de todo el mundo
  // ---------------------------------------------------------------------------
  W.placeProps = function () {
    R = W.rng(2024);
    used.length = 0;
    geos();
    heartTree();
    // arcos de raíces a lo largo de los senderos (más densos en el bosque de raíces)
    const P = W.pathSamples;
    P.forEach((s, pi) => {
      let acc = 0;
      for (let k = 1; k < s.length - 1; k++) {
        acc += Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]);
        const x = s[k][0], z = s[k][1], zone = W.zoneAt(x, z);
        const every = zone === "roots" ? 5.5 : pi === P.length - 1 ? 9 : 16;
        if (acc < every) continue;
        const tx = s[k + 1][0] - s[k - 1][0], tz = s[k + 1][1] - s[k - 1][1], tl = Math.hypot(tx, tz) || 1;
        const nx = -tz / tl, nz = tx / tl;
        if (Math.hypot(x, z) < 4) continue;
        // pies en terreno válido
        const ok = [-1, 1].every((sg) => { const fx = x + nx * 3.3 * sg, fz = z + nz * 3.3 * sg, kd = W.kindAt(fx, fz);
          return kd !== K.WATER && kd !== K.BORDER && W.pathDistAt(fx, fz) > 1.3 && farFromUsed(fx, fz, 0.8) && Math.abs(W.heightAt(fx, fz) - W.heightAt(x, z)) <= 1; });
        if (!ok) continue;
        if (zone === "ruins") stoneArch(x, z, nx, nz); else rootArch(x, z, nx, nz, zone === "roots" ? 1.05 : 0.95);
        acc = 0;
      }
    });
    // bosque de raíces
    for (let k = 0; k < 26; k++) { const s = spot({ zone: "roots", minPath: 2.4, r: 1.3 }); if (s) rootTree(s.x, s.z, 0.85 + R() * 0.35); }
    for (let k = 0; k < 22; k++) { const s = spot({ minPath: 2.6, r: 1.4 }); if (s && W.zoneAt(s.x, s.z) !== "crystal" && W.zoneAt(s.x, s.z) !== "ruins") rootTree(s.x, s.z, 0.8 + R() * 0.4); }
    // cristales
    for (let k = 0; k < 32; k++) { const s = spot({ zone: "crystal", minPath: 1.7, r: 0.9 }); if (s) crystalCluster(s.x, s.z, 0.9 + R() * 0.7); }
    for (let k = 0; k < 10; k++) { const s = spot({ minPath: 2, r: 1 }); if (s) crystalCluster(s.x, s.z, 0.7 + R() * 0.4); }
    // ruinas
    const rz = W.ZONES.ruins;
    for (let k = 0; k < 16; k++) { const s = spot({ zone: "ruins", minPath: 1.8, r: 1 }); if (s) pillar(s.x, s.z, 2 + Math.floor(R() * 4)); }
    wall(rz.x - 8, rz.z - 6, rz.x - 2, rz.z - 8, 3);
    wall(rz.x + 3, rz.z + 7.5, rz.x + 8, rz.z + 4, 2);
    wall(rz.x - 7, rz.z + 3, rz.x - 7, rz.z + 8, 3);
    for (let k = 0; k < 12; k++) { const s = spot({ zone: "ruins", minPath: 1.6, r: 0.7 }); if (s) fallenBlock(s.x, s.z); }
    for (let k = 0; k < 6; k++) { const s = spot({ minPath: 2.2, r: 1 }); if (s) pillar(s.x, s.z, 1 + Math.floor(R() * 3)); }
    // charcas: hongos grandes y pequeños
    for (let k = 0; k < 14; k++) { const s = spot({ zone: "ponds", minPath: 1.8, r: 0.9 }); if (s) mushroomCluster(s.x, s.z, R() < 0.5); }
    for (let k = 0; k < 30; k++) { const s = spot({ minPath: 1.5, r: 0.7 }); if (s) mushroomCluster(s.x, s.z, false); }
    // tallos, rocas
    for (let k = 0; k < 90; k++) { const s = spot({ minPath: 1.3, r: 0.3 }); if (s) stalk(s.x, s.z); }
    for (let k = 0; k < 40; k++) { const s = spot({ minPath: 1.8, r: 0.8 }); if (s) rock(s.x, s.z, 0.7 + R() * 0.8); }
    // hierba (no bloquea)
    const gcol = [0x4d8a5c, 0x5f9a62, 0x6aa66a, 0x3f7654];
    for (let k = 0; k < 1400; k++) { const s = spot({ minPath: 1.15, flat: false, kinds: [K.GRASS, K.CRYSTAL, K.STONE] }); if (s) grassTuft(s.x, s.z, gcol[k % 4]); }
    // destellos
    const dc = [COL.cyan, 0xff7ae0, 0xc8ff6a];
    for (let k = 0; k < 420; k++) { const s = spot({ minPath: 1.1, flat: false }); if (s) glint(s.x, s.z, dc[k % 3]); }
  };
})();
