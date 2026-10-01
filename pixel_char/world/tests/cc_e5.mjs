// Combate completo · Etapa 5: parry, riposte y reacciones con los controles nuevos (L/H, objetivo fijado).
// uso: node cc_e5.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info).slice(0, 900) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  const A = (window.A = W.foes[0]);
  for (const f of W.foes) f.ai.enabled = false;
  const s = W.findSpot(-8, 1, null, 2.4);
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  window.reset = () => {
    W.pf.respawn(); W.pf.combo = null; W.pf.rip = null; W.hitstop = 0; W.teleport(s.x, s.z);
    for (const f of W.foes) { f.respawn(); if (f !== A) { f.body.x = 999; f.body.z = 999; } }
    // un ángulo con sitio detrás del enemigo (para ver su retroceso)
    let a = 0.5; for (let k = 0; k < 16; k++) { const b = k * Math.PI / 8; let ok = true; for (let d = 1.9; d <= 4.2; d += 0.25) ok = ok && W.cellFree(s.x + Math.cos(b) * d, s.z + Math.sin(b) * d) && Math.abs(W.heightAt(s.x + Math.cos(b) * d, s.z + Math.sin(b) * d) - W.heightAt(s.x, s.z)) < 0.3; if (ok) { a = b; break; } }
    A.body.x = s.x + Math.cos(a) * 1.9; A.body.z = s.z + Math.sin(a) * 1.9; A.body.y = A.body.ground = W.heightAt(A.body.x, A.body.z);
    A.body.heading = a + Math.PI; W.player.heading = a; A.act = null; A.post = 0; A.hp = A.hpMax = 900; A.ai.enabled = false; A.ai.chain = null;
    W.setTarget(A); T(10); W.combatLog.length = 0;
  };
  // su golpe (attack1 con su plan) y tu guardia «early» s antes del impacto
  window.foeStrike = (early, move) => {
    A.ai.attack(move || "attack1"); let n = 0, pressed = false;
    while (n++ < 300) { const l = A.toImpact(); if (!pressed && l != null && l <= early + 1e-3) { W.pf.input("guardDown", { ts: performance.now() + (l - early) * 1000 }); W.pf.input("guardUp"); pressed = true; }
      T(1); if (L("parry").length || L("block").length || L("hit").length) break; }
    T(1);
    return L("parry")[0] || L("block")[0] || L("hit")[0];
  };
  // toques de ataque (L) con su marca de tiempo; at = instante deseado en el reloj de combate
  window.tapL = (at) => { W.attackPress("key", performance.now() + ((at == null ? W.ct : at) - W.ct) * 1000, A); T(2); W.attackRelease("key"); };
  window.ripRun = (bad3) => {
    const p = W.pf; let n = 0;
    tapL(); while (!(p.act && p.act.name === "riposte" && p.act.ripN === 1 && p.act.impactT != null) && n++ < 200) T(1);
    while (W.ct < p.act.impactT + 0.22 && n++ < 400) T(1); tapL();
    while (!(p.rip && p.rip.beat != null) && n++ < 400) T(1);
    const at = p.rip ? p.rip.beat + (bad3 ? 0.15 : 0) : W.ct; while (W.ct < at - 1 / 60 && n++ < 500) T(1); tapL(at);
    n = 0; while ((p.act || n < 10) && n++ < 300) T(1); T(10);
    return { rip: L("riposte").map((x) => x.n), defl: L("ripDeflected").length, deathblow: L("deathblow").length };
  };
  reset();
});
// 1) parry perfecto → DEFLECTED (~0,7 s) y riposte de 3 con el 3.º en ritmo (con toques L)
let r = await page.evaluate(() => {
  reset(); const res = foeStrike(0.04); const t0 = W.ct; const d0 = A.act && A.act.name;
  const rr = ripRun(false);
  return { parry: res && res.level, deflected: d0, ...rr };
});
check("parry perfecto: el enemigo queda DEFLECTED y el riposte (con toques) da 3 golpes con el 3.º en ritmo", r.parry === "perfect" && r.deflected === "deflected" && r.rip.join() === "1,2,3" && r.defl === 0, r);
// duración del desequilibrio
r = await page.evaluate(() => { reset(); foeStrike(0.04); const t0 = W.ct; let n = 0; while (A.act && A.act.name === "deflected" && n++ < 200) T(1); return { ms: Math.round((W.ct - t0) * 1000) }; });
check("DEFLECTED dura ~0,7 s", Math.abs(r.ms - 700) <= 60, r);
// 2) el 3.º fuera de ritmo: el enemigo lo desvía
r = await page.evaluate(() => { reset(); foeStrike(0.04); return ripRun(true); });
check("riposte: el 3.º fuera de ritmo lo desvía el enemigo", r.rip.join() === "1,2" && r.defl === 1, r);
// 3) parry normal = 1 golpe
r = await page.evaluate(() => { reset(); const res = foeStrike(0.13); const rr = ripRun(false); return { parry: res && res.level, ...rr }; });
check("parry normal: riposte de un solo golpe", r.parry === "normal" && r.rip.length === 1, r);
// 4) postura rota durante el riposte → DEATHBLOW
r = await page.evaluate(() => { reset(); foeStrike(0.04); A.post = A.postMax * 0.86; return ripRun(false); });
check("si la postura se rompe en el riposte: DEATHBLOW", r.deathblow === 1, r);
await page.evaluate(() => T(30));
// 5) reacciones por peso: ligero = respingo corto; fuerte = tambaleo con retroceso; su golpe fuerte = hyper armor
r = await page.evaluate(() => {
  const out = {};
  reset(); tapL(); let n = 0; while (!L("hit").length && n++ < 100) T(1); out.ligero = { res: L("hit")[0].res, flinch: !!(A.act && A.act.flinch) };
  const x0 = A.body.x, z0 = A.body.z; T(30); out.ligero.retroceso = +Math.hypot(A.body.x - x0, A.body.z - z0).toFixed(2);
  reset(); const ax = A.body.x, az = A.body.z; W.attackPress("key", performance.now(), A); T(28); W.attackRelease("key"); n = 0; while (!L("hit").length && n++ < 100) T(1);
  out.fuerte = { res: L("hit")[0].res, flinch: !!(A.act && A.act.flinch) }; T(30); out.fuerte.retroceso = +Math.hypot(A.body.x - ax, A.body.z - az).toFixed(2);
  // su barrido amplio (nivel 2): aguanta tu ligero sin interrumpirse
  reset(); A.ai.attack("attack2"); n = 0; while (A.act && A.act.f < 1 && n++ < 100) T(1); tapL(); n = 0; while (!L("hit").length && n++ < 100) T(1);
  out.armadura = { res: (L("hit")[0] || {}).res, sigue: !!(A.act && A.act.name === "attack2") };
  return out;
});
check("reacción por peso: ligero = respingo corto; fuerte = tambaleo con retroceso; su golpe fuerte aguanta (hyper armor)",
  r.ligero.res === "flinch" && r.fuerte.res === "hit" && !r.fuerte.flinch && r.fuerte.retroceso > r.ligero.retroceso * 1.5 && r.armadura.res === "armor" && r.armadura.sigue, r);
// 6) si te desvía, quedas desequilibrado y lanza su COUNTER; un perfecto lo desvía (intercambio)
r = await page.evaluate(() => {
  reset(); A.ai.enabled = true; A.ai.cool = 99; A.ai.passive = true; A.ai.state = "chase";
  // su lectura: obliga a que te desvíe el próximo golpe
  A.guardHeld = false; tapL(); let n = 0; while (W.pf.act && W.pf.act.f < 2 && n++ < 60) T(1);
  A.act = null; A.start("parry", { pressT: W.ct }); A.guardT = W.ct; A.lastGuardT = W.ct;
  n = 0; while (!L("foeParriedYou").length && n++ < 120) T(1);
  const yo = W.pf.act && W.pf.act.name, unb = !!(W.pf.act && W.pf.act.unbalanced);
  // su counter: desviado con un perfecto
  let pressed = false; n = 0;
  while (n++ < 300) { const a = A.act; const l = a && a.move === "counter" ? A.toImpact() : null; if (!pressed && l != null && l <= 0.04) { W.pf.input("guardDown", { ts: performance.now() + (l - 0.04) * 1000 }); W.pf.input("guardUp"); pressed = true; }
    T(1); if (L("xchg").length) break; }
  A.ai.passive = false; A.ai.enabled = false;
  return { tu: yo, desequilibrado: unb, counter: L("chainStart").some((x) => x.chain === "counter"), xchg: L("xchg").map((x) => x.result) };
});
check("si el enemigo te desvía: quedas desequilibrado y lanza su COUNTER; con un perfecto lo desvías (intercambio)", r.tu === "hit" && r.desequilibrado && r.counter && r.xchg.length >= 1, r);
// 7) choque: los dos golpeáis a la vez
r = await page.evaluate(() => {
  reset(); A.startAttack("attack1", { dir: A.body.heading }); let n = 0, done = false;
  while (n++ < 200) { const l = A.toImpact(); if (!done && l != null && l <= 0.205) { tapL(); done = true; } T(1); if (L("clash").length) break; }
  return { clash: L("clash").length, hits: L("hit").length };
});
check("choque: los dos golpeáis a la vez → chispas y retroceso sin daño", r.clash === 1 && r.hits === 0, r);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
