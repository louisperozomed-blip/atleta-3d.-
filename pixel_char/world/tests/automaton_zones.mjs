import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + process.argv[2]);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
const out = [];
for (const [k, zone] of [[1, "roots"], [2, "ruins"], [0, "heart"]]) {
  const r = await page.evaluate((k) => { W.manual = true; const T = (n) => W.tick(1 / 60, n || 1); const f = W.foes[k];
    for (const g of W.foes) g.ai.enabled = g === f; document.querySelector(".bar").style.display = "none";
    W.teleport(f.home.x - 5, f.home.z + 3); T(30); const s0 = f.steps || 0, sh0 = []; let maxShake = 0;
    const v = new THREE.Vector3(); for (let i = 0; i < 140; i++) { T(); W.shakeOffset && 0; }
    return { zone: f.zone, state: f.ai.state, steps: (f.steps || 0) - s0, d: +Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z).toFixed(1) }; }, k);
  out.push(r);
  await page.screenshot({ path: `${OUT}/amb_${zone}.png` });
}
console.log(JSON.stringify(out));
await browser.close();
