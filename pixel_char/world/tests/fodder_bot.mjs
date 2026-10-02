// Relleno · Etapa 5: bot de reacción humana (250 ± 40 ms).
//
// RELLENO: el aviso es el inicio del WINDUP (pose, gruñido, anillo). El bot lo percibe con su reacción
// (250 ± 40 ms, normal truncada a ±3σ) y, como el ritmo de cada tipo es fijo, apunta su pulsación 60 ms antes del
// IMPACT (dentro de la ventana: PERFECTO = 0-70 ms antes, PARRY = hasta 200 ms) con un error de cronometraje
// que depende de la ayuda: anillo completo (nivel 2) σ = 20 ms (seguir un aro que se cierra), últimos 250 ms
// (nivel 1) σ = 25 ms, sin anillo (nivel 0, solo pose + gruñido + clic) σ = 35 ms (≈5 % de un intervalo de
// 0,6-0,8 s). Nunca pulsa antes de haber percibido el aviso (+50 ms de movimiento).
// «Desviable» = el aviso deja tiempo a una reacción humana para poner la pulsación dentro de la ventana
// (reacción + 50 ms ≤ WINDUP); y se mide además cuántos desvía de verdad el bot en el juego.
// AUTÓMATA: el bot de las pruebas anteriores (parry2): reacciona a la SUELTA (destello del ojo) con 250 ± 40 ms.
// uso: node fodder_bot.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const N = +(process.env.N || 120);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; W.skipRender = true; window.T = (n) => W.tick(1 / 60, n || 1);
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  let bs = 12345; const brand = () => ((bs = (bs * 16807) % 2147483647) / 2147483647);
  window.gauss = () => { let u = 0, v = 0; while (!u) u = brand(); while (!v) v = brand(); return Math.max(-3, Math.min(3, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))); };
  window.seed = (s) => { bs = (s * 2654435761) % 2147483646 + 1; for (let i = 0; i < 8; i++) brand(); };
  window.setup = (kind) => {
    if (W.enemyType !== kind) W.setEnemyType(kind);
    const f = (window.F = W.foes[0]);
    for (const g of W.foes) { g.ai.enabled = false; if (g !== f) { g.body.x = 999; g.body.z = 999; } }
    W.pf.respawn(); W.pf.hp = W.pf.hpMax = 9999; W.hitstop = 0;
    if (f.fodder && (!f.alive || f.hidden)) W.fodderRespawn(f);
    if (!f.fodder) { f.respawn(f.home.x, f.home.z); f.hp = f.hpMax = 9999; f.post = 0; f.ai.chain = null; }
    f.act = null; f.slide = null;
    const s = W.findSpot(f.home.x, f.home.z, null, 2.6);
    let a = 0;
    for (let k = 0; k < 16; k++) { const b = k * Math.PI / 8; let ok = true; for (let d = 0.5; d <= 4.5; d += 0.25) ok = ok && W.cellFree(s.x + Math.cos(b) * d, s.z + Math.sin(b) * d); if (ok) { a = b; break; } }
    W.teleport(s.x, s.z); const dd = f.kind === "dog" ? 2.3 : f.fodder ? 1.5 : 1.9;
    f.body.x = s.x + Math.cos(a) * dd; f.body.z = s.z + Math.sin(a) * dd; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z);
    f.body.heading = a + Math.PI; W.player.heading = a; f.body.stop(); T(4); W.combatLog.length = 0;
    return f;
  };
  // un golpe del relleno contra el bot; devuelve el resultado
  window.fodderTrial = (sig) => {
    const f = window.F, p = W.pf;
    f.ai.strike(Math.atan2(p.body.z - f.body.z, p.body.x - f.body.x));
    const t0 = f.act.fodderT0, C = f.fodder, impact = t0 + C.windup;
    const rt = 0.25 + 0.04 * gauss(), perceive = t0 + rt;
    const at = Math.max(perceive + 0.05, impact - 0.06 + sig * gauss());
    let n = 0, pressed = false;
    while (n++ < 200) {
      if (!pressed && W.ct + 1 / 60 >= at - 1e-9) { p.input("guardDown", { ts: performance.now() + (at - W.ct) * 1000 }); p.input("guardUp"); pressed = true; }
      T(1); if (L("fodderImpact").length && (L("parry").length || L("block").length || L("hit").length)) break;
    }
    T(1);
    const r = L("parry")[0] || L("block")[0] || L("hit")[0] || {};
    return { res: r.ev === "parry" ? r.level : r.ev || "?", early: Math.round((impact - at) * 1000), desviable: rt + 0.05 <= C.windup };
  };
  // un golpe del autómata contra el bot reactivo (ve la SUELTA)
  window.autoTrial = (move) => {
    const f = window.F, p = W.pf;
    f.ai.attack(move); let n = 0, pending = null, seen = false;
    while (n++ < 300) {
      const a = f.act;
      if (!seen && a && a.plan && a.plan.released) { seen = true; const P = a.plan, rel = W.ct - (P.t - P.wind - P.hold) / (a.speed || 1); pending = rel + 0.25 + 0.04 * gauss(); }
      if (pending != null && W.ct + 1 / 60 >= pending - 1e-9) { p.input("guardDown", { ts: performance.now() + (pending - W.ct) * 1000 }); p.input("guardUp"); pending = null; }
      T(1); if (L("parry").length || L("block").length || L("hit").length) break;
    }
    T(30);
    const r = L("parry")[0] || L("block")[0] || L("hit")[0] || {};
    return { res: r.ev === "parry" ? r.level : r.ev || "?" };
  };
});
const out = {};
const pct = (a, k) => +(100 * a.filter(k).length / a.length).toFixed(1);
for (const kind of ["zombie", "dog"]) {
  for (const [lv, sig] of [[2, 0.02], [1, 0.025], [0, 0.035]]) {
    const rs = await page.evaluate(({ kind, lv, sig, N }) => {
      seed(lv * 100 + (kind === "dog" ? 7 : 3)); W.setFodderRingMode(lv === 2 ? "always" : lv === 0 ? "never" : "auto");
      const res = [];
      for (let i = 0; i < N; i++) { setup(kind); if (lv === 1) W.FODDER_SCAF[kind].level = 1; res.push(fodderTrial(sig)); }
      W.setFodderRingMode("auto");
      return res;
    }, { kind, lv, sig, N });
    out[`${kind}_nivel${lv}`] = { n: rs.length, desviables: pct(rs, (x) => x.desviable), desviados: pct(rs, (x) => x.res === "perfect" || x.res === "normal"), perfectos: pct(rs, (x) => x.res === "perfect"),
      golpeado: pct(rs, (x) => x.res === "hit"), bloqueo: pct(rs, (x) => x.res === "block") };
    console.log(kind, "nivel", lv, JSON.stringify(out[`${kind}_nivel${lv}`]));
  }
}
const ra = await page.evaluate((N) => {
  seed(999); W.setEnemyType("automaton"); const res = [];
  for (let i = 0; i < N; i++) { setup("automaton"); res.push(Object.assign(autoTrial(i % 2 ? "attack2" : "attack1"), { move: i % 2 ? "attack2" : "attack1" })); }
  return res;
}, N);
out.automata = { n: ra.length, desviados: pct(ra, (x) => x.res === "perfect" || x.res === "normal"), perfectos: pct(ra, (x) => x.res === "perfect"), golpeado: pct(ra, (x) => x.res === "hit"),
  attack1_perfectos: pct(ra.filter((x) => x.move === "attack1"), (x) => x.res === "perfect"), attack2_perfectos: pct(ra.filter((x) => x.move === "attack2"), (x) => x.res === "perfect") };
console.log("autómata", JSON.stringify(out.automata));
const all2 = ["zombie_nivel2", "dog_nivel2"].map((k) => out[k]);
const ok = all2.every((x) => x.desviables >= 99 && x.desviados >= 99) && ["zombie_nivel1", "zombie_nivel0", "dog_nivel1", "dog_nivel0"].every((k) => out[k].desviables >= 99);
console.log(ok ? "OK   ≥ 99 % de golpes de relleno desviables (y desviados por el bot con el anillo)" : "FALLO desviables < 99 %", errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/bot.json`, JSON.stringify({ N, out, ok, errors }, null, 1));
await browser.close();
