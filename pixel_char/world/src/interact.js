// interact.js — el personaje afecta al entorno: ondas al pisar charcas, polvo luminoso
// al aterrizar (la hierba y las esporas reaccionan en core.js / effects.js vía uPlayer).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  let idleT = 0;
  let stepSlot = 0;
  // terreno bajo el pie -> tipo de impacto
  function surfaceKind(x, z) {
    if (W.surfaceAt) return W.surfaceAt(x, z);      // feel.js: agua, hojas, metal, piedra, tierra, hierba
    const k = W.kindAt(x, z), K = W.K;
    if (k === K.PUDDLE) return "water";
    if (k === K.PATH || k === K.PLAZA) return "dust";
    if (k === K.STONE) return "stone";
    return "grass";
  }
  const PAL = {
    dust: { pal: [[0.62, 0.66, 0.62], [0.5, 0.52, 0.5], [0.72, 0.74, 0.68]], spd: 0.55, up: 0.55, life: 0.45, n: 7 },
    stone: { pal: [[0.6, 0.64, 0.7], [0.45, 0.5, 0.56], [0.36, 0.62, 0.42]], spd: 0.6, up: 0.6, life: 0.4, n: 5 },
    water: { pal: [[0.75, 0.97, 1], [0.5, 0.88, 0.95], [1, 1, 1]], spd: 0.7, up: 1.6, life: 0.45, n: 9 },
    grass: { pal: [[0.3, 0.42, 0.33], [0.36, 0.48, 0.38], [0.42, 0.55, 0.42]], spd: 0.5, up: 1.0, life: 0.5, n: 6 },
    // hojas secas que saltan al pisar (crujido), chispa mínima en el metal
    leaves: { pal: [[0.45, 0.28, 0.2], [0.36, 0.3, 0.22], [0.5, 0.36, 0.24]], spd: 0.75, up: 1.5, life: 0.75, n: 7 },
    metal: { pal: [[1, 0.9, 0.62], [1, 0.72, 0.36], [1, 0.95, 0.8]], spd: 1.5, up: 1.7, life: 0.22, n: 2 },
  };
  W.afterCharacter = function (dt) {
    const p = W.player, fx = W.fx, st = W.character.st;
    const surf = p.ground + 0.045;
    // --- impacto de cada pisada (eventos del anclaje de pies) --------------------------------
    const evs = W.stepEvents || [];
    if (W.FX.impact) {
      for (const e of evs) {
        const kind = surfaceKind(e.x, e.z), P = PAL[kind], run = e.anim === "run";
        // pisadas de otros personajes (enemigos): cada uno las trata a su manera (el autómata: pesadas)
        const ec = e.ch || W.character;
        if (ec !== W.character) {
          if (ec.onStep) ec.onStep(e, kind, P);
          else { fx.dust(e.x, W.heightAt(e.x, e.z), e.z, P.n, P); if (W.sfx) W.sfx.step(kind, 0.5); }
          continue;
        }
        const y = W.heightAt(e.x, e.z);
        fx.dust(e.x, kind === "water" ? y + 0.045 : y, e.z, Math.round(P.n * (run ? 1.5 : 1)), P);
        if (kind === "water") fx.ripple(e.x, y + 0.045, e.z, run ? 0.7 : 0.5);
        else if (kind !== "metal") fx.footprint(e.x, y, e.z, e.heading, kind === "grass" || kind === "leaves" ? 0.22 : 0.38);
        // hierba aplastada un momento
        const s = W.U.uSteps.value[stepSlot++ % 4];
        s.x = e.x; s.y = e.z; s.z = W.U.uTime.value; s.w = run ? 1 : 0.8;
        // peso: el cuerpo se hunde en el contacto
        const fresh = st.dipT != null && st.dipT < 0.05 ? st.dipA : 0;
        st.dipT = 0; st.dipA = Math.max(run ? 2.0 : 1.5, fresh);
        if (W.sfx) W.sfx.step(kind, run ? 1 : 0.7);
        W.__steps = (W.__steps || 0) + 1;
        (W.stepLog || (W.stepLog = [])).push({ t: W.U.uTime.value, kind });
      }
    }
    evs.length = 0;
    if (W.FX.impact) {
      if (p.inWater && !p.jump && st.anim === "idle") { idleT += dt; if (idleT > 1.4) { idleT = 0; fx.ripple(p.x, surf, p.z, 0.35); } }
      for (const e of p.events) if (e.type === "land") { fx.dust(p.x, p.ground, p.z, 18); if (p.inWater) { fx.ripple(p.x, surf, p.z, 0.9); fx.ripple(p.x, surf, p.z, 0.5); } if (W.sfx) W.sfx.step(surfaceKind(p.x, p.z), 1.2); }
      p.events.length = 0;
      return;
    }
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
