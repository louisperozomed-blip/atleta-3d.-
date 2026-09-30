import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
await page.evaluate(() => {
  W.manual = true;
  window.T = (n) => W.tick(1 / 60, n || 1);
  window.setup = (d) => {
    const e = W.foe, p = W.pf;
    p.respawn(); e.respawn(); W.hitstop = 0;
    W.teleport(e.home.x - (d || 1.3), e.home.z); e.body.x = e.home.x; e.body.z = e.home.z;
    p.body.heading = 0; e.body.heading = Math.PI; T(10); W.combatLog.length = 0;
  };
  // tiempo (s) desde el inicio de un ataque del eco hasta su impacto
  window.untilImpact = (fn) => { let n = 0; while (!(W.foe.act && W.foe.act.f >= 3) && n < 400) { if (fn) fn(n); T(); n++; } return n; };
});
const res = {};
// 1) parry dentro de la ventana: pulsar ~120 ms antes del impacto
res.parryIn = await page.evaluate(() => {
  setup(1.3); const e = W.foe;
  // medir cuántos ticks tarda el impacto
  e.input("attack"); const n = untilImpact(); T(60); setup(1.3);
  e.input("attack"); let k = 0;
  untilImpact((i) => { if (i === n - 7) W.pf.input("guardDown"); if (i === n - 5) W.pf.input("guardUp"); });
  T(2);
  return { ticksToImpact: n, log: W.combatLog.filter((x) => x.ev !== "swing"), hp: W.pf.hp, post: Math.round(e.post) };
});
await page.screenshot({ path: OUT + "/p_parry.png" });
// 2) pulsar demasiado pronto (~450 ms antes) y soltar: golpe
res.parryEarly = await page.evaluate(() => {
  T(90); setup(1.3); const e = W.foe;
  e.input("attack");
  untilImpact((i) => { if (i === 2) { W.pf.input("guardDown"); } if (i === 4) W.pf.input("guardUp"); });
  T(2);
  return { log: W.combatLog.filter((x) => x.ev !== "swing"), hp: W.pf.hp };
});
// 3) bloqueo mantenido hasta romper la guardia
res.block = await page.evaluate(() => {
  T(90); setup(1.3); const e = W.foe, p = W.pf;
  p.input("guardDown"); T(20);
  const out = [];
  for (let i = 0; i < 10 && p.alive; i++) { e.act = null; e.input("attack"); untilImpact(); T(2); out.push([Math.round(p.st), Math.round(p.hp), p.act && p.act.name]); T(50); }
  p.input("guardUp"); T(60);
  return { seq: out, log: W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev) };
});
// 4) esquiva en el momento del impacto
res.dodge = await page.evaluate(() => {
  T(120); setup(1.3); const e = W.foe, p = W.pf;
  e.input("attack"); const n = untilImpact((i) => {});
  T(60); setup(1.3);
  e.input("attack");
  untilImpact((i) => { if (i === n - 8) p.input("dodge", { dir: Math.PI / 2 }); });
  T(2);
  return { log: W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev), hp: p.hp, moved: +Math.hypot(p.body.x - (e.home.x - 1.3), p.body.z - e.home.z).toFixed(2) };
});
// 5) cancelación: attack1 → esquiva tras el impacto
res.cancel = await page.evaluate(() => {
  T(120); setup(1.3); const p = W.pf, seq = [];
  p.input("attack"); for (let i = 0; i < 40; i++) { if (p.act && p.act.name === "attack1" && p.act.f === 4) p.input("dodge", { dir: Math.PI }); T(); seq.push(p.act ? p.act.name[0] + p.act.f : "-"); }
  return seq.join(" ");
});
// 6) muerte del eco (remates) 
res.kill = await page.evaluate(() => {
  T(60); setup(1.2); const p = W.pf, e = W.foe; let n = 0;
  while (e.alive && n < 60) { p.input("attack"); T(12); n++; }
  T(120);
  return { alive: e.alive, act: e.act && e.act.name + e.act.f, ev: W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev + (x.dmg ? x.dmg : "")).join(",") };
});
await page.screenshot({ path: OUT + "/p_dead.png" });
console.log(JSON.stringify(res, null, 1));
await browser.close();
