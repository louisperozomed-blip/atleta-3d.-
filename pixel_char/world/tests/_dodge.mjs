import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => {
  W.manual = true; W.skipRender = true; const T = (n) => W.tick(1 / 60, n || 1);
  const e = W.foe, p = W.pf, D = W.ENEMY_DIFF; D.parry = 0; D.block = 0;
  for (const f of W.foes) if (f !== e) f.ai.enabled = false;
  W.teleport(e.home.x - 2.2, e.home.z); p.body.heading = 0; e.body.heading = Math.PI; e.ai.state = "chase"; e.ai.cool = 99; e.hp = 50; T(8);
  const orig = e.ai.onPlayerAttack.bind(e.ai), log = [];
  e.ai.onPlayerAttack = function (act) { const before = this.pending; orig(act); log.push({ st: this.state, act: e.act && e.act.name, pend: this.pending && this.pending.kind, hp: e.hp }); };
  for (let k = 0; k < 6; k++) { p.input("attack", { dir: 0 }); T(50); log.push(W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev).join(",")); W.combatLog.length = 0; }
  return log; })));
await browser.close();
