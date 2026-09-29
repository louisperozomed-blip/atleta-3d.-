// ETAPA 4 · Pruebas E2E de la demo con Playwright (escritorio + móvil táctil).
// uso: node e2e.mjs <index.html> <carpeta_salida>
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = "file://" + path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3] || "out");
fs.mkdirSync(outDir, { recursive: true });
const results = [];
function check(name, ok, info = "") {
  results.push({ name, ok, info });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${info ? " — " + info : ""}`);
}
const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
const ISO = 0.64;

async function open(browser, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__demo && window.__demo.ready, null, { timeout: 90000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const st = (page) => page.evaluate(() => window.__demo.state());

// Muestrea el estado cada ~40 ms hasta que cond() se cumpla o pase el tiempo.
async function sample(page, ms, stopWhen) {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await st(page);
    s.t = Date.now() - t0;
    out.push(s);
    if (stopWhen && stopWhen(s, out)) break;
    await page.waitForTimeout(40);
  }
  return out;
}
const arrived = (s) => !s.target && s.anim === "idle" && s.speed === 0;

// teletransporta y espera a que se renderice (el estado de pantalla se actualiza en render)
async function teleport(page, fx, fy) {
  await page.evaluate(([a, b]) => window.__demo.teleport(innerWidth * a, innerHeight * b), [fx, fy]);
  await page.waitForTimeout(120);
  return st(page);
}

async function tap(page, x, y, touch) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function suite(browser, label, ctxOpts, touch) {
  const { ctx, page, errors } = await open(browser, ctxOpts);
  const vp = ctxOpts.viewport;
  let s = await st(page);
  check(`[${label}] canvas usa devicePixelRatio`, s.canvas[0] === Math.round(vp.width * s.dpr) && s.canvas[1] === Math.round(vp.height * s.dpr),
        `canvas ${s.canvas.join("×")} dpr ${s.dpr}`);
  await page.screenshot({ path: path.join(outDir, `${label}_00_inicio.png`) });
  const H = s.H;

  // --- 1. toque cercano: camina, llega, idle ---------------------------------
  let [cx, cy] = s.screen;
  let tx = Math.min(cx + 1.6 * H, vp.width - 20), ty = cy;
  await tap(page, tx, ty, touch);
  let seq = await sample(page, 6000, arrived);
  let anims = new Set(seq.map((q) => q.anim));
  let last = seq[seq.length - 1];
  check(`[${label}] toque cercano → camina (sin correr)`, anims.has("walk") && !anims.has("run"), [...anims].join(","));
  let g = await page.evaluate(([a, b]) => window.__demo.ground(a, b), [tx, ty]);   // objetivo recortado a los márgenes
  check(`[${label}] llega al punto y pasa a idle`, arrived(last) && Math.abs(last.screen[0] - g.x) < 3 && Math.abs(last.screen[1] - g.z * ISO) < 3,
        `final ${last.screen.map((v) => v.toFixed(1))} objetivo ${g.x.toFixed(1)},${(g.z * ISO).toFixed(1)} en ${last.t} ms`);
  check(`[${label}] idle mirando hacia donde iba (E)`, last.dir === "E", last.dir);
  // pies sin patinar: fps efectiva de la animación ∝ velocidad
  const walkS = seq.filter((q) => q.anim === "walk" && q.speed > 0);
  const vmax = Math.max(...walkS.map((q) => q.speed));
  check(`[${label}] velocidad de marcha ≈ 1.05 H/s`, Math.abs(vmax / H - 1.05) < 0.1, (vmax / H).toFixed(2) + " H/s");

  // --- 2. toque lejano: corre y pasa a caminar al acercarse ----------------------
  s = await teleport(page, 0.12, 0.9);
  tx = vp.width * 0.9; ty = vp.height * 0.35;
  const dGround = Math.hypot(tx - s.screen[0], (ty - s.screen[1]) / ISO) / H;
  await tap(page, tx, ty, touch);
  seq = await sample(page, 9000, arrived);
  const order = seq.map((q) => q.anim).filter((a, i, arr) => i === 0 || arr[i - 1] !== a);
  last = seq[seq.length - 1];
  if (dGround > 4) {
    check(`[${label}] toque lejano (${dGround.toFixed(1)} H) → corre y luego camina → idle`,
          order.includes("run") && order.lastIndexOf("walk") > order.indexOf("run") && last.anim === "idle", order.join(" → "));
  } else {
    check(`[${label}] (pantalla pequeña: ${dGround.toFixed(1)} H < 4 H, no corre)`, !order.includes("run"), order.join(" → "));
  }
  const runSpeed = Math.max(...seq.map((q) => q.speed)) / H;
  if (dGround > 4) check(`[${label}] velocidad de carrera ≈ 2.7 H/s`, Math.abs(runSpeed - 2.7) < 0.2, runSpeed.toFixed(2) + " H/s");
  // aceleración suave: sin saltos de velocidad
  let maxJump = 0;
  for (let i = 1; i < seq.length; i++) maxJump = Math.max(maxJump, Math.abs(seq[i].speed - seq[i - 1].speed) / H / Math.max((seq[i].t - seq[i - 1].t) / 1000, 1e-3));
  // (frenado máx. configurado 6.7 H/s²; el muestreo por reloj de pared añade ruido)
  check(`[${label}] aceleración/frenado acotados`, maxJump < 11, `máx ${maxJump.toFixed(1)} H/s²`);
  await page.screenshot({ path: path.join(outDir, `${label}_01_tras_carrera.png`) });

  // --- 3. las 8 direcciones --------------------------------------------------------
  const dirOk = [];
  const flicker = [];
  for (let i = 0; i < 8; i++) {
    s = await teleport(page, 0.5, 0.62);
    const a = i * Math.PI / 4;
    const gx = -Math.sin(a), gz = Math.cos(a);
    const R = Math.min(1.7 * H, vp.width * 0.4, (vp.height * 0.3) / ISO);
    await tap(page, s.screen[0] + gx * R, s.screen[1] + gz * R * ISO, touch);
    seq = await sample(page, 5000, arrived);
    const mid = seq.filter((q) => q.speed > 0.3 * H);
    const counts = {};
    for (const q of mid) counts[q.dir] = (counts[q.dir] || 0) + 1;
    const main = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0];
    const lastD = seq[seq.length - 1].dir;
    dirOk.push(`${DIRS[i]}:${main}/${lastD}`);
    // cambios de dirección una vez lanzado (no debe parpadear)
    let changes = 0;
    const k0 = mid.findIndex((q) => q.dir === DIRS[i]);
    for (let j = Math.max(k0, 0) + 1; j < mid.length; j++) if (mid[j].dir !== mid[j - 1].dir) changes++;
    flicker.push(changes);
    check(`[${label}] dirección ${DIRS[i]}`, main === DIRS[i] && lastD === DIRS[i], `en marcha ${main}, al parar ${lastD}`);
    if (i === 1 || i === 5) await page.screenshot({ path: path.join(outDir, `${label}_02_dir_${DIRS[i]}.png`) });
  }
  check(`[${label}] sin parpadeo de dirección en línea recta`, flicker.every((c) => c === 0), flicker.join(","));

  // --- 4. giro de 180°: pasa por las intermedias ----------------------------------------
  s = await teleport(page, 0.5, 0.62);
  // mira al SE (última prueba) -> pide ir al NW: giro de 180°
  await tap(page, s.screen[0] - 1.2 * H * 0.7, s.screen[1] - 1.2 * H * 0.7 * ISO, touch);
  seq = await sample(page, 800);
  const dirSeq = seq.map((q) => q.dir).filter((d, i, arr) => i === 0 || arr[i - 1] !== d);
  check(`[${label}] giro amplio pasa por direcciones intermedias`, dirSeq.length >= 4 && dirSeq[dirSeq.length - 1] === "NW", dirSeq.join(" → "));
  await sample(page, 4000, arrived);

  // --- 5. mantener pulsado: sigue al dedo ---------------------------------------------
  s = await teleport(page, 0.25, 0.7);
  const path0 = [s.screen[0] + 0.8 * H, s.screen[1]];
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const u = k / 40;
    pts.push([path0[0] + u * (vp.width * 0.92 - path0[0]), path0[1] - Math.sin(u * Math.PI) * vp.height * 0.25]);
  }
  let followSeen = false, gaps = [];
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    const tp = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
    await tp("touchStart", pts[0]);
    await page.waitForTimeout(250);
    for (const p of pts) {
      await tp("touchMove", p);
      await page.waitForTimeout(45);
      const q = await st(page);
      followSeen ||= q.following;
      gaps.push(Math.hypot(q.screen[0] - p[0], (q.screen[1] - p[1]) / ISO) / H);
    }
    await page.screenshot({ path: path.join(outDir, `${label}_03_siguiendo.png`) });
    await tp("touchEnd", null);
  } else {
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    await page.waitForTimeout(250);
    for (const p of pts) {
      await page.mouse.move(p[0], p[1]);
      await page.waitForTimeout(45);
      const q = await st(page);
      followSeen ||= q.following;
      gaps.push(Math.hypot(q.screen[0] - p[0], (q.screen[1] - p[1]) / ISO) / H);
    }
    await page.screenshot({ path: path.join(outDir, `${label}_03_siguiendo.png`) });
    await page.mouse.up();
  }
  check(`[${label}] mantener pulsado activa el seguimiento`, followSeen);
  check(`[${label}] sigue al dedo (distancia final < 1.5 H)`, gaps[gaps.length - 1] < 1.5, `distancias ${gaps.filter((_, i) => i % 10 === 0).map((g) => g.toFixed(2)).join(",")} H`);
  seq = await sample(page, 5000, arrived);
  last = seq[seq.length - 1];
  g = await page.evaluate(([a, b]) => window.__demo.ground(a, b), pts[40]);
  check(`[${label}] al soltar llega al último punto y para`, arrived(last) && Math.hypot(last.screen[0] - g.x, last.screen[1] - g.z * ISO) < 4,
        `final ${last.screen.map((v) => v.toFixed(0))} vs ${[g.x, g.z * ISO].map((v) => v.toFixed(0))}`);

  // --- 6. doble toque parado: salta en el sitio --------------------------------------
  s = await teleport(page, 0.5, 0.65);
  const p0 = s.screen.slice();
  const dx = s.screen[0] + 0.9 * H, dy = s.screen[1] + 0.1 * H;
  await tap(page, dx, dy, touch);
  await page.waitForTimeout(90);
  await tap(page, dx, dy, touch);
  seq = await sample(page, 1500, (q, all) => all.length > 3 && !q.jumping && q.anim === "idle");
  const jumped = seq.some((q) => q.jumping);
  const maxUp = Math.max(...seq.map((q) => q.yUp || 0));
  last = seq[seq.length - 1];
  check(`[${label}] doble toque parado → salta en el sitio`, jumped && Math.hypot(last.screen[0] - p0[0], last.screen[1] - p0[1]) < 3,
        `desplazamiento ${Math.hypot(last.screen[0] - p0[0], last.screen[1] - p0[1]).toFixed(1)} px, altura máx ${(maxUp / H).toFixed(2)} H`);
  check(`[${label}] el sprite sube durante el salto`, maxUp > 0.3 * H, (maxUp / H).toFixed(2) + " H");

  // --- 7. SALTAR en marcha: salta hacia delante ------------------------------------------
  s = await teleport(page, 0.15, 0.7);
  await tap(page, vp.width * 0.85, s.screen[1], touch);
  await page.waitForTimeout(500);
  const before = (await st(page)).screen.slice();
  const box = await page.locator("#jump").boundingBox();
  await tap(page, box.x + box.width / 2, box.y + box.height / 2, touch);
  seq = await sample(page, 900, (q, all) => all.length > 3 && !q.jumping);
  const inAir = seq.filter((q) => q.jumping);
  const moved = inAir.length ? inAir[inAir.length - 1].screen[0] - before[0] : 0;
  check(`[${label}] SALTAR en marcha → salta hacia delante`, inAir.length > 0 && moved > 0.4 * H, `avance ${(moved / H).toFixed(2)} H`);
  await sample(page, 5000, arrived);

  // --- 8. sin scroll ni zoom ---------------------------------------------------------------
  const vpState = await page.evaluate(() => ({ sx: scrollX, sy: scrollY, scale: visualViewport ? visualViewport.scale : 1,
                                                 sw: document.documentElement.scrollWidth, cw: innerWidth }));
  check(`[${label}] sin scroll ni zoom`, vpState.sx === 0 && vpState.sy === 0 && vpState.scale === 1 && vpState.sw <= vpState.cw, JSON.stringify(vpState));
  check(`[${label}] sin errores JS`, errors.length === 0, errors.join(" | "));

  // --- 9. panel -------------------------------------------------------------------------------
  await tap(page, 50, 30, touch);
  await page.waitForTimeout(200);
  const panelVisible = await page.locator("#panel").isVisible();
  check(`[${label}] panel plegable se abre`, panelVisible);
  await page.evaluate(() => window.__demo.setLight(220));
  await page.screenshot({ path: path.join(outDir, `${label}_04_panel_luz220.png`) });
  await page.locator("#nm").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `${label}_05_sin_normalmaps.png`) });
  await page.locator("#nm").click();
  await tap(page, 50, 30, touch);
  await ctx.close();
}

// GIF: secuencia de capturas de un recorrido (carrera + salto + llegada)
async function gifFrames(browser) {
  const { ctx, page } = await open(browser, { viewport: { width: 640, height: 420 }, deviceScaleFactor: 1 });
  const dir = path.join(outDir, "gif");
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => { window.__demo.teleport(70, 360); window.__demo.setLight(40); });
  await page.waitForTimeout(200);
  let n = 0;
  const shot = async () => {
    const t = Date.now();
    await page.screenshot({ path: path.join(dir, `f${String(n).padStart(3, "0")}_${t}.png`) });
    n++;
  };
  await page.mouse.click(580, 150);
  for (let i = 0; i < 26; i++) await shot();
  await page.keyboard.press("Space");
  for (let i = 0; i < 16; i++) await shot();
  await page.mouse.click(120, 330);
  for (let i = 0; i < 40; i++) await shot();
  await ctx.close();
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
await suite(browser, "escritorio", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, false);
const iphone = devices["iPhone 13"];
await suite(browser, "iphone", { viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: iphone.userAgent }, true);
await gifFrames(browser);
await browser.close();
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} comprobaciones OK`);
process.exit(fails.length ? 1 : 0);
