// Captura una página que usa three r128 desde cdnjs, sirviendo la copia local.
// uso: node shot.mjs <html> <png> [ancho alto dpr espera_ms]
import { chromium } from "playwright";
import fs from "node:fs";
const THREE_LOCAL = process.env.THREE_LOCAL;
const [html, png, w = 900, h = 900, dpr = 1, wait = 2500] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() !== "log" || m.text().startsWith("[w]")) console.log("console:", m.type(), m.text()); });
await page.goto("file://" + html);
if (process.env.PRE) { await page.waitForFunction(() => window.W && W.ready, null, { timeout: 60000 }); await page.evaluate(process.env.PRE); }
await page.waitForTimeout(+wait);
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); } requestAnimationFrame(f); }));
console.log("fps", fps.toFixed(1));
if (process.env.EVAL) console.log(JSON.stringify(await page.evaluate(process.env.EVAL)));
await page.screenshot({ path: png });
await browser.close();
