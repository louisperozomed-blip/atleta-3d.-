// Cronometraje de la guardia EN TIEMPO REAL (no a paso fijo): ¿la pulsación cae en el instante de juego correcto?
// Verdad de referencia: cada paso deja (performance.now(), W.ct); el instante de juego de una pulsación con marca
// event.timeStamp = ts es la interpolación de W.ct entre los dos pasos que la rodean. Se compara con W.pressTime.
// Modos: render (SwiftShader, ~8 fps: dt recortado a 50 ms → el juego va más lento que el reloj), 60 fps
// (skipRender) y 60 fps con tirones (un frame de 60-110 ms cada ~6).
// uso: node timing_rt.mjs <dist/index.html> [render|smooth|hitch] [N]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, MODE = "smooth", NN = "24"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html) + "#enemy=zombie");
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
const res = await page.evaluate(async ({ MODE, N }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let bs = 777; const rnd = () => ((bs = (bs * 16807) % 2147483647) / 2147483647);
  const f = W.foes[0]; for (const g of W.foes) { g.ai.enabled = false; if (g !== f) { g.body.x = 999; g.body.z = 999; } }
  W.pf.hp = W.pf.hpMax = 99999;
  if (MODE !== "render") W.skipRender = true;
  if (MODE === "hitch") { let k = 0; const h = () => { if (++k % 6 === 0) { const e = performance.now() + 60 + rnd() * 50; while (performance.now() < e); } requestAnimationFrame(h); }; requestAnimationFrame(h); }
  const LOG = [], PL = [];
  const cs = W.combatStep; W.combatStep = (dt) => { const r = cs(dt); LOG.push([W.ctReal, W.ct]); return r; };
  const pt0 = W.pressTime; W.pressTime = (ts, h) => { const r = pt0(ts, h); if (h) PL.push([ts, r, ts - W.ctReal, W.ctRate, W.ctFrame, LOG.length]); return r; };
  const truth = (ts) => { for (let i = LOG.length - 2; i >= 0; i--) if (LOG[i][0] <= ts) { const [r0, c0] = LOG[i], [r1, c1] = LOG[i + 1]; return c0 + (ts - r0) / Math.max(1e-6, r1 - r0) * (c1 - c0); } return null; };
  await sleep(600);
  let fr = 0; const t0 = performance.now(); await new Promise((r) => { const k = () => { fr++; if (performance.now() - t0 < 1000) requestAnimationFrame(k); else r(); }; requestAnimationFrame(k); });
  const calib = (W.COMBAT.calib || 0) / 1000, out = [];
  for (let i = 0; i < N; i++) {
    if (!f.alive || f.hidden) W.fodderRespawn(f);
    f.act = null; f.post = 0; f.slide = null; W.teleport(f.home.x - 1.5, f.home.z); W.pf.act = null; W.pf.buf = null; await sleep(350); W.combatLog.length = 0; PL.length = 0;
    f.ai.strike(Math.atan2(W.pf.body.z - f.body.z, W.pf.body.x - f.body.x));
    const impact = f.act.fodderT0 + f.fodder.windup;
    await new Promise((r) => requestAnimationFrame(r));
    const lead = 0.0 + rnd() * 0.24, l = f.toImpact();
    // ritmo juego/reloj de los últimos pasos (a pocos fps el dt se recorta y el juego va más lento); solo para apuntar:
    // la verdad sale del registro
    const a = LOG[Math.max(0, LOG.length - 12)], b = LOG[LOG.length - 1], rate = Math.min(1, Math.max(0.2, (b[1] - a[1]) * 1000 / Math.max(1, b[0] - a[0])));
    await new Promise((r) => setTimeout(() => { dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", bubbles: true })); dispatchEvent(new KeyboardEvent("keyup", { code: "KeyK", key: "k", bubbles: true })); r(); }, Math.max(0, (l - lead) * 1000 / rate)));
    await sleep(700 / rate);
    const P = PL[0]; if (!P) { out.push({ skip: 1 }); continue; }
    const tr = truth(P[0]); if (tr == null) { out.push({ skip: 1 }); continue; }
    const e = W.combatLog.find((x) => x.ev === "parry" || x.ev === "block" || x.ev === "hit");
    const got = !e ? "?" : e.ev === "parry" ? e.level : e.ev;
    const te = Math.round((impact - tr) * 1000);
    // (una pulsación posterior al paso que resolvió el impacto ya llega tarde: «hit», aunque caiga en el margen de 4 ms)
    const want = te >= 0 && te <= 70 ? "perfect" : te > 70 && te <= 200 ? "normal" : te > 200 && te <= 320 ? "block" : "hit";
    const j = P[5] - 1, nx = LOG[j + 1] || [0, 0];
    out.push({ err: Math.round((P[1] + calib - tr) * 1000 * 10) / 10, trueEarly: te, got, want, d: [Math.round(P[2]), P[3] == null ? null : +P[3].toFixed(2), Math.round((P[4] || 0) * 1000), Math.round(nx[0] - LOG[j][0]), Math.round((nx[1] - LOG[j][1]) * 1000)] });
  }
  return { fps: fr, out };
}, { MODE, N: +NN });
const ok = res.out.filter((x) => !x.skip), errs = ok.map((x) => Math.abs(x.err));
const agree = ok.filter((x) => x.got === x.want || (x.want === "hit" && x.got === "perfect" && x.trueEarly >= -4) || (x.want === "perfect" && x.got === "normal" && x.trueEarly > 62) || (x.want === "normal" && x.got === "perfect" && x.trueEarly < 78)).length;
console.log(`modo ${MODE} · ${res.fps} fps · n=${ok.length} · error |pulsación| medio ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1)} ms, máx ${Math.max(...errs).toFixed(1)} ms · resultado = esperado ${agree}/${ok.length}`);
if (process.env.V) for (const o of ok) console.log(JSON.stringify(o));
await browser.close();
