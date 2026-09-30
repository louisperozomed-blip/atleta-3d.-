// enemies/core.js — tipos de enemigo registrados, aparición, paso, reaparición y panel de pruebas.
//
// Cada tipo vive en su propio módulo (src/enemies/<tipo>/) y se registra con W.registerEnemy(id, def):
//   def.label                        nombre en el panel
//   def.spawnPoints()                [{x, z, heading, zone}] dónde aparece
//   def.spawn(p, assets)             crea y devuelve el luchador (W.Fighter con .body, .ch, .ai, .home)
//   def.update(f, dt)                (opcional) cosas propias en cada paso (luces, desvanecerse...)
//   def.onFrame(f, a) / def.onAct(f, actor, act)   (opcionales) ganchos de animación y de acciones ajenas
//   def.respawn(f)                   (opcional) reaparición propia
//   def.remove(f)                    (opcional) limpieza al cambiar de tipo
// Tipo por defecto: "automaton" (el Autómata del bosque). El eco de pruebas sigue disponible: selector
// «Enemigo» del panel de pruebas (⚙), W.setEnemyType("echo") o la dirección con #enemy=echo.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const TYPES = (W.ENEMY_TYPES = W.ENEMY_TYPES || {});
  const foes = (W.foes = W.foes || []);
  W.registerEnemy = function (id, def) { def.id = id; TYPES[id] = def; };
  const m = /enemy=(\w+)/.exec(location.hash || "");
  W.enemyType = m ? m[1] : "automaton";
  // dificultad (la usa el autómata): reacción (×), frecuencia de parry y de bloqueo (0..1)
  W.ENEMY_DIFF = W.ENEMY_DIFF || { react: 1, parry: 0.3, block: 0.35 };

  function removeFoe(f) {
    const def = TYPES[f.type];
    if (def && def.remove) def.remove(f);
    const ch = f.ch;
    for (const o of [ch.mesh, ch.ghost, ch.caster, ch.blob, ...(ch.boots || [])]) if (o && o.parent) o.parent.remove(o);
    if (ch.sticker && ch.sticker.parentElement) ch.sticker.remove();
    const i = W.fighters.indexOf(f); if (i >= 0) W.fighters.splice(i, 1);
  }
  W.spawnEnemies = function (type) {
    type = type || W.enemyType;
    while (foes.length) removeFoe(foes.pop());
    if (type === "none") { W.enemyType = type; W.foe = null; return foes; }     // sin enemigos (pruebas del mundo)
    if (!TYPES[type]) type = Object.keys(TYPES)[0];
    W.enemyType = type;
    const def = TYPES[type];
    for (const p of def.spawnPoints()) {
      const f = def.spawn(p, W.assets);
      f.type = type; f.zone = p.zone;
      foes.push(f);
    }
    W.foe = foes[0] || null;
    W.combatLog && W.combatLog.push({ ev: "enemies", type, n: foes.length, t: W.U ? +W.U.uTime.value.toFixed(3) : 0 });
    const sel = document.getElementById("enemySel"); if (sel) sel.value = type;
    return foes;
  };
  W.setEnemyType = function (t) { return W.spawnEnemies(t); };

  W.updateFoes = function (dt, theta, thetaT) {
    for (const f of foes) {
      const def = TYPES[f.type];
      if (f.hidden) continue;
      if (f.ai && dt > 0) f.ai.update(dt);           // cada IA mira su propio "enabled"
      f.update(dt);
      f.body.update(dt);
      f.ch.update(dt, f.body, theta, thetaT);
      if (def.update) def.update(f, dt);
    }
    // botón REAPARECER: se ilumina si algún enemigo o el jugador han muerto
    const rb = document.getElementById("respawn");
    if (rb) {
      const need = foes.some((f) => !f.alive) || (W.pf && !W.pf.alive);
      if (rb._shown !== need) { rb._shown = need; rb.classList.toggle("hot", need); }
    }
  };
  W.respawnAll = function () {
    for (const f of foes) {
      const def = TYPES[f.type];
      if (def.respawn) def.respawn(f);
      else { f.respawn(f.home.x, f.home.z); f.body.heading = f.home.heading; }
      f.hidden = false;
    }
    const p = W.pf;
    if (p && !p.alive) p.respawn();
    W.combatLog.push({ ev: "respawn", t: +W.U.uTime.value.toFixed(3) });
  };
  // ganchos de animación: el de cada tipo
  W.onCombatFrameExtra = function (f, a) {
    const def = f.type && TYPES[f.type];
    if (def && def.onFrame) def.onFrame(f, a);
  };
  // acciones de cualquiera (p. ej. el jugador empieza un ataque): los enemigos pueden reaccionar
  W.onCombatAct = function (actor, act) {
    for (const f of foes) { const def = TYPES[f.type]; if (def.onAct && f !== actor) def.onAct(f, actor, act); }
  };

  // ---- panel de pruebas (⚙): tipo de enemigo y dificultad -----------------------------------------
  W.initFoeUI = function () {
    const rb = document.getElementById("respawn");
    if (rb && !rb._wired) { rb._wired = true; rb.addEventListener("click", (e) => { e.stopPropagation(); W.respawnAll(); }); }
    if (document.getElementById("tpanel")) return;
    const wrap = document.getElementById("wrap");
    const btn = document.createElement("button");
    btn.id = "tbtn"; btn.textContent = "⚙"; btn.setAttribute("aria-label", "Panel de pruebas"); btn.setAttribute("aria-expanded", "false");
    const pn = document.createElement("div");
    pn.id = "tpanel"; pn.hidden = true;
    const opts = Object.entries(TYPES).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join("");
    pn.innerHTML = `<div class="tt">PRUEBAS</div>
      <label>Enemigo <select id="enemySel">${opts}</select></label>
      <label>Reacción <input id="dReact" type="range" min="0.5" max="1.6" step="0.1"><output id="oReact"></output></label>
      <label>Parry <input id="dParry" type="range" min="0" max="0.9" step="0.05"><output id="oParry"></output></label>
      <label>Bloqueo <input id="dBlock" type="range" min="0" max="0.9" step="0.05"><output id="oBlock"></output></label>
      <button id="tResp">reaparecer enemigos</button>`;
    wrap.appendChild(btn); wrap.appendChild(pn);
    const css = document.createElement("style");
    css.textContent = `#tbtn{position:absolute;right:calc(12px + env(safe-area-inset-right,0px));top:calc(12px + env(safe-area-inset-top,0px));min-width:40px;min-height:40px;
        font:inherit;font-size:14px;color:var(--ink);background:var(--panel);border:2px solid var(--edge);cursor:pointer}
      #tpanel{position:absolute;right:calc(12px + env(safe-area-inset-right,0px));top:calc(60px + env(safe-area-inset-top,0px));width:230px;padding:10px;
        background:rgba(10,18,26,.92);border:2px solid var(--edge);font-size:8px;line-height:1.5;display:flex;flex-direction:column;gap:8px;z-index:6}
      #tpanel[hidden]{display:none}#tpanel .tt{color:var(--dim)}#tpanel label{display:grid;grid-template-columns:62px 1fr 34px;align-items:center;gap:6px}
      #tpanel select,#tpanel button{font:inherit;font-size:8px;color:var(--ink);background:#0d1a26;border:1px solid var(--edge);min-height:32px}
      #tpanel select{grid-column:2/4}#tpanel input{width:100%}#tpanel output{text-align:right}`;
    document.head.appendChild(css);
    btn.addEventListener("click", (e) => { e.stopPropagation(); pn.hidden = !pn.hidden; btn.setAttribute("aria-expanded", String(!pn.hidden)); });
    for (const ev of ["pointerdown", "click"]) pn.addEventListener(ev, (e) => e.stopPropagation());
    const sel = pn.querySelector("#enemySel"); sel.value = W.enemyType;
    sel.addEventListener("change", () => W.setEnemyType(sel.value));
    const D = W.ENEMY_DIFF;
    const bind = (id, key, fmt) => {
      const i = pn.querySelector("#" + id), o = i.nextElementSibling;
      i.value = D[key]; o.textContent = fmt(D[key]);
      i.addEventListener("input", () => { D[key] = +i.value; o.textContent = fmt(D[key]); });
    };
    bind("dReact", "react", (v) => "×" + (+v).toFixed(1));
    bind("dParry", "parry", (v) => Math.round(v * 100) + "%");
    bind("dBlock", "block", (v) => Math.round(v * 100) + "%");
    pn.querySelector("#tResp").addEventListener("click", () => W.respawnAll());
  };
})();
