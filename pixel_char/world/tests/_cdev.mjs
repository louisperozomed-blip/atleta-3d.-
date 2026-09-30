import { chromium } from "playwright";
import fs from "node:fs";
const THREE_LOCAL = process.env.THREE_LOCAL, OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.type(), m.text().slice(0, 300)); });
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
const r = await page.evaluate(() => {
  W.manual = true; W.tick(1 / 60, 30);
  const p = W.pf, e = W.foe;
  return { p: [p.body.x, p.body.z, p.body.heading], e: e && [e.body.x, e.body.z], spawn: W.foeSpawn, fighters: W.fighters.length };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: OUT + "/c0.png" });
// combo: attack pressed 3 times at intervals
const seq = await page.evaluate(() => {
  const p = W.pf, out = [];
  const tick = (n) => { for (let i = 0; i < n; i++) { W.tick(1 / 60); const a = p.act; out.push(a ? a.name + ":" + a.f : "-"); } };
  p.input("attack"); tick(20); p.input("attack"); tick(20); p.input("attack"); tick(60);
  return { seq: out.join(" "), log: W.combatLog.slice(-10) };
});
console.log(seq.seq); console.log(JSON.stringify(seq.log));
await page.screenshot({ path: OUT + "/c1.png" });
await browser.close();
