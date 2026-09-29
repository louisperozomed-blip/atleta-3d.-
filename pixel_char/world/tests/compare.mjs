// Etapa 2: personaje integrado vs sin integrar (pegatina) en 3 zonas con luz distinta.
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
await page.evaluate(() => { W.ui.zoom = 2.6; W.resize(); });
// charquito transitable para la zona de charcas
const puddle = await page.evaluate(() => {
  for (let x = 12; x < 32; x += 0.5) for (let z = 12; z < 32; z += 0.5)
    if (W.kindAt(x, z) === W.K.PUDDLE && W.cellFree(x, z) && W.kindAt(x + 0.6, z) === W.K.PUDDLE) return [x + 0.25, z + 0.25];
  return [21, 19];
});
const spots = [["claro · luz magenta del árbol-corazón", 0.3, -2.3], ["campo de cristales · luz violeta", 22, -20], ["charcas · agua y luz cian", puddle[0], puddle[1]]];
let i = 0;
for (const [name, x, z] of spots) {
  await page.evaluate(([x, z]) => { W.teleport(x, z); W.character.integrated = true; }, [x, z]);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}_${i}_int.png` });
  await page.evaluate(() => { W.character.integrated = false; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}_${i}_raw.png` });
  console.log(i, name, x.toFixed(1), z.toFixed(1));
  i++;
}
await browser.close();
