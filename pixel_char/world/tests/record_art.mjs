// GIF de recorridos (determinista, paso fijo 1/30 s, 15 fps en el GIF).
// uso: node record_art.mjs <dist/index.html> <carpeta> <ancho> <alto> '<tramos JSON>'
//   tramos: [{ "tp": [x, z], "go": [x, z], "run": true, "frames": 60, "pre": "js" }, ...]
//   (un tramo sin "go" solo espera: el personaje en reposo)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "480", h = "600", legsJ] = process.argv.slice(2);
const legs = JSON.parse(legsJ);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
await page.evaluate(() => { W.manual = true; const b = document.querySelector(".bar"); if (b) b.style.display = "none"; });
if (process.env.PRE) await page.evaluate(process.env.PRE);
let n = 0;
const info = [];
for (const L of legs) {
  await page.evaluate((L) => {
    if (L.pre) eval(L.pre);
    if (L.tp) { W.teleport(L.tp[0], L.tp[1]); W.tick(1 / 30, 30); }
    if (L.go) { W.goTo(L.go[0], L.go[1]); if (L.run != null) W.player.gait = L.run ? "run" : "walk"; }
  }, L);
  for (let i = 0; i < (L.frames || 45); i++) {
    const s = await page.evaluate(() => { W.tick(1 / 30, 2); return { z: W.zoneAt(W.player.x, W.player.z), a: W.character.st.anim, dc: W.lastInfo.calls, tri: W.lastInfo.triangles }; });
    info.push(s);
    await page.screenshot({ path: `${out}/f${String(n++).padStart(4, "0")}.png` });
  }
}
fs.writeFileSync(`${out}/info.json`, JSON.stringify(info));
console.log("frames", n);
await browser.close();
