// modules.js — piezas modulares del mundo muerto, dibujadas con instancing (una malla instanciada por
// tipo para todo el mapa: una llamada de dibujo, más la de sombras si proyecta).
// Cada módulo es una geometría pequeña con color por vértice y brillo (aGlow) propio; cada instancia
// lleva su matriz y un tinte (instanceColor). Las piezas grandes y únicas (árboles, el titán) siguen
// fusionadas por chunk en props/zones.
//   W.M.put(nombre, x, y, z, { ry, rx, rz, s, sx, sy, sz, tint })
//   W.M.build(scene, material, depthMaterial) -> estadísticas
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  const M4 = () => new THREE.Matrix4();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function m(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    return M4().compose(_p.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz));
  }
  let G = null;
  function prim() {
    if (G) return G;
    G = {
      ico0: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1),
      dode: new THREE.DodecahedronGeometry(1, 0), oct: new THREE.OctahedronGeometry(1, 0),
      box: new THREE.BoxGeometry(1, 1, 1), cyl5: new THREE.CylinderGeometry(1, 1, 1, 5), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
      cyl8: new THREE.CylinderGeometry(1, 1, 1, 8), taper: new THREE.CylinderGeometry(0.7, 1, 1, 6),
      cap: new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      tet: new THREE.TetrahedronGeometry(1, 0),
    };
    const b = new THREE.BufferGeometry();          // brizna de doble cara
    b.setAttribute("position", new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 1, 0, 0.03, 0, 0, -0.03, 0, 0, 0, 1, 0], 3));
    b.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1, 0, 0.3, -1, 0, 0.3, -1, 0, 0.3, -1], 3));
    G.blade = b;
    return G;
  }
  // colores base (se tiñen por instancia); todo desaturado salvo lo que brilla
  const C = {
    bone: 0xb9b4a2, boneDark: 0x8e8a7c, socket: 0x0c100f, wood: 0x4b4640, wood2: 0x5a544b, stone: 0x59605c, stoneMoss: 0x3e5743,
    soil: 0x2b2824, rust: 0x5c4336, rustDark: 0x3f302a, metal: 0x3c4341, metalDark: 0x262c2b, screen: 0x46e1ff, screenGreen: 0x78ff96,
    emerg: 0xd05038, stem: 0x9fb4ac, bioC: 0x46e1ff, bioG: 0x78ff96, flower: 0xf07a2a, flower2: 0xffb45a, leaf: 0x3e5743,
    moss: 0x3e5743, mossT: 0x6a4434, rock: 0x4a524f, log: 0xa6a294, logDark: 0x7d7a6f,
  };
  W.MC = C;

  // definición de módulos: lista de piezas [geo, matriz, color, opciones]
  const DEF = {
    skull: () => [
      [prim().ico1, m(0, 0.13, 0, 0, 0, 0, 0.16, 0.14, 0.19), C.bone, { flat: true }],
      [prim().box, m(0, 0.05, 0.1, 0.2, 0, 0, 0.15, 0.07, 0.1), C.boneDark, { flat: true }],
      [prim().ico0, m(-0.055, 0.13, 0.16, 0, 0, 0, 0.042), C.socket, {}],
      [prim().ico0, m(0.055, 0.13, 0.16, 0, 0, 0, 0.042), C.socket, {}],
    ],
    bone: () => [
      [prim().cyl5, m(0, 0.035, 0, 0, 0, Math.PI / 2, 0.03, 0.5, 0.03), C.bone, {}],
      [prim().ico0, m(-0.26, 0.045, 0, 0, 0, 0, 0.055), C.bone, { flat: true }],
      [prim().ico0, m(0.26, 0.045, 0, 0, 0, 0, 0.055), C.bone, { flat: true }],
    ],
    fencePost: () => [
      [prim().box, m(0, 0.45, 0, 0, 0, 0, 0.09, 0.9, 0.09), C.wood, { flat: true }],
      [prim().tet, m(0, 0.92, 0, 0, 0.6, 0, 0.07), C.wood2, { flat: true }],
    ],
    fenceRail: () => [[prim().box, m(0, 0, 0, 0, 0, 0, 1.1, 0.07, 0.05), C.wood2, { flat: true }]],
    tomb: () => [
      [prim().box, m(0, 0.28, 0, 0, 0, 0, 0.44, 0.56, 0.12), C.stone, { flat: true }],
      [prim().cyl8, m(0, 0.56, 0, Math.PI / 2, 0, 0, 0.22, 0.12, 0.22), C.stone, { flat: true }],
      [prim().box, m(0.05, 0.72, 0, 0, 0, 0.1, 0.3, 0.05, 0.13), C.stoneMoss, { flat: true }],
      [prim().box, m(0, 0.02, 0.35, 0, 0, 0, 0.5, 0.05, 0.6), C.soil, { flat: true }],
    ],
    cross: () => [
      [prim().box, m(0, 0.4, 0, 0, 0, 0, 0.08, 0.8, 0.08), C.wood, { flat: true }],
      [prim().box, m(0, 0.58, 0, 0, 0, 0, 0.42, 0.07, 0.07), C.wood, { flat: true }],
    ],
    mound: () => [[prim().ico1, m(0, 0, 0, 0, 0, 0, 0.42, 0.13, 0.78), C.soil, { flat: true }]],
    plate: () => [
      [prim().box, m(0, 0, 0, 0, 0, 0, 1, 0.06, 0.64), C.rust, { flat: true }],
      [prim().box, m(0, 0.035, -0.2, 0, 0, 0, 0.94, 0.02, 0.06), C.rustDark, { flat: true }],
      [prim().box, m(0, 0.035, 0.2, 0, 0, 0, 0.94, 0.02, 0.06), C.rustDark, { flat: true }],
    ],
    terminal: () => [
      [prim().box, m(0, 0.42, 0, 0, 0, 0, 0.42, 0.84, 0.3), C.metal, { flat: true }],
      [prim().box, m(0, 0.05, 0, 0, 0, 0, 0.55, 0.1, 0.42), C.metalDark, { flat: true }],
      [prim().box, m(0, 0.9, 0.05, -0.5, 0, 0, 0.46, 0.08, 0.34), C.metalDark, { flat: true }],
      [prim().box, m(0, 0.63, 0.155, 0, 0, 0, 0.3, 0.22, 0.01), C.screen, { glow: 2.2 }],
      [prim().box, m(-0.12, 0.38, 0.155, 0, 0, 0, 0.05, 0.05, 0.01), C.emerg, { glow: 3 }],
    ],
    beacon: () => [                                   // luz de emergencia moribunda sobre un poste
      [prim().cyl5, m(0, 0.6, 0, 0, 0, 0, 0.035, 1.2, 0.035), C.metalDark, {}],
      [prim().box, m(0, 1.22, 0, 0, 0, 0, 0.12, 0.09, 0.12), C.metal, { flat: true }],
      [prim().box, m(0, 1.3, 0, 0, 0, 0, 0.08, 0.07, 0.08), C.emerg, { glow: 3 }],
    ],
    mushroom: () => [
      [prim().taper, m(0, 0.25, 0, 0, 0, 0, 0.05, 0.5, 0.05), C.stem, { glow: 0.12 }],
      [prim().cap, m(0, 0.48, 0, 0, 0, 0, 0.22, 0.14, 0.22), C.bioC, { glow: 1, flat: true, sway: -1 }],   // se recorta si tapa
      [prim().cyl8, m(0, 0.475, 0, 0, 0, 0, 0.2, 0.015, 0.2), C.bioG, { glow: 0.6 }],
    ],
    flower: () => [
      [prim().blade, m(0.02, 0, 0, 0, 0.3, 0.1, 1, 0.16, 1), C.leaf, {}],
      [prim().blade, m(-0.03, 0, 0.02, 0, 1.8, -0.15, 1, 0.13, 1), C.leaf, {}],
      [prim().oct, m(0.02, 0.17, 0, 0, 0.4, 0, 0.045), C.flower, { glow: 0.35, flat: true }],
      [prim().oct, m(-0.05, 0.13, 0.03, 0, 0.9, 0, 0.04), C.flower2, { glow: 0.3, flat: true }],
      [prim().oct, m(0.06, 0.11, 0.05, 0, 0.2, 0, 0.035), C.flower, { glow: 0.3, flat: true }],
    ],
    moss: () => [[prim().dode, m(0, 0.03, 0, 0, 0, 0, 0.36, 0.08, 0.3), C.moss, { flat: true }]],
    rock: () => [[prim().dode, m(0, 0.18, 0, 0, 0, 0, 0.5, 0.36, 0.44), C.rock, { flat: true }]],
    log: () => [
      [prim().cyl6, m(0, 0.15, 0, 0, 0, Math.PI / 2, 0.16, 1.8, 0.16), C.log, { flat: true }],
      [prim().cyl5, m(0.3, 0.3, 0.1, 0.6, 0, 0.3, 0.05, 0.4, 0.05), C.logDark, {}],
      [prim().cyl5, m(-0.5, 0.25, -0.1, -0.5, 0, -0.4, 0.04, 0.35, 0.04), C.logDark, {}],
      [prim().cyl6, m(0.9, 0.15, 0, 0, 0, Math.PI / 2, 0.165, 0.04, 0.165), C.logDark, {}],
    ],
    tuft: () => {                                      // mata de hierba (instanciada, sin balanceo)
      const out = [];
      for (let k = 0; k < 4; k++) out.push([prim().blade, m((k % 2 - 0.5) * 0.12, 0, (k > 1 ? 0.06 : -0.05), 0.25 * (k - 1.5), k * 0.9, 0.1 * (k - 1.5), 1, 0.22 + 0.05 * k, 1), C.leaf, {}]);
      return out;
    },
  };
  W.MODULES = DEF;

  // reparto por tipo: matrices y tintes
  const lists = new Map();
  const _t = new THREE.Color();
  W.M = {
    put(name, x, y, z, o) {
      o = o || {};
      const s = o.s || 1;
      let L = lists.get(name);
      if (!L) { L = { mats: [], tints: [] }; lists.set(name, L); }
      L.mats.push(m(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, (o.sx || 1) * s, (o.sy || 1) * s, (o.sz || 1) * s));
      _t.set(o.tint == null ? 0xffffff : o.tint);
      L.tints.push(_t.r, _t.g, _t.b);
    },
    count(name) { const L = lists.get(name); return L ? L.mats.length : 0; },
    // sombras: solo los módulos con volumen (no la hierba, flores, musgo...)
    // (día nublado: las sombras del sol son suaves; solo las piezas con altura que se notan)
    CAST: { tomb: 1, cross: 1, terminal: 1, beacon: 1, log: 1 },
    build(scene, material, depthMat) {
      const out = { meshes: 0, instances: 0, tris: 0, types: {} };
      for (const [name, L] of lists) {
        const b = new W.GeoBuilder();
        for (const [g, mm, col, op] of DEF[name]()) b.add(g, mm, col, op);
        const geo = b.build();
        const mesh = new THREE.InstancedMesh(geo, material, L.mats.length);
        L.mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(L.tints), 3);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;                    // instancias por todo el mapa
        mesh.castShadow = !!this.CAST[name]; mesh.receiveShadow = true;
        if (mesh.castShadow && depthMat) mesh.customDepthMaterial = depthMat;
        scene.add(mesh);
        const tris = geo.attributes.position.count / 3;
        out.meshes++; out.instances += L.mats.length; out.tris += tris * L.mats.length;
        out.types[name] = { n: L.mats.length, tris };
      }
      W.moduleStats = out;
      return out;
    },
  };
})();
