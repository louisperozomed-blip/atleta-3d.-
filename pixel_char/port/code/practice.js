// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/practice.js
// Modo entrenamiento (lógica) y textos de timing. Sin las barras centrales del DOM.
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
// practice.js — práctica y lectura del duelo.
//  · MODO ENTRENAMIENTO (panel ⚙ → «Entrenar»): el autómata más cercano repite la cadena elegida (con su retraso o
//    su finta si se elige así), sin leerte ni defenderse; ni él ni tú morís. Tras cada golpe suyo aparece un
//    indicador pequeño: cuántos ms antes del impacto pulsaste y el nivel (PERFECTO / PARRY / BLOQUEO / PRONTO),
//    o cuánto llegaste TARDE; en los peligrosos, la respuesta correcta si fallas
//  · BARRAS DE POSTURA de los dos siempre visibles en combate (arriba la suya, abajo la tuya; crecen desde el
//    centro, como en Sekiro) y el indicador de la VENTANA DE CONTRAATAQUE bajo la tuya
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const T = (W.TRAINING = { on: false, id: "", reps: 0 });
  const EXTRA = [["dos+delay", "zarpazo y barrido · retrasado"], ["dos+feint", "zarpazo y barrido · finta"], ["rrl+delay", "rápido-rápido-lento · retrasado"],
    ["riposte", "RIPOSTE · desvía y contraataca (ritmo del 3.º)"], ["fodder", "RELLENO · ms antes del impacto y nivel"]];
  const HINT = { sweep: "BARRIDO → salta", thrust: "ESTOCADA → esquiva hacia él", grab: "AGARRE → esquiva de lado" };

  // ---- modo entrenamiento -----------------------------------------------------------------------------
  W.setTraining = function (id) {
    T.on = !!id; T.id = id || ""; T.reps = 0;
    // riposte: siempre la misma cadena (zarpazo y barrido, sin trucos ni ramas) para practicar el parry perfecto y
    // el ritmo del riposte; tras el 3.er golpe dice si acertaste el ritmo y por cuántos ms
    const [chain, trick] = id === "riposte" ? ["dos", null] : (id || "").split("+");
    T.rip = id === "riposte"; T.ripStats = { ok: 0, n: 0 };
    for (const f of W.foes || []) {
      if (f.type !== "automaton" || !f.ai) continue;
      const ai = f.ai;
      ai.training = T.on; ai.forced = T.on ? chain : null; ai.forcedTrick = T.on && trick ? trick : null; ai.noTricks = T.on && !trick;
      ai.commit = null; ai.react1 = null; ai.chain = null; ai.cool = 0.6; ai.passive = false;
    }
    const sel = document.getElementById("trainSel"); if (sel && sel.value !== T.id) sel.value = T.id;
    W.combatLog.push({ ev: "training", id: T.id, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 });
  };
  // en entrenamiento nadie muere
  W.trainingStep = function () {
    if (!T.on) return;
    const p = W.pf;
    if (p && p.alive && p.hp < p.hpMax * 0.35) p.hp = p.hpMax;
    for (const f of W.foes || []) if (f.type === "automaton" && f.alive && f.hp < f.hpMax * 0.35) f.hp = f.hpMax;
  };
  W.initTrainingUI = function (pn) {
    if (!pn || pn.querySelector("#trainSel")) return;
    const row = document.createElement("label");
    const chains = (W.AUTOMATON && W.AUTOMATON.chains) || [];
    row.innerHTML = `Entrenar <select id="trainSel"><option value="">— pelea normal —</option>${chains.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}${EXTRA.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>`;
    const sel = pn.querySelector("#enemySel"); const at = sel ? sel.parentElement.nextSibling : null;
    pn.insertBefore(row, at);
    row.querySelector("select").addEventListener("change", (e) => W.setTraining(e.target.value));
  };

  // ---- indicador de timing (entrenamiento) ------------------------------------------------------------
  let tmg = null, tmgT = 9;
  function show(txt, col) {
    if (!tmg) return;
    tmg.textContent = txt; tmg.style.color = col; tmgT = 0; tmg.style.opacity = 1;
    W.lastTiming = txt;
  }
  W.timingText = function (info) {
    if (info.perilous) return info.how === "hit" ? [HINT[info.move] || "PELIGRO", "#ff6a4a"] : [{ jump: "¡SALTO!", mikiri: "¡CONTRAATAQUE!", side: "¡DE LADO!", dodge: "ESQUIVA" }[info.how] || "ESQUIVA", "#9fe8c8"];
    const ms = info.early != null && isFinite(info.early) ? Math.round(info.early * 1000) : null;
    const pressed = ms != null && ms > -5 && ms < 700;
    if (info.def === "perfect") return ["PERFECTO · " + ms + " ms antes", "#ffd34a"];
    if (info.def === "parry") return ["PARRY · " + ms + " ms antes", "#ffe9b0"];
    if (info.def === "block") return [pressed ? "BLOQUEO · " + ms + " ms antes (pronto)" : "BLOQUEO", "#b8d8ff"];
    if (info.def === "evade") return ["ESQUIVA", "#9fe8c8"];
    if (info.def === "open") return [pressed && ms > 0 ? "PRONTO · " + ms + " ms antes" : "SIN GUARDIA", "#ff8a5a"];
    return null;
  }
  W.onDefenseInfo = function (info) {
    if (!T.on) return;
    const r = W.timingText(info); if (!r) return;
    // relleno: también el nivel del anillo con el que lo has hecho (2 = anillo completo, 1 = últimos 250 ms, 0 = sin anillo)
    if (info.fodder && W.fodderRingLevel) r[0] += " · nivel " + W.fodderRingLevel(info.fodder);
    show(r[0], r[1]);
  };
  W.onLatePress = function (late) { if (T.on) show("TARDE · " + Math.round(late * 1000) + " ms", "#ff6a4a"); };
  // ritmo del 3.er golpe del riposte (duel.js)
  W.ripBeatText = function (ok, err) {
    if (err == null) return ["RITMO · PRONTO (antes del 2.º golpe)", "#ff6a4a"];
    const ms = Math.round(err * 1000);
    return ok ? ["RITMO ✓ " + (ms >= 0 ? "+" : "") + ms + " ms", "#ffd34a"] : [(ms < 0 ? "RITMO · PRONTO " : "RITMO · TARDE +") + ms + " ms", "#ff6a4a"];
  };
  W.onRipBeat = function (ok, err) {
    if (!T.on) return;
    if (T.ripStats) { T.ripStats.n++; if (ok) T.ripStats.ok++; }
    const r = W.ripBeatText(ok, err); show(r[0] + (T.rip && T.ripStats ? " · " + T.ripStats.ok + "/" + T.ripStats.n : ""), r[1]);
  };

  // [VISUAL OMITIDO: barras de postura centrales y texto de timing en el DOM. W.practiceAfter llamaba a
  //  W.trainingStep() en cada paso: en Unity, llamar a trainingStep() desde el bucle.]
})();
