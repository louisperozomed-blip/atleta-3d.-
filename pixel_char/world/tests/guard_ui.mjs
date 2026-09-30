import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [name, o] of [["movil", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }], ["escritorio", { viewport: { width: 1280, height: 800 } }]]) {
  const ctx = await browser.newContext(o); const page = await ctx.newPage();
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("file://" + process.argv[2]);
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
  await page.evaluate(() => { W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1); const e = W.foe; e.ai.enabled = false;
    W.teleport(e.home.x - 1.3, e.home.z); W.player.heading = 0; e.body.heading = Math.PI; T(20); });
  const gb = await page.locator("#guard").boundingBox();
  const cx = gb.x + gb.width / 2, cy = gb.y + gb.height / 2;
  // tocar = parry
  if (o.hasTouch) await page.touchscreen.tap(cx, cy); else { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); }
  const tap = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return a; });
  // mantener = bloqueo
  await page.mouse.move(cx, cy); await page.mouse.down(); const hold = await page.evaluate(() => { T(25); return W.pf.act && W.pf.act.name; }); await page.mouse.up(); await page.evaluate(() => T(40));
  // parry real contra un golpe del eco (entrada directa, a 110 ms del impacto) y captura del aviso
  await page.evaluate(() => { const e = W.foe, p = W.pf; e.input("attack", { dir: Math.PI }); let done = false, n = 0;
    while (!W.combatLog.some((x) => x.ev === "parry") && n < 200) { const a = e.act; if (a && a.f < 3) { const ms = W.CMETA.animations[a.name].ms; const l = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.slow || 1); if (!done && l <= 0.11) { p.input("guardDown"); p.input("guardUp"); done = true; } } T(); n++; } T(8); });
  const pop = await page.evaluate(() => [...document.querySelectorAll(".cpop")].map((x) => x.textContent));
  console.log(name, JSON.stringify({ guard: [Math.round(gb.x), Math.round(gb.y), Math.round(gb.width)], tap, hold, pop }));
  await page.screenshot({ path: process.env.S + "/ui2_" + name + ".png" });
  await ctx.close();
}
await browser.close();
