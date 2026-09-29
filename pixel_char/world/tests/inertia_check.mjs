import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(process.argv[2]));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
const r = await page.evaluate(() => {
  W.manual = true;
  const out = {};
  for (const inertia of [false, true]) {
    W.FX.inertia = inertia;
    W.teleport(-12.5, 5.5); W.tick(1 / 60, 30);
    W.player.setPath([{ x: -10.2, z: 3.2 }], { noDelay: true });
    let t = 0, t90 = null, seq = [], settleSeen = false, maxDip = 0;
    for (let i = 0; i < 600; i++) {
      W.tick(1 / 60); t += 1 / 60;
      if (t90 === null && W.player.speed >= 0.9 * W.player.walkV) t90 = t;
      const a = W.character.st.anim; if (seq[seq.length - 1] !== a) seq.push(a);
      if (W.character.st.settle && W.character.st.settle.t < 0.16) settleSeen = true;
      if (!W.player.path.length) maxDip = Math.max(maxDip, W.character.st.dipPx || 0);
      if (!W.player.path.length && W.character.st.anim === "idle" && !W.character.st.settle) break;
    }
    out[inertia ? "con" : "sin"] = { t90: +t90.toFixed(3), seq: seq.join(">"), asentamiento: settleSeen, hundimientoAlParar: +maxDip.toFixed(2) };
  }
  // inclinación al correr (ruta larga hacia la derecha de la pantalla)
  W.FX.inertia = true;
  W.teleport(-8.5, 0.5); W.tick(1 / 60, 30);
  W.goTo(8.5, 0);
  let maxLean = 0, anims = new Set();
  for (let i = 0; i < 300; i++) { W.tick(1 / 60); anims.add(W.character.st.anim); maxLean = Math.max(maxLean, Math.abs(W.character.st.lean || 0)); }
  out.carrera = { anims: [...anims].join(","), inclinacionMax_uv: +maxLean.toFixed(4), inclinacion_px_cabeza: +(maxLean * 0.66 * 120 * 0.5).toFixed(1) };
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
