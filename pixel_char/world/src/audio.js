// audio.js — pasos suaves sintetizados (WebAudio, sin archivos), distintos por terreno.
// El contexto de audio se crea con el primer toque (política de reproducción de los navegadores).
// Botón "sonido" para silenciar.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const A = (W.sfx = { enabled: true, ctx: null, noise: null, count: 0 });

  function ensure() {
    if (A.ctx || !A.enabled) return A.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      A.ctx = new AC();
      const len = A.ctx.sampleRate * 0.4, buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.noise = buf;
      A.master = A.ctx.createGain(); A.master.gain.value = 0.35; A.master.connect(A.ctx.destination);
    } catch (e) { A.ctx = null; }
    return A.ctx;
  }
  A.unlock = function () { const c = ensure(); if (c && c.state === "suspended") c.resume(); };
  A.setEnabled = function (on) { A.enabled = on; if (A.master) A.master.gain.value = on ? 0.35 : 0; };

  // kind: "dust" (sendero/plaza), "stone" (ruinas), "water" (charco), "grass" (hierba/cristal)
  A.step = function (kind, strength) {
    A.count++;
    if (!A.enabled || !W.FX.sound) return;
    const c = A.ctx;
    if (!c || c.state !== "running") return;
    const t = c.currentTime, s = strength == null ? 1 : strength;
    const src = c.createBufferSource(); src.buffer = A.noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = c.createBiquadFilter(), g = c.createGain();
    const P = {
      dust: ["lowpass", 900, 0.9, 0.09, 0.22],
      stone: ["bandpass", 2200, 2.5, 0.05, 0.2],
      water: ["bandpass", 1300, 4, 0.14, 0.2],
      grass: ["highpass", 2600, 0.7, 0.11, 0.12],
    }[kind] || ["lowpass", 900, 0.9, 0.09, 0.2];
    f.type = P[0]; f.frequency.value = P[1]; f.Q.value = P[2];
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(P[4] * s, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + P[3]);
    if (kind === "water") f.frequency.exponentialRampToValueAtTime(500, t + P[3]);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t, Math.random() * 0.2, P[3] + 0.02);
    // golpe grave del talón (sendero, piedra)
    if (kind === "dust" || kind === "stone") {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(kind === "stone" ? 150 : 95, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.25 * s, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(og); og.connect(A.master); o.start(t); o.stop(t + 0.09);
    }
    if (kind === "water") {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.06);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.06 * s, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(og); og.connect(A.master); o.start(t); o.stop(t + 0.08);
    }
  };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, () => A.unlock(), { passive: true }));
})();
