// feet.js — pies anclados al suelo (walk y run).
//
// Datos: assets/feet.json (tools/feet.py): para cada frame, las botas (punto de contacto de la suela,
// en píxeles de la hoja completa respecto al pivote) y cuál es la más baja.
//
// El walk dibujado apenas desplaza la bota apoyada hacia atrás (en la vista S recorre ~6 px por ciclo:
// "anda en el sitio"), así que un root motion puro por frames dejaría al personaje casi parado. Se usa
// un anclaje equivalente: el cuerpo avanza de forma continua (velocidad y cadencia salen de la zancada)
// y, mientras un pie está apoyado, una deformación local de esa pierna (de la rodilla a la suela)
// mantiene la bota en el MISMO punto del suelo. Cambio de apoyo: cuando la bota anclada se levanta
// (la otra queda más baja) el ancla pasa a la otra bota donde esté, y la pierna liberada vuelve a su
// forma con un fundido de 80 ms (ya está en el aire, no desliza).
// Mide el deslizamiento del pie apoyado en píxeles de render por frame (W.slip).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  W.FX = Object.assign({ anchor: true, contact: true, impact: true, inertia: true, matter: true, sound: true }, W.FX || {});
  W.slip = { samples: [], reset() { this.samples.length = 0; } };

  // Locomoción guiada por los pies: cadencia fija, velocidad = lo que avanza el pie dibujado +
  // lo que la pierna apoyada puede absorber durante un apoyo (MAXW texeles), por dirección.
  const MAXW = { walk: 15, run: 16 };
  W.locoParams = function (anim, dir) {
    const F = W.FEET && W.FEET[anim + "_" + DIRS[dir]];
    const fps = 12;
    if (!F) return null;
    const c = F.contact;
    const tex = W.CHAR_H * Math.cos(W.CAM_EL) / 103;          // u de pantalla por texel del atlas del mundo
    if (anim === "walk") {
      // hueco máximo entre contactos (en frames, cíclico)
      let gap = 0;
      for (let i = 0; i < 6; i++) if (c[i]) { let k = 1; while (!c[(i + k) % 6] && k < 6) k++; gap = Math.max(gap, k); }
      const T = gap / fps;
      const v = F.art * fps / 6 + 0.64 * MAXW.walk * tex / F.f / T;
      return { v: Math.min(1.25, Math.max(0.8, v)), fps, weights: [1, 1, 1, 1, 1, 1].map((x) => x / 6), contact: c, maxw: MAXW.walk };
    }
    // run: contactos cortos (el pie solo está en el suelo un instante), vuelo más largo
    const w = c.map((k) => (k ? 0.55 : 1.1)), sw = w.reduce((a, b) => a + b, 0);
    return { v: null, fps, weights: w.map((x) => x / sw), contact: c, maxw: MAXW.run };
  };

  W.makeFootAnchor = function (ch) {
    const meta = ch.meta, SC = meta.scale_from_full || 0.5;
    const [FW, FH] = meta.frame_size, [PVX, PVY] = meta.pivot;
    const EL = W.CAM_EL;
    const st = { anchor: null, release: null, key: "", frame: -1, lastScreen: null, stance: 0, lastTheta: null, lastGround: null };

    function feetOf(anim, dir, f) {
      const r = W.FEET && W.FEET[anim + "_" + DIRS[dir]];
      if (!r) return null;
      const fr = r.frames[f];
      return { feet: fr.feet.map((q) => ({ x: q.x * SC, y: q.y * SC })), grounded: anim === "walk" ? true : !!r.contact[f], contact: !!r.contact[f] };
    }
    function anyFeet(anim, dir, f) {
      const r = W.FEET && W.FEET[anim + "_" + DIRS[dir]];
      return r ? r.frames[f].feet.map((q) => ({ x: q.x * SC, y: q.y * SC })) : null;
    }
    // coordenadas de pantalla (en unidades de mundo) de un punto del plano del sprite
    function screenOf(base, R, cx, cy, sx, sy, camTheta) {
      const wx = base.x + R.x * cx * ch.unitsH * sx, wz = base.z + R.z * cx * ch.unitsH * sx;
      const wy = base.y - cy * ch.unitsV * sy;
      const ux = -Math.sin(EL) * Math.sin(camTheta), uy = Math.cos(EL), uz = -Math.sin(EL) * Math.cos(camTheta);
      return [wx * R.x + wz * R.z, wx * ux + wy * uy + wz * uz];
    }
    const warps = { A: [0, 0, 0, 0], B: [0, 0, 0, 0] };
    // punto del suelo bajo una bota: a lo ancho del plano (wx, wz) y en profundidad (px, pz): una bota
    // dibujada más abajo está más cerca de la cámara (el suelo se ve acortado por sin(EL)); q.y se mide
    // desde la línea del suelo (el sprite se desplaza para que su píxel más bajo quede en ella) y el plano
    // del sprite va 0.15 u por delante del centro
    function groundPoint(q, anim, dir, f, base, sx, sy, camTheta) {
      const R = { x: Math.cos(camTheta), z: -Math.sin(camTheta) };
      const lowT = W.FX.matter ? (W.FEET[anim + "_" + DIRS[dir]].frames[f].lowest || 0) * SC : 0;
      const dep = (q.y - lowT) * ch.unitsH * sy / Math.sin(EL), TX = Math.sin(camTheta), TZ = Math.cos(camTheta);
      const wx = base.gx + R.x * q.x * ch.unitsH * sx, wz = base.gz + R.z * q.x * ch.unitsH * sx;
      return { wx, wz, px: wx + TX * (0.15 + dep), pz: wz + TZ * (0.15 + dep) };
    }
    function frontOf(feet, dir) {
      const a8 = dir * Math.PI / 4, mx = -Math.sin(a8), my = Math.cos(a8) * Math.sin(EL);
      return (feet[0].x * mx + feet[0].y * my) >= (feet[1].x * mx + feet[1].y * my) ? 0 : 1;
    }

    return {
      st, warps, anyFeet,
      // base: punto del pivote del sprite en el mundo; sx, sy: escala del sprite
      update(dt, p, anim, dir, f, camTheta, base, sx, sy) {
        const R = { x: Math.cos(camTheta), z: -Math.sin(camTheta) };
        const data = (anim === "walk" || anim === "run") && !p.jump ? feetOf(anim, dir, f) : null;
        const key = anim + dir;
        // cambios que invalidan el ancla: otra animación/dirección, giro de cámara
        if (key !== st.key || st.lastTheta !== camTheta) {
          if (st.anchor) st.release = { x: st.anchor.fx, y: st.anchor.fy, d: st.anchor.d.slice(), t: 0 };
          st.anchor = null; st.key = key; st.lastScreen = null;
        }
        // escalón: el cuerpo sube o baja al nuevo nivel cuando el apoyo pasa a él (player.js) y el pie
        // apoyado acompaña ese cambio de altura (es colocar el pie en el escalón, no un deslizamiento)
        const dyBody = st.lastY == null ? 0 : p.y - st.lastY;
        const riding = !!st.anchor && Math.abs(dyBody) > 1e-5;
        if (riding) st.anchor.sy += dyBody * Math.cos(EL);
        st.lastTheta = camTheta; st.lastY = p.y;
        let applied = [0, 0], cur = null;
        if (data && data.grounded) {
          const feet = data.feet;
          // dirección de avance en la pantalla (para saber qué bota va delante)
          const front = frontOf(feet, dir);
          const newFrame = st.frame !== f;
          st.frame = f;
          // al entrar en un frame de contacto, la bota de delante toma el apoyo
          if (st.anchor && newFrame && data.contact) {
            st.release = { x: st.anchor.fx, y: st.anchor.fy, d: st.anchor.d.slice(), t: 0 };
            st.anchor = null;
          }
          const low = front;
          if (st.anchor) {
            // sigue a la misma bota: la del frame nuevo más cercana a la anclada (en el dibujo)
            let bi = 0, bd = 1e9;
            feet.forEach((q, i) => { const d = Math.hypot(q.x - st.anchor.fx, q.y - st.anchor.fy); if (d < bd) { bd = d; bi = i; } });
            const other = feet[1 - bi];
            st.anchor.fx = feet[bi].x; st.anchor.fy = feet[bi].y;
          }
          if (!st.anchor) {
            const q = feet[low];
            const s = screenOf(base, R, q.x, q.y, sx, sy, camTheta);
            const g = groundPoint(q, anim, dir, f, base, sx, sy, camTheta);
            st.anchor = { fx: q.x, fy: q.y, sx: s[0], sy: s[1], d: [0, 0], wx: g.wx, wz: g.wz, px: g.px, pz: g.pz };
            st.stance++;
            st.lastScreen = null;
            // pisada: evento para polvo, huella, hierba, hundimiento y sonido
            (W.stepEvents || (W.stepEvents = [])).push({ x: st.anchor.px, z: st.anchor.pz, anim, heading: p.heading, t: performance.now() });
          }
          // desplazamiento necesario para que la bota vuelva a su punto del suelo
          const a = st.anchor;
          const s = screenOf(base, R, a.fx, a.fy, sx, sy, camTheta);
          let dx = (a.sx - s[0]) / ch.unitsH, dy = (a.sy - s[1]) / ch.unitsH;   // texeles (y hacia arriba)
          if (!W.FX.anchor) { dx = 0; dy = 0; }
          const m = Math.hypot(dx, dy);
          st.desired = m;
          const mw = (W.locoParams(anim, dir) || {}).maxw || 12;
          if (m > mw) { dx *= mw / m; dy *= mw / m; }
          a.d = [dx, dy];
          applied = [dx, dy];
          cur = [s[0] + dx * ch.unitsH, s[1] + dy * ch.unitsH];
        } else if (st.anchor) {
          st.frame = f;
          st.lastY = null;
          st.release = { x: st.anchor.fx, y: st.anchor.fy, d: st.anchor.d.slice(), t: 0 };
          st.anchor = null; st.lastScreen = null;
        }
        // próxima pisada: dónde y cuándo se apoyará la bota delantera (para subir escalones: el cuerpo
        // empieza a subir justo antes, así la bota no se hunde en el escalón al apoyarse)
        st.next = null;
        const lp = (anim === "walk" || anim === "run") && !p.jump && p.speed > 0.05 && ch.st ? W.locoParams(anim, dir) : null;
        if (lp) {
          let acc = 0; const starts = lp.weights.map((w) => { const a = acc; acc += w; return a; });
          let fc = -1;
          for (let k = 1; k <= 6 && fc < 0; k++) if (lp.contact[(f + k) % 6]) fc = (f + k) % 6;
          if (fc >= 0) {
            const stride = (anim === "walk" ? lp.v : p.runV) * 6 / lp.fps;
            const tC = ((starts[fc] - ch.st.phase) % 1 + 1) % 1 * stride / p.speed;
            if (tC < 0.2) {
              const fe = anyFeet(anim, dir, fc), adv = p.speed * tC;
              const b2 = { gx: base.gx + Math.cos(p.heading) * adv, gz: base.gz + Math.sin(p.heading) * adv };
              const g = groundPoint(fe[frontOf(fe, dir)], anim, dir, fc, b2, sx, sy, camTheta);
              st.next = { h: W.heightAt(g.px, g.pz), t: tC };
            }
          }
        }
        // medida del deslizamiento: posición en pantalla de la bota apoyada entre frames seguidos
        if (cur && st.lastScreen && st.lastScreen.stance === st.stance && W.wpp && !riding) {
          const px = Math.hypot(cur[0] - st.lastScreen.x, cur[1] - st.lastScreen.y) / W.wpp;
          W.slip.samples.push(px);
          if (W.slip.samples.length > 4000) W.slip.samples.shift();
        }
        st.lastScreen = cur ? { x: cur[0], y: cur[1], stance: st.stance } : null;
        // deformaciones para el shader (UV del frame: u a la derecha, v hacia abajo)
        const toUV = (fx, fy, d) => [(PVX + fx) / FW, (PVY + fy) / FH, d[0] / FW, -d[1] / FH];
        warps.A = st.anchor ? toUV(st.anchor.fx, st.anchor.fy, applied) : [0, 0, 0, 0];
        if (st.release) {
          st.release.t += dt;
          const k = Math.max(0, 1 - st.release.t / 0.08);
          warps.B = toUV(st.release.x, st.release.y, [st.release.d[0] * k, st.release.d[1] * k]);
          if (k <= 0 || !W.FX.anchor) st.release = null;
        } else warps.B = [0, 0, 0, 0];
        return warps;
      },
    };
  };
  W.slipStats = function () {
    const s = W.slip.samples.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, media: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1], sobre1px: s.filter((v) => v > 1).length / s.length };
  };
})();
