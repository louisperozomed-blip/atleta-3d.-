// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/feet.js (EXTRACTO)
// Velocidad de la marcha a partir de los pies dibujados (cadencia fija 12 fps). El resto de feet.js (deformar la pierna
// apoyada para que la bota no patine) es visual.
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
(function () {
  const W = window.W; const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  // Locomoción guiada por los pies: cadencia fija, velocidad = lo que avanza el pie dibujado +
  // lo que la pierna apoyada puede absorber durante un apoyo (MAXW texeles), por dirección.
  const MAXW = { walk: 15, run: 16 };
  // ch (opcional): el personaje dueño de los pies (el enemigo tiene su propio atlas, pies y escala)
  W.locoParams = function (anim, dir, ch) {
    const FS = (ch && ch.feet) || W.FEET;
    const F = FS && FS[anim + "_" + DIRS[dir]];
    const fps = (ch && ch.locoFps) || 12;
    if (!F) return null;
    const c = F.contact;
    const tex = ch && ch.feet ? ch.unitsH : W.CHAR_H * Math.cos(W.CAM_EL) / 103;   // u de pantalla por texel del atlas del mundo
    if (anim === "walk") {
      // hueco máximo entre contactos (en frames, cíclico)
      let gap = 0;
      for (let i = 0; i < 6; i++) if (c[i]) { let k = 1; while (!c[(i + k) % 6] && k < 6) k++; gap = Math.max(gap, k); }
      const T = gap / fps;
      const v = F.art * fps / 6 + 0.64 * MAXW.walk * tex / F.f / T;
      return { v: ch && ch.vFree ? v : Math.min(1.25, Math.max(0.8, v)), fps, weights: [1, 1, 1, 1, 1, 1].map((x) => x / 6), contact: c, maxw: MAXW.walk };
    }
    // run: contactos cortos (el pie solo está en el suelo un instante), vuelo más largo
    const w = c.map((k) => (k ? 0.55 : 1.1)), sw = w.reduce((a, b) => a + b, 0);
    return { v: null, fps, weights: w.map((x) => x / sw), contact: c, maxw: MAXW.run };
  };

})();
