// Pie sobre la superficie en TODOS los frames apoyados: se fuerza cada frame, se renderiza con y sin
// el personaje, y se compara la fila más baja de sus píxeles (buffer de baja resolución) con la fila
// del suelo en su línea de apoyo. Con la corrección (W.FX.matter) apagada y encendida.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(process.argv[2]));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
const res = await page.evaluate(() => {
  W.manual = true; W.ui.pi = 0; W.ui.zoom = 2.2; W.resize(); W.FX.anchor = false; W.FX.inertia = false;   // px1; se mide el dibujo, sin anclaje
  const R = W.renderer, rt = W.post.rt, w = rt.width, h = rt.height;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  const out = { off: [], on: [] };
  const D = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  for (const matter of [false, true]) {
    W.FX.matter = matter;
    for (const anim of ["idle", "walk", "run", "jump"]) for (let dir = 0; dir < 8; dir++) for (let f = 0; f < 6; f++) {
      const F = W.FEET[anim + "_" + D[dir]];
      const grounded = anim === "idle" || anim === "walk" || (anim === "run" && F.contact[f]) || (anim === "jump" && (f === 0 || f === 5));
      if (!grounded) continue;
      W.teleport(-12.5, 5.5); W.player.jump = null; W.debugFrame = { anim: anim === "jump" ? "idle" : anim, dir, f };
      if (anim === "jump") { W.debugFrame.anim = "jump"; W.player.jump = { t: f === 0 ? 0.01 : 0.74, h: 0, forward: false, v: 0, landed: true }; }
      W.hideChar = false; W.tick(0);
      R.readRenderTargetPixels(rt, 0, 0, w, h, A);
      W.hideChar = true; W.tick(0); W.hideChar = false;
      R.readRenderTargetPixels(rt, 0, 0, w, h, B);
      let low = -1;
      for (let y = 0; y < h && low < 0; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) { low = y; break; } }
      // fila del suelo bajo la línea de apoyo del sprite (plano 0.15 u hacia la cámara)
      const th = W.ui.theta, p = W.player;
      const v = new THREE.Vector3(p.x + Math.sin(th) * 0.15, p.ground, p.z + Math.cos(th) * 0.15).project(W.camera);
      const groundRow = Math.floor((v.y + 1) / 2 * h);                  // filas desde abajo (como readPixels)
      (matter ? out.on : out.off).push({ k: anim + "_" + D[dir] + "_" + f, d: low - groundRow });
      if (anim === "jump") W.player.jump = null;
    }
  }
  W.debugFrame = null;
  return out;
});
for (const k of ["off", "on"]) {
  const d = res[k].map((r) => r.d), abs = d.map(Math.abs);
  const bad = res[k].filter((r) => Math.abs(r.d) > 1);
  console.log(`${k === "off" ? "sin corrección" : "con corrección"}: ${d.length} frames apoyados, desfase medio ${(abs.reduce((a, b) => a + b, 0) / d.length).toFixed(2)} px, máx ${Math.max(...abs)} px, frames con |desfase| > 1 px: ${bad.length}` + (bad.length ? "  ej. " + bad.slice(0, 6).map((r) => `${r.k}:${r.d}`).join(" ") : ""));
}
fs.writeFileSync(process.argv[3] || "/tmp/foot_surface.json", JSON.stringify(res));
await browser.close();
