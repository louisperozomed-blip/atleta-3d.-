// interact.js — el personaje afecta al entorno: ondas al pisar charcas, polvo luminoso
// al aterrizar (la hierba y las esporas reaccionan en core.js / effects.js vía uPlayer).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  let idleT = 0;
  W.afterCharacter = function (dt) {
    const p = W.player, fx = W.fx, st = W.character.st;
    const surf = p.ground + 0.045;
    if (st.anim === "walk" || st.anim === "run") {
      // dos pisadas por ciclo: fase 0 y 0.5
      const q = Math.floor(st.phase * 2);
      if (q !== st.lastStepQ) {
        st.lastStepQ = q;
        if (p.inWater) {
          const side = q ? 1 : -1, hx = -Math.sin(p.heading) * 0.12 * side, hz = Math.cos(p.heading) * 0.12 * side;
          fx.ripple(p.x + hx, surf, p.z + hz, st.anim === "run" ? 0.75 : 0.55);
        }
      }
      idleT = 0;
    } else if (p.inWater && !p.jump) {
      idleT += dt;
      if (idleT > 1.4) { idleT = 0; fx.ripple(p.x, surf, p.z, 0.35); }
    }
    for (const e of p.events) {
      if (e.type === "land") {
        fx.dust(p.x, p.ground, p.z, 18);
        if (p.inWater) { fx.ripple(p.x, surf, p.z, 0.9); fx.ripple(p.x, surf, p.z, 0.5); }
      }
    }
    p.events.length = 0;
  };
})();
