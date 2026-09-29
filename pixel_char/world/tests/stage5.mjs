// PASO 6 · Pruebas de peso e integración (Playwright + SwiftShader, simulación determinista a 60 Hz):
//  1. deslizamiento del pie apoyado: walk y run en las 8 direcciones de pantalla (W.slip, px de render/frame)
//  2. alineación con el suelo al subir y bajar escalones: fila más baja del personaje (render con y sin él)
//     frente a la fila del suelo bajo sus pies, en cada frame apoyado
//  3. charcas: la misma alineación + cada pisada en el agua es de tipo "water" y deja su onda
//  4. frenado: sin pasarse del destino, desaceleración suave, parada exacta, asentamiento y hundimiento
// uso: node stage5.mjs <dist/index.html> <salida.json>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 320, height: 300 }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("file://" + path.resolve(process.argv[2]));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });

// utilidades dentro de la página
await page.evaluate(() => {
  W.manual = true; W.ui.pi = 0; W.ui.zoom = 2.2; W.resize();
  const th = W.ui.thetaT, R = [Math.cos(th), -Math.sin(th)], T = [Math.sin(th), Math.cos(th)];
  const T5 = (W.T5 = {});
  // dirección del mundo que se ve con ángulo phi en pantalla (0 = derecha, 90° = hacia abajo)
  T5.screenDir = (phi) => [Math.cos(phi) * R[0] + Math.sin(phi) * T[0], Math.cos(phi) * R[1] + Math.sin(phi) * T[1]];
  T5.reset = function (x, z, heading) {
    W.teleport(x, z);
    const st = W.character.st;
    Object.assign(st, { phase: 0, idleT: 0, anim: "idle", frame: 0, lastStep: 0, wst: {}, settle: null, dipT: null });
    if (W.character.anchor) Object.assign(W.character.anchor.st, { anchor: null, release: null, key: "", frame: -1 });
    W.player.heading = heading; W.player.jump = null; W.player.speed = 0;
    W.tick(1 / 60, 30);
    W.slip.reset(); W.stepLog = []; W.__ripples = 0; W.__steps = 0;
  };
  // tramo recto de longitud L en la dirección d; test(k, px, pz) decide cada muestra (cada 0.1 u)
  T5.route = function (d, L, clear, test) {
    for (let x = -26; x < 26; x += 0.5) for (let z = -26; z < 26; z += 0.5) {
      if (Math.abs(x + d[0] * L) > 26 || Math.abs(z + d[1] * L) > 26) continue;   // lejos del borde del mapa
      let ok = W.cellFree(x, z) && W.kindAt(x, z) !== W.K.WATER;
      const n = Math.round(L / 0.1);
      for (let k = 0; k <= n && ok; k++) {
        const px = x + d[0] * k * 0.1, pz = z + d[1] * k * 0.1;
        ok = W.cellFree(px, pz) && (k === 0 || W.canStep(x + d[0] * (k - 1) * 0.1, z + d[1] * (k - 1) * 0.1, px, pz)) && test(k / n, px, pz, x, z);
        for (const o of W.obstacles) if (ok && Math.hypot(o.x - px, o.z - pz) < clear) ok = false;
      }
      if (ok && W.lineClear({ x, z }, { x: x + d[0] * L, z: z + d[1] * L })) return { x, z, tx: x + d[0] * L, tz: z + d[1] * L };
    }
    return null;
  };
  // desfase (px de render) entre el píxel más bajo del personaje y el suelo bajo sus pies, parado
  const rt = W.post.rt, w = rt.width, h = rt.height;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  // Se renderiza SOLO el personaje (terreno, hierba y props ocultos, luces encendidas): así un escalón
  // o la hierba que tapan las botas no falsean la medida.
  T5.align = function () {
    const Rr = W.renderer, ch = W.character, hidden = [];
    W.tick(0);                                                   // estado al día (sin avanzar el tiempo)
    for (const o of W.scene.children) if (o !== ch.mesh && !o.isLight && o.visible) { o.visible = false; hidden.push(o); }
    const vis = ch.mesh.visible;
    Rr.setRenderTarget(rt); ch.mesh.visible = true; Rr.render(W.scene, W.camera);
    Rr.readRenderTargetPixels(rt, 0, 0, w, h, A);
    ch.mesh.visible = false; Rr.render(W.scene, W.camera);
    Rr.readRenderTargetPixels(rt, 0, 0, w, h, B);
    Rr.setRenderTarget(null); ch.mesh.visible = vis;
    for (const o of hidden) o.visible = true;
    let low = -1;
    for (let y = 0; y < h && low < 0; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) { low = y; break; } }
    const t = W.ui.theta, p = W.player;
    const v = new THREE.Vector3(p.x + Math.sin(t) * 0.15, W.heightAt(p.x, p.z), p.z + Math.cos(t) * 0.15).project(W.camera);
    return low - Math.floor((v.y + 1) / 2 * h);
  };
  T5.grounded = function () {
    const st = W.character.st, p = W.player;
    if (p.jump) return false;
    if (st.anim === "walk" || st.anim === "idle") return true;
    if (st.anim === "run") { const F = W.FEET["run_" + W.character.meta.directions[st.dir]]; return !!F.contact[st.frame]; }
    return false;
  };
});

const out = { slip: {}, escalones: [], charcas: [], frenado: {} };
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null, run = (k) => !ONLY || ONLY.includes(k);
out.picos = [];

// ---------------------------------------------------------------------------------------------------
// 1. deslizamiento en 8 direcciones de pantalla, andando y corriendo
for (const gait of run("slip") ? ["walk", "run"] : []) {
  for (let k = 0; k < 8; k++) {
    const r = await page.evaluate(([gait, k]) => {
      const d = W.T5.screenDir(k * Math.PI / 4);
      const L = gait === "run" ? 9 : 4;
      const route = W.T5.route(d, L, 0.9, (u, px, pz, x, z) => W.heightAt(px, pz) === W.heightAt(x, z));
      if (!route) return null;
      W.T5.reset(route.x, route.z, Math.atan2(d[1], d[0]));
      W.player.setPath([{ x: route.tx, z: route.tz }], { noDelay: true });
      W.player.gait = gait;
      const by = {};
      for (let i = 0; i < 900 && W.player.path.length; i++) {
        const n0 = W.slip.samples.length;
        W.tick(1 / 60);
        const st = W.character.st, key = st.anim + "_" + W.character.meta.directions[st.dir];
        for (let j = n0; j < W.slip.samples.length; j++) {
          (by[key] || (by[key] = [])).push(W.slip.samples[j]);
          if (W.slip.samples[j] > 1) (by.__picos || (by.__picos = [])).push({ i, key, px: +W.slip.samples[j].toFixed(2), f: st.frame, v: +W.player.speed.toFixed(3), path: W.player.path.length, d: +(W.character.anchor.st.desired || 0).toFixed(1), settle: !!st.settle });
        }
      }
      return by;
    }, [gait, k]);
    if (!r) { console.log(`sin tramo libre para ${gait} en dirección ${k}`); continue; }
    if (r.__picos) { out.picos.push(...r.__picos); delete r.__picos; }
    for (const [key, s] of Object.entries(r)) (out.slip[key] || (out.slip[key] = [])).push(...s);
  }
}
const stat = (a) => { const s = a.slice().sort((x, y) => x - y); return { n: s.length, media: s.reduce((x, y) => x + y, 0) / s.length, p95: s[Math.floor(0.95 * (s.length - 1))], max: s[s.length - 1], sobre1: s.filter((v) => v > 1).length }; };
out.slipResumen = {};
for (const [key, s] of Object.entries(out.slip).sort()) {
  if (!key.startsWith("walk") && !key.startsWith("run")) continue;
  out.slipResumen[key] = stat(s);
}
delete out.slip;

// ---------------------------------------------------------------------------------------------------
// 2. escalones (subir y bajar) y 3. charcas: alineación en cada frame apoyado
const special = !(run("escalones") || run("charcas")) ? {} : await page.evaluate(() => {
  const res = {};
  for (let k = 0; k < 8 && !res.step; k++) {   // en pantalla: 0 = de lado, 1 = diagonal...
    const d = W.T5.screenDir(k * Math.PI / 4);
    // un único escalón (>= 0.2 u) en el centro del tramo
    let h0 = null;
    const r = W.T5.route(d, 4, 0.6, (u, px, pz, x, z) => {
      const h = W.heightAt(px, pz), hs = W.heightAt(x, z), he = W.heightAt(x + d[0] * 4, z + d[1] * 4);
      if (Math.abs(he - hs) < 0.2) return false;
      // y sin otro desnivel justo antes del inicio ni después del final
      if (u === 0 && (W.heightAt(x - d[0] * 0.8, z - d[1] * 0.8) !== hs || W.heightAt(x + d[0] * 4.8, z + d[1] * 4.8) !== he)) return false;
      // el escalón se cruza de frente: a 0.35 u a cada lado del recorrido, la misma altura
      for (const sd of [-0.35, 0.35]) if (W.heightAt(px - d[1] * sd, pz + d[0] * sd) !== h) return false;
      if (u < 0.35) return h === hs;
      if (u > 0.65) return h === he;
      return h === hs || h === he;
    });
    if (r) res.step = { ...r, dh: W.heightAt(r.tx, r.tz) - W.heightAt(r.x, r.z) };
  }
  for (let k = 0; k < 8 && !res.puddle; k++) {
    const d = W.T5.screenDir(k * Math.PI / 4);
    const r = W.T5.route(d, 4.5, 0.6, (u, px, pz, x, z) => {
      const pud = W.kindAt(px, pz) === W.K.PUDDLE;
      if (u > 0.3 && u < 0.7) return pud;
      return Math.abs(W.heightAt(px, pz) - W.heightAt(x, z)) < 0.01;
    });
    if (r) res.puddle = r;
  }
  return res;
});
console.log("tramos", JSON.stringify(special));

async function walkAlign(route, back) {
  return page.evaluate(([r, back]) => {
    const a = back ? { x: r.tx, z: r.tz } : { x: r.x, z: r.z }, b = back ? { x: r.x, z: r.z } : { x: r.tx, z: r.tz };
    W.T5.reset(a.x, a.z, Math.atan2(b.z - a.z, b.x - a.x));
    W.player.setPath([b], { noDelay: true }); W.player.gait = "walk";
    const rows = [];
    let lastH = W.player.ground, tCross = null, t = 0;
    for (let i = 0; i < 900 && (W.player.path.length || W.character.st.settle); i++) {
      W.tick(1 / 60); t += 1 / 60;
      if (W.player.ground !== lastH) { tCross = t; lastH = W.player.ground; }
      if (i % 2) continue;
      if (!W.T5.grounded()) continue;
      const an = W.character.anchor.st.anchor, P = W.player;
      // desfase geométrico: altura de la línea de apoyo del sprite (p.y) frente al suelo bajo la bota apoyada
      const geo = an ? +((P.y - W.heightAt(an.px, an.pz)) * Math.cos(W.CAM_EL) / W.wpp).toFixed(2) : null;
      rows.push({ geo, t: +t.toFixed(3), d: an ? null : W.T5.align(), sinceCross: tCross == null ? null : +(t - tCross).toFixed(3), anim: W.character.st.anim, water: W.kindAt(W.player.x, W.player.z) === W.K.PUDDLE });
    }
    const res = { rows, steps: W.stepLog.slice(), ripples: W.__ripples, final: [W.player.x, W.player.z], goal: [b.x, b.z], slip: W.slipStats() };
    // parado en mitad del tramo (en la charca: dentro del agua)
    W.T5.reset((r.x + r.tx) / 2, (r.z + r.tz) / 2, W.player.heading);
    res.idleMid = { d: W.T5.align(), water: W.kindAt(W.player.x, W.player.z) === W.K.PUDDLE };
    return res;
  }, [route, back]);
}
if (special.step) {
  out.escalones.push({ sentido: special.step.dh > 0 ? "sube" : "baja", dh: special.step.dh, ...(await walkAlign(special.step, false)) });
  out.escalones.push({ sentido: special.step.dh > 0 ? "baja" : "sube", dh: -special.step.dh, ...(await walkAlign(special.step, true)) });
}
if (special.puddle) out.charcas.push(await walkAlign(special.puddle, false));

// ---------------------------------------------------------------------------------------------------
// 4. frenado andando y corriendo
for (const gait of run("frenado") ? ["walk", "run"] : []) {
  out.frenado[gait] = await page.evaluate((gait) => {
    const d = W.T5.screenDir(Math.PI / 4);
    const L = gait === "run" ? 9 : 3.5;
    const r = W.T5.route(d, L, 0.9, (u, px, pz, x, z) => W.heightAt(px, pz) === W.heightAt(x, z));
    W.T5.reset(r.x, r.z, Math.atan2(d[1], d[0]));
    W.player.setPath([{ x: r.tx, z: r.tz }], { noDelay: true });
    const trace = [];
    let t = 0, prevV = 0, maxDec = 0, finalSnap = 0, overshoot = 0, dipMax = 0, settle = false, seq = [], slipStart = null, tStop = null;
    const walkV = W.player.walkV;
    for (let i = 0; i < 1200; i++) {
      const p = W.player;
      W.tick(1 / 60); t += 1 / 60;
      const st = W.character.st;
      const along = (p.x - r.x) * d[0] + (p.z - r.z) * d[1];
      overshoot = Math.max(overshoot, along - L);
      // la última muestra (llegada: de < 0.12·walkV a 0 en el punto exacto) se cuenta aparte
      if (p.speed === 0 && prevV > 0 && !p.path.length) finalSnap = prevV;
      else if (p.speed < prevV) maxDec = Math.max(maxDec, (prevV - p.speed) * 60);
      if (slipStart == null && p.speed < prevV - 1e-6 && p.speed < 0.95 * (gait === "run" ? p.runV || 99 : walkV)) slipStart = W.slip.samples.length;
      prevV = p.speed;
      if (seq[seq.length - 1] !== st.anim) seq.push(st.anim);
      if (st.settle) settle = true;
      if (!p.path.length) { dipMax = Math.max(dipMax, st.dipPx || 0); if (tStop == null) tStop = t; }
      if (i % 3 === 0) trace.push([+t.toFixed(3), +p.speed.toFixed(3), +along.toFixed(3), st.anim, +(st.dipPx || 0).toFixed(2)]);
      if (!p.path.length && st.anim === "idle" && !st.settle && t - tStop > 0.3) break;
    }
    const brakeSlip = W.slip.samples.slice(slipStart || 0);
    return {
      L, err: Math.hypot(W.player.x - r.tx, W.player.z - r.tz), overshoot, finalSnap, walkV, maxDecel: maxDec, decelLimit: 4.2 * W.CHAR_H * 1.6,
      settle, dipMax, seq: seq.join(">"), brakeSlip: { n: brakeSlip.length, max: Math.max(0, ...brakeSlip), sobre1: brakeSlip.filter((v) => v > 1).length },
      trace,
    };
  }, gait);
}

// ---------------------------------------------------------------------------------------------------
// resumen y comprobaciones
const checks = [];
const check = (name, ok, info) => { checks.push({ name, ok, info }); console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${info}`); };
const sr = out.slipResumen;
for (const g of run("slip") ? ["walk", "run"] : []) {
  const keys = Object.keys(sr).filter((k) => k.startsWith(g + "_"));
  const all = keys.map((k) => sr[k]);
  const n = all.reduce((a, s) => a + s.n, 0), media = all.reduce((a, s) => a + s.media * s.n, 0) / n, max = Math.max(...all.map((s) => s.max)), over = all.reduce((a, s) => a + s.sobre1, 0);
  if (g === "walk") console.log("picos > 1 px:", JSON.stringify(out.picos.slice(0, 50)));
  check(`deslizamiento del pie apoyado (${g}, ${keys.length}/8 direcciones)`, keys.length === 8 && media < 1 && max < 1,
    `media ${media.toFixed(3)} px/frame, máx ${max.toFixed(3)} px, frames > 1 px: ${over}/${n} · ` + keys.map((k) => `${k.split("_")[1]} ${sr[k].media.toFixed(2)}`).join(" "));
}
const dt2 = 2 / 60;   // una muestra cada 2 pasos de 1/60 s
for (const e of out.escalones) {
  const geo = e.rows.filter((r) => r.geo != null).map((r) => r.geo);
  const idle = e.rows.filter((r) => r.d != null).map((r) => Math.abs(r.d));
  const sink = geo.filter((g) => g < -1), flt = geo.filter((g) => g > 1);
  e.resumen = { apoyados: geo.length, hundido: sink.length, flotaS: +(flt.length * dt2).toFixed(3), flotaMax: flt.length ? Math.max(...flt) : 0, paradoMax: Math.max(...idle), resto: Math.max(0, ...geo.filter((g) => g <= 1).map(Math.abs)) };
  const R = e.resumen;
  check(`${e.sentido} un escalón de ${Math.abs(e.dh).toFixed(2)} u: el pie apoyado nunca se hunde ni flota fuera del cambio de nivel`,
    R.hundido === 0 && R.flotaS <= 0.15 && R.resto <= 1 && R.paradoMax <= 1 && Math.hypot(e.final[0] - e.goal[0], e.final[1] - e.goal[1]) < 0.01 && e.slip.max < 1,
    `${R.apoyados} frames con pie apoyado: hundido > 1 px ${R.hundido}, resto |desfase| ≤ ${R.resto.toFixed(2)} px; cambio de nivel ${(R.flotaS * 1000).toFixed(0)} ms (${e.sentido === "sube" ? "impulso: el pie de atrás despega al subir el cuerpo" : "la bota llega al nivel de abajo y el cuerpo cae"}, máx ${R.flotaMax.toFixed(1)} px); parado al final: ${R.paradoMax} px; deslizamiento máx ${e.slip.max.toFixed(2)} px; ${e.steps.length} pisadas`);
}
for (const c of out.charcas) {
  const geo = c.rows.filter((r) => r.geo != null).map((r) => Math.abs(r.geo));
  const inWater = c.rows.filter((r) => r.water && r.geo != null).length;
  const wSteps = c.steps.filter((q) => q.kind === "water").length;
  c.resumen = { apoyados: geo.length, dentro: inWater, max: Math.max(...geo), parado: c.idleMid, pisadasAgua: wSteps, ondas: c.ripples };
  check(`charca: pies sobre la superficie andando y parado dentro del agua`, c.resumen.max <= 1 && inWater > 0 && c.idleMid.water && Math.abs(c.idleMid.d) <= 1 && c.slip.max < 1,
    `${geo.length} frames con pie apoyado (${inWater} en el agua): |desfase| máx ${c.resumen.max.toFixed(2)} px; parado en el agua: ${c.idleMid.d} px; deslizamiento máx ${c.slip.max.toFixed(2)} px`);
  check(`charca: cada pisada en el agua es de tipo agua y deja su onda`, wSteps >= 2 && c.ripples >= wSteps, `${c.steps.length} pisadas (${c.steps.map((q) => q.kind[0]).join("")}), ${wSteps} en agua, ${c.ripples} ondas`);
}
for (const [g, f] of Object.entries(out.frenado)) {
  check(`frenado ${g}: para exacto, sin pasarse, sin tirones`, f.err < 0.01 && f.overshoot < 0.01 && f.maxDecel <= f.decelLimit + 1e-3 && f.finalSnap <= 0.12 * f.walkV + 1e-6,
    `error final ${f.err.toFixed(4)} u, se pasa ${Math.max(0, f.overshoot).toFixed(4)} u, deceleración máx ${f.maxDecel.toFixed(2)} u/s² (límite ${f.decelLimit.toFixed(2)}), última muestra ${f.finalSnap.toFixed(3)} u/s → 0 en el punto exacto`);
  check(`frenado ${g}: asentamiento y hundimiento al parar`, f.settle && f.dipMax >= 1 && f.dipMax <= 3 && f.seq.endsWith("idle"), `${f.seq}, hundimiento ${f.dipMax.toFixed(2)} px`);
  check(`frenado ${g}: el pie no desliza al frenar`, f.brakeSlip.n > 0 && f.brakeSlip.max < 1, `${f.brakeSlip.n} muestras, máx ${f.brakeSlip.max.toFixed(3)} px, > 1 px: ${f.brakeSlip.sobre1}`);
}
check("sin errores JS", errors.length === 0, errors.slice(0, 3).join(" | ") || "ninguno");
out.checks = checks;
fs.writeFileSync(process.argv[3] || "stage5_results.json", JSON.stringify(out, null, 1));
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} OK`);
await browser.close();
