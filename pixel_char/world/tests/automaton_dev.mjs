import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
const R = await page.evaluate(() => {
  W.manual = true; W.skipRender = true; const T = (n) => W.tick(1 / 60, n || 1);
  const e = W.foe, p = W.pf, D = W.ENEMY_DIFF, out = {};
  out.start = { d: +Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z).toFixed(1), state: e.ai.state, zones: W.foes.map((f) => f.zone) };
  const pair = (d) => { for (const f of W.foes) if (f !== e) f.ai.enabled = false; p.respawn(); e.respawn(e.home.x, e.home.z); W.hitstop = 0; e.ai.pending = null;
    W.teleport(e.home.x - d, e.home.z); p.body.heading = 0; e.body.heading = Math.PI; e.ai.state = "chase"; e.ai.cool = 99; T(8); W.combatLog.length = 0; };
  const ev = () => W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev);
  // 1) bloqueo del autómata (parry 0, bloqueo 100%)
  D.parry = 0; D.block = 1; pair(2.2); p.input("attack", { dir: 0 }); T(50); out.block = ev();
  // 2) parry del autómata: el mismo ataque repetido; el jugador pierde postura
  D.parry = 1; D.block = 0; pair(2.2); const post0 = p.post; p.input("attack", { dir: 0 }); T(60); out.parry = { ev: ev(), playerPost: [post0, Math.round(p.post)] };
  // 3) esquiva: poca vida
  D.parry = 0; D.block = 0; pair(2.2); e.hp = e.hpMax * 0.2; e.ai.rand = null; let dodged = false;
  for (let k = 0; k < 6 && !dodged; k++) { p.input("attack", { dir: 0 }); T(50); dodged = W.combatLog.some((x) => x.ev === "foeDodge"); }
  out.dodge = ev();
  // 4) aviso + parry del jugador x3 -> aturdido -> remate
  pair(2.0); e.ai.cool = 0; let n = 0; const stops = [];
  while (!e.stunned && n < 3000) {
    const a = e.act;
    if (a && a.name.startsWith("attack") && !a._pp) { const ms = e.M().animations[a.name].ms; const left = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.f < 3 ? a.slow : 1);
      if (left <= 0.1) { p.input("guardDown"); p.input("guardUp"); a._pp = true; } }
    T(); n++;
  }
  out.stun = { stunned: e.stunned, ev: ev().filter((x) => x !== "foeParryTry"), post: Math.round(e.post) };
  T(20); p.act = null; p.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); T(40);
  out.deathblow = (W.combatLog.find((x) => x.ev === "deathblow") || {}).dmg;
  // 5) muerte y desvanecerse
  e.hp = 1; e.act = null; e.ai.pending = null; D.parry = 0; D.block = 0; p.act = null; p.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); T(60);
  const f1 = e.fade; T(60 * 4); const f2 = e.fade; T(60 * 2); out.death = { alive: e.alive, fade: [+f1.toFixed(2), +f2.toFixed(2), +e.fade.toFixed(2)], hidden: !!e.hidden };
  W.respawnAll(); T(5); out.respawn = { alive: e.alive, hp: e.hp, hidden: !!e.hidden, fade: e.fade };
  // 6) cambio al eco y vuelta
  W.setEnemyType("echo"); T(5); out.echo = { type: W.enemyType, n: W.foes.length, label: W.foe.label, fighters: W.fighters.length };
  W.setEnemyType("automaton"); T(5); out.back = { type: W.enemyType, n: W.foes.length, fighters: W.fighters.length };
  return out;
});
console.log(JSON.stringify(R, null, 1));
await browser.close();
