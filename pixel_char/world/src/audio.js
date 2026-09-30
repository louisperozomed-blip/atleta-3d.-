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
      leaves: ["highpass", 1800, 0.9, 0.16, 0.2],
      metal: ["bandpass", 2600, 9, 0.12, 0.16],
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
    // hojas secas: crujido = varios chasquidos muy cortos
    if (kind === "leaves") for (let i = 0; i < 4; i++) {
      const b = c.createBufferSource(), bf = c.createBiquadFilter(), bg = c.createGain(), t0 = t + 0.012 + i * (0.018 + Math.random() * 0.02);
      b.buffer = A.noise; bf.type = "bandpass"; bf.frequency.value = 2500 + Math.random() * 2500; bf.Q.value = 1.5;
      bg.gain.setValueAtTime(0.0001, t0); bg.gain.exponentialRampToValueAtTime(0.14 * s, t0 + 0.003); bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
      b.connect(bf); bf.connect(bg); bg.connect(A.master); b.start(t0, Math.random() * 0.3, 0.03);
    }
    // metal: golpe con resonancia (placa hueca)
    if (kind === "metal") for (const [fr, gn, dec] of [[520, 0.12, 0.35], [1310, 0.06, 0.22], [2270, 0.035, 0.15]]) {
      const o = c.createOscillator(), og = c.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(fr * (0.97 + Math.random() * 0.06), t);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(gn * s, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(og); og.connect(A.master); o.start(t); o.stop(t + dec + 0.02);
    }
    if (kind === "water") {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.06);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.06 * s, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(og); og.connect(A.master); o.start(t); o.stop(t + 0.08);
    }
  };
  // Combate: tajos (ruido que barre), golpes (golpe grave + crujido), parry (metal agudo que resuena),
  // bloqueo (metal sordo), rotura de guardia, esquiva, aturdido (campanilla), remate, muerte
  function noiseHit(c, t, type, f0, f1, q, g0, dur, detune) {
    const src = c.createBufferSource(); src.buffer = A.noise; src.playbackRate.value = detune || 1;
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + Math.min(0.02, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(A.master); src.start(t, Math.random() * 0.1, dur + 0.02);
  }
  function tone(c, t, type, f0, f1, g0, dur) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.02);
  }
  A.combat = function (kind, surface) {
    A.last = kind; A.combatCount = (A.combatCount || 0) + 1;
    if (!A.enabled || !W.FX.sound) return;
    const c = A.ctx;
    if (!c || c.state !== "running") return;
    const t = c.currentTime;
    if (kind === "swing") noiseHit(c, t, "bandpass", 700, 2600, 1.2, 0.22, 0.16);
    else if (kind === "swingHeavy") { noiseHit(c, t, "bandpass", 400, 1800, 1.0, 0.3, 0.28); tone(c, t, "sine", 120, 60, 0.12, 0.25); }
    else if (kind === "hit" || kind === "hitHeavy") {
      const h = kind === "hitHeavy" ? 1.4 : 1;
      tone(c, t, "sine", 140 * h, 45, 0.45 * h, 0.14 * h);
      noiseHit(c, t, "lowpass", 2400, 400, 0.8, 0.3 * h, 0.12 * h);
      if (surface) A.step(surface, 1.1);
    } else if (kind === "parry") {
      for (const [fr, g, d] of [[1850, 0.16, 0.5], [2790, 0.1, 0.35], [4100, 0.06, 0.25], [920, 0.1, 0.4]]) tone(c, t, "triangle", fr, fr * 0.985, g, d);
      noiseHit(c, t, "highpass", 5000, 3000, 0.7, 0.25, 0.06);
    } else if (kind === "block") { tone(c, t, "triangle", 620, 560, 0.14, 0.18); noiseHit(c, t, "bandpass", 1600, 900, 2, 0.2, 0.08); }
    else if (kind === "guardBreak") { tone(c, t, "sawtooth", 300, 90, 0.18, 0.3); noiseHit(c, t, "lowpass", 3000, 300, 0.6, 0.35, 0.25); }
    else if (kind === "dodge") noiseHit(c, t, "bandpass", 1800, 500, 0.9, 0.16, 0.2);
    else if (kind === "stun") { tone(c, t, "sine", 1320, 1310, 0.08, 0.6); tone(c, t + 0.09, "sine", 1760, 1750, 0.06, 0.55); }
    else if (kind === "deathblow") { tone(c, t, "sine", 90, 35, 0.6, 0.45); noiseHit(c, t, "lowpass", 3000, 200, 0.7, 0.45, 0.4); tone(c, t, "triangle", 2200, 2100, 0.08, 0.6); }
    else if (kind === "death") { tone(c, t, "sine", 80, 40, 0.35, 0.35); noiseHit(c, t, "lowpass", 900, 200, 0.6, 0.25, 0.3); }
    else if (kind === "warn") { tone(c, t, "sine", 980, 1480, 0.05, 0.12); }
  };
  // Ambiente: viento (ruido filtrado que respira), goteo (gotas al azar en las charcas y bajo las copas),
  // zumbido eléctrico lejano junto a las máquinas (50 Hz + armónicos, con cortes). Volúmenes suavizados.
  let amb = null;
  function makeAmbient(c) {
    const out = c.createGain(); out.gain.value = 1; out.connect(A.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { b = b * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = b * 6; }   // ruido marrón
    const wind = c.createBufferSource(); wind.buffer = buf; wind.loop = true;
    const wf = c.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 420; wf.Q.value = 0.6;
    const wg = c.createGain(); wg.gain.value = 0;
    wind.connect(wf); wf.connect(wg); wg.connect(out); wind.start();
    const hg = c.createGain(); hg.gain.value = 0;
    const hf = c.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 380;
    [[50, 0.5, "sawtooth"], [100, 0.3, "sine"], [150, 0.15, "square"]].forEach(([f, g, ty]) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(hf); o.start();
    });
    hf.connect(hg); hg.connect(out);
    return { wg, wf, hg, dripT: 0, cur: { wind: 0, drip: 0, hum: 0 } };
  }
  function drip(c, v) {
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f0 = 900 + Math.random() * 1400;
    o.type = "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.05);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.14);
  }
  A.ambient = function (target, dt) {
    const c = A.ctx;
    if (!c || c.state !== "running" || !A.enabled) return;
    if (!amb) amb = makeAmbient(c);
    const k = 1 - Math.exp(-dt * 1.5), cur = amb.cur;
    for (const key of ["wind", "drip", "hum"]) cur[key] += (target[key] - cur[key]) * k;
    const t = c.currentTime, breathe = 0.7 + 0.3 * Math.sin(t * 0.23) * Math.sin(t * 0.37 + 1);
    amb.wg.gain.setTargetAtTime(0.09 * cur.wind * breathe, t, 0.2);
    amb.wf.frequency.setTargetAtTime(300 + 260 * breathe, t, 0.3);
    const cut = Math.sin(t * 7.1) * Math.sin(t * 3.3) > 0.75 ? 0.3 : 1;          // la corriente falla a ratos
    amb.hg.gain.setTargetAtTime(0.03 * cur.hum * cut, t, 0.05);
    amb.dripT -= dt;
    if (amb.dripT <= 0) { amb.dripT = 0.25 + Math.random() * 1.6; if (Math.random() < cur.drip) drip(c, 0.6 + Math.random() * 0.4); }
  };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, () => A.unlock(), { passive: true }));
})();
