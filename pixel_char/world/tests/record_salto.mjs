// GIF del salto contextual (paso fijo 1/60 s, una captura cada 3 pasos = 20 fps), con clics reales en el mundo:
//   1) tocas la zona alta (1 u = 2 cabezas): camina hasta el borde y salta  2) tocas abajo: salta hacia abajo
//   3) tocas una zona de más de 2 cabezas: marcador rojo y no se mueve  4) el autómata te persigue y rodea el desnivel
// uso: node record_salto.mjs <dist/index.html> <carpeta> [ancho alto]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "720", h = "480"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith(".png")) fs.unlinkSync(path.join(out, f));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let fi = 0;
async function open(hash) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("file://" + path.resolve(html) + hash);
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => {
    W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
    const b = document.querySelector(".bar"); if (b) b.style.display = "none";
    const N = W.N, H = W.T.H, c = (i) => i - W.HALF + 0.5;
    window.EDGES = (dh) => { const L = [];
      for (let x = 1; x < N - 1; x++) for (let z = 1; z < N - 1; z++) for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const a = H[x * N + z], b = H[(x + dx) * N + z + dz];
        if (b - a === dh && W.cellFree(c(x), c(z)) && W.cellFree(c(x + dx), c(z + dz)) && W.cellFree(c(x) - dx * 0.25, c(z) - dz * 0.25)) L.push({ lo: [c(x), c(z)], hi: [c(x + dx), c(z + dz)], dx, dz });
      }
      return L; };
  });
  return page;
}
async function rec(page, n, ticks, until) {
  for (let i = 0; i < n; i++) {
    const done = await page.evaluate(([k, u]) => { T(k); return u ? !!eval(u) : false; }, [ticks || 3, until || null]);
    await page.screenshot({ path: `${out}/f${String(fi++).padStart(4, "0")}.png` });
    if (done) break;
  }
}
async function click(page, x, z) {
  const p = await page.evaluate(([x, z]) => W.toScreen(x, W.heightAt(x, z), z), [x, z]);
  await page.mouse.click(p[0], p[1]);
}
const idle = "!W.player.path.length && !W.player.jump && W.player.speed < 0.01";

// --- 1-3: sin enemigos ------------------------------------------------------------------------------------
{
  const page = await open("#enemy=none");
  const sc = await page.evaluate(() => {
    // un borde de 1 u donde andando no se llega (o el rodeo es largo), con sitio delante para caminar
    const ok = (e) => { const wk = W.findPath(e.lo[0], e.lo[1], e.hi[0], e.hi[1]); return !wk.reached || wk.length > 5; };
    const up = EDGES(1).filter((e) => ok(e) && W.cellFree(e.lo[0] - e.dx * 2.5, e.lo[1] - e.dz * 2.5) &&
      Math.abs(W.heightAt(e.lo[0] - e.dx * 2.5, e.lo[1] - e.dz * 2.5) - W.heightAt(e.lo[0], e.lo[1])) < 0.01);
    // a cielo abierto (sin copas de árboles que tapen al personaje)
    const cov = (e) => W.coverAt(e.lo[0], e.lo[1]).c + W.coverAt(e.hi[0], e.hi[1]).c + W.coverAt(e.lo[0] - e.dx * 2.5, e.lo[1] - e.dz * 2.5).c;
    const best = (L) => L.sort((a, b) => cov(a) - cov(b));
    const U = best(up);
    const down = best(EDGES(-1).filter((e) => ok(e) && W.cellFree(e.hi[0] + e.dx * 1.5, e.hi[1] + e.dz * 1.5) && Math.hypot(e.lo[0] - U[0].lo[0], e.lo[1] - U[0].lo[1]) > 8))[0];
    return { up: U[0], down, cov: [cov(U[0]), cov(down)] };
  });
  console.log(JSON.stringify(sc));
  // 1) subir: arranca 2,5 baldosas antes del borde y toca la zona alta (1 baldosa más allá)
  const u = sc.up;
  await page.evaluate(([x, z]) => { W.teleport(x, z); W.camSnap = true; T(20); }, [u.lo[0] - u.dx * 2.5, u.lo[1] - u.dz * 2.5]);
  await rec(page, 6);
  await click(page, u.hi[0] + u.dx * 0.6, u.hi[1] + u.dz * 0.6);
  await rec(page, 70, 3, idle); await rec(page, 8);
  // 2) bajar: toca abajo (vuelve por el mismo borde, hacia abajo)
  await click(page, u.lo[0] - u.dx * 1.5, u.lo[1] - u.dz * 1.5);
  await rec(page, 70, 3, idle); await rec(page, 8);
  // 2b) otro borde, hacia abajo
  const d = sc.down;
  await page.evaluate(([x, z]) => { W.teleport(x, z); W.camSnap = true; T(20); }, d.lo);
  await rec(page, 5);
  await click(page, d.hi[0] + d.dx * 1.2, d.hi[1] + d.dz * 1.2);
  await rec(page, 60, 3, idle); await rec(page, 8);
  // 3) zona inalcanzable (más de 2 cabezas): marcador rojo, no se mueve
  const far = await page.evaluate(() => {
    const n = W.NAV.n, R = W.NAV_RES, toW = (c) => (c + 0.5) / R - W.HALF;
    // el acantilado detrás del jugador, visto desde la cámara (que no lo tape)
    const m = W.camera.matrixWorld.elements, fl = Math.hypot(m[8], m[10]), fx = -m[8] / fl, fz = -m[10] / fl;
    for (let x = 4; x < n - 4; x++) for (let z = 4; z < n - 4; z++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = [toW(x), toW(z)], b = [toW(x + dx * 3), toW(z + dz * 3)];
      if (!W.cellFree(a[0], a[1]) || !W.cellFree(b[0], b[1])) continue;
      const hb = W.heightAt(b[0], b[1]);
      if (W.heightAt(a[0], a[1]) - hb >= 2 && hb > 0.5 && (dx * fx + dz * fz) < -0.7 && W.coverAt(b[0], b[1]).c + W.coverAt(a[0], a[1]).c < 0.15) { const p = W.findPath(b[0], b[1], a[0], a[1], undefined, { jump: true }); if (!p.reached) return { a, b }; }
    }
    return null;
  });
  if (far) {
    await page.evaluate(([x, z]) => { W.teleport(x, z); W.camSnap = true; T(20); }, far.b);
    await rec(page, 6);
    await click(page, far.a[0], far.a[1]);
    await rec(page, 22);
  }
  await page.close();
}
// --- 4: el autómata rodea el desnivel ---------------------------------------------------------------------
{
  const page = await open("");
  const ok = await page.evaluate(() => {
    const L = EDGES(1).map((e) => ({ e, w: W.findPath(e.lo[0], e.lo[1], e.hi[0], e.hi[1]) })).filter((o) => o.w.reached && o.w.length >= 3);
    let best = null;
    for (const o of L) { let d = 0, p = { x: o.e.lo[0], z: o.e.lo[1] }; for (const q of o.w) { d += Math.hypot(q.x - p.x, q.z - p.z); p = q; }
      if (d > 4 && d < 14) { best = o; break; } }
    if (!best) return false;
    const e = W.foe, p = W.pf, ai = e.ai;
    for (const f of W.foes) f.ai.enabled = f === e;
    p.hpMax = p.hp = 1e6;
    e.body.x = best.e.lo[0]; e.body.z = best.e.lo[1]; e.body.y = e.body.ground = W.heightAt(e.body.x, e.body.z); e.body.path = [];
    W.teleport(best.e.hi[0] + best.e.dx, best.e.hi[1] + best.e.dz); W.camSnap = true; T(5);
    ai.state = "chase"; ai.cool = 99; ai.passive = true;
    return true;
  });
  if (ok) await rec(page, 110, 4, "Math.hypot(W.foe.body.x - W.player.x, W.foe.body.z - W.player.z) < 2.3 && Math.abs(W.foe.body.y - W.player.y) < 0.6");
  await rec(page, 6);
  await page.close();
}
console.log("frames", fi);
await browser.close();
