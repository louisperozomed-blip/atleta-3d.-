// Pruebas del SALTO CONTEXTUAL (Playwright + Chromium/SwiftShader), en escritorio (ratón y teclado) y en iPhone
// (toques reales por CDP). Simulación a paso fijo (W.manual + W.tick) para que sea determinista.
// uso: node salto.mjs <dist/index.html> <carpeta de salida>
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); }
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function open(opts, hash) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("file://" + path.resolve(html) + hash);
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => {
    W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
    const N = W.N, H = W.T.H, c = (i) => i - W.HALF + 0.5;
    // bordes entre baldosas vecinas libres: [baja, alta, desnivel]
    window.EDGES = (dh) => { const L = [];
      for (let x = 1; x < N - 1; x++) for (let z = 1; z < N - 1; z++) for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const a = H[x * N + z], b = H[(x + dx) * N + z + dz];
        if (b - a === dh && W.cellFree(c(x), c(z)) && W.cellFree(c(x + dx), c(z + dz)) && W.cellFree(c(x) - dx * 0.25, c(z) - dz * 0.25)) L.push({ lo: [c(x), c(z)], hi: [c(x + dx), c(z + dz)], dh });
      }
      return L; };
    // espera a que el jugador termine (camino y salto); muestra cada paso con fn
    window.untilIdle = (fn, max) => { const p = W.player; let n = 0; do { T(1); if (fn) fn(n); } while ((p.path.length || p.jump || p.speed > 0.01) && n++ < (max || 900)); return n; };
    window.st = () => ({ x: +W.player.x.toFixed(3), z: +W.player.z.toFixed(3), y: +W.player.y.toFixed(3), h: W.heightAt(W.player.x, W.player.z), jump: !!W.player.jump });
  });
  return { ctx, page };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// toque o clic real en un punto del mundo (con el bucle de render en pausa: el gesto es un toque corto)
async function tapWorld(page, x, z, touch) {
  const p = await page.evaluate(([x, z]) => { W.skipRender = false; T(1); return W.toScreen(x, W.heightAt(x, z), z); }, [x, z]);
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const tp = (type, q) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: q ? [{ x: q[0], y: q[1], id: 1 }] : [] });
    await Promise.all([tp("touchStart", p), tp("touchEnd", null)]);
  } else await page.mouse.click(p[0], p[1]);
  return p;
}

async function suite(label, opts, touch) {
  const { ctx, page } = await open(opts, "#enemy=none");
  const shot = async (n) => { await page.evaluate(() => { W.skipRender = false; T(1); }); await page.screenshot({ path: `${OUT}/${label}_${n}.png` }); };
  // puntos: bordes de 1 u (2 cabezas) donde hace falta saltar (andando no se llega o el rodeo es largo), repartidos
  const spots = await page.evaluate(() => {
    const pick = (dh) => { const L = EDGES(dh).filter((e) => { const w = W.findPath(e.lo[0], e.lo[1], e.hi[0], e.hi[1]); return !w.reached || w.length > 5; });
      L.sort((a, b) => a.lo[0] - b.lo[0]); const out = []; for (const e of L) if (out.every((o) => Math.hypot(o.lo[0] - e.lo[0], o.lo[1] - e.lo[1]) > 12)) out.push(e); return out.slice(0, 3); };
    return { up: pick(1), down: pick(-1) };   // lo = desde, hi = hasta
  });
  // --- subir y bajar saltando en varios puntos, tocando la zona de destino ------------------------------
  const runs = [];
  for (const [kind, list] of [["sube", spots.up], ["baja", spots.down]]) for (const e of list) {
    const from = e.lo, to = e.hi;
    await page.evaluate(([x, z]) => { W.teleport(x, z); W.camSnap = true; W.skipRender = true; T(10); W.combatLog.length = 0; }, from);
    const s0 = await page.evaluate(() => st());
    await tapWorld(page, to[0], to[1], touch);
    const r = await page.evaluate(() => {
      const p = W.player, ch = W.character, trace = [];
      let prepXZ = null, landXZ = null, blobAir = 1, frames = new Set(), moveInPrep = 0, moveInLand = 0, maxAir = 0;
      untilIdle(() => { const J = p.jump;
        if (J && J.terrain) {
          frames.add(ch.st.frame);
          if (J.t < J.prep) { if (!prepXZ) prepXZ = [p.x, p.z]; moveInPrep = Math.max(moveInPrep, Math.hypot(p.x - prepXZ[0], p.z - prepXZ[1])); }
          if (J.landed) { if (!landXZ) landXZ = [p.x, p.z]; moveInLand = Math.max(moveInLand, Math.hypot(p.x - landXZ[0], p.z - landXZ[1])); }
          if (!J.landed && J.t >= J.prep) { blobAir = Math.min(blobAir, ch.blob.scale.x / 0.7); maxAir = Math.max(maxAir, p.y + J.h - p.ground); }
        } });
      const tj = W.combatLog.filter((x) => x.ev === "terrainJump");
      return { saltos: tj.map((x) => x.dh), frames: [...frames].sort(), pies_despegue: +moveInPrep.toFixed(3), pies_aterrizaje: +moveInLand.toFixed(3), sombra: +blobAir.toFixed(2), alto_max: +maxAir.toFixed(2), fin: st() };
    });
    r.kind = kind; r.objetivo = to; r.desde_h = s0.h; // llega al punto tocado (el del marcador: junto a un acantilado el rayo del clic puede caer unos cm fuera del centro)
    const mk = await page.evaluate(() => W.lastMarker && { x: W.lastMarker.x, z: W.lastMarker.z, red: W.lastMarker.red });
    r.tocado = mk && [+mk.x.toFixed(2), +mk.z.toFixed(2)];
    r.llega = !!mk && !mk.red && Math.hypot(r.fin.x - mk.x, r.fin.z - mk.z) < 0.3 && r.fin.h === (await page.evaluate((m) => W.heightAt(m.x, m.z), mk));
    runs.push(r);
  }
  const ups = runs.filter((r) => r.kind === "sube"), downs = runs.filter((r) => r.kind === "baja");
  check(`[${label}] sube saltando bordes de 2 cabezas (1 u) en varios puntos del mapa, tocando la zona alta`,
    ups.length >= 3 && ups.every((r) => r.llega && r.saltos.length >= 1 && r.saltos.every((d) => Math.abs(d) <= 1.0001)), ups.map((r) => ({ a: r.objetivo, saltos: r.saltos, y: r.fin.y })));
  check(`[${label}] baja saltando (más de un escalón y hasta 2 cabezas) con aterrizaje`,
    downs.length >= 3 && downs.every((r) => r.llega && r.saltos.some((d) => d < -0.5)), downs.map((r) => ({ a: r.objetivo, tocado: r.tocado, fin: [r.fin.x, r.fin.z], saltos: r.saltos, y: r.fin.y })));
  check(`[${label}] animación del salto: hoja jump entera (preparación → aterrizaje), pies quietos al despegar y aterrizar, sombra que se separa en el aire`,
    runs.every((r) => r.frames.includes(0) && r.frames.includes(2) && r.frames.includes(5) && r.pies_despegue < 0.01 && r.pies_aterrizaje < 0.01 && r.sombra < 0.85 && r.alto_max > 0.2),
    runs.map((r) => ({ frames: r.frames.join(""), despegue: r.pies_despegue, aterrizaje: r.pies_aterrizaje, sombra: r.sombra, alto: r.alto_max })));
  // capturas: en el aire subiendo y el polvo al aterrizar
  if (spots.up[0]) {
    const e = spots.up[0];
    await page.evaluate(([lo, hi]) => { W.teleport(lo[0], lo[1]); W.camSnap = true; T(10); W.goTo(hi[0], hi[1], { tap: true }); const p = W.player; let n = 0; while (!(p.jump && p.jump.terrain && p.jump.t > p.jump.prep + p.jump.air * 0.45) && n++ < 400) T(1); }, [e.lo, e.hi]);
    await shot("01_subiendo");
    await page.evaluate(() => { const p = W.player; let n = 0; while (!(p.jump && p.jump.landed) && n++ < 200) T(1); T(3); });
    await shot("02_aterriza");
  }
  if (spots.down[0]) {
    const e = spots.down[0];
    await page.evaluate(([lo, hi]) => { W.teleport(lo[0], lo[1]); W.camSnap = true; T(10); W.goTo(hi[0], hi[1], { tap: true }); const p = W.player; let n = 0; while (!(p.jump && p.jump.terrain && p.jump.t > p.jump.prep + p.jump.air * 0.5) && n++ < 400) T(1); }, [e.lo, e.hi]);
    await shot("03_bajando");
    await page.evaluate(() => untilIdle());
  }

  // --- 3 cabezas (1,5 u) o más: no se salta; zona inalcanzable → marcador ROJO y no se mueve ----------------
  const far = await page.evaluate(() => {
    // celdas alcanzables (andando y saltando) desde el inicio; una inalcanzable con vecina alcanzable al lado
    const n = W.NAV.n, R = W.NAV_RES, toW = (c) => (c + 0.5) / R - W.HALF, seen = new Uint8Array(n * n);
    const s = [Math.floor((W.player.x + W.HALF) * R), Math.floor((W.player.z + W.HALF) * R)], q = [s[0] * n + s[1]]; seen[q[0]] = 1;
    while (q.length) { const i = q.pop(), x = (i / n) | 0, z = i % n, h = W.heightAt(toW(x), toW(z));
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz, j = X * n + Z;
        if (X < 0 || Z < 0 || X >= n || Z >= n || seen[j] || W.NAV.blocked[j]) continue;
        if (Math.abs(W.heightAt(toW(X), toW(Z)) - h) > W.JUMP_MAX + 1e-3) continue; seen[j] = 1; q.push(j); } }
    let best = null;
    for (let x = 2; x < n - 2 && !best; x++) for (let z = 2; z < n - 2 && !best; z++) {
      const i = x * n + z; if (seen[i] || W.NAV.blocked[i]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (x + dx * 2) * n + z + dz * 2;
        if (seen[j] && W.heightAt(toW(x), toW(z)) - W.heightAt(toW(x + dx * 2), toW(z + dz * 2)) > W.JUMP_MAX) { best = { cel: [toW(x), toW(z)], pie: [toW(x + dx * 2), toW(z + dz * 2)] }; break; } }
    }
    // y un borde de 1,5 u entre dos zonas alcanzables (se llega rodeando, no saltándolo)
    return best;
  });
  if (far) {
    await page.evaluate(([x, z]) => { W.teleport(x, z); W.camSnap = true; T(10); }, far.pie);
    const s0 = await page.evaluate(() => st());
    await tapWorld(page, far.cel[0], far.cel[1], touch);
    const r = await page.evaluate(() => { const m = W.lastMarker; T(30); const el = document.querySelector(".mark-red"); return { rojo: !!(m && m.red) && !!el && getComputedStyle(el.querySelector("ellipse")).stroke === "rgb(255, 42, 30)", path: W.player.path.length, st: st() }; });
    const dh = await page.evaluate(([a, b]) => W.heightAt(a[0], a[1]) - W.heightAt(b[0], b[1]), [far.cel, far.pie]);
    check(`[${label}] zona alta inalcanzable (más de 2 cabezas: ${dh} u = ${(dh / 0.49).toFixed(1)} cabezas) → marcador ROJO y no se mueve`,
      r.rojo && r.path === 0 && Math.hypot(r.st.x - s0.x, r.st.z - s0.z) < 0.02, { ...r, dh });
    await shot("04_marcador_rojo");
  } else check(`[${label}] zona inalcanzable para el marcador rojo`, false, "no encontrada");
  // en todos los caminos: nunca salta más de 2 cabezas
  const maxJ = await page.evaluate(() => {
    // 40 destinos al azar por todo el mapa: ningún salto del camino supera 2 cabezas
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); let mx = 0, n = 0, conSalto = 0;
    for (let k = 0; k < 40; k++) { const x = (rnd() - 0.5) * W.N * 0.9, z = (rnd() - 0.5) * W.N * 0.9;
      const p = W.findPath(W.player.x, W.player.z, x, z, undefined, { jump: true }); n++;
      // los saltos del camino: desnivel entre cada punto y el anterior (en las aristas marcadas)
      let prev = { x: W.player.x, z: W.player.z };
      for (const q of p) { if (q.jump) { conSalto++; mx = Math.max(mx, Math.abs(W.heightAt(q.x, q.z) - W.heightAt(prev.x, prev.z))); } prev = q; } }
    return { caminos: n, saltos: conSalto, max_desnivel: mx, cabezas: +(mx / W.HEAD_H).toFixed(2), JUMP_MAX: +W.JUMP_MAX.toFixed(3) };
  });
  check(`[${label}] A*: los saltos del camino nunca superan 2 cabezas (1,5 u o más sigue siendo infranqueable)`, maxJ.saltos > 0 && maxJ.max_desnivel <= 1.0001, maxJ);

  // --- botón SALTAR y tecla L (combate) ----------------------------------------------------------------
  await page.evaluate(() => { W.teleport(3.5, -5.5); W.camSnap = true; T(20); });
  const box = await page.locator("#jump").boundingBox();
  if (touch) { const cdp = await page.context().newCDPSession(page); const c = [box.x + box.width / 2, box.y + box.height / 2];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c[0], y: c[1], id: 2 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let jb = await page.evaluate(() => { let h = 0, any = !!W.player.jump; for (let i = 0; i < 60; i++) { T(1); if (W.player.jump) { any = true; h = Math.max(h, W.player.jump.h); } } return { salta: any, alto: +h.toFixed(2) }; });
  let jl = { salta: null };
  if (!touch) { await page.evaluate(() => T(30)); await page.keyboard.press("KeyL"); jl = await page.evaluate(() => { let h = 0, any = !!W.player.jump; for (let i = 0; i < 60; i++) { T(1); if (W.player.jump) { any = true; h = Math.max(h, W.player.jump.h); } } return { salta: any, alto: +h.toFixed(2) }; }); }
  check(`[${label}] botón SALTAR${touch ? "" : " y tecla L"} siguen saltando (para el barrido bajo del autómata)`, jb.salta && jb.alto > 0.3 && (touch || (jl.salta && jl.alto > 0.3)), { boton: jb, L: jl });

  // --- doble toque: ya no salta ----------------------------------------------------------------------
  await page.evaluate(() => { W.teleport(3.5, -5.5); W.camSnap = true; T(20); });
  const p0 = await page.evaluate(() => st());
  const tgt = await page.evaluate(() => W.toScreen(W.player.x + 1.2, W.heightAt(W.player.x + 1.2, W.player.z), W.player.z));
  if (touch) { const cdp = await page.context().newCDPSession(page); const tp = (type, q) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: q ? [{ x: q[0], y: q[1], id: 1 }] : [] });
    await Promise.all([tp("touchStart", tgt), tp("touchEnd", null)]); await page.evaluate(() => T(3)); await Promise.all([tp("touchStart", tgt), tp("touchEnd", null)]); }
  else { await page.mouse.click(tgt[0], tgt[1]); await page.evaluate(() => T(3)); await page.mouse.click(tgt[0], tgt[1]); }
  const dt = await page.evaluate(() => { let j = false; untilIdle(() => { if (W.player.jump) j = true; }); return { salta: j, st: st() }; });
  check(`[${label}] doble toque: ya no salta (va al punto tocado)`, !dt.salta && Math.hypot(dt.st.x - p0.x, dt.st.z - p0.z) > 0.8, { salta: dt.salta, recorrido: +Math.hypot(dt.st.x - p0.x, dt.st.z - p0.z).toFixed(2) });
  const resW = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  console.log(`[${label}] ventana ${resW.w}×${resW.h}`);
  await ctx.close();
  return spots;
}

const spots = await suite("escritorio", { viewport: { width: 1280, height: 800 } }, false);
const ip = devices["iPhone 13"];
await suite("iphone", { viewport: ip.viewport, deviceScaleFactor: ip.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: ip.userAgent }, true);

// --- el autómata: si te persigue y hay un desnivel que no puede salvar, rodea por el camino más corto ----------
{
  const { ctx, page } = await open({ viewport: { width: 1000, height: 700 } }, "");
  const r = await page.evaluate(() => {
    // un borde de 1 u (el jugador lo salta) con un camino andando que lo rodea
    const L = EDGES(1).map((e) => ({ e, w: W.findPath(e.lo[0], e.lo[1], e.hi[0], e.hi[1]) })).filter((o) => o.w.reached && o.w.length >= 3);
    let best = null;
    for (const o of L) { const len = (() => { let d = 0, p = { x: o.e.lo[0], z: o.e.lo[1] }; for (const q of o.w) { d += Math.hypot(q.x - p.x, q.z - p.z); p = q; } return d; })();
      if (len > 4 && len < 14) { best = { ...o, len }; break; } }
    if (!best) return null;
    const e = W.foe, p = W.pf, ai = e.ai;
    for (const f of W.foes) f.ai.enabled = f === e;
    p.hpMax = p.hp = 1e6;
    e.body.x = best.e.lo[0]; e.body.z = best.e.lo[1]; e.body.y = e.body.ground = W.heightAt(e.body.x, e.body.z); e.body.path = [];
    // el jugador, arriba, a 2 baldosas del borde (fuera de su alcance)
    const dx = best.e.hi[0] - best.e.lo[0], dz = best.e.hi[1] - best.e.lo[1];
    W.teleport(best.e.hi[0] + dx, best.e.hi[1] + dz); W.camSnap = true; T(5);
    ai.state = "chase"; ai.cool = 99; ai.passive = true;
    const hs = [], d0 = Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z);
    let maxStep = 0, prevH = W.heightAt(e.body.x, e.body.z), traveled = 0, px = e.body.x, pz = e.body.z, n = 0, closest = d0;
    for (; n < 60 * 14; n++) { T(1); const h = W.heightAt(e.body.x, e.body.z); maxStep = Math.max(maxStep, Math.abs(h - prevH)); prevH = h;
      traveled += Math.hypot(e.body.x - px, e.body.z - pz); px = e.body.x; pz = e.body.z;
      const d = Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z); closest = Math.min(closest, d); if (d < 2.4 && Math.abs(h - W.heightAt(W.player.x, W.player.z)) <= 0.5) break; }
    return { borde: best.e, rodeo_andando: +best.len.toFixed(2), distancia_inicial: +d0.toFixed(2), recorrido: +traveled.toFixed(2), mayor_desnivel_pisado: maxStep, llega: closest < 2.4, segundos: +(n / 60).toFixed(1), saltos: !!e.body.jump };
  });
  check("el autómata no salta: si te persigue y hay un desnivel que no puede salvar, rodea (camino más corto andando) y llega",
    r && r.llega && r.mayor_desnivel_pisado <= 0.5 && r.recorrido > r.distancia_inicial && !r.saltos, r);
  await page.evaluate(() => { W.skipRender = false; T(1); });
  await page.screenshot({ path: `${OUT}/autómata_rodea.png` });
  await ctx.close();
}

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
