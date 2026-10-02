// Prueba de estrés de navegación (la de la dirección de arte, E4): rutas aleatorias con A* y el paso del cuerpo,
// sin render. Misma semilla (W.rng(9)) y los mismos 300 intentos: 282 rutas válidas; una ruta va bien si el
// personaje acaba a < 0,3 u del final del camino.
// uso: node nav_stress.mjs <dist/index.html>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  W.manual = true; const R = W.rng(9); const bad = []; let ok = 0, n = 0; const P = W.player;
  for (let k = 0; k < 300; k++) {
    const near = k < 160; const sx = near ? 3.5 : (R() * 2 - 1) * 30, sz = near ? -5.5 : (R() * 2 - 1) * 30;
    if (!W.cellFree(sx, sz)) continue;
    const a = R() * 6.283, d = near ? 3 + R() * 9 : 4 + R() * 14; const gx = sx + Math.cos(a) * d, gz = sz + Math.sin(a) * d;
    W.teleport(sx, sz); const r = W.goTo(gx, gz); if (!r.ok) continue; n++;
    const end = r.path[r.path.length - 1]; P.replans = 0;
    // (también mientras dura un salto por el terreno: con el salto contextual, el último punto del camino puede
    //  ser un aterrizaje y el camino queda vacío en el aire)
    for (let i = 0; i < 3000 && (P.path.length || P.jump); i++) P.update(1 / 30);
    const e = Math.hypot(P.x - end.x, P.z - end.z);
    if (e < 0.3) ok++; else bad.push([sx.toFixed(1), sz.toFixed(1), end.x.toFixed(2), end.z.toFixed(2), P.x.toFixed(2), P.z.toFixed(2), e.toFixed(2)]);
  }
  return { ok, n, bad: bad.slice(0, 10) };
});
console.log(`navegación: ${r.ok}/${r.n} rutas`, r.bad.length ? JSON.stringify(r.bad) : "", errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
await browser.close();
