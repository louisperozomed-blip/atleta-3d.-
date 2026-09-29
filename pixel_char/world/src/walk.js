// walk.js — ETAPA 3: mejoras SOLO de la animación de caminar (sin redibujar al personaje).
// Variantes acumulativas (se eligen en el visor y en el botón "andar" de la demo):
//   A  original: 6 frames iguales, zancada fija 0.72 H
//   B  tiempos no uniformes: los frames de contacto duran más que los de paso
//   C  B + bob vertical, balanceo lateral y squash muy ligero en cada apoyo
//   D  C + túnica con retraso (deformación del sprite en la franja cintura-bajo)
//   E  D + pies sin patinar: zancada medida por dirección y reparto del avance medido por frame
// Los datos medidos (tools/walk_measure.py -> assets/walk_variants.json) llegan en W.WALK_DATA.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  W.WALK_MODES = ["A", "B", "C", "D", "E"];
  W.WALK_LABELS = { A: "Original", B: "Tiempos", C: "+Bob/balanceo", D: "+Túnica", E: "+Zancada medida" };
  W.walkMode = "E";

  // valores por defecto (se sustituyen por los medidos)
  const D0 = { stride: {}, contact: {}, advance: {}, spread: {} };
  DIRS.forEach((d) => { D0.stride[d] = 0.72; D0.contact[d] = [1, 0, 1, 0, 1, 0]; D0.advance[d] = [1, 1, 1, 1, 1, 1]; D0.spread[d] = [1, 0.5, 1, 0.5, 1, 0.5]; });
  function data() { return W.WALK_DATA || D0; }

  function has(mode, feat) {
    const i = W.WALK_MODES.indexOf(mode);
    return i >= W.WALK_MODES.indexOf(feat);
  }
  // pesos (duración relativa) de cada frame en el ciclo
  function weights(mode, dir) {
    const d = DIRS[dir], D = data();
    if (has(mode, "E")) {
      const a = D.advance[d], s = a.reduce((x, y) => x + y, 0) || 1;
      return a.map((v) => 0.55 * v / s + 0.45 / 6);           // reparto medido (+ mínimo para no saltarse frames)
    }
    if (has(mode, "B")) {
      const c = D.contact[d];
      const w = c.map((k) => (k ? 1.3 : 0.85)), s = w.reduce((x, y) => x + y, 0);
      return w.map((v) => v / s);
    }
    return [1, 1, 1, 1, 1, 1].map((v) => v / 6);
  }
  W.walkWeights = weights;
  W.walkStride = function (mode, dir, anim) {
    if (anim === "run") return 1.35;
    return has(mode, "E") ? data().stride[DIRS[dir]] : 0.72;
  };
  // frame a partir de la fase (0..1) con los pesos de la variante
  W.walkFrameFor = function (mode, dir, phase) {
    const w = weights(mode, dir);
    let acc = 0;
    for (let i = 0; i < 6; i++) { acc += w[i]; if (phase < acc) return { f: i, u: (phase - (acc - w[i])) / w[i] }; }
    return { f: 5, u: 1 };
  };
  // Movimiento secundario: bob, balanceo, squash y túnica. st = estado persistente por personaje.
  W.walkFx = function (mode, dir, phase, fi, dt, st, speedK, turnRate) {
    const out = { bob: 0, sway: 0, sx: 1, sy: 1, warpX: 0, warpY: 0 };
    const D = data(), d = DIRS[dir];
    if (!has(mode, "C")) {
      // bob original (el de la demo anterior): dos golpes por ciclo
      out.bob = 0.011 * Math.pow(Math.sin(phase * 2 * Math.PI), 2) * speedK;
      return out;
    }
    // bob: alto cuando los pies están juntos (paso), bajo en el contacto; interpolado entre frames
    const sp = D.spread[d], mx = Math.max.apply(null, sp), mn = Math.min.apply(null, sp);
    const n0 = (sp[fi.f] - mn) / (mx - mn || 1), n1 = (sp[(fi.f + 1) % 6] - mn) / (mx - mn || 1);
    const sepN = n0 + (n1 - n0) * fi.u;
    out.bob = (1 - sepN) * 0.016 * speedK;                      // en alturas de personaje
    // balanceo lateral: hacia la pierna de apoyo, un periodo por ciclo
    out.sway = Math.sin(phase * 2 * Math.PI) * 0.009 * speedK;
    // squash muy ligero al apoyar (se detecta la entrada en un frame de contacto)
    const contact = D.contact[d][fi.f];
    if (contact && st.lastF !== fi.f) st.squashT = 0;
    st.lastF = fi.f;
    st.squashT = (st.squashT == null ? 1 : st.squashT) + dt;
    const sq = Math.exp(-st.squashT * 14) * speedK;
    out.sy = 1 - 0.022 * sq; out.sx = 1 + 0.012 * sq;
    // túnica: sigue al balanceo y a los giros con retraso (resorte amortiguado, sin temblor)
    if (has(mode, "D")) {
      const target = -out.sway * 1.6 - (turnRate || 0) * 0.004 * speedK;
      const k = 38, c = 2 * Math.sqrt(k) * 0.9;
      st.cv = (st.cv || 0) + ((target - (st.cx || 0)) * k - (st.cv || 0) * c) * dt;
      st.cx = (st.cx || 0) + st.cv * dt;
      out.warpX = st.cx;                                         // fracción del ancho del frame
      out.warpY = -0.006 * (1 - sepN) * speedK;                  // el bajo sube un poco en el paso
    } else { st.cx = 0; st.cv = 0; }
    return out;
  };
})();
