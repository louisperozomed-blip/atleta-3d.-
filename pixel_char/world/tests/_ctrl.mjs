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
// ---- escritorio: teclado + ratón ----
let page = await open({ viewport: { width: 900, height: 700 } });
res.kbMove = await page.evaluate(() => { W.teleport(0, -6.2); T(5); return [W.player.x, W.player.z]; });
await page.keyboard.down("KeyD"); await page.evaluate(() => T(60)); await page.keyboard.up("KeyD"); await page.evaluate(() => T(40));
res.kbMove.push(await page.evaluate(() => [+W.player.x.toFixed(2), +W.player.z.toFixed(2), W.character.st.dir]));
await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW"); const runSpd = await page.evaluate(() => { T(90); return [W.character.st.anim, +W.player.speed.toFixed(2)]; });
await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft"); await page.evaluate(() => T(60));
res.kbRun = runSpd;
// J ataca, J J encadena
res.kbAttack = await page.evaluate(() => { const e = W.foe; W.teleport(e.home.x - 1.3, e.home.z); W.player.heading = 0; e.body.heading = Math.PI; T(10); W.combatLog.length = 0; return 0; });
for (let i = 0; i < 3; i++) { await page.keyboard.press("KeyJ"); await page.evaluate(() => T(18)); }
res.kbAttack = await page.evaluate(() => { T(40); return W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev + ":" + x.anim); });
// K: tocar = parry (anim parry), mantener = bloqueo
await page.keyboard.down("KeyK"); await page.evaluate(() => T(3)); await page.keyboard.up("KeyK");
res.kTap = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return a; });
await page.keyboard.down("KeyK"); res.kHold = await page.evaluate(() => { T(30); return W.pf.act && W.pf.act.name; }); await page.keyboard.up("KeyK");
await page.evaluate(() => T(40));
// Espacio = esquiva, L = salto
await page.keyboard.press("Space"); res.space = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return a; });
await page.keyboard.press("KeyL"); res.jump = await page.evaluate(() => { T(4); const j = !!W.player.jump; T(60); return j; });
// clic sobre el enemigo = ataque
await page.evaluate(() => { const e = W.foe; W.teleport(e.home.x - 1.6, e.home.z); W.player.heading = 0; T(20); W.combatLog.length = 0; });
const fs2 = await page.evaluate(() => { const b = W.foe.body; const a = W.toScreen(b.x, b.y + 0.8, b.z); return a; });
await page.mouse.click(fs2[0], fs2[1]);
res.clickFoe = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return [W.lastFoeTap, a, W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev)]; });
// clic lejos del enemigo: se acerca y ataca
await page.evaluate(() => { const e = W.foe; e.respawn(e.home.x, e.home.z); W.teleport(e.home.x - 6, e.home.z); T(20); W.combatLog.length = 0; });
const fs3 = await page.evaluate(() => { const b = W.foe.body; return W.toScreen(b.x, b.y + 0.8, b.z); });
await page.mouse.click(fs3[0], fs3[1]);
res.clickFar = await page.evaluate(() => { const t0 = W.lastFoeTap; let n = 0; while (!(W.pf.act) && n < 400) { T(); n++; } const a = W.pf.act && W.pf.act.name; T(40); return [t0, n, a, W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev)]; });
// botón GUARDIA: tocar y mantener
const gb = await page.locator("#guard").boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down(); await page.evaluate(() => T(2)); await page.mouse.up();
res.guardTap = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return a; });
await page.mouse.down(); res.guardHold = await page.evaluate(() => { T(30); return W.pf.act && W.pf.act.name; }); await page.mouse.up(); await page.evaluate(() => T(30));
await page.screenshot({ path: OUT + "/ctrl_desk.png" });
await page.close();
// ---- móvil: deslizar = esquivar ----
page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.context().newCDPSession(page);
await page.evaluate(() => { W.teleport(0, -6.2); T(10); });
const c = await page.evaluate(() => { const b = W.player; return W.toScreen(b.x, b.y + 0.5, b.z); });
const sw = async (dx, dy) => {
  const pts = [[c[0], c[1]], [c[0] + dx * 0.5, c[1] + dy * 0.5], [c[0] + dx, c[1] + dy]];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[1][0], y: pts[1][1] }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[2][0], y: pts[2][1] }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
res.swipes = [];
for (const [dx, dy] of [[90, 0], [0, -90], [-90, 0], [0, 90]]) {
  const p0 = await page.evaluate(() => [W.player.x, W.player.z]);
  await sw(dx, dy);
  const r = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return { a, sw: W.lastSwipe && [W.lastSwipe.ms | 0, +W.lastSwipe.dir.toFixed(2)], p: [W.player.x, W.player.z] }; });
  const s0 = await page.evaluate((p) => { const a = W.toScreen(p[0], W.player.y, p[1]), b = W.toScreen(W.player.x, W.player.y, W.player.z); return [Math.round(b[0] - a[0]), Math.round(b[1] - a[1])]; }, p0);
  res.swipes.push({ dir: [dx, dy], act: r.a, swipe: r.sw, screenMove: s0 });
  await page.evaluate(() => T(20));
}
await page.screenshot({ path: OUT + "/ctrl_mob.png" });
console.log(JSON.stringify(res, null, 0));
await browser.close();
