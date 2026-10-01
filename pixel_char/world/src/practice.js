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
  const EXTRA = [["dos+delay", "zarpazo y barrido · retrasado"], ["dos+feint", "zarpazo y barrido · finta"], ["rrl+delay", "rápido-rápido-lento · retrasado"]];
  const HINT = { sweep: "BARRIDO → salta", thrust: "ESTOCADA → esquiva hacia él", grab: "AGARRE → esquiva de lado" };

  // ---- modo entrenamiento -----------------------------------------------------------------------------
  W.setTraining = function (id) {
    T.on = !!id; T.id = id || ""; T.reps = 0;
    const [chain, trick] = (id || "").split("+");
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
    const r = W.timingText(info); if (r) show(r[0], r[1]);
  };
  W.onLatePress = function (late) { if (T.on) show("TARDE · " + Math.round(late * 1000) + " ms", "#ff6a4a"); };

  // ---- HUD del duelo: barras de postura centrales + ventana de contraataque --------------------------------
  let hud = null;
  function makeHud() {
    const wrap = document.getElementById("wrap");
    const top = document.createElement("div"); top.id = "duelE";
    top.innerHTML = `<div class="dn"></div><div class="pb"><i></i></div>`;
    const bot = document.createElement("div"); bot.id = "duelP";
    bot.innerHTML = `<div class="tmg"></div><div class="pb"><i></i></div><div class="cw"><i></i></div><div class="dl">POSTURA</div>`;
    wrap.appendChild(top); wrap.appendChild(bot);
    const css = document.createElement("style");
    css.textContent = `#duelE,#duelP{position:absolute;left:50%;transform:translateX(-50%);pointer-events:none;text-align:center;display:none;z-index:4}
      #duelE{top:calc(14px + env(safe-area-inset-top,0px))}#duelP{bottom:calc(64px + env(safe-area-inset-bottom,0px))}
      #duelE .dn{font-size:8px;color:#9fe8ff;margin-bottom:4px;text-shadow:1px 1px 0 #000}#duelP .dl{font-size:6px;color:var(--dim);margin-top:3px}
      .pb{width:min(46vw,260px);height:8px;margin:0 auto;background:rgba(0,0,0,.6);border:1px solid #4a3426;position:relative;overflow:hidden}
      .pb i{position:absolute;top:0;bottom:0;left:50%;width:0;transform:translateX(-50%);background:#ffd27a;transition:width .08s}
      .pb.hi i{background:#ff7a3a}.pb.max i{background:#ff4a2a;animation:pbp .25s infinite alternate}@keyframes pbp{to{filter:brightness(1.6)}}
      #duelP .cw{width:min(46vw,260px);height:4px;margin:3px auto 0;position:relative;visibility:hidden}#duelP .cw.on{visibility:visible}
      #duelP .cw i{position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);background:#ffd34a;box-shadow:0 0 8px #ffb020}
      #duelP .tmg{font-size:10px;min-height:14px;margin-bottom:5px;text-shadow:2px 2px 0 #000,-1px -1px 0 #000}`;
    document.head.appendChild(css);
    tmg = bot.querySelector(".tmg");
    return { top, bot, dn: top.querySelector(".dn"), eb: top.querySelector(".pb"), ei: top.querySelector(".pb i"), pb: bot.querySelector(".pb"), pi: bot.querySelector(".pb i"), cw: bot.querySelector(".cw"), ci: bot.querySelector(".cw i") };
  }
  const setBar = (box, el, f) => { el.style.width = (100 * Math.max(0, Math.min(1, f))).toFixed(1) + "%"; box.classList.toggle("hi", f >= 0.7 && f < 0.999); box.classList.toggle("max", f >= 0.999); };
  // enemigo «en combate»: el más cercano, vivo, a menos de 9 u (o en entrenamiento)
  W.duelFoe = function () {
    const p = W.pf; if (!p) return null;
    let e = null, bd = 1e9;
    for (const f of W.foes || []) { if (!f.alive || f.hidden) continue; const d = Math.hypot(f.body.x - p.body.x, f.body.z - p.body.z); if (d < bd) { bd = d; e = f; } }
    return e && (bd < 9 || T.on) ? e : null;
  };
  W.practiceAfter = function (dt) {
    if (!hud) { if (!document.getElementById("wrap") || !W.pf) return; hud = makeHud(); }
    W.trainingStep();
    const p = W.pf, e = W.duelFoe(), on = !!e && p.alive;
    if (hud._on !== on) { hud._on = on; hud.top.style.display = hud.bot.style.display = on ? "block" : "none"; }
    if (tmg) { tmgT += dt; if (tmgT > 1.2) tmg.style.opacity = Math.max(0, 1 - (tmgT - 1.2) / 0.4); }
    if (!on) return;
    // colocación: justo encima de la barra de botones y, si la pantalla es estrecha, a la izquierda de GUARDIA
    hud.layT = (hud.layT || 0) - dt;
    if (hud.layT <= 0) {
      hud.layT = 0.5;
      const bar = document.querySelector(".bar"), gb = document.getElementById("guard");
      const bt = bar && bar.offsetParent ? bar.getBoundingClientRect().top : innerHeight - 10;
      hud.bot.style.bottom = Math.round(innerHeight - bt + 8) + "px";
      const wB = hud.bot.getBoundingClientRect().width;
      let cx = innerWidth / 2;
      if (gb && gb.offsetParent) { const g = gb.getBoundingClientRect(); if (cx + wB / 2 > g.left - 8 && g.top < bt) cx = Math.max(wB / 2 + 8, g.left - 8 - wB / 2); }
      hud.bot.style.left = Math.round(cx) + "px";
      // la suya: arriba en el centro; en pantallas estrechas, bajo el botón ⚙ (sin pisar el título ni tus barras)
      const tb = document.getElementById("tbtn"), narrow = innerWidth < 600;
      if (narrow && tb && tb.offsetParent) { const r = tb.getBoundingClientRect(), wE = hud.top.getBoundingClientRect().width;
        hud.top.style.top = Math.round(r.bottom + 8) + "px"; hud.top.style.left = Math.round(innerWidth - 12 - wE / 2) + "px"; }
      else { hud.top.style.top = ""; hud.top.style.left = ""; }
    }
    const nm = (e.label || "ECO") + (e.stunned ? " · ATURDIDO" : T.on ? " · ENTRENAMIENTO" : "");
    if (hud.dn.textContent !== nm) hud.dn.textContent = nm;
    setBar(hud.eb, hud.ei, e.post / e.postMax);
    setBar(hud.pb, hud.pi, p.post / p.postMax);
    const ru = W.duelRipUntil ? W.duelRipUntil(p) : 0;     // ventana de riposte (duel.js)
    const cw = ru > W.ct ? (ru - W.ct) / W.duelRipSpan(p) : Math.max(0, Math.max(p.counterT, p.airCounterT || 0) - W.ct) / W.COMBAT.counterWin, con = cw > 0;
    if (hud.cw._on !== con) { hud.cw._on = con; hud.cw.classList.toggle("on", con); }
    if (con) hud.ci.style.width = (100 * Math.min(1, cw)).toFixed(1) + "%";
  };
})();
