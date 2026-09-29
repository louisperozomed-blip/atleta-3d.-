// Píxeles del personaje tal como se ven en el mundo (iluminado, sin cuantizar): captura con y sin
// el personaje en el mismo instante y guarda las dos imágenes para aislar sus píxeles.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
await page.evaluate(() => { W.manual = true; W.FX.matter = false; W.ui.zoom = 3.2; W.resize(); document.querySelector(".bar").style.display = "none"; document.querySelector(".hud").style.display = "none"; });
const spots = [[3.5, -5.5], [0.3, -2.3], [22, -20], [21, 19], [-21, 22], [-20, -19], [-8.5, 0.5]];
let n = 0;
for (const [x, z] of spots) for (const h of [0, 1.6, 3.1, 4.7]) {
  await page.evaluate(([x, z, h]) => { W.teleport(x, z); W.player.heading = h; W.player.setPath([{ x: x + Math.cos(h) * 3, z: z + Math.sin(h) * 3 }], { noDelay: true }); W.tick(1 / 30, 14); W.hideChar = false; W.tick(0); }, [x, z, h]);
  await page.screenshot({ path: `${outDir}/c${n}_a.png` });
  await page.evaluate(() => { W.hideChar = true; W.tick(0); W.hideChar = false; });
  await page.screenshot({ path: `${outDir}/c${n}_b.png` });
  n++;
}
console.log(n, "pares");
await browser.close();
