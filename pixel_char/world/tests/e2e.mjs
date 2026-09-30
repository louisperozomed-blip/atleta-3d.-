// ETAPA 4 · Pruebas E2E del mundo (Playwright + Chromium con SwiftShader).
// uso: node e2e.mjs <dist/index.html> <carpeta_salida>
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const html = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3] || "out");
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok, info }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("file://" + html + (process.env.HASH || ""));
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
  await sleep(500);
  return { ctx, page, errors };
}
const S = (page) => page.evaluate(() => ({
  x: W.player.x, z: W.player.z, y: W.player.y, speed: W.player.speed, path: W.player.path.length, jump: !!W.player.jump,
  following: W.player.following, gait: W.player.gait, anim: W.character.st.anim, dir: W.character.st.dir,
  zone: W.zoneAt(W.player.x, W.player.z), fps: W.fps, info: W.lastInfo,
}));
async function waitIdle(page, ms, every = 120, onSample) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) {
    s = await S(page);
    if (onSample) onSample(s);
    if (!s.path && s.speed === 0 && !s.jump && s.anim === "idle") return { s, t: Date.now() - t0 };
    await sleep(every);
  }
  return { s, t: -1 };
}
async function tap(page, x, y, touch) { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
// punto de pantalla de un punto del mundo
const scr = (page, x, z) => page.evaluate(([x, z]) => W.toScreen(x, W.heightAt(x, z), z), [x, z]);

async function suite(browser, label, opts, touch) {
  const { ctx, page, errors } = await open(browser, opts);
  const vp = opts.viewport;
  // --- 0. resolución: canvas interno = css·dpr / tamaño de píxel ------------------
  let r = await page.evaluate(() => ({ w: W.renderer.domElement.width, h: W.renderer.domElement.height, dpr: Math.min(devicePixelRatio, 3), px: [1, 2, 3, 4, 5, 6, 8][W.ui.pi] }));
  check(`[${label}] resolución interna = css·dpr/px`, r.w === Math.floor(vp.width * r.dpr / r.px) && r.h === Math.floor(vp.height * r.dpr / r.px), `${r.w}×${r.h} (dpr ${r.dpr}, px${r.px})`);
  await page.screenshot({ path: `${out}/${label}_00_inicio.png` });

  // --- 1. recorrido por todas las zonas (A*, como un toque lejano) -------------------
  const tour = [["roots", -20, -19], ["crystal", 22, -20], ["ponds", 21, 19], ["ruins", -21, 22], ["heart", 3.5, -5.5]];
  if (label === "escritorio") {
    for (const [zn, x, z] of tour) {
      const g = await page.evaluate(([x, z]) => { const r = W.goTo(x, z); return { ok: r.ok, reached: r.reached, n: r.path ? r.path.length : 0 }; }, [x, z]);
      const zones = new Set(), gaits = new Set(); let maxCalls = 0, maxTris = 0;
      const w = await waitIdle(page, 90000, 250, (s) => { zones.add(s.zone); gaits.add(s.anim); if (s.info) { maxCalls = Math.max(maxCalls, s.info.calls); maxTris = Math.max(maxTris, s.info.triangles); } });
      const s = w.s;
      check(`[${label}] recorrido → ${zn}`, g.ok && g.reached && w.t > 0 && s.zone === zn && Math.hypot(s.x - x, s.z - z) < 0.3,
        `${g.n} puntos A*, llega en ${(w.t / 1000).toFixed(1)} s, zonas ${[...zones].join("/")}, anims ${[...gaits].join("/")}, máx ${maxCalls} draw calls / ${(maxTris / 1000).toFixed(0)}k tri`);
      await page.screenshot({ path: `${out}/${label}_01_zona_${zn}.png` });
    }
  }

  // --- 2. toque cercano (camina) y toque lejano (corre y luego camina) ---------------------
  await page.evaluate(() => { W.teleport(3.5, -5.5); });
  await sleep(400);
  let p = await scr(page, 3.5 + 1.8, -5.5);
  await tap(page, p[0], p[1], touch);
  const anims = new Set();
  let w = await waitIdle(page, 15000, 100, (s) => anims.add(s.anim));
  check(`[${label}] toque cercano → camina y para`, anims.has("walk") && !anims.has("run") && w.t > 0, [...anims].join(","));
  // lejano: el punto visible más lejano del sendero en pantalla
  await page.evaluate(() => { W.teleport(0, -6.2); });
  await sleep(400);
  const far = await page.evaluate(() => {
    let best = null, bd = 0;
    for (let x = -30; x < 30; x += 0.5) for (let z = -30; z < 30; z += 0.5) {
      if (W.kindAt(x, z) !== W.K.PATH) continue;
      const s = W.toScreen(x, W.heightAt(x, z), z);
      if (s[0] < 30 || s[1] < 60 || s[0] > innerWidth - 30 || s[1] > innerHeight - 90) continue;
      const d = Math.hypot(x - W.player.x, z - W.player.z);
      const p = W.findPath(W.player.x, W.player.z, x, z);
      if (d > bd && p.reached) { bd = d; best = { x, z, s, d }; }
    }
    return best;
  });
  const seq = [];
  await tap(page, far.s[0], far.s[1], touch);
  w = await waitIdle(page, 30000, 100, (s) => { if (seq[seq.length - 1] !== s.anim) seq.push(s.anim); });
  const H = 1.7;
  if (far.d > 4 * H) check(`[${label}] toque lejano (${(far.d / H).toFixed(1)} H) → corre y pasa a caminar`, seq.includes("run") && seq.lastIndexOf("walk") > seq.indexOf("run") && w.t > 0, seq.join(" → "));
  else check(`[${label}] toque lejano (pantalla pequeña: ${(far.d / H).toFixed(1)} H < 4 H, camina)`, !seq.includes("run") && w.t > 0, seq.join(" → "));
  await page.screenshot({ path: `${out}/${label}_02_tras_toque_lejano.png` });

  const W_HAND_H = await page.evaluate(() => W.HAND.h);
  // --- 3. el titán caído: rodea su columna por A* (entra y sale entre las costillas) y sube a su mano ------
  await page.evaluate(() => { W.teleport(0.4, -4.4); });
  await sleep(400);
  const behind = await page.evaluate(() => { const r = W.goTo(0.4, 5.2); return { reached: r.reached, exact: r.exact, n: r.path.length }; });
  let crossedSpine = false, minSpine = 99;
  w = await waitIdle(page, 40000, 120, (s) => { if (s.x > -3.6 && s.x < 5.9) minSpine = Math.min(minSpine, Math.abs(s.z - 3.3)); if (s.z > 4.2) crossedSpine = true; });
  let sT = await S(page);
  check(`[${label}] rodea la columna del titán (no la atraviesa)`, behind.reached && crossedSpine && minSpine > 0.35 && w.t > 0 && Math.hypot(sT.x - 0.4, sT.z - 5.2) < 0.3,
    `${behind.n} puntos A*, distancia mínima a la columna ${minSpine.toFixed(2)} u, final (${sT.x.toFixed(1)}, ${sT.z.toFixed(1)})`);
  await page.screenshot({ path: `${out}/${label}_03_titan.png` });
  await page.evaluate(() => { W.teleport(-1.8, -4.8); });
  await sleep(300);
  await page.evaluate(() => W.goTo(-4.0, -3.0));
  w = await waitIdle(page, 25000, 120);
  sT = await S(page);
  check(`[${label}] sube a la mano abierta del titán (plataforma)`, w.t > 0 && Math.abs(sT.y - (W_HAND_H)) < 0.01 && Math.hypot(sT.x + 4, sT.z + 3) < 0.3,
    `altura ${sT.y.toFixed(2)} (palma ${W_HAND_H}), final (${sT.x.toFixed(1)}, ${sT.z.toFixed(1)})`);
  await page.screenshot({ path: `${out}/${label}_03b_mano.png` });

  // --- 4. escalones: sube a la meseta de cristales por los escalones ----------------------------
  await page.evaluate(() => { W.teleport(13, -15); });
  await sleep(300);
  const ys = [];
  await page.evaluate(() => W.goTo(22, -20));
  w = await waitIdle(page, 40000, 80, (s) => ys.push(s.y));
  let maxDy = 0; for (let i = 1; i < ys.length; i++) maxDy = Math.max(maxDy, ys[i] - ys[i - 1]);
  check(`[${label}] sube escalones (1.5 → 2.5) con suavidad`, w.t > 0 && Math.abs(ys[ys.length - 1] - 2.5) < 0.01 && maxDy < 0.5, `altura ${ys[0].toFixed(2)} → ${ys[ys.length - 1].toFixed(2)}, mayor subida entre muestras ${maxDy.toFixed(2)}`);

  // --- 5. charcas: ondas al pisar un charquito ------------------------------------------------------
  const pud = await page.evaluate(() => {
    let best = null, bn = 0;
    for (let x = 12; x < 32; x += 1) for (let z = 12; z < 32; z += 1) {
      let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (W.kindAt(x + a, z + b) === W.K.PUDDLE) n++;
      if (n > bn && W.cellFree(x + 0.5, z + 0.5)) { bn = n; best = [x + 0.5, z + 0.5]; }
    }
    return best;
  });
  await page.evaluate(([x, z]) => { W.teleport(x - 1.5, z); W.goTo(x + 1.5, z); }, pud);
  let rings = 0;
  w = await waitIdle(page, 15000, 90, async () => {});
  for (let k = 0; k < 1; k++) rings = await page.evaluate(() => W.__ripples || 0);
  check(`[${label}] ondas al pisar charcas`, rings > 0, `${rings} ondas creadas`);
  await page.screenshot({ path: `${out}/${label}_04_charca.png` });

  // --- 6. doble toque parado: salta en el sitio -------------------------------------------------------
  await page.evaluate(() => { W.teleport(3.5, -5.5); });
  await sleep(500);
  let s0 = await S(page);
  // el intervalo real entre los dos toques se mide en la página; si el arnés (render lento) los separa más
  // que la ventana de doble toque (320 ms), no es un doble toque: se repite (hasta 3 intentos)
  await page.evaluate(() => { W.__ups = []; W.renderer.domElement.addEventListener("pointerup", () => W.__ups.push(performance.now())); });
  let jumped = false, s1, gap = 0, tries = 0;
  for (; tries < 3; tries++) {
    await page.evaluate(() => { W.teleport(3.5, -5.5); W.__ups.length = 0; });
    await sleep(500);
    s0 = await S(page);
    p = await scr(page, s0.x + 1.2, s0.z);
    if (touch) {
      // táctil: con el iPhone emulado en SwiftShader el hilo principal está ocupado renderizando y cada toque
      // espera al frame (> 320 ms entre toques). Se pausa el bucle de render solo durante los dos toques
      // (W.manual): la lógica del gesto se prueba con su separación real de 60 ms
      await page.evaluate(() => { W.manual = true; });
      const cdp = await page.context().newCDPSession(page);
      const tp = (type, q) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: q ? [{ x: q[0], y: q[1], id: 1 }] : [] });
      // apoyar y levantar seguidos (si entre ambos pasan > 170 ms el control lo toma por "mantener pulsado")
      await Promise.all([tp("touchStart", p), tp("touchEnd", null)]); await sleep(60); await Promise.all([tp("touchStart", p), tp("touchEnd", null)]);
      await page.evaluate(() => { W.manual = false; });
    } else { await tap(page, p[0], p[1], touch); await sleep(60); await tap(page, p[0], p[1], touch); }
    jumped = false;
    w = await waitIdle(page, 8000, 60, (s) => { if (s.jump) jumped = true; });
    s1 = await S(page);
    gap = await page.evaluate(() => W.__ups.length >= 2 ? W.__ups[1] - W.__ups[0] : -1);
    if (gap >= 0 && gap <= 320) break;
  }
  check(`[${label}] doble toque parado → salta en el sitio`, jumped && Math.hypot(s1.x - s0.x, s1.z - s0.z) < 0.05, `desplazamiento ${Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(3)} u, toques separados ${gap.toFixed(0)} ms (intento ${tries + 1})`);
  // --- 7. SALTAR en marcha: hacia delante ------------------------------------------------------------
  await page.evaluate(() => { W.teleport(-8.5, 0.5); W.goTo(-3, 5.9); });
  await sleep(900);
  s0 = await S(page);
  const box = await page.locator("#jump").boundingBox();
  await tap(page, box.x + box.width / 2, box.y + box.height / 2, touch);
  let airMoved = 0, landed = false;
  // hasta 15 s reales: con SwiftShader la escena va a pocos fps y el tiempo simulado avanza más despacio
  const tj = Date.now();
  while (Date.now() - tj < 15000) { const s = await S(page); if (s.jump) airMoved = Math.hypot(s.x - s0.x, s.z - s0.z); else if (airMoved > 0) { landed = true; break; } await sleep(50); }
  const dust = await page.evaluate(() => W.__dust || 0);
  check(`[${label}] SALTAR en marcha → salta hacia delante y levanta polvo`, airMoved > 0.4 && landed && dust > 0, `avance ${airMoved.toFixed(2)} u, polvo ${dust}`);
  await page.screenshot({ path: `${out}/${label}_05_salto.png` });
  await waitIdle(page, 15000);

  // --- 8. mantener pulsado: sigue al dedo --------------------------------------------------------------
  await page.evaluate(() => { W.teleport(3.5, -5.5); });
  await sleep(500);
  s0 = await S(page);
  const c = await scr(page, s0.x, s0.z);
  const pts = []; for (let k = 0; k <= 24; k++) { const u = k / 24; pts.push([c[0] + 40 + u * vp.width * 0.3, c[1] - 10 - Math.sin(u * Math.PI) * vp.height * 0.12]); }
  let followSeen = false, endG = null;
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    const tp = (type, q) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: q ? [{ x: q[0], y: q[1], id: 1 }] : [] });
    await tp("touchStart", pts[0]); await sleep(260);
    for (const q of pts) { await tp("touchMove", q); await sleep(70); followSeen ||= (await S(page)).following; }
    await page.screenshot({ path: `${out}/${label}_06_siguiendo.png` });
    endG = await page.evaluate((q) => W.pick(q[0], q[1]), pts[pts.length - 1]);   // destino en el momento de soltar
    await tp("touchEnd", null);
  } else {
    await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); await sleep(260);
    for (const q of pts) { await page.mouse.move(q[0], q[1]); await sleep(70); followSeen ||= (await S(page)).following; }
    await page.screenshot({ path: `${out}/${label}_06_siguiendo.png` });
    endG = await page.evaluate((q) => W.pick(q[0], q[1]), pts[pts.length - 1]);
    await page.mouse.up();
  }
  await sleep(150);
  // destino que planificó A* al soltar: el último punto si es alcanzable o, si no (p. ej. cae sobre una
  // meseta), el punto alcanzable más cercano
  const goal = await page.evaluate(() => { const p = W.lastPath; return p && p.length ? { ...p[p.length - 1], exact: !!p.exact } : null; });
  w = await waitIdle(page, 45000);        // con SwiftShader a pocos fps el tiempo simulado va lento
  s1 = w.s;
  const dEnd = Math.hypot(s1.x - endG.x, s1.z - endG.z), dGoal = goal ? Math.hypot(s1.x - goal.x, s1.z - goal.z) : 99;
  check(`[${label}] mantener pulsado sigue al dedo y termina en el último punto`, followSeen && w.t > 0 && dGoal < 0.3 && (goal.exact ? dEnd < 0.8 : true),
    `final a ${dGoal.toFixed(2)} u del destino planificado, ${dEnd.toFixed(2)} u del punto soltado (${goal && goal.exact ? "alcanzable" : "inalcanzable: más cercano alcanzable"}), llega en ${(w.t / 1000).toFixed(1)} s, ${(s1.fps || 0).toFixed(0)} fps; destino (${goal ? goal.x.toFixed(2) + ", " + goal.z.toFixed(2) : "-"}), final (${s1.x.toFixed(2)}, ${s1.z.toFixed(2)}), re-planeos ${await page.evaluate(() => W.player.replans || 0)}`);

  // --- 9. botones: girar cámara (índice ±2), zoom, píxel ------------------------------------------------
  const d0 = (await S(page)).dir;
  await tap(page, ...(await page.locator("#rr").boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])), touch);
  await sleep(800);
  const d1 = (await S(page)).dir;
  check(`[${label}] girar cámara 90° desplaza la dirección 2 posiciones`, (d1 - d0 + 8) % 8 === 2 || (d0 - d1 + 8) % 8 === 2, `${d0} → ${d1}`);
  await page.screenshot({ path: `${out}/${label}_07_camara_girada.png` });
  const z0 = await page.evaluate(() => W.ui.zoom);
  await tap(page, ...(await page.locator("#zi").boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])), touch);
  const z1 = await page.evaluate(() => W.ui.zoom);
  const px0 = await page.evaluate(() => W.renderer.domElement.width);
  await tap(page, ...(await page.locator("#px").boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])), touch);
  const px1 = await page.evaluate(() => W.renderer.domElement.width);
  check(`[${label}] zoom y tamaño de píxel`, z1 > z0 && px1 < px0, `zoom ${z0.toFixed(2)}→${z1.toFixed(2)}, ancho interno ${px0}→${px1}`);
  await page.screenshot({ path: `${out}/${label}_08_zoom_px4.png` });

  // --- 10. sin scroll/zoom del navegador, sin errores ---------------------------------------------------
  const v = await page.evaluate(() => ({ sx: scrollX, sy: scrollY, scale: visualViewport ? visualViewport.scale : 1 }));
  check(`[${label}] sin scroll ni zoom del navegador`, v.sx === 0 && v.sy === 0 && v.scale === 1, JSON.stringify(v));
  check(`[${label}] sin errores JS`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

async function gif(browser) {
  const { ctx, page } = await open(browser, { viewport: { width: 560, height: 420 }, deviceScaleFactor: 1 });
  const dir = `${out}/gif`; fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async () => { await page.screenshot({ path: `${dir}/f${String(n).padStart(3, "0")}_${Date.now()}.png` }); n++; };
  // carrera del claro a las charcas, salto en plena carrera y entrada en un charquito
  await page.evaluate(() => { W.ui.zoom = 2.0; W.resize(); W.teleport(8.5, 0); });
  await sleep(600);
  await page.evaluate(() => W.goTo(21, 19));
  for (let i = 0; i < 16; i++) await shot();
  await page.evaluate(() => W.player.doJump());
  for (let i = 0; i < 26; i++) await shot();
  await page.evaluate(() => {
    let best = null, bn = 0;
    for (let x = 12; x < 32; x += 1) for (let z = 12; z < 32; z += 1) {
      let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (W.kindAt(x + a, z + b) === W.K.PUDDLE) n++;
      if (n > bn && W.cellFree(x + 0.5, z + 0.5)) { bn = n; best = [x + 0.5, z + 0.5]; }
    }
    W.goTo(best[0], best[1]);
  });
  for (let i = 0; i < 30; i++) await shot();
  await ctx.close();
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
if (process.env.ONLY_GIF) { await gif(browser); await browser.close(); process.exit(0); }
if (!process.env.ONLY || process.env.ONLY === "escritorio") await suite(browser, "escritorio", { viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 }, false);
const ip = devices["iPhone 13"];
if (!process.env.ONLY || process.env.ONLY === "iphone") await suite(browser, "iphone", { viewport: ip.viewport, deviceScaleFactor: ip.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: ip.userAgent }, true);
await gif(browser);
await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} comprobaciones OK`);
process.exit(fails.length ? 1 : 0);
