import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
const res = {};
res.start = await page.evaluate(() => { W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1); T(60); const e = W.foe; return { state: e.ai.state, d: +Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z).toFixed(2), act: W.pf.act }; });
await page.screenshot({ path: OUT + "/ai0.png" });
// el jugador se acerca: el eco despierta, persigue y ataca con aviso
res.chase = await page.evaluate(() => {
  const e = W.foe; W.teleport(e.home.x - 5.5, e.home.z + 1); T(5); W.player.path = [{ x: e.home.x - 3.5, z: e.home.z }]; T(90);
  const out = []; let warnAt = null;
  for (let i = 0; i < 360; i++) { T(); const w = W.combatLog.find((x) => x.ev === "warn"); if (w && !warnAt) warnAt = i; if (i % 30 === 0) out.push(e.ai.state + ":" + (e.act ? e.act.name + e.act.f : "-") + ":" + Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z).toFixed(1)); if (warnAt != null && i === warnAt + 1) window.WARN_SHOT = true; }
  return { out, log: W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev + (x.anim ? ":" + x.anim : "")).slice(0, 14), hp: W.pf.hp };
});
await page.screenshot({ path: OUT + "/ai1.png" });
// captura del aviso: esperar al siguiente "warn"
await page.evaluate(() => { W.pf.respawn(); const n0 = W.combatLog.length; let i = 0; while (i < 400 && !W.combatLog.slice(n0).some((x) => x.ev === "warn")) { T(); i++; } T(2); });
await page.screenshot({ path: OUT + "/ai_warn.png" });
// parry repetidos contra sus ataques hasta romper la postura → aturdido → remate
res.parryLoop = await page.evaluate(() => {
  const e = W.foe, p = W.pf; p.respawn(); e.post = 0; W.combatLog.length = 0; let stun = false, i = 0, last = null;
  while (i < 3000 && !stun) {
    // cuando el eco empieza un ataque, pulsar guardia ~110 ms antes del impacto
    if (e.act && e.act.name.startsWith("attack") && e.act.f === 2 && last !== e.act) { last = e.act; const c = W.combatDur(e.act.name); }
    if (e.act && e.act.name.startsWith("attack") && e.act.f === 2 && !e.act._pp) {
      // tiempo restante hasta f3 en tiempo real (preparación ×1.7)
      e.act._pp = true; e.act._need = true;
    }
    if (e.act && e.act._need) {
      const ms = W.CMETA.animations[e.act.name].ms, left = ((ms[0] + ms[1] + ms[2]) / 1000 - e.act.tt) * e.act.slow;
      if (left < 0.11) { p.input("guardDown"); p.input("guardUp"); e.act._need = false; }
    }
    T(); i++; stun = e.stunned;
  }
  const ev = W.combatLog.filter((x) => ["parry", "hit", "block", "stun"].includes(x.ev)).map((x) => x.ev + (x.post != null ? x.post : ""));
  let db = null;
  if (stun) { T(18); W.player.heading = Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x); p.input("attack", { dir: W.player.heading }); T(40); db = W.combatLog.find((x) => x.ev === "deathblow"); }
  return { ticks: i, stun, ev, deathblow: db && db.dmg, ehp: Math.round(e.hp) };
});
await page.screenshot({ path: OUT + "/ai_stun.png" });
// matar al eco y reaparecer con el botón
res.respawn = await page.evaluate(() => { const e = W.foe; e.hp = 1; e.act = null; W.pf.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); T(60); return { dead: !e.alive, btn: document.getElementById("respawn").classList.contains("hot") }; });
await page.click("#respawn");
res.respawn.after = await page.evaluate(() => { T(5); const e = W.foe; return { alive: e.alive, hp: e.hp, at: [+(e.body.x - e.home.x).toFixed(2), +(e.body.z - e.home.z).toFixed(2)], btn: document.getElementById("respawn").classList.contains("hot") }; });
console.log(JSON.stringify(res, null, 0));
await browser.close();
