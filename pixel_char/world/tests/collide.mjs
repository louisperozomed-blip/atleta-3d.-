// Colisiones: manda al personaje contra obstáculos y comprueba dónde se para.
import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 60000 });
const cases = [
  ["árbol-corazón", [0, -4.5], [0, 0], "dist al centro >= 1.5"],
  ["laguna", null, null, "no entra en agua"],
  ["acantilado meseta", null, null, "no sube > 0.5"],
];
// 1: contra el árbol-corazón
let r = await page.evaluate(async () => { W.teleport(0, -4.5); W.player.setPath([{ x: 0, z: 0 }], { noDelay: true }); await new Promise((r) => setTimeout(r, 3000)); return [W.player.x, W.player.z, Math.hypot(W.player.x, W.player.z)]; });
console.log("árbol-corazón: parada a", r[2].toFixed(2), "del centro (radio obstáculo 1.55)", r[2] > 1.5 ? "OK" : "FALLO");
// 2: contra el agua: busca una baldosa de agua y un punto de sendero cercano
r = await page.evaluate(async () => {
  let w = null;
  for (let x = 14; x < 32 && !w; x += 0.5) for (let z = 14; z < 32 && !w; z += 0.5) if (W.kindAt(x, z) === W.K.WATER && W.kindAt(x - 3, z) !== W.K.WATER && W.cellFree(x - 3, z)) w = [x, z];
  W.teleport(w[0] - 3, w[1]); W.player.setPath([{ x: w[0] + 1, z: w[1] }], { noDelay: true });
  await new Promise((r) => setTimeout(r, 3000));
  return [w, W.player.x, W.player.z, W.kindAt(W.player.x, W.player.z)];
});
console.log("laguna: agua en", r[0], "se para en", r[1].toFixed(2), r[2].toFixed(2), "tipo", r[3], r[3] !== 2 ? "OK" : "FALLO");
// 3: contra un acantilado (desnivel > 0.5)
r = await page.evaluate(async () => {
  let c = null;
  for (let x = -30; x < 30 && !c; x += 0.5) for (let z = -30; z < 30 && !c; z += 0.5)
    if (W.cellFree(x, z) && W.cellFree(x + 1, z) && W.heightAt(x + 1, z) - W.heightAt(x, z) >= 1 && W.cellFree(x - 2, z) && W.heightAt(x - 2, z) === W.heightAt(x, z)) c = [x, z];
  W.teleport(c[0] - 2, c[1]); const h0 = W.heightAt(c[0] - 2, c[1]);
  W.player.setPath([{ x: c[0] + 2, z: c[1] }], { noDelay: true });
  await new Promise((r) => setTimeout(r, 3000));
  return [c, h0, W.player.x, W.heightAt(W.player.x, W.player.z)];
});
console.log("acantilado en", r[0], "altura inicial", r[1], "final", r[3], "x", r[2].toFixed(2), r[3] === r[1] ? "OK" : "FALLO");
await browser.close();
