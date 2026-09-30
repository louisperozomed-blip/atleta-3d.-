import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 700, height: 520 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  const e = W.foe, p = W.pf;
  W.teleport(e.home.x - 1.3, e.home.z); p.body.heading = 0; e.body.heading = Math.PI; T(20);
  e.input("attack"); let n = 0;
  while (!(e.act && e.act.f >= 3) && n < 300) { if (n === 14) p.input("guardDown"); if (n === 16) p.input("guardUp"); T(); n++; }
});
await page.screenshot({ path: OUT + "/v_parry.png" });
await page.evaluate(() => { T(1); });
await page.screenshot({ path: OUT + "/v_parry2.png" });
await page.evaluate(() => { const p = W.pf; T(50); p.input("attack"); let n = 0; while (!(p.act && p.act.f >= 3) && n < 100) { T(); n++; } T(1); });
await page.screenshot({ path: OUT + "/v_hit.png" });
await browser.close();
