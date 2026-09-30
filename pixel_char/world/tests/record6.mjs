// GIF antes/después del paso 6 (determinista, paso fijo 1/30 s, 15 fps en el GIF): subir un escalón,
// cruzar una charca y frenar tras una carrera. "antes" = todos los interruptores W.FX apagados.
// uso: node record6.mjs <dist/index.html> <prefijo_salida> [frames]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [html, prefix, nFrames = "60"] = process.argv.slice(2);
const N = +nFrames;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
await page.evaluate(() => { W.manual = true; W.ui.zoom = 3.2; W.resize(); document.querySelector(".bar").style.display = "none"; document.querySelector(".hud").style.display = "none"; });

const routes = await page.evaluate(() => {
  const th = W.ui.thetaT, R = [Math.cos(th), -Math.sin(th)], T = [Math.sin(th), Math.cos(th)];
  const dirOf = (phi) => [Math.cos(phi) * R[0] + Math.sin(phi) * T[0], Math.cos(phi) * R[1] + Math.sin(phi) * T[1]];
  function route(d, L, clear, test) {
    for (let x = -26; x < 26; x += 0.5) for (let z = -26; z < 26; z += 0.5) {
      if (Math.abs(x + d[0] * L) > 26 || Math.abs(z + d[1] * L) > 26) continue;
      let ok = W.cellFree(x, z) && W.kindAt(x, z) !== W.K.WATER;
      const n = Math.round(L / 0.1);
      for (let k = 0; k <= n && ok; k++) {
        const px = x + d[0] * k * 0.1, pz = z + d[1] * k * 0.1;
        ok = W.cellFree(px, pz) && (k === 0 || W.canStep(x + d[0] * (k - 1) * 0.1, z + d[1] * (k - 1) * 0.1, px, pz)) && test(k / n, px, pz, x, z);
        for (const o of W.obstacles) if (ok && Math.hypot(o.x - px, o.z - pz) < clear) ok = false;
        // nada que tape: ni troncos/copas cerca (clear) ni terreno más alto que el tramo a menos de 2.2 u
        const top = Math.max(W.heightAt(x, z), W.heightAt(x + d[0] * L, z + d[1] * L));
        for (let a = 0; a < 12 && ok; a++) { const qx = px + Math.cos(a * 0.52) * 2.2, qz = pz + Math.sin(a * 0.52) * 2.2; if (W.heightAt(qx, qz) > top + 0.01) ok = false; }
      }
      if (ok && W.lineClear({ x, z }, { x: x + d[0] * L, z: z + d[1] * L })) return { x, z, tx: x + d[0] * L, tz: z + d[1] * L };
    }
    return null;
  }
  const out = {};
  // escalón que sube, cruzado de frente, en diagonal de pantalla si lo hay
  for (const k of [1, 3, 0, 2, 4, 5, 6, 7]) {
    const d = dirOf(k * Math.PI / 4);
    const r = route(d, 3.2, 3.2, (u, px, pz, x, z) => {
      const h = W.heightAt(px, pz), hs = W.heightAt(x, z), he = W.heightAt(x + d[0] * 3.2, z + d[1] * 3.2);
      if (he - hs < 0.2) return false;
      for (const sd of [-0.35, 0.35]) if (W.heightAt(px - d[1] * sd, pz + d[0] * sd) !== h) return false;
      if (u < 0.4) return h === hs;
      if (u > 0.6) return h === he;
      return h === hs || h === he;
    });
    if (r) { out["escalón"] = { ...r, gait: "walk" }; break; }
  }
  for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17]) {
    const d = dirOf((k % 10) * Math.PI / 4);
    const r = route(d, 3.6, k >= 10 ? 2.0 : 3.2, (u, px, pz, x, z) => (u > 0.3 && u < 0.75 ? W.kindAt(px, pz) === W.K.PUDDLE : Math.abs(W.heightAt(px, pz) - W.heightAt(x, z)) < 0.01));
    if (r) { out["charca"] = { ...r, gait: "walk" }; break; }
  }
  for (const k of [1, 0, 3, 2]) { const d = dirOf(k * Math.PI / 4); const r = route(d, 7, 4.0, (u, px, pz, x, z) => W.heightAt(px, pz) === W.heightAt(x, z)); if (r) { out["frenado"] = { x: r.x, z: r.z, tx: r.x + (r.tx - r.x) * 0.84, tz: r.z + (r.tz - r.z) * 0.84, gait: "run" }; break; } }   // para antes del arco del final
  return out;
});
console.log("recorridos", JSON.stringify(routes));

const OFF = { anchor: false, contact: false, impact: false, inertia: false, matter: false, sound: false };
const ON = { anchor: true, contact: true, impact: true, inertia: true, matter: true, sound: false };
async function record(fx, r, tag) {
  await page.evaluate(([fx, r]) => {
    Object.assign(W.FX, fx);
    W.teleport(r.x, r.z);
    Object.assign(W.character.st, { phase: 0, idleT: 0, anim: "idle", frame: 0, lastStep: 0, wst: {}, settle: null, dipT: null });
    if (W.character.anchor) Object.assign(W.character.anchor.st, { anchor: null, release: null, key: "", frame: -1 });
    W.player.heading = Math.atan2(r.tz - r.z, r.tx - r.x);
    W.tick(1 / 30, 20);
    W.slip.reset();
    W.player.setPath([{ x: r.tx, z: r.tz }], { noDelay: true });
    W.player.gait = r.gait;
  }, [fx, r]);
  const files = [];
  for (let i = 0; i < N; i++) {
    await page.evaluate(() => W.tick(1 / 30, 2));
    const f = `${prefix}_${tag}_${String(i).padStart(3, "0")}.png`;
    await page.screenshot({ path: f, clip: { x: 100, y: 50, width: 280, height: 250 } });
    files.push(f);
  }
  return { files, slip: await page.evaluate(() => W.slipStats()) };
}
const res = {};
const prev = process.env.KEEP && fs.existsSync(`${prefix}_frames.json`) ? JSON.parse(fs.readFileSync(`${prefix}_frames.json`)) : {};
for (const [name, r] of Object.entries(routes)) {
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) { if (prev[name]) res[name] = prev[name]; continue; }
  if (!r) { console.log("sin tramo para", name); continue; }
  res[name] = { antes: await record(OFF, r, name + "_antes"), despues: await record(ON, r, name + "_despues") };
  const lab = (k) => { const s = res[name][k].slip; return s ? `desliz. ${s.media.toFixed(2)} px/frame` : ""; };
  res[name].antes.label = lab("antes"); res[name].despues.label = lab("despues");
}
fs.writeFileSync(`${prefix}_frames.json`, JSON.stringify(res));
await browser.close();
