// zones.js — las cinco zonas del mundo muerto (mismo mapa y mismas claves de zona):
//   heart   → El titán caído: máquina-gigante esquelética en el centro, costillas transitables y una mano
//             abierta que forma una plataforma.
//   roots   → Bosque retorcido: árboles enormes de troncos trenzados, raíces en arco sobre los senderos.
//   ponds   → Charcas bioluminiscentes: agua oscura, hongos que brillan, salientes con lianas.
//   ruins   → Cementerio del bosque muerto: árboles muertos, troncos caídos, cercas, tumbas, calaveras.
//   crystal → Árbol del farol: árbol gigante con hueco y farol cálido, escalones, flores y luciérnagas.
// Piezas grandes y únicas: tubos fusionados por chunk (W.addPiece). Piezas repetidas: módulos
// instanciados (W.M.put, modules.js). Cada pieza registra obstáculos, copas (oscuridad) y emisores.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const M4 = () => new THREE.Matrix4();
  let R, P, K, C;
  const TAU = Math.PI * 2;

  W.ZONES.heart.name = "El titán caído";
  W.ZONES.roots.name = "Bosque retorcido";
  W.ZONES.crystal.name = "Árbol del farol";
  W.ZONES.ponds.name = "Charcas bioluminiscentes";
  W.ZONES.ruins.name = "Cementerio del bosque muerto";

  const COL = {
    bark: [0x3a3430, 0x2f2a27, 0x433a33], barkMoss: 0x3e5743, mossT: 0x6a4434, canopy: [0x1d302c, 0x223833, 0x284038, 0x31493f, 0x2f3527], canopyT: 0x5a3a2e,
    bone: 0xb4af9d, boneDark: 0x8a8678, rust: 0x5c4336, rustDark: 0x3f302a, cable: 0x1c2120, cable2: 0x2a302e,
    dead: 0x8f8b80, deadDark: 0x6f6c63, rock: 0x3c4442, rockDark: 0x2c3331, vine: 0x24362e,
    bioC: 0x46e1ff, bioG: 0x78ff96, warm: 0xffb45a, warmDeep: 0xe07a30, emerg: 0xd05038,
  };

  // ---------------------------------------------------------------------------
  // Tubo (Catmull-Rom) con adelgazamiento opcional, fusionado en el chunk de su punto medio
  // ---------------------------------------------------------------------------
  function tube(pts, r, color, o) {
    o = o || {};
    const c = new THREE.CatmullRomCurve3(pts.map((p) => V3(p[0], p[1], p[2])));
    const seg = o.seg || 14, rs = o.rs || 5;
    const g = new THREE.TubeGeometry(c, seg, r, rs, false);
    if (o.taper) {
      const pa = g.attributes.position;
      for (let i = 0; i <= seg; i++) {
        const ctr = c.getPointAt(i / seg), k = 1 - o.taper * (i / seg);
        for (let j = 0; j <= rs; j++) {
          const v = i * (rs + 1) + j;
          pa.setXYZ(v, ctr.x + (pa.getX(v) - ctr.x) * k, ctr.y + (pa.getY(v) - ctr.y) * k, ctr.z + (pa.getZ(v) - ctr.z) * k);
        }
      }
    }
    g.computeBoundingBox();
    const mid = c.getPoint(0.5);
    W.addPiece(g, M4(), color, { flat: o.flat !== false, chunk: W.chunkOf(mid.x, mid.z), glow: o.glow, phase: o.phase, sway: o.cut ? -1 : o.sway, swayByHeight: o.cut ? null : o.sbh });
    return c;
  }
  function blob(geo, x, y, z, sx, sy, sz, color, o) {
    o = o || {};
    W.addPiece(geo, W.propMat(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, sx, sy, sz), color, { flat: true, glow: o.glow, phase: o.phase, sway: o.cut ? -1 : 0 });
  }
  let G;
  function geos() {
    if (G) return G;
    G = { ico: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1), dode: new THREE.DodecahedronGeometry(1, 0), box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 6) };
    Object.values(G).forEach((g) => g.computeBoundingBox());
    return G;
  }
  const H = (x, z) => W.heightAt(x, z);
  const onPath = (x, z, d) => W.pathDistAt(x, z) < (d == null ? 1.25 : d);
  function obstacle(x, z, r, tag) { if (!onPath(x, z, 1.2 + r * 0.5)) W.addObstacle(x, z, r, tag); }
  // sitio libre cerca de un punto (radio rad), fuera del sendero
  function spotNear(x, z, rad, minPath, r) {
    for (let k = 0; k < 120; k++) {
      const a = R() * TAU, d = Math.sqrt(R()) * rad, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const kd = W.kindAt(px, pz);
      if (kd === K.WATER || kd === K.BORDER || W.pathDistAt(px, pz) < minPath || !P.farFromUsed(px, pz, r || 0.4)) continue;
      let flat = true; for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) if (H(px + dx, pz + dz) !== H(px, pz)) flat = false;
      if (flat) return { x: px, z: pz, y: H(px, pz) };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Árbol retorcido: troncos trenzados en hélice, raíces que se abren, ramas y copa densa
  // ---------------------------------------------------------------------------
  function twistedTree(x, z, s, o) {
    o = o || {};
    const y = H(x, z), Ht = (5.8 + R() * 1.6) * s, nT = 3 + Math.floor(R() * 2), turns = 0.55 + R() * 0.5, base = 0.42 * s, a0 = R() * TAU;
    const bark = () => COL.bark[Math.floor(R() * 3)];
    for (let k = 0; k < nT; k++) {
      const pts = [];
      for (let j = 0; j <= 7; j++) {
        const t = j / 7, a = a0 + (k / nT) * TAU + t * turns * TAU, r = base * (1 - 0.5 * t) + (j === 0 ? 0.25 * s : 0);
        pts.push([x + Math.cos(a) * r, y + t * Ht - (j === 0 ? 0.25 : 0), z + Math.sin(a) * r]);
      }
      tube(pts, 0.22 * s, bark(), { seg: 16, rs: 5, taper: 0.45 });
    }
    // raíces: se abren desde la base y se hunden en el suelo
    const nR = 4 + Math.floor(R() * 3);
    for (let k = 0; k < nR; k++) {
      const a = a0 + (k / nR) * TAU + R() * 0.4, L = (1.6 + R() * 1.2) * s;
      const ex = x + Math.cos(a) * L, ez = z + Math.sin(a) * L;
      tube([[x + Math.cos(a) * 0.3 * s, y + 0.8 * s, z + Math.sin(a) * 0.3 * s], [x + Math.cos(a) * 0.9 * s, y + 0.55 * s, z + Math.sin(a) * 0.9 * s],
        [x + Math.cos(a) * L * 0.75, y + 0.25 * s, z + Math.sin(a) * L * 0.75], [ex, H(ex, ez) - 0.1, ez]], 0.14 * s, bark(), { seg: 9, rs: 5, taper: 0.7 });
      if (R() < 0.6) W.M.put("moss", x + Math.cos(a) * 0.9 * s, y + 0.52 * s, z + Math.sin(a) * 0.9 * s, { ry: a, s: 0.9 * s, tint: R() < 0.55 ? COL.mossT : 0xffffff });
    }
    // ramas y copa
    const nB = o.dead ? 5 : 4 + Math.floor(R() * 3), tops = [];
    for (let k = 0; k < nB; k++) {
      const a = a0 + k * 2.1 + R() * 0.6, t0 = 0.62 + R() * 0.3, L = (1.8 + R() * 1.4) * s * (o.dead ? 0.8 : 1);
      const bx = x + Math.cos(a) * base * 0.5, bz = z + Math.sin(a) * base * 0.5, by = y + Ht * t0;
      const ex = bx + Math.cos(a) * L, ez = bz + Math.sin(a) * L, ey = by + (o.dead ? 0.8 + R() * 1.4 : 1.1 + R() * 0.8) * s;
      tube([[bx, by, bz], [bx + Math.cos(a + 0.5) * L * 0.4, by + 0.6 * s, bz + Math.sin(a + 0.5) * L * 0.4], [ex, ey, ez]], (o.dead ? 0.07 : 0.1) * s, o.dead ? COL.deadDark : bark(), { seg: 7, rs: 4, taper: 0.8, cut: !o.dead });
      tops.push([ex, ey, ez]);
    }
    if (!o.dead) {
      tops.push([x, y + Ht + 0.6 * s, z]);
      canopy(tops, s);
      W.addCover(x, z, 3.6 * s, 1);
    } else W.addCover(x, z, 2 * s, 0.25);     // árbol muerto: poca sombra, pero sueltan hojas
    obstacle(x, z, 0.75 * s, o.dead ? "dead" : "tree");
    P.claim(x, z, 1.8 * s);
  }

  // Copa: racimos de piezas pequeñas de tonos distintos (oscuro abajo, verde azulado claro arriba, algo
  // de terracota), no bloques iguales
  function canopy(tops, s) {
    for (const [tx, ty, tz] of tops) {
      const n = 4 + Math.floor(R() * 3);
      for (let j = 0; j < n; j++) {
        const cs = (0.55 + R() * 0.55) * s, up = R();
        const col = up > 0.8 ? COL.canopy[3] : up > 0.55 ? COL.canopy[2] : up > 0.1 ? COL.canopy[Math.floor(R() * 2)] : (R() < 0.5 ? COL.canopyT : COL.canopy[4]);
        blob(R() < 0.6 ? geos().ico : geos().dode, tx + (R() - 0.5) * 1.8 * s, ty + (up - 0.35) * 0.9 * s, tz + (R() - 0.5) * 1.8 * s, cs * (1 + R() * 0.4), cs * (0.5 + R() * 0.25), cs, col, { ry: R() * 3, rx: (R() - 0.5) * 0.4, cut: 1 });
      }
    }
  }

  // Arco de raíces trenzadas sobre un sendero (p: punto del sendero, n: normal horizontal)
  function rootArch(px, pz, nx, nz, s) {
    const y0 = H(px, pz), span = 3.3 * s;
    for (let k = 0; k < 2; k++) {
      const pts = [];
      for (let j = 0; j <= 10; j++) {
        const u = -1 + (2 * j) / 10, a = u * 3.2 + k * Math.PI, tw = 0.22 * s;
        const ux = nx * u * span, uz = nz * u * span, hy = Math.cos(u * Math.PI / 2) * 3.3 * s;
        const gx = px + ux, gz = pz + uz;
        pts.push([gx + Math.cos(a) * tw * nz, (Math.abs(u) > 0.95 ? H(gx, gz) - 0.15 : y0 + hy) + Math.sin(a) * tw, gz - Math.cos(a) * tw * nx]);
      }
      tube(pts, (0.24 - k * 0.06) * s, COL.bark[k], { seg: 26, rs: 5 });
    }
    // musgo terracota colgando de la parte alta
    for (let j = 0; j < 3; j++) { const u = -0.4 + j * 0.4, hy = Math.cos(u * Math.PI / 2) * 3.3 * s;
      blob(geos().ico, px + nx * u * span, y0 + hy + 0.18 * s, pz + nz * u * span, 0.35 * s, 0.12 * s, 0.3 * s, R() < 0.5 ? COL.mossT : COL.barkMoss); }
    [-1, 1].forEach((sg) => { const fx = px + nx * span * sg, fz = pz + nz * span * sg; W.addObstacle(fx, fz, 0.38 * s, "arch"); P.claim(fx, fz, 0.7); });
    W.addCover(px, pz, 2.2 * s, 0.35);
  }

  // Cable (restos de máquina) que corre por el suelo como una raíz
  function cable(x0, z0, x1, z1, r, glowEvery) {
    const n = Math.max(3, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.2)), pts = [];
    const nx = -(z1 - z0), nz = x1 - x0, nl = Math.hypot(nx, nz) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, w = Math.sin(t * Math.PI * (2 + R())) * 0.6;
      const x = x0 + (x1 - x0) * t + nx / nl * w, z = z0 + (z1 - z0) * t + nz / nl * w;
      pts.push([x, H(x, z) + r * 0.6 + (i % 3 === 1 ? 0.12 : 0), z]);
    }
    tube(pts, r || 0.07, R() < 0.5 ? COL.cable : COL.cable2, { seg: n * 3, rs: 4 });
    if (glowEvery) for (let i = 1; i < n; i += glowEvery) {
      const p = pts[i];
      W.M.put("beaconLed", p[0], p[1] + 0.05, p[2], { s: 1 });
    }
  }

  // Módulo auxiliar pequeño: diodo que parpadea sobre un cable
  W.MODULES.beaconLed = () => [[new THREE.BoxGeometry(1, 1, 1), W.propMat(0, 0, 0, 0, 0, 0, 0.07, 0.05, 0.07), 0x46e1ff, { glow: 2.1 }]];
  W.MODULES.slab = () => [
    [new THREE.BoxGeometry(1, 1, 1), W.propMat(0, 0.06, 0, 0, 0, 0, 0.9, 0.14, 0.62), 0x565d59, { flat: true }],
    [new THREE.DodecahedronGeometry(1, 0), W.propMat(-0.25, 0.13, 0.18, 0, 0, 0, 0.22, 0.05, 0.16), 0x3e5743, { flat: true }],
  ];
  W.MODULES.speck = () => [[new THREE.OctahedronGeometry(1, 0), W.propMat(0, 0.03, 0, 0, 0, 0, 0.05, 0.03, 0.05), 0x46e1ff, { glow: 1.2 }]];

  // ---------------------------------------------------------------------------
  // EL TITÁN CAÍDO (centro)
  // ---------------------------------------------------------------------------
  function titan() {
    const g = 1.5;                                         // altura de la plaza
    const bone = (i) => (i % 3 ? COL.bone : COL.boneDark);
    // columna tendida a lo largo de x, en el lado norte (z = 3.2)
    for (let x = -3.2, i = 0; x <= 5.6; x += 0.8, i++) {
      const y = H(x, 3.2);
      blob(geos().box, x, y + 0.2, 3.3, 0.6, 0.55, 0.75, bone(i), { ry: 0.1 * (R() - 0.5), rz: 0.15 * (R() - 0.5) });
      blob(geos().box, x, y + 0.65, 3.55, 0.18, 0.55, 0.22, COL.boneDark, { rx: -0.5 });            // apófisis
      if (i % 2 === 0) blob(geos().box, x + 0.4, y + 0.55, 3.3, 0.5, 0.08, 0.9, COL.rust, { rz: 0.3 * (R() - 0.5), rx: 0.2 });
      obstacle(x, 3.3, 0.45, "titan");
    }
    // costillas: arcos de la columna al suelo del sur; se camina por dentro y entre ellas
    const ribs = [-2.0, -0.4, 1.2, 2.8, 4.4];
    ribs.forEach((x, i) => {
      const broken = i === 1 || i === 3;
      const pts = [[x, g + 0.4, 3.0], [x + 0.1, g + 2.6, 2.6], [x + 0.2, g + 4.0, 0.6], [x + 0.2, g + 3.4, -1.3]];
      if (!broken) pts.push([x + 0.1, g + 1.4, -2.6], [x, H(x, -3.0) - 0.1, -3.05]);
      const c = tube(pts, 0.22, bone(i), { seg: 24, rs: 6, taper: broken ? 0.55 : 0.3, cut: 1 });   // se recortan si tapan al personaje
      // placas de armadura oxidadas sobre la costilla y musgo en lo alto
      [0.3, 0.55].forEach((t, k) => {
        if ((i + k) % 2) return;
        const p = c.getPointAt(t), tg = c.getTangentAt(t);
        W.addPiece(geos().box, W.propMat(p.x, p.y + 0.12, p.z, Math.atan2(tg.y, -tg.z) - Math.PI / 2, 0, 0, 0.7, 0.07, 0.8), k ? COL.rustDark : COL.rust, { flat: true, sway: -1 });
      });
      const top = c.getPointAt(0.45);
      blob(geos().ico, top.x, top.y + 0.2, top.z, 0.4, 0.14, 0.5, R() < 0.5 ? COL.mossT : COL.barkMoss, { cut: 1 });
      // tendón: cable colgando a lo largo de la costilla
      const cp = [0.15, 0.4, 0.62].map((t) => { const q = c.getPointAt(t); return [q.x + 0.3, q.y - 0.35, q.z]; });
      tube(cp, 0.045, COL.cable, { seg: 10, rs: 4, cut: 1 });
      if (!broken) obstacle(x, -3.05, 0.32, "titan");
      else { const q = c.getPointAt(1); W.M.put("bone", q.x + 0.4, H(q.x + 0.4, q.z - 1.6), q.z - 1.6, { ry: R() * 3, s: 1.8, tint: 0xd8d2c0 }); }
    });
    W.addCover(1.2, 0.2, 4.2, 0.55);           // la caja torácica da sombra
    // cráneo (este): calavera de máquina mirando a la cámara, con cuencas hondas, dientes, casco oxidado
    // y una luz de emergencia moribunda en una cuenca
    const sx = 6.0, sz = 0.9, sy = H(sx, sz), ry = Math.PI / 4;
    const F = [Math.sin(ry), Math.cos(ry)], Rt = [Math.cos(ry), -Math.sin(ry)];
    const at = (lat, up, fw) => [sx + Rt[0] * lat + F[0] * fw, sy + up, sz + Rt[1] * lat + F[1] * fw];
    const put = (geo, lat, up, fw, w, h, d, col, o) => { const q = at(lat, up, fw); blob(geo, q[0], q[1], q[2], w, h, d, col, Object.assign({ ry }, o)); };
    put(geos().ico1, 0, 1.35, -0.25, 1.25, 1.1, 1.3, COL.bone);                        // bóveda
    put(geos().box, 0, 1.55, 0.72, 1.7, 0.32, 0.45, COL.boneDark, { rx: -0.25 });      // arco de las cejas
    put(geos().box, 0, 0.85, 0.85, 1.35, 0.75, 0.4, COL.bone);                         // cara
    put(geos().ico, -0.42, 1.12, 1.02, 0.34, 0.3, 0.2, 0x07090a);                      // cuencas
    put(geos().ico, 0.42, 1.12, 1.02, 0.34, 0.3, 0.2, 0x07090a);
    put(geos().box, -0.42, 1.12, 1.16, 0.1, 0.08, 0.04, COL.emerg, { glow: 3.05 });   // la luz moribunda
    put(geos().ico, 0, 0.72, 1.08, 0.16, 0.2, 0.12, 0x07090a);                         // nariz
    for (let t = 0; t < 6; t++) put(geos().box, -0.5 + t * 0.2, 0.42, 1.02, 0.13, 0.2, 0.1, t % 2 ? COL.bone : COL.boneDark);   // dientes
    put(geos().box, 0.1, 0.12, 1.25, 1.3, 0.24, 0.7, COL.boneDark, { rx: 0.35, rz: 0.12 });   // mandíbula caída
    for (let t = 0; t < 5; t++) put(geos().box, -0.45 + t * 0.22, 0.28, 1.5, 0.12, 0.16, 0.1, COL.bone, { rx: 0.35 });
    put(geos().box, -0.1, 2.3, -0.2, 1.3, 0.14, 1.3, COL.rust, { rz: 0.18, rx: -0.1 });          // placas del casco
    put(geos().box, 0.75, 1.7, -0.45, 0.14, 0.9, 1.0, COL.rustDark, { rz: -0.2 });
    put(geos().box, -0.8, 1.6, -0.3, 0.14, 0.8, 0.9, COL.rust, { rz: 0.25 });
    put(geos().ico, 0.1, 2.45, -0.3, 0.75, 0.16, 0.65, COL.barkMoss);                           // musgo encima
    put(geos().ico, -0.6, 1.9, 0.2, 0.35, 0.1, 0.3, COL.mossT);
    for (let t = 0; t < 4; t++) { const a = at(-0.5 + t * 0.35, 0.6, -1.1), b = at(-1.4 + t * 0.9, 0.05, -3.2 - t * 0.4);    // cables de la nuca
      tube([a, [(a[0] + b[0]) / 2, sy + 0.5, (a[2] + b[2]) / 2], [b[0], H(b[0], b[2]) + 0.06, b[2]]], 0.06, t % 2 ? COL.cable : COL.cable2, { seg: 8, rs: 4 }); }
    const eye = at(-0.42, 1.12, 1.6);
    W.addEmitter(eye[0], eye[1], eye[2], 0xc0302a, 0.45, 3, { kind: "emerg", dying: true });
    obstacle(sx, sz, 1.25, "titan");
    // brazo: del hombro (oeste de la columna) al codo en el suelo y a la muñeca
    const sh = [-3.4, g + 1.1, 2.5], el = [-6.3, H(-6.3, 0.0) + 0.35, 0.0], wr = [-5.1, H(-5.1, -2.2) + 0.35, -2.2];
    const up = tube([sh, [-5.0, g + 1.2, 1.4], el], 0.24, COL.bone, { seg: 14, rs: 6 });
    const fo = tube([el, [-5.9, el[1] + 0.1, -1.1], wr], 0.19, COL.boneDark, { seg: 12, rs: 6 });
    tube([[sh[0], sh[1] - 0.1, sh[2] + 0.2], [-5.2, g + 0.8, 1.2], [el[0] + 0.2, el[1] + 0.2, el[2] + 0.2]], 0.05, COL.cable, { seg: 10, rs: 4 });
    tube([[el[0] + 0.25, el[1] + 0.1, el[2]], [-5.5, el[1] + 0.35, -1.0], [wr[0] + 0.2, wr[1] + 0.15, wr[2]]], 0.045, COL.cable2, { seg: 10, rs: 4 });
    [0.3, 0.6].forEach((t) => { const p = fo.getPointAt(t); W.addPiece(geos().box, W.propMat(p.x, p.y + 0.18, p.z, 0.1, 0.9, 0.2, 0.5, 0.1, 0.6), COL.rust, { flat: true }); });
    for (const c of [up, fo]) for (let t = 0.1; t <= 0.95; t += 0.2) { const p = c.getPointAt(t); if (p.y - H(p.x, p.z) < 1.3) obstacle(p.x, p.z, 0.3, "titan"); }
    // mano abierta = plataforma: baldosas elevadas medio escalón (W.HAND), palma y dedos que se curvan
    const hd = W.HAND;
    if (hd) {
      const cx = (hd.x0 + hd.x1) / 2, cz = (hd.z0 + hd.z1) / 2, py = hd.h;
      blob(geos().box, cx, py - 0.16, cz, hd.x1 - hd.x0 + 0.1, 0.32, hd.z1 - hd.z0 + 0.1, COL.bone);
      blob(geos().box, cx - 0.1, py - 0.01, cz + 0.1, hd.x1 - hd.x0 - 0.5, 0.03, hd.z1 - hd.z0 - 0.5, COL.boneDark);
      // dedos por el lado oeste y norte (se entra por el sur y el este)
      const fingers = [[hd.x0 + 0.2, hd.z1 - 0.2, -1, 0.6], [hd.x0 + 0.2, cz + 0.4, -1, 0.3], [hd.x0 + 0.2, cz - 0.5, -1, 0], [hd.x0 + 0.8, hd.z1 - 0.15, 0.5, 1]];
      fingers.forEach(([fx, fz, dx, dz], k) => {
        const bx = fx + dx * 0.4, bz = fz + dz * 0.4;
        tube([[fx, py + 0.05, fz], [bx, py + 0.65, bz], [bx + dx * 0.15, py + 1.15, bz + dz * 0.2], [fx + (cx - fx) * 0.3, py + 1.3, fz + (cz - fz) * 0.3]], 0.14, k % 2 ? COL.bone : COL.boneDark, { seg: 10, rs: 5, taper: 0.45 });
        const kn = [bx, py + 0.65, bz]; blob(geos().ico, kn[0], kn[1], kn[2], 0.2, 0.2, 0.2, COL.rust);   // nudillo de metal
        W.addObstacle(fx + dx * 0.1, fz + dz * 0.1, 0.2, "hand");
      });
      tube([[hd.x0 + 0.5, py + 0.05, hd.z0 + 0.15], [hd.x0 + 0.2, py + 0.5, hd.z0 - 0.3], [hd.x0 + 0.6, py + 0.8, hd.z0 - 0.4]], 0.11, COL.bone, { seg: 8, rs: 5, taper: 0.4 });    // pulgar
      W.addPiece(geos().box, W.propMat(cx + 0.3, py + 0.04, cz - 0.3, 0, 0.5, 0.06, 0.8, 0.05, 0.5), COL.rust, { flat: true });
      W.M.put("moss", cx + 0.4, py, cz + 0.4, { s: 1.2, tint: COL.mossT });
    }
    // pelvis hundida al oeste de la columna y restos alrededor
    blob(geos().dode, -4.4, H(-4.4, 3.6) + 0.3, 3.9, 0.9, 0.55, 0.8, COL.boneDark, { ry: 0.5 });
    obstacle(-4.4, 3.9, 0.8, "titan");
    // cables que salen del titán y corren por el suelo hacia fuera, como raíces
    const outs = [[-24, -14], [22, -14], [26, 16], [-18, 22], [-2, -26], [9, 25], [-28, 2], [30, 4]];
    outs.forEach(([ox, oz], i) => {
      const x0 = i % 2 ? 5.2 : -2.6, z0 = 3.6;
      const d = Math.hypot(ox - x0, oz - z0), L = Math.min(d, 9 + R() * 5);
      cable(x0, z0, x0 + (ox - x0) / d * L, z0 + (oz - z0) / d * L, 0.06 + R() * 0.04, i % 3 === 0 ? 4 : 0);
    });
    // placas hundidas, una terminal y balizas en el anillo
    for (let k = 0; k < 7; k++) { const s = P.spot({ zone: "heart", minPath: 1.4, r: 0.7 }); if (s) { W.M.put("plate", s.x, s.y + 0.01, s.z, { ry: R() * 3, rx: (R() - 0.5) * 0.3, rz: (R() - 0.5) * 0.4, s: 0.8 + R() * 0.6 }); W.plates.push([s.x, s.z, 0.6]); P.claim(s.x, s.z, 0.6); } }
    [[3.2, -4.6], [-7.6, 0.8]].forEach(([x, z]) => { const s = spotNear(x, z, 2.5, 1.4, 0.6); if (s) terminal(s.x, s.z, R() * 6); });
    [[0, -9.4], [9.8, 2.2], [-9.6, -2.6]].forEach(([x, z]) => beacon(x, z));
  }
  function terminal(x, z, ry, broken) {
    const y = H(x, z);
    W.M.put("terminal", x, y, z, { ry, rx: broken ? 0.35 : (R() - 0.5) * 0.12, rz: broken ? 0.2 : (R() - 0.5) * 0.12 });
    W.addEmitter(x + Math.sin(ry) * 0.4, y + 0.7, z + Math.cos(ry) * 0.4, 0x46e1ff, 0.45, 2.6, { kind: "screen", flicker: true });
    W.addObstacle(x, z, 0.35, "terminal"); P.claim(x, z, 0.7);
    W.plates.push([x, z, 0.5]);
  }
  function beacon(x, z) {
    if (onPath(x, z, 1.3) || !P.farFromUsed(x, z, 0.4)) { const s = spotNear(x, z, 3, 1.4, 0.4); if (!s) return; x = s.x; z = s.z; }
    const y = H(x, z);
    W.M.put("beacon", x, y, z, { ry: R() * 3, rz: (R() - 0.5) * 0.15 });
    W.addEmitter(x, y + 1.35, z, COL.emerg, 0.8, 4, { kind: "emerg", dying: true });
    W.addObstacle(x, z, 0.15, "beacon"); P.claim(x, z, 0.4);
  }

  // ---------------------------------------------------------------------------
  // BOSQUE RETORCIDO
  // ---------------------------------------------------------------------------
  function forest() {
    for (let k = 0; k < 18; k++) { const s = P.spot({ zone: "roots", minPath: 2.6, r: 2.8 }); if (s) twistedTree(s.x, s.z, 1.1 + R() * 0.45); }
    for (let k = 0; k < 40; k++) { const s = P.spot({ zone: "roots", minPath: 1.3, r: 0.4 }); if (s) W.M.put("moss", s.x, s.y, s.z, { ry: R() * 3, s: 0.8 + R() * 0.8, tint: R() < 0.5 ? COL.mossT : 0xffffff }); }
    for (let k = 0; k < 14; k++) { const s = P.spot({ zone: "roots", minPath: 1.6, r: 0.6 }); if (s) { W.M.put("rock", s.x, s.y, s.z, { ry: R() * 3, s: 0.8 + R() * 0.8, tint: 0xc0c8c0 }); W.addObstacle(s.x, s.z, 0.35, "rock"); P.claim(s.x, s.z, 0.6); } }
    for (let k = 0; k < 8; k++) { const s = P.spot({ zone: "roots", minPath: 1.4, r: 0.6 }); if (s) { W.M.put("plate", s.x, s.y + 0.01, s.z, { ry: R() * 3, rx: (R() - 0.5) * 0.4, rz: 0.3, s: 0.8 }); W.plates.push([s.x, s.z, 0.5]); } }
    const s = P.spot({ zone: "roots", minPath: 1.8, r: 0.8 }); if (s) terminal(s.x, s.z, R() * 6, true);
  }

  // ---------------------------------------------------------------------------
  // CHARCAS BIOLUMINISCENTES
  // ---------------------------------------------------------------------------
  function vine(x, top, z, len, glow) {
    const pts = [], ph = R() * 6;
    for (let j = 0; j <= 4; j++) pts.push([x + Math.sin(j * 1.3 + ph) * 0.08, top - len * j / 4, z + Math.cos(j * 1.1 + ph) * 0.08]);
    tube(pts, 0.035, COL.vine, { seg: 8, rs: 3, sway: 0.5, phase: ph, sbh: [top, top - len] });
    if (glow) blob(geos().ico, pts[4][0], pts[4][1], pts[4][2], 0.06, 0.08, 0.06, R() < 0.5 ? COL.bioC : COL.bioG, { glow: 1, phase: ph });
  }
  function overhang(x, z, ang, s) {
    // saliente de roca (como la boca de una cueva) sobre dos pilares, con lianas colgando
    const y = H(x, z), ca = Math.cos(ang), sa = Math.sin(ang), span = 2.4 * s, hgt = 3.0 * s;
    [-1, 1].forEach((sg) => {
      const px = x + ca * span * sg, pz = z + sa * span * sg, py = H(px, pz);
      for (let j = 0; j < 4; j++) blob(geos().box, px + (R() - 0.5) * 0.25, py + 0.35 + j * 0.72 * s, pz + (R() - 0.5) * 0.25, (0.95 - j * 0.08) * s, 0.72 * s, (0.85 - j * 0.06) * s, j % 2 ? COL.rock : 0x46504d, { ry: ang + (R() - 0.5) * 0.5, rz: (R() - 0.5) * 0.15 });
      W.addObstacle(px, pz, 0.7 * s, "rock"); P.claim(px, pz, 1);
    });
    // dintel de losas quebradas, con musgo y raíces por encima
    for (let j = -3; j <= 3; j++) blob(geos().box, x + ca * j * span / 3.2, y + hgt + 0.1 + Math.cos(j / 3 * 1.3) * 0.25, z + sa * j * span / 3.2, 1.0 * s, 0.42 * s, 1.1 * s, j % 2 ? 0x46504d : COL.rock, { ry: -ang + (R() - 0.5) * 0.3, rz: (R() - 0.5) * 0.2, rx: (R() - 0.5) * 0.15 });
    for (let j = -2; j <= 2; j += 2) blob(geos().ico, x + ca * j * span / 3, y + hgt + 0.42 * s, z + sa * j * span / 3, 0.8 * s, 0.16 * s, 0.7 * s, j ? COL.barkMoss : COL.mossT, { ry: R() * 3 });
    for (let j = 0; j < 7; j++) {
      const u = (R() * 2 - 1) * span * 0.9, vx = x + ca * u + (R() - 0.5) * 0.8, vz = z + sa * u + (R() - 0.5) * 0.8;
      vine(vx, y + hgt - 0.35, vz, 1.1 + R() * 1.4, R() < 0.7);
    }
    W.addCover(x, z, 3.2 * s, 1);
  }
  function mushrooms(x, z, n, big) {
    const tint = R() < 0.55 ? 0xffffff : 0x9dffc4;     // cian o verde
    for (let j = 0; j < n; j++) {
      const mx = x + (R() - 0.5) * (big ? 1.4 : 0.9), mz = z + (R() - 0.5) * (big ? 1.4 : 0.9), sc = big ? 1.6 + R() * 1.2 : 0.6 + R() * 1.1;
      if (W.kindAt(mx, mz) === K.WATER) continue;
      // los grandes brillan menos (tinte apagado): la penumbra manda y el personaje sigue siendo lo cálido
      W.M.put("mushroom", mx, H(mx, mz), mz, { ry: R() * 6, rz: (R() - 0.5) * 0.25, s: sc, tint: big ? (tint === 0xffffff ? 0x5f9aa4 : 0x6aa484) : tint });
      if (big) W.addObstacle(mx, mz, 0.1 * sc, "mushroom");
      W.reflect(mx, mz, tint === 0xffffff ? COL.bioC : COL.bioG, 0.5 * sc);
    }
    W.addEmitter(x, H(x, z) + (big ? 2.2 : 0.8), z, tint === 0xffffff ? COL.bioC : COL.bioG, big ? 1.3 : 0.8, big ? 6 : 4, { kind: "bio" });
    P.claim(x, z, big ? 1.2 : 0.7);
  }
  function ponds() {
    const Z = W.ZONES.ponds;
    W.addCover(Z.x, Z.z, Z.r + 2, 0.55);                   // penumbra de cueva en toda la zona
    // salientes de roca cerca del agua
    for (let k = 0; k < 5; k++) {
      const s = P.spot({ zone: "ponds", minPath: 3.2, r: 3 });
      if (s) overhang(s.x, s.z, R() * Math.PI, 0.9 + R() * 0.3);
    }
    // hongos: gigantes y en grupos, sobre todo junto al agua
    for (let k = 0; k < 9; k++) { const s = P.spot({ zone: "ponds", minPath: 2, r: 1.4 }); if (s) mushrooms(s.x, s.z, 1 + Math.floor(R() * 2), true); }
    for (let k = 0; k < 34; k++) { const s = P.spot({ zone: "ponds", minPath: 1.25, r: 0.8 }); if (s) mushrooms(s.x, s.z, 3 + Math.floor(R() * 5), false); }
    // líquenes que brillan en el suelo y en la orilla
    for (let k = 0; k < 160; k++) { const s = P.spot({ zone: "ponds", minPath: 0.9, flat: false }); if (s) W.M.put("speck", s.x, s.y, s.z, { ry: R() * 3, s: 0.8 + R(), tint: R() < 0.6 ? 0xffffff : 0x9dffc4 }); }
    // raíces muertas sobre el agua, con lianas
    for (let k = 0; k < 4; k++) {
      const s = P.spot({ zone: "ponds", minPath: 2.2, r: 1.5 }); if (!s) continue;
      const a = R() * TAU, L = 4 + R() * 2, ex = s.x + Math.cos(a) * L, ez = s.z + Math.sin(a) * L;
      const c = tube([[s.x, s.y - 0.1, s.z], [s.x + Math.cos(a) * L * 0.3, s.y + 2.6, s.z + Math.sin(a) * L * 0.3], [s.x + Math.cos(a) * L * 0.7, s.y + 2.4, s.z + Math.sin(a) * L * 0.7], [ex, H(ex, ez) - 0.1, ez]], 0.18, COL.bark[1], { seg: 18, rs: 5, taper: 0.4 });
      for (let t = 0.3; t < 0.75; t += 0.12) { const p = c.getPointAt(t); vine(p.x, p.y - 0.15, p.z, 0.8 + R() * 1.2, R() < 0.6); }
      W.addObstacle(s.x, s.z, 0.35, "root"); if (!onPath(ex, ez)) W.addObstacle(ex, ez, 0.3, "root");
    }
    const s = P.spot({ zone: "ponds", minPath: 1.8, r: 0.8 }); if (s) terminal(s.x, s.z, R() * 6, true);
  }

  // ---------------------------------------------------------------------------
  // CEMENTERIO DEL BOSQUE MUERTO
  // ---------------------------------------------------------------------------
  function fence(x0, z0, x1, z1) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 1.1)), ang = Math.atan2(z1 - z0, x1 - x0);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (onPath(x, z, 1.3) || W.kindAt(x, z) === K.WATER || !P.farFromUsed(x, z, 0.3)) { prev = null; continue; }
      if (R() < 0.18) { prev = null; continue; }              // poste que falta
      const y = H(x, z), tilt = (R() - 0.5) * 0.5;
      W.M.put("fencePost", x, y, z, { ry: -ang, rz: tilt, rx: (R() - 0.5) * 0.3, sy: 0.7 + R() * 0.5 });
      W.addObstacle(x, z, 0.12, "fence");
      if (prev && R() < 0.75) {
        const mx = (x + prev[0]) / 2, mz = (z + prev[1]) / 2, broken = R() < 0.3;
        W.M.put("fenceRail", mx, (broken ? H(mx, mz) + 0.06 : y + 0.55), mz, { ry: -ang, rz: broken ? 0.05 : (R() - 0.5) * 0.25, sx: broken ? 0.6 : 1 });
        if (R() < 0.5 && !broken) W.M.put("fenceRail", mx, y + 0.25, mz, { ry: -ang, rz: (R() - 0.5) * 0.4 });
      }
      prev = [x, z];
    }
  }
  function cemetery() {
    const Z = W.ZONES.ruins;
    // árboles muertos, blanquecinos y sin copa
    for (let k = 0; k < 9; k++) { const s = P.spot({ zone: "ruins", minPath: 2.2, r: 1.8 }); if (s) deadTree(s.x, s.z, 0.9 + R() * 0.5); }
    // troncos caídos
    for (let k = 0; k < 10; k++) {
      const s = P.spot({ zone: "ruins", minPath: 1.9, r: 1.2 }); if (!s) continue;
      const ry = R() * Math.PI, sc = 0.8 + R() * 0.6;
      W.M.put("log", s.x, s.y, s.z, { ry, s: sc, rx: (R() - 0.5) * 0.1 });
      for (const u of [-0.6, 0, 0.6]) W.addObstacle(s.x + Math.cos(ry) * u * sc, s.z - Math.sin(ry) * u * sc, 0.25 * sc, "log");
      P.claim(s.x, s.z, 1.2 * sc);
    }
    // tumbas y cruces en filas sobre las terrazas, con montículo
    for (let k = 0; k < 14; k++) {
      const s = P.spot({ zone: "ruins", minPath: 1.8, r: 1.4 }); if (!s) continue;
      const ry = Math.round(R() * 4) * Math.PI / 2 + (R() - 0.5) * 0.3, n = 2 + Math.floor(R() * 3);
      for (let j = 0; j < n; j++) {
        const x = s.x + Math.cos(ry) * (j - n / 2) * 0.9, z = s.z - Math.sin(ry) * (j - n / 2) * 0.9;
        if (onPath(x, z, 1.4) || H(x, z) !== s.y) continue;
        const cross = R() < 0.35;
        W.M.put(cross ? "cross" : "tomb", x, H(x, z), z, { ry, rz: (R() - 0.5) * 0.35, rx: (R() - 0.5) * 0.25, s: 0.9 + R() * 0.3 });
        W.M.put("mound", x - Math.sin(ry) * 0.5, H(x, z), z - Math.cos(ry) * 0.5, { ry });
        W.addObstacle(x, z, 0.22, "tomb");
      }
      P.claim(s.x, s.z, 1.2);
    }
    // cercas rotas a lo largo de los bordes
    for (let k = 0; k < 9; k++) {
      const s = P.spot({ zone: "ruins", minPath: 1.5, maxPath: 2.4, r: 0.3 }); if (!s) continue;
      const a = R() * Math.PI, L = 2.5 + R() * 3;
      fence(s.x - Math.cos(a) * L / 2, s.z - Math.sin(a) * L / 2, s.x + Math.cos(a) * L / 2, s.z + Math.sin(a) * L / 2);
    }
    // calaveras y huesos entre la hierba (también en los bordes de los senderos)
    for (let k = 0; k < 70; k++) { const s = P.spot({ zone: "ruins", minPath: 1.2, flat: false }); if (s) W.M.put("skull", s.x, s.y - 0.03, s.z, { ry: R() * 6, rz: (R() - 0.5) * 0.6, rx: (R() - 0.5) * 0.4, s: 0.9 + R() * 0.5 }); }
    for (let k = 0; k < 110; k++) { const s = P.spot({ zone: "ruins", minPath: 1.15, flat: false }); if (s) W.M.put("bone", s.x, s.y, s.z, { ry: R() * 6, s: 0.6 + R() * 0.8 }); }
    // restos de máquinas
    for (let k = 0; k < 2; k++) { const s = P.spot({ zone: "ruins", minPath: 1.8, r: 0.8 }); if (s) terminal(s.x, s.z, R() * 6, R() < 0.6); }
    for (let k = 0; k < 6; k++) { const s = P.spot({ zone: "ruins", minPath: 1.3, r: 0.6 }); if (s) { W.M.put("plate", s.x, s.y + 0.01, s.z, { ry: R() * 3, rx: (R() - 0.5) * 0.35, rz: (R() - 0.5) * 0.35, s: 0.7 + R() * 0.5 }); W.plates.push([s.x, s.z, 0.5]); } }
    beacon(Z.x + 3, Z.z - 4);
  }
  function deadTree(x, z, s) {
    const y = H(x, z), Ht = (3.6 + R() * 1.4) * s, a0 = R() * TAU;
    const pts = [];
    for (let j = 0; j <= 6; j++) { const t = j / 6, a = a0 + t * 2.4; pts.push([x + Math.cos(a) * 0.18 * s * (1 - t), y + t * Ht - (j ? 0 : 0.2), z + Math.sin(a) * 0.18 * s * (1 - t)]); }
    tube(pts, 0.2 * s, COL.dead, { seg: 12, rs: 5, taper: 0.7 });
    for (let k = 0; k < 5; k++) {
      const t = 0.45 + R() * 0.45, p = pts[Math.round(t * 6)], a = a0 + k * 1.9, L = (0.8 + R() * 1.2) * s;
      tube([[p[0], p[1], p[2]], [p[0] + Math.cos(a) * L * 0.5, p[1] + 0.3 * s, p[2] + Math.sin(a) * L * 0.5], [p[0] + Math.cos(a + 0.4) * L, p[1] + (0.2 + R() * 0.8) * s, p[2] + Math.sin(a + 0.4) * L]], 0.06 * s, COL.deadDark, { seg: 6, rs: 4, taper: 0.8 });
    }
    for (let k = 0; k < 3; k++) { const a = a0 + k * 2.1, L = 1.2 * s, ex = x + Math.cos(a) * L, ez = z + Math.sin(a) * L;
      tube([[x, y + 0.5 * s, z], [x + Math.cos(a) * 0.6 * s, y + 0.25 * s, z + Math.sin(a) * 0.6 * s], [ex, H(ex, ez) - 0.08, ez]], 0.1 * s, COL.deadDark, { seg: 6, rs: 4, taper: 0.7 }); }
    W.addCover(x, z, 2 * s, 0.25);
    obstacle(x, z, 0.45 * s, "dead");
    P.claim(x, z, 1.4 * s);
  }

  // ---------------------------------------------------------------------------
  // ÁRBOL DEL FAROL (meseta del noreste): el único refugio cálido
  // ---------------------------------------------------------------------------
  function lanternTree() {
    const Z = W.ZONES.crystal;
    // sitio: lo más cerca del centro, lejos del sendero y en llano
    let best = null;
    for (let k = 0; k < 600; k++) {
      const a = R() * TAU, r = Math.sqrt(R()) * 6, x = Z.x + Math.cos(a) * r, z = Z.z + Math.sin(a) * r, pd = W.pathDistAt(x, z);
      if (pd < 3.4 || pd > 6 || H(x, z) < 2.5) continue;
      let flat = true; for (let j = 0; j < 8; j++) if (H(x + Math.cos(j) * 2.2, z + Math.sin(j) * 2.2) !== H(x, z)) flat = false;
      if (!flat) continue;
      const sc = -pd * 0.3 - r * 0.5;
      if (!best || sc > best.sc) best = { x, z, sc };
    }
    if (!best) best = { x: Z.x, z: Z.z };
    const x = best.x, z = best.z, y = H(x, z), s = 1.9;
    // la boca del hueco mira hacia el sendero más cercano
    let open = 0, bd = 1e9;
    for (let j = 0; j < 24; j++) { const a = j / 24 * TAU, d = W.pathDistAt(x + Math.cos(a) * 3, z + Math.sin(a) * 3); if (d < bd) { bd = d; open = a; } }
    W.LANTERN = { x, z, y, open };
    // tronco: anillo de troncos trenzados que dejan un hueco hacia "open", y se juntan arriba
    const n = 7;
    for (let k = 0; k < n; k++) {
      let a = open + 0.55 + (k / (n - 1)) * (TAU - 1.1);
      const pts = [];
      for (let j = 0; j <= 9; j++) {
        const t = j / 9, bulge = Math.sin(t * Math.PI * 1.3 + k) * 0.18, r = (1.3 - 0.8 * Math.min(1, t * 1.2) + bulge) * s, aa = a + t * (1.4 + (k % 2) * 0.6);
        pts.push([x + Math.cos(aa) * r, y + t * 6.4 * s - (j ? 0 : 0.25), z + Math.sin(aa) * r]);
      }
      tube(pts, (0.26 + (k % 3) * 0.05) * s, COL.bark[k % 3], { seg: 20, rs: 6, taper: 0.4 });
      if (k % 2 === 0) blob(geos().ico, pts[2][0], pts[2][1], pts[2][2], 0.45, 0.2, 0.4, k % 4 ? COL.barkMoss : COL.mossT);
      W.addObstacle(pts[0][0], pts[0][2], 0.45, "lanternTree");
    }
    // raíces grandes, ramas y la copa más grande del mapa
    for (let k = 0; k < 7; k++) {
      const a = open + 0.9 + k * 0.72, L = (2.4 + R()) * s * 0.8, ex = x + Math.cos(a) * L, ez = z + Math.sin(a) * L;
      if (onPath(ex, ez)) continue;
      tube([[x + Math.cos(a) * 1.2 * s, y + 0.6, z + Math.sin(a) * 1.2 * s], [x + Math.cos(a) * 1.9 * s, y + 0.5, z + Math.sin(a) * 1.9 * s], [ex, H(ex, ez) - 0.1, ez]], 0.2 * s, COL.bark[k % 3], { seg: 9, rs: 5, taper: 0.7 });
    }
    const topY = y + 6.2 * s;
    const ltops = [];
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + 0.3, L = (2.6 + R() * 1.4) * s, ex = x + Math.cos(a) * L, ez = z + Math.sin(a) * L;
      tube([[x, topY - 0.8, z], [x + Math.cos(a) * L * 0.5, topY + 0.3, z + Math.sin(a) * L * 0.5], [ex, topY + 0.9 + R() * 0.8, ez]], 0.16 * s, COL.bark[k % 3], { seg: 9, rs: 5, taper: 0.7, cut: 1 });
      ltops.push([ex, topY + 1.3, ez]);
    }
    canopy(ltops, s * 1.1);
    W.addCover(x, z, 8.5, 1);
    // el farol dentro del hueco: marco oscuro, cristal cálido, gancho
    const lx = x + Math.cos(open) * 0.35, lz = z + Math.sin(open) * 0.35, ly = y + 1.05;
    blob(geos().box, lx, ly, lz, 0.28, 0.36, 0.28, 0x1a1c1b);
    blob(geos().box, lx, ly, lz, 0.2, 0.28, 0.3, COL.warm, { glow: 1.6 });
    blob(geos().box, lx, ly, lz, 0.3, 0.28, 0.2, COL.warm, { glow: 1.6 });
    blob(geos().box, lx, ly + 0.24, lz, 0.18, 0.06, 0.18, 0x1a1c1b);
    tube([[lx, ly + 0.28, lz], [lx, ly + 0.9, lz], [x, ly + 1.2, z]], 0.025, 0x1a1c1b, { seg: 6, rs: 3 });
    W.addEmitter(lx + Math.cos(open) * 0.6, ly + 0.2, lz + Math.sin(open) * 0.6, 0xff9a40, 2.6, 10, { kind: "lantern", warm: true });
    // escalones de piedra con musgo que suben hacia el hueco
    for (let j = 0; j < 4; j++) {
      const d = 1.9 + j * 0.75, sx = x + Math.cos(open) * d, sz = z + Math.sin(open) * d;
      if (onPath(sx, sz, 1.0)) break;
      W.M.put("slab", sx, H(sx, sz) + 0.02 + (3 - j) * 0.04, sz, { ry: -open + Math.PI / 2, sx: 1.3 - j * 0.05 });
    }
    // escalones en la subida del sendero a la meseta (donde cambia la altura)
    for (const samp of W.pathSamples) for (let i = 1; i < samp.length; i++) {
      const [px, pz] = samp[i], q = samp[i - 1];
      if (Math.hypot(px - Z.x, pz - Z.z) > Z.r + 4 || i % 2) continue;
      if (H(px, pz) === H(q[0], q[1]) && H(px, pz) < 2.5 && Math.hypot(px - Z.x, pz - Z.z) > Z.r - 1) {
        const ang = Math.atan2(pz - q[1], px - q[0]);
        W.M.put("slab", px, H(px, pz) + 0.015, pz, { ry: -ang + Math.PI / 2, sx: 1.4, tint: 0xd0d8d2 });
      }
    }
    // flores naranjas (solo aquí), musgo, rocas con musgo; luciérnagas
    for (let k = 0; k < 150; k++) {
      const a = R() * TAU, r = 1.9 * s + Math.pow(R(), 0.7) * 7, fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r;
      if (onPath(fx, fz, 1.1) || W.kindAt(fx, fz) === K.WATER || !P.farFromUsed(fx, fz, 0.05)) continue;
      W.M.put("flower", fx, H(fx, fz), fz, { ry: R() * 6, s: 0.9 + R() * 0.7, tint: R() < 0.3 ? 0xffe0b0 : 0xffffff });
    }
    for (let k = 0; k < 30; k++) { const sp = P.spot({ zone: "crystal", minPath: 1.2, r: 0.3 }); if (sp) W.M.put("moss", sp.x, sp.y, sp.z, { ry: R() * 3, s: 1 + R(), tint: R() < 0.35 ? COL.mossT : 0xffffff }); }
    for (let k = 0; k < 10; k++) { const sp = P.spot({ zone: "crystal", minPath: 1.8, r: 0.7 }); if (sp) { W.M.put("rock", sp.x, sp.y, sp.z, { ry: R() * 3, s: 0.8 + R() * 0.7 }); W.M.put("moss", sp.x, sp.y + 0.3, sp.z, { s: 0.8 }); W.addObstacle(sp.x, sp.z, 0.35, "rock"); P.claim(sp.x, sp.z, 0.6); } }
    for (let k = 0; k < 4; k++) { const sp = P.spot({ zone: "crystal", minPath: 3, r: 2 }); if (sp) twistedTree(sp.x, sp.z, 0.8 + R() * 0.3); }
    W.fireflyZones.push([x, z, 9]);
    P.claim(x, z, 2.6 * s);
  }

  // ---------------------------------------------------------------------------
  // Entre zonas y el conjunto
  // ---------------------------------------------------------------------------
  W.plates = [];                                // placas de metal (pisada metálica, etapa 3)
  W.fireflyZones = [];
  W.reflections = [];
  W.reflect = function (x, z, color, h) {       // reflejo de algo que brilla sobre el agua cercana
    for (let j = 0; j < 6; j++) {
      const a = j * 1.05, wx = x + Math.cos(a) * 0.9, wz = z + Math.sin(a) * 0.9;
      const k = W.kindAt(wx, wz);
      if (k === K.WATER || k === K.PUDDLE) { W.reflections.push([wx, k === K.WATER ? 0.8 : H(wx, wz) + 0.05, wz, color, h]); return; }
    }
  };
  function arches() {
    const S = W.pathSamples;
    S.forEach((smp, pi) => {
      let acc = 0;
      for (let k = 1; k < smp.length - 1; k++) {
        acc += Math.hypot(smp[k][0] - smp[k - 1][0], smp[k][1] - smp[k - 1][1]);
        const x = smp[k][0], z = smp[k][1], zone = W.zoneAt(x, z);
        const every = zone === "roots" ? 6 : 18;
        if (acc < every || zone === "heart" || zone === "ruins" || zone === "crystal") continue;
        const tx = smp[k + 1][0] - smp[k - 1][0], tz = smp[k + 1][1] - smp[k - 1][1], tl = Math.hypot(tx, tz) || 1;
        const nx = -tz / tl, nz = tx / tl;
        const ok = [-1, 1].every((sg) => { const fx = x + nx * 3.4 * sg, fz = z + nz * 3.4 * sg, kd = W.kindAt(fx, fz);
          return kd !== K.WATER && kd !== K.BORDER && W.pathDistAt(fx, fz) > 1.3 && P.farFromUsed(fx, fz, 0.8) && Math.abs(H(fx, fz) - H(x, z)) <= 1; });
        if (!ok) continue;
        rootArch(x, z, nx, nz, zone === "roots" ? 1.05 : 0.95);
        acc = 0;
      }
    });
  }
  function between() {
    for (let k = 0; k < 26; k++) { const s = P.spot({ minPath: 2.8, r: 2 }); if (s && W.zoneAt(s.x, s.z) === "sendero" && Math.hypot(s.x, s.z) > 13) twistedTree(s.x, s.z, 0.75 + R() * 0.35); }
    for (let k = 0; k < 8; k++) { const s = P.spot({ minPath: 2.2, r: 1.5 }); if (s && W.zoneAt(s.x, s.z) === "sendero") deadTree(s.x, s.z, 0.8 + R() * 0.3); }
    for (let k = 0; k < 40; k++) { const s = P.spot({ minPath: 1.8, r: 0.8 }); if (s && W.zoneAt(s.x, s.z) !== "crystal") { W.M.put("rock", s.x, s.y, s.z, { ry: R() * 3, s: 0.7 + R() * 0.9 }); W.addObstacle(s.x, s.z, 0.3 * (0.7 + R() * 0.9), "rock"); P.claim(s.x, s.z, 0.6); } }
    for (let k = 0; k < 220; k++) { const s = P.spot({ minPath: 1.2, r: 0.2 }); if (s && W.zoneAt(s.x, s.z) !== "ponds") W.M.put("moss", s.x, s.y, s.z, { ry: R() * 3, s: 0.7 + R() * 0.9, tint: R() < 0.3 ? COL.mossT : 0xffffff }); }
    for (let k = 0; k < 40; k++) { const s = P.spot({ minPath: 1.2, flat: false }); if (s && W.zoneAt(s.x, s.z) === "sendero") W.M.put(R() < 0.3 ? "skull" : "bone", s.x, s.y, s.z, { ry: R() * 6, rz: (R() - 0.5) * 0.5, s: 0.8 + R() * 0.5 }); }
    for (let k = 0; k < 18; k++) { const s = P.spot({ minPath: 1.3, r: 0.6 }); if (s && W.zoneAt(s.x, s.z) === "sendero") { W.M.put("plate", s.x, s.y + 0.01, s.z, { ry: R() * 3, rx: (R() - 0.5) * 0.35, rz: (R() - 0.5) * 0.35, s: 0.7 + R() * 0.6 }); W.plates.push([s.x, s.z, 0.55]); } }
    for (let k = 0; k < 3; k++) { const s = P.spot({ minPath: 1.8, r: 0.8 }); if (s && W.zoneAt(s.x, s.z) === "sendero") terminal(s.x, s.z, R() * 6, R() < 0.5); }
    [[-12, -10], [14, 8], [-14, 12], [12, -26]].forEach(([x, z]) => beacon(x, z));
    // hierba (con balanceo, fusionada por chunk) y matas instanciadas
    const gcol = [0x3e5743, 0x46604a, 0x364d3c, 0x4f6a51];
    for (let k = 0; k < 900; k++) { const s = P.spot({ minPath: 1.15, flat: false, kinds: [K.GRASS, K.CRYSTAL, K.STONE] }); if (s) grassTuft(s.x, s.z, gcol[k % 4]); }
  }
  function grassTuft(x, z, c) {
    const y = H(x, z), ph = R() * 6;
    for (let k = 0; k < 4; k++) {
      const a = R() * Math.PI, h = 0.18 + R() * 0.22, ox = (R() - 0.5) * 0.25, oz = (R() - 0.5) * 0.25;
      W.addPiece(bladeGeo(), W.propMat(x + ox, y, z + oz, (R() - 0.5) * 0.4, a, (R() - 0.5) * 0.5, 1, h, 1), c, { outline: false, sway: 1.6, phase: ph, swayByHeight: [0, 1] });
    }
  }
  let _blade;
  function bladeGeo() {
    if (_blade) return _blade;
    const b = new THREE.BufferGeometry();
    b.setAttribute("position", new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 1, 0, 0.03, 0, 0, -0.03, 0, 0, 0, 1, 0], 3));
    b.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1, 0, 0.3, -1, 0, 0.3, -1, 0, 0.3, -1], 3));
    b.computeBoundingBox();
    return (_blade = b);
  }

  W.buildZones = function () {
    P = W.P; R = P.rnd; K = W.K; C = W.MC;
    geos();
    titan();
    lanternTree();
    ponds();
    cemetery();
    forest();
    arches();
    between();
  };
})();
