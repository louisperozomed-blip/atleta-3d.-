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
  function runTest(box) {
    const N = 10, GAP = 750, beats = [], taps = [];
    const ring = box.querySelector(".cring"), info = box.querySelector(".cinfo");
    let next = performance.now() + 1000, n = 0, done = false;
    const tap = (ts) => { if (!done) { taps.push(ts); ring.classList.add("hit"); setTimeout(() => ring.classList.remove("hit"), 90); } };
    ring.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); tap(e.timeStamp); };
    const key = (e) => { if (e.code === "KeyK" || e.code === "Space") { e.preventDefault(); e.stopPropagation(); if (!e.repeat) tap(e.timeStamp); } };
    addEventListener("keydown", key, true);
    info.textContent = "Toca el círculo al ritmo de los destellos";
    (function loop() {
      if (done) return;
      const now = performance.now();
      if (n < N && now >= next) {
        beats.push(now); n++; next += GAP;
        ring.classList.add("beat"); setTimeout(() => ring.classList.remove("beat"), 110);
        if (W.sfx) W.sfx.combat("tick");
        info.textContent = "pulso " + n + " / " + N;
      }
      if (n >= N && now > beats[N - 1] + 500) {
        done = true; removeEventListener("keydown", key, true);
        const c = W.calibFrom(beats, taps);
        if (c == null) info.textContent = "Pocos toques a tiempo; prueba otra vez";
        else { W.setCalib(c); info.textContent = "Latencia: " + fmt(c) + " (guardada)"; }
        box.querySelector(".cgo").disabled = false;
        return;
      }
      requestAnimationFrame(loop);
    })();
  }
  W.initCalibUI = function (pn) {
    load();
    if (!pn || pn.querySelector("#dCalib")) return;
    const row = document.createElement("label");
    row.innerHTML = `Latencia <input id="dCalib" type="range" min="-60" max="150" step="5"><output></output>`;
    const btn = document.createElement("button"); btn.id = "tCalib"; btn.textContent = "calibrar latencia (ritmo)";
    pn.appendChild(row); pn.appendChild(btn);
    const i = row.querySelector("input"), o = row.querySelector("output");
    i.value = W.COMBAT.calib; o.textContent = fmt(W.COMBAT.calib);
    i.addEventListener("input", () => W.setCalib(+i.value));
    const box = document.createElement("div");
    box.id = "calibBox"; box.hidden = true;
    box.innerHTML = `<div class="tt">CALIBRAR LATENCIA</div><div class="cring" role="button" aria-label="Tocar al ritmo"></div>
      <div class="cinfo">Toca el círculo (o K) a la vez que cada destello</div><div class="crow"><button class="cgo">empezar</button><button class="cx">cerrar</button></div>`;
    document.getElementById("wrap").appendChild(box);
    const css = document.createElement("style");
    css.textContent = `#calibBox{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9;width:250px;padding:14px;background:rgba(10,18,26,.95);
        border:2px solid var(--edge);display:flex;flex-direction:column;align-items:center;gap:12px;font-size:8px;line-height:1.5;text-align:center}
      #calibBox[hidden]{display:none}#calibBox .tt{color:var(--dim)}
      #calibBox .cring{width:120px;height:120px;border-radius:50%;border:4px solid #ffb070;background:rgba(40,22,14,.7);touch-action:none;cursor:pointer;transition:background .06s}
      #calibBox .cring.beat{background:#ffe08a;box-shadow:0 0 24px #ffb020}#calibBox .cring.hit{border-color:#fff}
      #calibBox .crow{display:flex;gap:8px}#calibBox button{font:inherit;font-size:8px;color:var(--ink);background:#0d1a26;border:1px solid var(--edge);min-height:32px;padding:0 10px}`;
    document.head.appendChild(css);
    for (const ev of ["pointerdown", "click"]) box.addEventListener(ev, (e) => e.stopPropagation());
    btn.addEventListener("click", () => { box.hidden = false; box.querySelector(".cinfo").textContent = "Toca el círculo (o K) a la vez que cada destello"; });
    box.querySelector(".cx").addEventListener("click", () => { box.hidden = true; });
    box.querySelector(".cgo").addEventListener("click", (e) => { e.currentTarget.disabled = true; runTest(box); });
  };
})();
