import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function open(opts) {
  const page = await browser.newPage(opts);
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("file://" + process.argv[2]);
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
  await page.evaluate(() => { W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1); });
  return page;
}
const res = {};
// ---- móvil: deslizar = esquivar ----
let page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.context().newCDPSession(page);
await page.evaluate(() => { W.teleport(0, -6.2); T(10); window.EV = []; const cv = W.renderer.domElement; for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) cv.addEventListener(t, (e) => EV.push([t, Math.round(e.clientX), Math.round(e.clientY)])); });
const c = await page.evaluate(() => { const b = W.player; return W.toScreen(b.x, b.y + 0.5, b.z); });
const sw = async (dx, dy) => {
  const pts = [[c[0], c[1]], [c[0] + dx * 0.5, c[1] + dy * 0.5], [c[0] + dx, c[1] + dy]];
  // todos los eventos del gesto juntos: con SwiftShader el compositor tarda entre eventos sueltos
  await Promise.all([
    cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] }),
    cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[1][0], y: pts[1][1] }] }),
    cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[2][0], y: pts[2][1] }] }),
    cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
  ]);
};
res.swipes = [];
for (const [dx, dy] of [[90, 0], [0, -90], [-90, 0], [0, 90]]) {
  const p0 = await page.evaluate(() => [W.player.x, W.player.z]);
  await sw(dx, dy); await page.waitForTimeout(150);
  const r = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return { a, sw: W.lastSwipe && [W.lastSwipe.ms | 0, +W.lastSwipe.dir.toFixed(2)], p: [W.player.x, W.player.z] }; });
  const s0 = await page.evaluate((p) => { const a = W.toScreen(p[0], W.player.y, p[1]), b = W.toScreen(W.player.x, W.player.y, W.player.z); return [Math.round(b[0] - a[0]), Math.round(b[1] - a[1])]; }, p0);
  res.swipes.push({ dir: [dx, dy], act: r.a, swipe: r.sw, screenMove: s0, g: await page.evaluate(() => W.lastGesture) });
  await page.evaluate(() => T(20));
}
await page.screenshot({ path: OUT + "/ctrl_mob.png" });
console.log(JSON.stringify(res, null, 0));
await browser.close();
