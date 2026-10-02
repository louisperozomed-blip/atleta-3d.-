// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/calib.js
// Calibración de latencia: el cálculo (mediana) y el valor. Sin la prueba en el DOM.
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
// calib.js — calibración de la latencia táctil para el parry (como en los juegos de ritmo).
// Panel de pruebas ⚙ → «Latencia»: deslizador en ms y botón «calibrar». La prueba da 10 pulsos (destello + clic)
// cada 0.75 s; tocas el círculo (o K) a su ritmo y la mediana de tu desfase (sin los dos primeros) desplaza la
// ventana del parry (W.COMBAT.calib, + = tus pulsaciones llegan tarde). Se recuerda en este navegador.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const KEY = "bosque.parryCalib";
  const clampC = (v) => Math.max(-60, Math.min(150, Math.round(v / 5) * 5));
  function load() { try { const v = localStorage.getItem(KEY); if (v != null && isFinite(+v)) W.COMBAT.calib = clampC(+v); } catch (_) {} }
  function save(v) { try { localStorage.setItem(KEY, String(v)); } catch (_) {} }
  W.setCalib = function (v) {
    W.COMBAT.calib = clampC(v); save(W.COMBAT.calib);
    const i = document.getElementById("dCalib"); if (i) { i.value = W.COMBAT.calib; i.nextElementSibling.textContent = fmt(W.COMBAT.calib); }
    return W.COMBAT.calib;
  };
  const fmt = (v) => (v > 0 ? "+" : "") + v + "ms";
  // desfase de una serie de toques respecto a los pulsos (ms): mediana sin los dos primeros
  W.calibFrom = function (beats, taps) {
    const d = [];
    beats.forEach((b, i) => {
      if (i < 2) return;
      let best = null;
      for (const t of taps) if (Math.abs(t - b) < 300 && (best == null || Math.abs(t - b) < Math.abs(best))) best = t - b;
      if (best != null) d.push(best);
    });
    if (d.length < 4) return null;
    d.sort((x, y) => x - y);
    return clampC(d[d.length >> 1]);
  };
  // [VISUAL OMITIDO: prueba de ritmo en el DOM (10 pulsos cada 750 ms tras 1 s; cada toque guarda su
  //  event.timeStamp; al acabar, W.calibFrom(pulsos, toques) y W.setCalib) y el panel]
})();
