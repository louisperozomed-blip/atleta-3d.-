// Combate completo · Etapa 2: fijar objetivo (escritorio con ratón y teclado, iPhone con toques reales por CDP).
// uso: node cc_e2.mjs <dist/index.html> <carpeta>
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
    // escena: dos autómatas delante del jugador, quietos (sin IA) en un claro
    const A = W.foes[0], B = W.foes[1];
    for (const f of W.foes) f.ai.enabled = false;
    const s = W.findSpot(-8, 1, null, 2.2);
    W.teleport(s.x, s.z); W.camSnap = true;
    // a la derecha y a la izquierda en pantalla (eje derecho de la cámara), un poco hacia el fondo: se ven en el móvil
    const th = W.ui.theta, rx = Math.cos(th), rz = -Math.sin(th), fx = -Math.sin(th), fz = -Math.cos(th);
    window.put = (f, kr, kf) => { const q = W.findSpot(s.x + rx * kr + fx * kf, s.z + rz * kr + fz * kf, W.heightAt(s.x, s.z), 0.6) || { x: s.x + rx * kr, z: s.z + rz * kr };
      f.body.x = q.x; f.body.z = q.z; f.body.y = f.body.ground = W.heightAt(q.x, q.z); f.body.path = []; f.act = null; };
    window.S0 = s;
    put(A, 1.7, 1.0); put(B, -1.7, 1.2);
    window.A = A; window.B = B; T(20);
    window.ts = (f) => W.toScreen(f.body.x, f.body.y + (f.ch.height || W.CHAR_H) * 0.5, f.body.z);
    window.tg = () => { const t = W.getTarget(); return t === A ? "A" : t === B ? "B" : t ? "otro" : null; };
  });
  return { ctx, page };
}
async function tapAt(page, p, touch) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const tp = (type, q) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: q ? [{ x: q[0], y: q[1], id: 1 }] : [] });
    await Promise.all([tp("touchStart", p), tp("touchEnd", null)]);
  } else await page.mouse.click(p[0], p[1]);
  await page.evaluate(() => T(2));
}
async function suite(label, opts, touch) {
  const { ctx, page } = await open(opts);
  // 1) tocar un enemigo lo selecciona (no ataca)
  let p = await page.evaluate(() => ts(A));
  await tapAt(page, p, touch);
  let r = await page.evaluate(() => ({ t: tg(), act: W.pf.act && W.pf.act.name, ring: W.TARGET.ring.visible, ret: document.getElementById("reticle").style.display, tap: W.lastFoeTap }));
  check(`[${label}] tocar un enemigo lo SELECCIONA (anillo y retícula) y no ataca`, r.t === "A" && !r.act && r.ring && r.ret === "block", r);
  await page.evaluate(() => T(20));
  await page.screenshot({ path: `${OUT}/${label}_objetivo.png` });
  // 2) tocar otro cambia el objetivo
  p = await page.evaluate(() => ts(B));
  await tapAt(page, p, touch);
  r = await page.evaluate(() => ({ t: tg(), act: W.pf.act && W.pf.act.name }));
  check(`[${label}] tocar otro enemigo cambia el objetivo`, r.t === "B" && !r.act, r);
  // 3) tocar el objetivo = ataca (y se gira al instante hacia él)
  await page.evaluate(() => { W.pf.act = null; W.player.heading = Math.atan2(W.player.z - B.body.z, W.player.x - B.body.x); T(10); });
  p = await page.evaluate(() => ts(B));
  await page.evaluate(() => { window._atk = null; const prev = W.onCombatAct; W.onCombatAct = function (f, a) { if (prev) prev(f, a); if (f === W.pf && W.isAtk(a) && !window._atk) {
    const pl = W.player, h = Math.atan2(B.body.z - pl.z, B.body.x - pl.x); let dd = pl.heading - h; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
    window._atk = { act: a.name, err: +Math.abs(dd).toFixed(3) }; } }; });
  await tapAt(page, p, touch);
  // (el gancho onCombatAct salta al crear la acción, antes de girarse: se mide en el paso en que empieza el golpe)
  r = await page.evaluate(() => { for (let i = 0; i < 90 && !window._atk; i++) T(1);
    const pl = W.player, h = Math.atan2(B.body.z - pl.z, B.body.x - pl.x), ch = W.character; let dd = pl.heading - h; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
    return { act: window._atk && window._atk.act, err: +Math.abs(dd).toFixed(3), sprite: ch.st.dir, wanted: ch.st.dirWanted, tt: W.pf.act && +W.pf.act.t.toFixed(3) }; });
  check(`[${label}] tocar el objetivo ataca y se gira al instante hacia él (rumbo y sprite)`, /attack|heavy/.test(r.act || "") && r.err < 0.05 && r.sprite === r.wanted, r);
  await page.evaluate(() => { W.pf.act = null; T(30); });
  // 4) al caminar mira hacia donde va; al guardar, se gira al instante hacia el objetivo
  r = await page.evaluate(() => {
    const pl = W.player; W.goTo(pl.x + 2.5, pl.z + 2.5); let walkErr = 0;
    for (let i = 0; i < 25; i++) { T(1); }
    if (pl.path.length) { const q = pl.path[0]; let d = pl.heading - Math.atan2(q.z - pl.z, q.x - pl.x); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; walkErr = Math.abs(d); }
    const out = { walkErr: +walkErr.toFixed(2) };
    for (const [k, a, b] of [["guardia", "guardDown", "guardUp"], ["esquiva", "dodge", null]]) {
      pl.stop(); W.pf.act = null; pl.heading += 2.0; T(1);
      W.pf.input(a, a === "dodge" ? { dir: pl.heading } : { ts: performance.now() }); T(1);
      const h = Math.atan2(B.body.z - pl.z, B.body.x - pl.x); let d = pl.heading - h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      out[k] = { err: +Math.abs(d).toFixed(3), sprite: W.character.st.dir === W.character.st.dirWanted, act: W.pf.act && W.pf.act.name };
      if (b) W.pf.input(b); T(30); W.pf.act = null;
    }
    return out;
  });
  check(`[${label}] al caminar mira hacia donde va; al guardar y al esquivar se gira al instante hacia el objetivo`,
    r.walkErr < 0.5 && r.guardia.err < 0.05 && r.guardia.sprite && r.esquiva.err < 0.05 && r.esquiva.sprite, r);
  // 5) cámara con un ligero sesgo hacia el objetivo
  r = await page.evaluate(() => { T(60); const c = W.TARGET.cam, pl = W.player, dx = B.body.x - pl.x, dz = B.body.z - pl.z, L = Math.hypot(dx, dz);
    return { cam: +Math.hypot(c.x, c.z).toFixed(2), cos: +((c.x * dx + c.z * dz) / (Math.hypot(c.x, c.z) * L || 1)).toFixed(2), dist: +L.toFixed(2) }; });
  check(`[${label}] cámara con un ligero sesgo hacia el objetivo`, r.cam > 0.2 && r.cam <= 2.01 && r.cos > 0.95, r);
  if (!touch) {
    // 6) Tab pasa al siguiente
    const seq = await page.evaluate(() => [tg()]);
    for (let k = 0; k < 3; k++) { await page.keyboard.press("Tab"); seq.push(await page.evaluate(() => { T(1); return tg(); })); }
    check(`[${label}] Tab cambia de objetivo (el más cercano primero)`, new Set(seq.slice(1)).size >= 2 && seq.slice(1).every((x) => x), seq);
  }
  // 7) se quita al alejarte más de 9 u
  r = await page.evaluate(() => { W.setTarget(A); const pl = W.player, dx = pl.x - A.body.x, dz = pl.z - A.body.z, L = Math.hypot(dx, dz);
    const s = W.findSpot(A.body.x + dx / L * 9.8, A.body.z + dz / L * 9.8, null, 0.5); W.teleport(s.x, s.z); T(2);
    return { t: tg(), d: +Math.hypot(pl.x - A.body.x, pl.z - A.body.z).toFixed(2), log: W.combatLog.filter((e) => e.ev === "targetLost").slice(-1)[0] }; });
  check(`[${label}] se suelta al alejarte más de ~9 u`, r.t === null && r.d > 9, r);
  // 8) se quita sin línea de visión más de 1,5 s (no antes)
  r = await page.evaluate(() => {
    // dos puntos a 3-6 u con el terreno en medio
    let pair = null;
    for (let k = 0; k < 4000 && !pair; k++) {
      const x = (Math.random() - 0.5) * W.N * 0.8, z = (Math.random() - 0.5) * W.N * 0.8, a = Math.random() * 6.28, d = 3 + Math.random() * 3;
      const x2 = x + Math.cos(a) * d, z2 = z + Math.sin(a) * d;
      if (!W.cellFree(x, z) || !W.cellFree(x2, z2)) continue;
      const P = { x, z, y: W.heightAt(x, z) }, Q = { x: x2, z: z2, y: W.heightAt(x2, z2) };
      if (!W.sightClear(P, Q) && Math.abs(P.y - Q.y) < 1.2) pair = [P, Q];
    }
    if (!pair) return { found: false };
    const [P, Q] = pair; W.teleport(P.x, P.z); A.body.x = Q.x; A.body.z = Q.z; A.body.y = A.body.ground = Q.y;
    W.setTarget(A); T(60); const at1 = tg(); T(40); const at17 = tg();
    return { found: true, at1, at17 };
  });
  check(`[${label}] se suelta sin línea de visión más de 1,5 s (a 1 s sigue)`, r.found && r.at1 === "A" && r.at17 === null, r);
  // 9) si muere, pasa a otro enemigo cerca en combate; si no hay, se suelta
  r = await page.evaluate(() => {
    W.teleport(S0.x, S0.z); A.respawn(); B.respawn(); put(A, 1.7, 1.0); put(B, -1.7, 1.2); B.ai.state = "chase"; T(2);
    W.setTarget(A); A.hurt({ dmg: 1e4, dir: 0 }); T(3); const after1 = tg();
    B.hurt({ dmg: 1e4, dir: 0 }); T(3); const after2 = tg();
    return { after1, after2, why: W.combatLog.filter((e) => e.ev === "target" || e.ev === "targetLost").slice(-2) };
  });
  check(`[${label}] si el objetivo muere pasa al otro enemigo cercano en combate; si no queda ninguno, se suelta`, r.after1 === "B" && r.after2 === null, r);
  await ctx.close();
}
await suite("escritorio", { viewport: { width: 1280, height: 800 } }, false);
const ip = devices["iPhone 13"];
await suite("iphone", { viewport: ip.viewport, deviceScaleFactor: ip.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: ip.userAgent }, true);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
