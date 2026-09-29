// Etapa 2: giro de cámara (índice de dirección ±2), ondas en charcas, polvo al aterrizar, escalones.
import { chromium } from "playwright";
import fs from "node:fs";
const [html, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + html);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 60000 });
await page.evaluate(() => { W.ui.zoom = 2.6; W.resize(); W.teleport(3.5, -5.5); });
await page.waitForTimeout(600);
// 1. giro de cámara
const d0 = await page.evaluate(() => W.character.st.dir);
await page.click("#rr"); await page.waitForTimeout(700);
const d1 = await page.evaluate(() => W.character.st.dir);
await page.click("#rr"); await page.waitForTimeout(700);
const d2 = await page.evaluate(() => W.character.st.dir);
await page.click("#rl"); await page.click("#rl"); await page.waitForTimeout(700);
const d3 = await page.evaluate(() => W.character.st.dir);
console.log("giro de cámara: dir", d0, "→", d1, "→", d2, "→ vuelta", d3, ((d1 - d0 + 8) % 8 === 2 || (d0 - d1 + 8) % 8 === 2) && d3 === d0 ? "OK" : "FALLO");
// 2. escalones: busca un sendero con escalón de 0.5 y cruza midiendo la altura de los pies
const stepRes = await page.evaluate(async () => {
  let s = null;
  for (let x = -30; x < 30 && !s; x += 0.5) for (let z = -30; z < 30 && !s; z += 0.5)
    if (W.kindAt(x, z) === W.K.PATH && W.kindAt(x + 1, z) === W.K.PATH && W.heightAt(x + 1, z) - W.heightAt(x, z) === 0.5 && W.cellFree(x - 1, z) && W.cellFree(x + 2, z) && W.heightAt(x - 1, z) === W.heightAt(x, z) && W.heightAt(x + 2, z) === W.heightAt(x + 1, z)) s = [x, z];
  W.teleport(s[0] - 1, s[1]); W.player.setPath([{ x: s[0] + 2.2, z: s[1] }], { noDelay: true });
  const ys = [];
  for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 50)); ys.push(+W.player.y.toFixed(3)); }
  let maxJump = 0; for (let k = 1; k < ys.length; k++) maxJump = Math.max(maxJump, Math.abs(ys[k] - ys[k - 1]));
  return { s, ys: ys.filter((_, i) => i % 3 === 0), maxJump };
});
console.log("escalón en", stepRes.s, "altura pies", stepRes.ys.join(" "), "máx salto entre muestras", stepRes.maxJump.toFixed(3));
// 3. charca: camina por un charquito y salta; capturas
const pud = await page.evaluate(() => {
  let best = null, bn = 0;
  for (let x = 12; x < 32; x += 1) for (let z = 12; z < 32; z += 1) {
    let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (W.kindAt(x + a, z + b) === W.K.PUDDLE) n++;
    if (n > bn && W.cellFree(x + 0.5, z + 0.5)) { bn = n; best = [x + 0.5, z + 0.5]; }
  }
  return best;
});
await page.evaluate(([x, z]) => { W.teleport(x - 1.2, z); W.player.setPath([{ x: x + 1.2, z }], { noDelay: true }); }, pud);
let rings = 0;
for (let k = 0; k < 14; k++) {
  await page.waitForTimeout(100);
  rings = Math.max(rings, await page.evaluate(() => W.scene.children.filter((m) => m.geometry && m.geometry.type === "RingGeometry" && m.visible).length));
  if (k === 6) await page.screenshot({ path: `${out}_charca.png` });
}
console.log("charquito en", pud, "anillos visibles (máx)", rings, rings > 0 ? "OK" : "FALLO");
await page.waitForTimeout(800);
await page.evaluate(() => W.player.doJump());
await page.waitForTimeout(780);
await page.screenshot({ path: `${out}_aterrizaje.png` });
const dust = await page.evaluate(() => { const p = W.scene.children.find((m) => m.isPoints && m.geometry.attributes.position.count === 64); const a = p.geometry.attributes.position.array; let n = 0; for (let i = 1; i < a.length; i += 3) if (a[i] > -50) n++; return n; });
console.log("polvo al aterrizar: partículas vivas", dust, dust > 0 ? "OK" : "FALLO");
await browser.close();
