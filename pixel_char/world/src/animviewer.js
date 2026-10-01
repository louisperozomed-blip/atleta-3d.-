// animviewer.js — visor de animaciones del panel de pruebas (⚙ → «visor de animaciones»).
//
// Elige personaje (jugador o el autómata más cercano), animación (todas las de su atlas: locomoción, combate y
// las nuevas heavy/spin), dirección (las 8) y frame (anterior/siguiente o reproducir con los tiempos del atlas),
// con la luz del mundo o sin luz (el color de la hoja tal cual + emisión). Mientras está abierto, la IA del
// autómata se detiene y el personaje elegido no se mueve; la cámara se acerca. Muestra la fase de cada frame
// (preparación / carga / activo / recuperación) y su etiqueta de la hoja.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  const V = (W.ANIM_VIEW = { on: false, who: "jugador", anim: "heavy", dir: 0, f: 0, play: false, t: 0, lit: true, ch: null, zoom0: null });

  function target() {
    if (V.who === "jugador") return { ch: W.character, body: W.player, f: W.pf, meta: W.CMETA, base: W.character.meta };
    let e = null, bd = 1e9;
    for (const f of W.foes || []) { if (!f.alive || f.type !== "automaton") continue; const d = Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z); if (d < bd) { bd = d; e = f; } }
    if (!e) e = (W.foes || [])[0];
    return e ? { ch: e.ch, body: e.body, f: e, meta: e.ch.meta, base: e.ch.meta } : null;
  }
  function animInfo(T, an) {
    const M = (T.meta && T.meta.animations && T.meta.animations[an]) ? T.meta : (T.base && T.base.animations && T.base.animations[an] ? T.base : null);
    return M ? M.animations[an] : null;
  }
  function msOf(T, an) { const A = animInfo(T, an); return A && A.ms ? A.ms : [100, 100, 100, 100, 100, 100]; }
  function release() {
    if (V.ch) { V.ch.view = null; V.ch.uniforms.uUnlit.value = 0; }
    V.ch = null;
  }
  function apply() {
    const T = target(); if (!T) return;
    if (V.ch && V.ch !== T.ch) release();
    V.ch = T.ch;
    const list = T.ch.animList;
    if (list.indexOf(V.anim) < 0) V.anim = list.indexOf("heavy") >= 0 ? "heavy" : list[0];
    T.ch.view = { anim: V.anim, dir: V.dir, f: V.f };
    T.ch.uniforms.uUnlit.value = V.lit ? 0 : 1;
    if (T.f) { T.f.act = null; T.f.buf = null; }
    // el autómata se trae junto al jugador, a un sitio despejado (se devuelve a su sitio al cerrar)
    if (V.who !== "jugador" && T.f && !T.f._avPos) {
      const b = T.body, p = W.player;
      T.f._avPos = { x: b.x, z: b.z, h: b.heading };
      const s = W.findSpot(p.x + 2.6, p.z + 0.4, W.heightAt(p.x, p.z), 1.2) || W.findSpot(p.x - 2.6, p.z, null, 1.2);
      if (s) { b.x = s.x; b.z = s.z; b.y = b.ground = W.heightAt(s.x, s.z); }
      V.moved = T.f;
    }
    T.body.path.length = 0; T.body.speed = 0;
    for (const f of W.foes || []) if (f.ai) f.ai.enabled = false;
    W.camFocus = T.body;                              // la cámara se centra en el personaje del visor (main.js)
    if (V.zoom0 == null && W.ui) { V.zoom0 = W.ui.zoom; W.ui.zoom = Math.max(W.ui.zoom, 3.0); if (W.resize) W.resize(); }   // y se acerca
    render(T);
  }
  let el = null;
  function render(T) {
    if (!el) return;
    const list = T.ch.animList, sel = el.querySelector("#avAnim");
    if (sel._key !== list.join()) { sel.innerHTML = list.map((a) => `<option>${a}</option>`).join(""); sel._key = list.join(); }
    sel.value = V.anim;
    el.querySelector("#avWho").value = V.who;
    for (const b of el.querySelectorAll("[data-dir]")) b.setAttribute("aria-pressed", String(+b.dataset.dir === V.dir));
    el.querySelector("#avF").textContent = (V.f + 1) + "/6";
    el.querySelector("#avPlay").textContent = V.play ? "❚❚" : "▶";
    el.querySelector("#avLit").textContent = V.lit ? "con luz" : "sin luz";
    const A = animInfo(T, V.anim);
    const lab = A && A.etiquetas ? A.etiquetas[V.f] : "";
    const ph = A && A.fase ? A.fase[V.f] : "";
    const name = { prep: "preparación", carga: "carga (bucle)", hold: "retención (aviso)", activo: "ACTIVO", rec: "recuperación" }[ph] || ph || "";
    el.querySelector("#avInfo").textContent = `${V.anim} ${DIRS[V.dir]} · ${lab}${name ? " · " + name : ""} · ${msOf(T, V.anim)[V.f]} ms`;
  }
  W.initAnimViewerUI = function (pn) {
    const b = document.createElement("button");
    b.id = "avOpen"; b.textContent = "visor de animaciones";
    pn.appendChild(b);
    el = document.createElement("div");
    el.id = "aview"; el.hidden = true;
    el.innerHTML = `<div class="tt">VISOR DE ANIMACIONES <button id="avClose" aria-label="Cerrar visor">✕</button></div>
      <label>Personaje <select id="avWho"><option value="jugador">jugador</option><option value="autómata">autómata</option></select></label>
      <label>Animación <select id="avAnim"></select></label>
      <div class="avd">${DIRS.map((d, i) => `<button data-dir="${i}" aria-pressed="false">${d}</button>`).join("")}</div>
      <div class="avf"><button id="avPrev" aria-label="Frame anterior">◀</button><span id="avF">1/6</span><button id="avNext" aria-label="Frame siguiente">▶︎</button>
        <button id="avPlay" aria-label="Reproducir">▶</button><button id="avLit">con luz</button></div>
      <div id="avInfo" class="ti"></div>`;
    document.getElementById("wrap").appendChild(el);
    const css = document.createElement("style");
    css.textContent = `#aview{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));width:min(300px,calc(100vw - 24px));
        padding:10px;background:rgba(10,18,26,.92);border:2px solid var(--edge);font-size:8px;line-height:1.5;display:flex;flex-direction:column;gap:7px;z-index:7}
      #aview[hidden]{display:none}#aview .tt{display:flex;justify-content:space-between;align-items:center;color:var(--dim)}
      #aview label{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:6px}
      #aview select,#aview button{font:inherit;font-size:8px;color:var(--ink);background:#0d1a26;border:1px solid var(--edge);min-height:32px;min-width:32px}
      #aview .avd{display:grid;grid-template-columns:repeat(8,1fr);gap:3px}#aview .avd button[aria-pressed=true]{background:#8a3a1a;border-color:#fff0c0}
      #aview .avf{display:flex;gap:5px;align-items:center}#aview .avf span{min-width:34px;text-align:center}#aview .ti{color:#ffd9a0}`;
    document.head.appendChild(css);
    for (const ev of ["pointerdown", "click"]) el.addEventListener(ev, (e) => e.stopPropagation());
    b.addEventListener("click", () => { V.on = true; el.hidden = false; pn.hidden = true; apply(); });
    el.querySelector("#avClose").addEventListener("click", () => W.closeAnimViewer());
    el.querySelector("#avWho").addEventListener("change", (e) => { V.who = e.target.value; V.f = 0; apply(); });
    el.querySelector("#avAnim").addEventListener("change", (e) => { V.anim = e.target.value; V.f = 0; apply(); });
    for (const d of el.querySelectorAll("[data-dir]")) d.addEventListener("click", () => { V.dir = +d.dataset.dir; apply(); });
    el.querySelector("#avPrev").addEventListener("click", () => { V.play = false; V.f = (V.f + 5) % 6; apply(); });
    el.querySelector("#avNext").addEventListener("click", () => { V.play = false; V.f = (V.f + 1) % 6; apply(); });
    el.querySelector("#avPlay").addEventListener("click", () => { V.play = !V.play; V.t = 0; apply(); });
    el.querySelector("#avLit").addEventListener("click", () => { V.lit = !V.lit; apply(); });
  };
  W.openAnimViewer = function (o) { Object.assign(V, o || {}); V.on = true; if (el) el.hidden = false; apply(); };
  W.closeAnimViewer = function () {
    V.on = false; V.play = false; release(); W.camFocus = null;
    if (V.moved && V.moved._avPos) { const f = V.moved, q = f._avPos, b = f.body; b.x = q.x; b.z = q.z; b.y = b.ground = W.heightAt(q.x, q.z); b.heading = q.h; f._avPos = null; V.moved = null; }
    if (V.zoom0 != null && W.ui) { W.ui.zoom = V.zoom0; V.zoom0 = null; if (W.resize) W.resize(); }
    if (el) el.hidden = true;
    for (const f of W.foes || []) if (f.ai) f.ai.enabled = true;
  };
  // reproducción con los tiempos de cada frame (los del atlas)
  W.animViewerStep = function (dt) {
    if (!V.on) return;
    const T = target(); if (!T) return;
    if (T.ch !== V.ch) apply();
    T.body.path.length = 0; T.body.speed = 0; if (T.f) T.f.act = null;
    if (V.play) {
      V.t += dt;
      const ms = msOf(T, V.anim)[V.f] / 1000;
      if (V.t >= ms) { V.t -= ms; V.f = (V.f + 1) % 6; T.ch.view = { anim: V.anim, dir: V.dir, f: V.f }; render(T); }
    }
  };
})();
