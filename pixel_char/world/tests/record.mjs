// GIF antes/después determinista (paso fijo 1/30 s): el personaje anda de lado (E en pantalla) y en
// diagonal (SE en pantalla) sobre suelo llano; se graba con los interruptores W.FX de "antes" y de
// "después" y se mide el deslizamiento del pie apoyado (W.slipStats).
// uso: node record.mjs <dist/index.html> <prefijo_salida> '<json FX antes>' '<json FX después>' [frames]
import { chromium } from "playwright";
import fs from "node:fs";

const [html, prefix, fxBefore, fxAfter, nFrames = "54"] = process.argv.slice(2);
const N = +nFrames;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + (await import("node:path")).resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
await page.evaluate(() => { W.manual = true; W.ui.zoom = 3.2; W.resize(); document.querySelector(".bar").style.display = "none"; document.querySelector(".hud").style.display = "none"; });

// recorridos: dirección de pantalla -> rumbo en el mundo (cámara a 45°)
const routes = await page.evaluate(() => {
  const th = W.ui.thetaT, R = [Math.cos(th), -Math.sin(th)], T = [Math.sin(th), Math.cos(th)];
  const dirs = { lado: [R[0], R[1]], diagonal: [0.7071 * (R[0] + T[0]), 0.7071 * (R[1] + T[1])] };
  const out = {};
  for (const [name, d] of Object.entries(dirs)) {
    // busca un tramo recto llano y libre de 5 u
    let best = null;
    for (let x = -30; x < 30 && !best; x += 0.5) for (let z = -30; z < 30 && !best; z += 0.5) {
      const h = W.heightAt(x, z);
      let ok = W.cellFree(x, z) && W.kindAt(x, z) !== W.K.PUDDLE;
      for (let k = 0; k <= 30 && ok; k++) {
        const px = x + d[0] * k * 0.2, pz = z + d[1] * k * 0.2;
        ok = W.cellFree(px, pz) && W.heightAt(px, pz) === h;
        // nada que tape: sin obstáculos (troncos, arcos, rocas...) ni desniveles a menos de 3 u
        for (const o of W.obstacles) if (ok && Math.hypot(o.x - px, o.z - pz) < 3.2) ok = false;
        for (let a = 0; a < 8 && ok; a++) { const qx = px + Math.cos(a) * 2.2, qz = pz + Math.sin(a) * 2.2; if (W.heightAt(qx, qz) > h + 0.01) ok = false; }
      }
      if (ok && Math.abs(x) < 30 && Math.abs(z) < 30 && W.lineClear({ x, z }, { x: x + d[0] * 5.6, z: z + d[1] * 5.6 }) && W.kindAt(x, z) !== W.K.WATER) best = { x, z, tx: x + d[0] * 5, tz: z + d[1] * 5 };
    }
    out[name] = best;
  }
  return out;
});
console.log("recorridos", JSON.stringify(routes));

async function record(fx, route, tag) {
  await page.evaluate(([fx, r]) => {
    Object.assign(W.FX, fx);
    W.teleport(r.x, r.z);
    Object.assign(W.character.st, { phase: 0, idleT: 0, anim: "idle", frame: 0, lastStep: 0, wst: {} });
    if (W.character.anchor) Object.assign(W.character.anchor.st, { anchor: null, release: null, key: "", frame: -1 });
    W.player.heading = Math.atan2(r.tz - r.z, r.tx - r.x);
    W.tick(1 / 30, 20);                      // se asienta la cámara
    W.slip.reset();
    W.player.setPath([{ x: r.tx, z: r.tz }], { noDelay: true });
  }, [fx, route]);
  const files = [];
  for (let i = 0; i < N; i++) {
    await page.evaluate(() => W.tick(1 / 30, 2));      // 15 fps en el GIF
    const f = `${prefix}_${tag}_${String(i).padStart(3, "0")}.png`;
    await page.screenshot({ path: f, clip: { x: 80, y: 40, width: 320, height: 280 } });
    files.push(f);
  }
  const s = await page.evaluate(() => W.slipStats());
  return { files, slip: s };
}
const B = JSON.parse(fxBefore), A = JSON.parse(fxAfter);
const res = {};
for (const name of ["lado", "diagonal"]) {
  res[name] = { antes: await record(B, routes[name], name + "_antes"), despues: await record(A, routes[name], name + "_despues") };
  for (const k of ["antes", "despues"]) {
    const s = res[name][k].slip;
    console.log(`${name.padEnd(8)} ${k.padEnd(7)} deslizamiento pie apoyado: ` + (s ? `media ${s.media.toFixed(2)} px, p95 ${s.p95.toFixed(2)} px, máx ${s.max.toFixed(2)} px, frames >1px ${(s.sobre1px * 100).toFixed(0)} % (n=${s.n})` : "sin muestras"));
  }
}
fs.writeFileSync(`${prefix}_frames.json`, JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { antes: { files: v.antes.files, slip: v.antes.slip }, despues: { files: v.despues.files, slip: v.despues.slip } }]))));
await browser.close();
