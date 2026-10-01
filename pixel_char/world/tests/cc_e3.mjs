// Combate completo · Etapa 3: ataques ligeros y fuertes (carga, nivel 2, cancelar con guardia), stamina.
// Escritorio (ratón + J) e iPhone (toques reales por CDP). Paso fijo; la duración de la pulsación se mide en tiempo
// de juego. uso: node cc_e3.mjs <dist/index.html> <carpeta>
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function open(opts) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("file://" + path.resolve(html));
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => {
    W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
    const A = (window.A = W.foes[0]);
    for (const f of W.foes) f.ai.enabled = false;
    const s = W.findSpot(-8, 1, null, 2.2);
    const th = W.ui.theta, rx = Math.cos(th), rz = -Math.sin(th), fx = -Math.sin(th), fz = -Math.cos(th);
    // un autómata quieto a 1,9 u, a la derecha en pantalla; fijado como objetivo
    window.reset = () => {
      W.pf.respawn(); A.respawn(); W.hitstop = 0; W.teleport(s.x, s.z);
      const q = W.findSpot(s.x + rx * 1.55 + fx * 1.1, s.z + rz * 1.55 + fz * 1.1, W.heightAt(s.x, s.z), 0.5);
      A.body.x = q.x; A.body.z = q.z; A.body.y = A.body.ground = W.heightAt(q.x, q.z); A.body.path = []; A.act = null; A.post = 0; A.hp = A.hpMax = 5000;
      A.body.heading = Math.atan2(W.player.z - A.body.z, W.player.x - A.body.x); W.setTarget(A); W.pf.combo = null; T(20); W.combatLog.length = 0;
    };
    window.ts = (f) => W.toScreen(f.body.x, f.body.y + (f.ch.height || W.CHAR_H) * 0.5, f.body.z);
    window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
    reset();
  });
  return { ctx, page };
}
// pulsar sobre el objetivo, mantener n pasos de juego (1/60 s) y soltar
async function pressFoe(page, touch, steps) {
  const p = await page.evaluate(() => ts(A));
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p[0], y: p[1], id: 1 }] });
    await page.evaluate((n) => T(n), steps);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.evaluate((n) => T(n), steps); await page.mouse.up();
  }
  await page.evaluate(() => T(1));
}
async function suite(label, opts, touch) {
  const { ctx, page } = await open(opts);
  // 1) toque = LIGERO
  await pressFoe(page, touch, 4);
  let r = await page.evaluate(() => { const a = W.pf.act; T(50); return { act: a && a.name, seq: L("move").map((x) => x.seq), hits: L("hit").map((x) => x.anim) }; });
  check(`[${label}] tocar el objetivo = LIGERO (attack1)`, r.act === "attack1" && r.seq[0] === "L" && r.hits[0] === "attack1", r);
  // 2) mantener 0,35 s: aún nada; a 0,45 s: FUERTE cargando; soltar → golpe fuerte (impacto en IMPACT, frame 4)
  await page.evaluate(() => { reset(); });
  const p = await page.evaluate(() => ts(A));
  let cdp = null;
  if (touch) { cdp = await page.context().newCDPSession(page); await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p[0], y: p[1], id: 1 }] }); }
  else { await page.mouse.move(p[0], p[1]); await page.mouse.down(); }
  r = await page.evaluate(() => { T(21); const a1 = W.pf.act && W.pf.act.name; T(6); const a = W.pf.act; return { at035: a1, at045: a && a.name, charging: !!(a && a.charging), f: a && a.f }; });
  await page.evaluate(() => T(6));
  if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await page.mouse.up();
  const r2 = await page.evaluate(() => { const st0 = W.pf.st; T(2); const a = W.pf.act; const rel = { act: a && a.name, charging: !!(a && a.charging), level: a && a.level }; T(60);
    return Object.assign(rel, { hits: L("hit").map((x) => ({ anim: x.anim, dmg: x.dmg, res: x.res })), release: L("heavyRelease")[0] }); });
  check(`[${label}] mantener ≥ 0,4 s = FUERTE: carga (a 0,35 s aún no); soltar lanza el golpe`, !r.at035 && r.at045 === "heavy" && r.charging && !r2.charging && r2.hits[0] && r2.hits[0].anim === "heavy" && r2.release.level === 1, { ...r, ...r2 });
  await page.screenshot({ path: `${OUT}/${label}_fuerte.png` });
  // 3) nivel 2 (1,2 s) pega más: daño y postura frente al nivel 1; a 1,8 s se suelta solo
  const lv = await page.evaluate(() => {
    const out = {};
    for (const [k, hold] of [["n1", 0.6], ["n2", 1.35], ["auto", 2.4]]) {
      reset(); A.act = null; A.post = 0; const hp0 = A.hp;
      W.attackPress("key", performance.now(), A); let n = 0, rel = null;
      while (n++ < hold * 60) { T(1); if (!rel && W.pf.act && W.pf.act.name === "heavy" && !W.pf.act.charging && W.pf.act.level) rel = +(W.ct - 0).toFixed(2); }
      W.attackRelease("key"); T(70);
      const h = L("heavyRelease")[0];
      out[k] = { level: h && h.level, held: h && h.held, dmg: +(hp0 - A.hp).toFixed(1), post: +A.post.toFixed(1), charge2: L("charge2").length };
    }
    return out;
  });
  check(`[${label}] carga de NIVEL 2 a 1,2 s (×1,5 daño, más postura); a 1,8 s se suelta sola`,
    lv.n1.level === 1 && lv.n2.level === 2 && lv.n2.charge2 === 1 && lv.n2.dmg > lv.n1.dmg * 1.4 && lv.n2.post > lv.n1.post * 1.4 && lv.auto.level === 2 && Math.abs(lv.auto.held - 1.8) < 0.05, lv);
  // captura: cargando a nivel 2 (cuchilla avivada, brasas)
  await page.evaluate(() => { reset(); W.attackPress("key", performance.now(), A); T(80); });
  await page.screenshot({ path: `${OUT}/${label}_carga_nivel2.png` });
  await page.evaluate(() => { W.attackRelease("key"); T(4); });
  await page.screenshot({ path: `${OUT}/${label}_suelta.png` });
  await page.evaluate(() => T(60));
  // 4) guardia durante la carga = FINTA (la cancela, gasta stamina) y pasa a guardia
  r = await page.evaluate(() => {
    reset(); W.attackPress("key", performance.now(), A); T(36); const ch = W.pf.act && W.pf.act.charging; const st0 = W.pf.st;
    W.pf.input("guardDown", { ts: performance.now() }); T(2); const a = W.pf.act && W.pf.act.name; W.pf.input("guardUp"); W.attackRelease("key"); T(30);
    return { cargando: ch, act: a, finta: L("feint").length, stamina: +(st0 - W.pf.st).toFixed(1), heavy: L("hit").filter((x) => x.anim === "heavy").length };
  });
  check(`[${label}] guardia durante la carga = finta (cancela, gasta stamina, pasa a guardia)`, r.cargando && r.act === "parry" && r.finta === 1 && r.stamina >= 13 && r.heavy === 0, r);
  // 5) vulnerable al cargar: un golpe del enemigo la interrumpe
  r = await page.evaluate(() => {
    reset(); A.ai.enabled = false; W.attackPress("key", performance.now(), A); T(36);
    A.ai.attack("attack1"); let n = 0; while (W.pf.act && W.pf.act.name === "heavy" && n++ < 200) T(1);
    const a = W.pf.act && W.pf.act.name; W.attackRelease("key"); T(40);
    return { act: a, golpes: L("hit").filter((x) => x.who === "jugador").length, heavy: L("hit").filter((x) => x.anim === "heavy").length };
  });
  check(`[${label}] durante la carga eres vulnerable (su golpe la interrumpe)`, r.act === "hit" && r.golpes === 1 && r.heavy === 0, r);
  // 6) stamina: ligero poco, fuerte bastante más, nivel 2 aún más; sin stamina, más lento
  r = await page.evaluate(() => {
    const cost = (fn) => { reset(); W.pf.st = 100; const s0 = W.pf.st; fn(); return +(s0 - W.pf.st).toFixed(1); };
    const out = {};
    out.L = cost(() => { W.attackPress("key", performance.now(), A); T(2); W.attackRelease("key"); T(3); });
    out.H = cost(() => { W.attackPress("key", performance.now(), A); T(30); W.attackRelease("key"); T(3); });
    out.H2 = cost(() => { W.attackPress("key", performance.now(), A); T(76); W.attackRelease("key"); T(3); });
    const imp = (st) => { reset(); W.pf.st = st; W.attackPress("key", performance.now(), A); T(2); W.attackRelease("key"); const t0 = W.ct; let n = 0; while (!(W.pf.act && W.pf.act.impactT != null) && n++ < 120) T(1); return +((W.pf.act.impactT - t0) * 1000).toFixed(0); };
    out.ms_con = imp(100); out.ms_sin = imp(0); out.lento = L("move").length >= 0;
    return out;
  });
  check(`[${label}] stamina: ligero < fuerte < nivel 2; sin stamina el golpe sale más lento`, r.L > 0 && r.L < 9 && r.H >= 16 && r.H2 > r.H * 1.4 && r.ms_sin > r.ms_con * 1.2, r);
  if (!touch) {
    // 7) teclado: J tocada = L, J mantenida = H
    await page.evaluate(() => reset());
    await page.keyboard.down("KeyJ"); await page.evaluate(() => T(3)); await page.keyboard.up("KeyJ");
    const k1 = await page.evaluate(() => { T(2); const a = W.pf.act && W.pf.act.name; T(50); return a; });
    await page.evaluate(() => reset());
    await page.keyboard.down("KeyJ"); const k2 = await page.evaluate(() => { T(30); return W.pf.act && W.pf.act.charging; }); await page.keyboard.up("KeyJ");
    const k3 = await page.evaluate(() => { T(60); return L("hit").map((x) => x.anim); });
    check(`[${label}] teclado: J tocada = ligero, J mantenida = fuerte con carga`, k1 === "attack1" && k2 && k3.includes("heavy"), { k1, k2, k3 });
  }
  // 8) mantener en el suelo sigue siendo seguir el dedo; tocar el suelo te mueve
  r = await page.evaluate(() => { reset(); const pl = W.player; const g = W.toScreen(pl.x - 1.8, pl.y, pl.z + 1.2); return { g, x0: pl.x, z0: pl.z }; });
  if (touch) { const c2 = await page.context().newCDPSession(page); await c2.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.g[0], y: r.g[1], id: 1 }] }); await c2.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
  else await page.mouse.click(r.g[0], r.g[1]);
  const mv = await page.evaluate((r) => { T(90); return { moved: +Math.hypot(W.player.x - r.x0, W.player.z - r.z0).toFixed(2), act: W.pf.act && W.pf.act.name }; }, r);
  check(`[${label}] tocar el suelo te mueve (no ataca)`, mv.moved > 1 && !mv.act, mv);
  await ctx.close();
}
await suite("escritorio", { viewport: { width: 1280, height: 800 } }, false);
const ip = devices["iPhone 13"];
await suite("iphone", { viewport: ip.viewport, deviceScaleFactor: ip.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: ip.userAgent }, true);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
