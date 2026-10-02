// Resolución automática (main.js) y arranque del ligero (fighter.js): comprobaciones rápidas.
//  1. escritorio 1280×800: empieza en px2 (antes px3); móvil iPhone: px3 (como antes)
//  2. ritmo simulado (W.resAutoStep con frames sintéticos): a 60 fps sube a px2; a 40 fps baja y no vuelve al nivel
//     lento; limitado a 30 fps (ahorro de energía): baja, no mejora → vuelve y se queda
//  3. botón px: auto → manual → … → auto
//  4. en tiempo real (SwiftShader, pocos fps): prueba a bajar la resolución; si no sube los fps, vuelve
//  5. ligero por toque: pulsar → impacto ~ preparación (205 ms) + el toque − lo recuperado (≤ 40 % de la preparación)
// uso: node res_auto.mjs <dist/index.html> <carpeta>
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const res = [], errors = [];
const check = (name, ok, info) => { res.push({ name, ok: !!ok, info }); console.log(ok ? "OK   " : "FALLO", name, info ? JSON.stringify(info) : ""); };
async function open(ctx) {
  const page = await (await browser.newContext(ctx)).newPage();
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("file://" + path.resolve(html) + "#res=auto");
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  return page;
}
const desk = await open({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const d0 = await desk.evaluate(() => ({ pi: W.ui.pi, on: W.resAuto.on, buf: [W.renderer.domElement.width, W.renderer.domElement.height], btn: document.getElementById("px").textContent }));
check("escritorio 1280×800 empieza en px2 (auto)", d0.pi === 1 && d0.on && /auto/.test(d0.btn), d0);
await desk.screenshot({ path: `${OUT}/escritorio_px2.png` });
// 4. tiempo real: SwiftShader va lento → baja
const rt = await desk.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(9000); return { pi: W.ui.pi, fps: +W.resAuto.fps.toFixed(1), log: W.resAuto.log.slice(), lock: W.resAuto.lock };
});
// (SwiftShader pinta con la CPU: bajar la resolución apenas sube sus fps → lo normal aquí es probar y volver)
check("tiempo real a pocos fps: prueba un píxel más grueso y lo deja solo si sube los fps", rt.log.length > 0 && /fps/.test(rt.log[0]) && (rt.pi > 1 || rt.lock), rt);
// 2. simulado
const sim = await desk.evaluate(() => {
  W.manual = true; const A = W.resAuto, feed = (dt, s) => { for (let t = 0; t < s; t += dt) W.resAutoStep(dt); };
  const reset = (pi) => { Object.assign(A, { on: true, bad: {}, acc: 0, n: 0, good: 0, warm: 1, prev: null, lock: false, log: [] }); W.ui.pi = pi; W.resize(); };
  reset(2); feed(1 / 60, 6.5); const up = W.ui.pi;
  reset(1); feed(1 / 40, 2.2); const dn = W.ui.pi; feed(1 / 60, 2.2); const dn2 = W.ui.pi; feed(1 / 60, 6.5); const noBack = W.ui.pi;
  reset(2); feed(1 / 30, 2.2); const cap1 = W.ui.pi; feed(1 / 30, 2.2); const cap2 = W.ui.pi; const lock = A.lock; feed(1 / 30, 6.5); const cap3 = W.ui.pi;
  return { up, dn, dn2, noBack, cap1, cap2, lock, cap3 };
});
check("60 fps: sube de px3 a px2", sim.up === 1, sim);
check("40 fps: baja a px3 y no vuelve a px2", sim.dn === 2 && sim.dn2 === 2 && sim.noBack === 2, sim);
check("limitado a 30 fps: baja, no mejora → vuelve a px3 y se queda", sim.cap1 === 3 && sim.cap2 === 2 && sim.lock && sim.cap3 === 2, sim);
// 3. botón
const btn = await desk.evaluate(() => {
  const b = document.getElementById("px"), seq = [];
  for (let i = 0; i < 8; i++) { b.click(); seq.push(b.textContent); }
  return { seq, on: W.resAuto.on };
});
check("botón px: auto → manual … → auto", !/auto/.test(btn.seq[0]) && btn.seq.some((s) => /auto/.test(s)), btn);
// 5. ligero por toque
const lat = await desk.evaluate(() => {
  W.manual = true; W.skipRender = true; const out = [];
  for (const tapF of [3, 6, 9]) {
    W.pf.act = null; W.pf.st = 100; W.tick(1 / 60, 90);
    const t0 = W.ct; W.attackPress("key", performance.now(), null, W.player.heading); W.tick(1 / 60, tapF); W.attackRelease("key");
    let n = 0; while (n++ < 120 && !(W.pf.act && W.pf.act.f >= 3)) W.tick(1 / 60);
    out.push({ tapMs: Math.round(tapF / 60 * 1000), ms: Math.round((W.ct - t0) * 1000), cut: W.pf.act && W.pf.act.tapCut });
  }
  return out;
});
check("ligero: el toque se recupera (≤ 40 % de la preparación)", lat.every((x) => x.ms <= 205 + x.tapMs - Math.min(x.tapMs, 82) + 17), lat);
await desk.close();
// 1b. móvil
const phone = await open({ ...devices["iPhone 13"] });
const p0 = await phone.evaluate(() => ({ pi: W.ui.pi, buf: [W.renderer.domElement.width, W.renderer.domElement.height] }));
check("iPhone empieza en px3 (como antes)", p0.pi === 2, p0);
await phone.screenshot({ path: `${OUT}/iphone_px3.png` });
const ok = res.every((r) => r.ok) && !errors.length;
console.log(`${res.filter((r) => r.ok).length}/${res.length} ${ok ? "OK" : "FALLO"} ,`, errors.length ? `${errors.length} errores JS` : "sin errores JS");
fs.writeFileSync(`${OUT}/res_auto.json`, JSON.stringify({ res, errors }, null, 1));
await browser.close();
