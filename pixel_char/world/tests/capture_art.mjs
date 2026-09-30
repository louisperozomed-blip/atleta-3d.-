// Capturas deterministas de cada zona con el personaje (W.manual + W.tick) y estadísticas de render
// (draw calls, triángulos). Sirve para el antes/después de la nueva dirección de arte.
// uso: node capture_art.mjs <dist/index.html> <carpeta_salida> [ancho alto] ; SPOTS='[[nombre,x,z,rumbo],...]'
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "430", h = "760"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
if (process.env.CONSOLE) page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 300)));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
if (process.env.PRE) await page.evaluate(process.env.PRE);
await page.evaluate(() => { W.manual = true; for (const s of [".bar", ".hud"]) { const e = document.querySelector(s); if (e) e.style.display = "none"; } });
const spots = JSON.parse(process.env.SPOTS || '[["heart",3.5,-5.5,2.4],["roots",-20,-19,0.8],["crystal",22,-20,2.2],["ponds",21,19,-0.8],["ruins",-21,22,0.3]]');
const stats = {};
for (const [name, x, z, hd] of spots) {
  const info = await page.evaluate(([x, z, hd]) => {
    W.teleport(x, z); W.player.heading = hd || 0;
    W.tick(1 / 30, 60);
    return Object.assign({}, W.lastInfo);
  }, [x, z, hd]);
  stats[name] = info;
  console.log(name.padEnd(8), `draw calls ${info.calls}, triángulos ${(info.triangles / 1000).toFixed(1)}k, puntos ${info.points}`);
  await page.screenshot({ path: `${out}/${name}.png` });
}
stats._global = await page.evaluate(() => W.stats);
fs.writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 1));
await browser.close();
