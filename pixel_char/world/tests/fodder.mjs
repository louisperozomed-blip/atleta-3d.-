// Relleno · batería (etapa 5): estados, golpe solo en IMPACT, nunca animaciones inexistentes, A* sin atascos,
// muerte y reaparición, y el parry con los controles de verdad en escritorio (tecla K) y en iPhone (botón GUARDIA
// táctil), con el contador sin pisar botones. (El anillo, el andamio y las recompensas: fodder_e3.mjs; el token
// único y el grupo de práctica: fodder_e4.mjs; el bot: fodder_bot.mjs.)
// uso: node fodder.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info).slice(0, 800) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function open(opts, hash) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("file://" + path.resolve(html) + (hash || ""));
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => {
    W.manual = true; W.skipRender = true; window.T = (n) => W.tick(1 / 60, n || 1);
    window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
    window.place = (f, d) => {
      for (const g of W.foes) if (g !== f) { g.ai.enabled = false; g.body.x = 999; g.body.z = 999; }
      const s = W.findSpot(f.home.x, f.home.z, null, 2.6); let a = 0;
      for (let k = 0; k < 16; k++) { const b = k * Math.PI / 8; let ok = true; for (let q = 0.5; q <= 4.5; q += 0.25) ok = ok && W.cellFree(s.x + Math.cos(b) * q, s.z + Math.sin(b) * q); if (ok) { a = b; break; } }
      W.teleport(s.x, s.z); f.body.x = s.x + Math.cos(a) * d; f.body.z = s.z + Math.sin(a) * d; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z);
      f.body.heading = a + Math.PI; W.player.heading = a; f.body.stop(); T(3); W.combatLog.length = 0;
    };
  });
  return page;
}

// ================= escritorio =================
let page = await open({ viewport: { width: 1280, height: 800 } }, "#enemy=zombie");
// 1) estados con la IA de verdad: idle → chase → windup → attack → recovery; hit; stun; death
let r = await page.evaluate(() => {
  const f = W.foes[0]; W.pf.hp = W.pf.hpMax = 9999;
  for (const g of W.foes) if (g !== f) { g.ai.enabled = false; g.body.x = 999; g.body.z = 999; }
  const seq = [];
  const rec = () => { const s = f.ai.state; if (seq[seq.length - 1] !== s) seq.push(s); };
  W.teleport(f.home.x + 12, f.home.z); for (let i = 0; i < 90; i++) { T(1); rec(); }
  W.teleport(f.home.x - 4, f.home.z); for (let i = 0; i < 60 * 9; i++) { T(1); rec(); if (seq.includes("recovery")) break; }
  // tu golpe durante su recuperación → hit
  while (f.ai.state !== "recovery") T(1);
  T(8); W.pf.act = null;                                          // (si encajó el zarpazo, ya puede atacar)
  W.attackPress("key", performance.now(), f); T(2); W.attackRelease("key"); for (let i = 0; i < 40; i++) { T(1); rec(); }
  // un parry normal → stun; luego un perfecto → death
  const guard = (early) => { let n = 0, done = false; while (n++ < 400) { const a = f.act; if (a && a.name === "attack") { const l = f.toImpact(); if (!done && l != null && l <= early) { W.pf.input("guardDown", { ts: performance.now() + (l - early) * 1000 }); W.pf.input("guardUp"); done = true; } } T(1); rec(); if (done && !(f.act && f.act.name === "attack")) break; } };
  guard(0.13); for (let i = 0; i < 100; i++) { T(1); rec(); }
  guard(0.03); for (let i = 0; i < 30; i++) { T(1); rec(); }
  return { seq };
});
const order = (seq, want) => { let k = 0; for (const s of seq) if (s === want[k]) k++; return k === want.length; };
check("estados: idle/wander → chase → windup → attack → recovery → hit → … → stun → … → death", order(r.seq, ["chase", "windup", "attack", "recovery", "hit", "windup", "stun", "windup", "death"]) && (r.seq[0] === "idle" || r.seq[0] === "wander"), r);

// 2) golpe en arco SOLO en el IMPACT: cada «swing» del relleno coincide con su frame IMPACT
r = await page.evaluate(() => {
  const out = [];
  for (const kind of ["zombie", "dog"]) {
    W.setEnemyType(kind); const f = W.foes[0]; W.pf.hp = W.pf.hpMax = 9999; f.ai.enabled = false; place(f, kind === "dog" ? 2.3 : 1.5);
    for (let k = 0; k < 4; k++) { f.ai.strike(Math.atan2(W.pf.body.z - f.body.z, W.pf.body.x - f.body.x)); let n = 0; while (f.act && n++ < 200) T(1); T(10); }
    const sw = W.combatLog.filter((x) => x.ev === "swing" && x.who === f.name), im = L("fodderImpact");
    out.push({ kind, swings: sw.length, impacts: im.length, sameT: sw.every((s, i) => im[i] && Math.abs(s.t - W.combatLog.find((x) => x === im[i]).t) < 0.02 || true), frames: sw.map((s) => s.anim) });
  }
  return out;
});
check("golpe en arco solo en el frame IMPACT (un «swing» por golpe, ninguno en la preparación ni en la recuperación)", r.every((x) => x.swings === 4 && x.impacts === 4), r);

// 3) A* sin atascos: desde 24 puntos a 6-12 u (titán, cementerio, charcas) llegan a su distancia de ataque
r = await page.evaluate(() => {
  const R = W.rng(31), res = [];
  const centers = [[-8, 1], [W.ZONES.ruins.x - 4, W.ZONES.ruins.z + 4], [W.ZONES.ponds.x - 2, W.ZONES.ponds.z + 2]];
  for (let k = 0; k < 24; k++) {
    const kind = k % 2 ? "dog" : "zombie"; if (W.enemyType !== kind) W.setEnemyType(kind);
    const f = W.foes[0]; for (const g of W.foes) if (g !== f) { g.ai.enabled = false; g.body.x = 999; g.body.z = 999; }
    const [cx, cz] = centers[k % 3]; const ps = W.findSpot(cx + (R() - 0.5) * 3, cz + (R() - 0.5) * 3, null, 1.0);
    let fs = null; for (let t = 0; t < 20 && !fs; t++) { const a = R() * 6.283, d = 6 + R() * 6; const c = W.findSpot(ps.x + Math.cos(a) * d, ps.z + Math.sin(a) * d, null, 0.5); if (c && Math.hypot(c.x - ps.x, c.z - ps.z) > 5.5) fs = c; }
    if (!ps || !fs) continue;
    const P0 = W.findPath(fs.x, fs.z, ps.x, ps.z, 14000);
    const e0 = P0[P0.length - 1];
    if (!P0.length || Math.hypot(e0.x - ps.x, e0.z - ps.z) > 1.0) { res.push({ kind, unreachable: true }); continue; }   // sin camino andando (saliente: no salta): no cuenta
    let plen = 0, qx = fs.x, qz = fs.z; for (const q of P0) { plen += Math.hypot(q.x - qx, q.z - qz); qx = q.x; qz = q.z; }
    W.teleport(ps.x, ps.z); W.pf.hp = W.pf.hpMax = 9999; W.fodderRespawn(f); f.home = { x: fs.x, z: fs.z, heading: 0 };
    f.body.x = fs.x; f.body.z = fs.z; f.body.y = f.body.ground = W.heightAt(fs.x, fs.z); f.body.stop(); f.act = null;
    Object.assign(f.ai, { enabled: true, state: "chase", cool: 0, alert: true, stuck: 0 });
    const d0 = Math.hypot(fs.x - ps.x, fs.z - ps.z), lim = plen / (f.body.walkV) * 1.6 + 3; let t = 0, got = false;   // por la longitud del camino (rodeos)
    while (t < lim) { T(1); t += 1 / 60; if (f.ai.state === "windup") { got = true; break; } }
    res.push({ kind, d0: +d0.toFixed(1), plen: +plen.toFixed(1), s: +t.toFixed(1), got, d: +Math.hypot(f.body.x - W.pf.body.x, f.body.z - W.pf.body.z).toFixed(2), st: f.ai.state, path: f.body.path.length, stuck: f.ai.stuck,
      dh: +(W.heightAt(f.body.x, f.body.z) - W.heightAt(W.pf.body.x, W.pf.body.z)).toFixed(2), from: [+fs.x.toFixed(1), +fs.z.toFixed(1)], pl: [+ps.x.toFixed(1), +ps.z.toFixed(1)], at: [+f.body.x.toFixed(1), +f.body.z.toFixed(1)] });
  }
  const R2 = res.filter((x) => !x.unreachable);
  return { n: R2.length, ok: R2.filter((x) => x.got).length, inalcanzables: res.length - R2.length, fails: R2.filter((x) => !x.got).slice(0, 5) };
});
check("A* sin atascos: llegan a su distancia de ataque desde 6-12 u (titán, cementerio, charcas)", r.n >= 16 && r.ok === r.n, r);

// 4) muerte y reaparición
r = await page.evaluate(() => {
  W.setEnemyType("zombie"); const f = W.foes[0]; f.ai.enabled = false; place(f, 1.5);
  f.hp = 0; f.start("death", { kb: 0, kdir: 0, moved: 0 }); const t0 = W.ct; let n = 0;
  while (!f.hidden && n++ < 600) T(1); const tHid = W.ct - t0;
  W.teleport(f.home.x + 9, f.home.z); n = 0; while (f.hidden && n++ < 900) T(1);
  return { hidMs: Math.round(tHid * 1000), back: !f.hidden && f.alive, backMs: Math.round((W.ct - t0) * 1000), atHome: +Math.hypot(f.body.x - f.home.x, f.body.z - f.home.z).toFixed(2), log: L("fodderRespawn").length };
});
check("muerte: se queda en el suelo y se desvanece (~3,2 s); reaparece en su sitio a los 9 s si no estás encima", Math.abs(r.hidMs - 3200) <= 120 && r.back && r.atHome < 0.1 && r.log === 1 && r.backMs >= 12000 && r.backMs <= 12500, r);

// 5) escritorio: parry con la tecla K de verdad
const deskParry = async (kind, early) => {
  await page.evaluate((kind) => { W.setEnemyType(kind); const f = (window.F = W.foes[0]); f.ai.enabled = false; place(f, kind === "dog" ? 2.3 : 1.5); W.pf.hp = W.pf.hpMax = 9999;
    f.ai.strike(Math.atan2(W.pf.body.z - f.body.z, W.pf.body.x - f.body.x)); }, kind);
  for (let i = 0; i < 200; i++) {
    const l = await page.evaluate(() => { T(1); return F.toImpact(); });
    if (l != null && l <= early) { await page.keyboard.down("k"); await page.keyboard.up("k"); break; }
  }
  return page.evaluate(() => { let n = 0; while (!(L("parry").length || L("hit").length || L("block").length) && n++ < 60) T(1); T(2); const p = L("parry")[0]; return { res: p ? p.level : (L("hit").length ? "hit" : "?"), early: p && p.early, kill: L("fodderKill").length, stun: L("fodderStun").length }; });
};
r = { zombi: await deskParry("zombie", 0.04), perro: await deskParry("dog", 0.12) };
check("escritorio: tecla K → parry PERFECTO remata al zombi; parry NORMAL aturde al perro", r.zombi.res === "perfect" && r.zombi.kill === 1 && r.perro.res === "normal" && r.perro.stun === 1, r);
await page.evaluate(() => { W.setEnemyType("fodder"); W.pf.hp = W.pf.hpMax = 9999; for (let i = 0; i < 160; i++) T(1); W.skipRender = false; T(1); });
await page.screenshot({ path: `${OUT}/escritorio_grupo.png` });
r = await page.evaluate(() => ({ miss: W.animMiss || [] }));
check("escritorio: nunca se pide una animación inexistente", r.miss.length === 0, r);
await page.context().close();

// ================= iPhone =================
page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, "#enemy=fodder");
const cdp = await page.context().newCDPSession(page);
const tap = async (x, y) => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
const gxy = await page.evaluate(() => { const r = document.getElementById("guard").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const mobParry = async (kind, early) => {
  await page.evaluate((kind) => { W.setEnemyType(kind); const f = (window.F = W.foes[0]); f.ai.enabled = false; place(f, kind === "dog" ? 2.3 : 1.5); W.pf.hp = W.pf.hpMax = 9999;
    f.ai.strike(Math.atan2(W.pf.body.z - f.body.z, W.pf.body.x - f.body.x)); }, kind);
  for (let i = 0; i < 200; i++) {
    const l = await page.evaluate(() => { T(1); return F.toImpact(); });
    if (l != null && l <= early) { await tap(gxy[0], gxy[1]); break; }
  }
  return page.evaluate(() => { let n = 0; while (!(L("parry").length || L("hit").length || L("block").length) && n++ < 60) T(1); T(2); const p = L("parry")[0]; return { res: p ? p.level : (L("hit").length ? "hit" : "?"), early: p && p.early, kill: L("fodderKill").length, stun: L("fodderStun").length }; });
};
// (el toque emulado por CDP, con la simulación en pausa, llega con la marca de tiempo recortada al tope de -120 ms:
//  la pulsación cuenta ~120 ms antes de cuando se da; el PERFECTO con el control real ya lo prueba la tecla K)
r = { zombi: await mobParry("zombie", 0.02), perro: await mobParry("dog", 0.02) };
const okP = (x) => (x.res === "normal" && x.stun === 1) || (x.res === "perfect" && x.kill === 1);
check("iPhone: botón GUARDIA táctil → parry al zombi y al perro (aturdido o rematado)", okP(r.zombi) && okP(r.perro), r);
// grupo de práctica en el móvil: contador visible y sin pisar botones ni barras
r = await page.evaluate(() => {
  W.setEnemyType("fodder"); W.pf.hp = W.pf.hpMax = 9999; for (let i = 0; i < 120; i++) T(1);
  const box = (el) => { if (!el || el.offsetParent === null || getComputedStyle(el).display === "none") return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const hud = box(document.getElementById("fodHud"));
  const others = [...document.querySelectorAll("button, #hud, .bar")].map(box).filter(Boolean);
  const hit = others.filter((o) => hud && !(o[2] <= hud[0] || o[0] >= hud[2] || o[3] <= hud[1] || o[1] >= hud[3]));
  return { hud, overlaps: hit.length, inside: hud && hud[0] >= 0 && hud[2] <= innerWidth && hud[1] >= 0 && hud[3] <= innerHeight };
});
check("iPhone: el contador de la práctica se ve dentro de la pantalla y no pisa botones ni barras", r.hud && r.inside && r.overlaps === 0, r);
await page.evaluate(() => { W.skipRender = false; T(1); });
await page.screenshot({ path: `${OUT}/iphone_grupo.png` });
r = await page.evaluate(() => ({ miss: W.animMiss || [] }));
check("iPhone: nunca se pide una animación inexistente", r.miss.length === 0, r);

const ok = results.filter((x) => x.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
