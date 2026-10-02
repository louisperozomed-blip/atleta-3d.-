// Relleno · Etapa 3: anillo de timing, clic, andamio adaptativo y recompensas.
// uso: node fodder_e3.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info).slice(0, 700) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  window.setup = (kind) => {
    if (W.enemyType !== kind) W.setEnemyType(kind);
    const f = (window.F = W.foes[0]);
    for (const g of W.foes) { g.ai.enabled = false; if (g !== f) { g.body.x = 999; g.body.z = 999; } }
    W.pf.respawn(); W.hitstop = 0;
    if (!f.alive || f.hidden) W.fodderRespawn(f);
    f.act = null; f.slide = null;
    const s = W.findSpot(f.home.x, f.home.z, null, 2.6);
    let a = 0;
    for (let k = 0; k < 16; k++) { const b = k * Math.PI / 8; let ok = true; for (let d = 0.5; d <= 4.5; d += 0.25) ok = ok && W.cellFree(s.x + Math.cos(b) * d, s.z + Math.sin(b) * d); if (ok) { a = b; break; } }
    W.teleport(s.x, s.z); const dd = f.kind === "dog" ? 2.3 : 1.5;
    f.body.x = s.x + Math.cos(a) * dd; f.body.z = s.z + Math.sin(a) * dd; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z);
    f.body.heading = a + Math.PI; W.player.heading = a; f.body.stop(); T(4); W.combatLog.length = 0;
    return f;
  };
  // su golpe y tu guardia «early» s antes del impacto (null = no defenderse; "hold" = guardia mantenida)
  window.strike = (early) => {
    const f = window.F, p = W.pf;
    f.ai.strike(Math.atan2(p.body.z - f.body.z, p.body.x - f.body.x));
    let n = 0, pressed = false; const rs = [];
    if (early === "hold") { p.input("guardDown"); T(20); }
    while (n++ < 200) {
      const l = f.toImpact();
      if (f.ring) rs.push([+W.ct.toFixed(4), +f.ring.r.toFixed(4), +f.ring.alpha.toFixed(2)]);
      if (typeof early === "number" && !pressed && l != null && l <= early + 1e-3) { p.input("guardDown", { ts: performance.now() + (l - early) * 1000 }); p.input("guardUp"); pressed = true; }
      T(1); if (L("fodderImpact").length && (L("parry").length || L("block").length || L("hit").length || n > 120)) break;
    }
    if (early === "hold") p.input("guardUp");
    T(1);
    return { imp: L("fodderImpact")[0], res: (L("parry")[0] || L("block")[0] || L("hit")[0] || {}), rs };
  };
});

// 1) parry PERFECTO al zombi: rematado al instante
let r = await page.evaluate(() => { setup("zombie"); W.fodderResetScaffold(); const s = strike(0.03); T(2); return { lvl: s.res.level, ev: s.res.ev, kill: L("fodderKill").length, alive: F.alive, act: F.act && F.act.name }; });
check("parry PERFECTO al zombi: queda REMATADO al instante (muerte con fogonazo)", r.lvl === "perfect" && r.kill === 1 && !r.alive && r.act === "death", r);
// 2) parry NORMAL al perro: aturdido 1,2 s y despedido ~1,5 baldosas
r = await page.evaluate(() => {
  setup("dog"); const s = strike(0.13); const t0 = W.ct; const o = F.slide ? { x: F.slide.x0, z: F.slide.z0 } : { x: F.body.x, z: F.body.z }; let n = 0;
  while (F.act && F.act.name === "stun" && n++ < 200) T(1);
  return { lvl: s.res.level, stun: L("fodderStun").length, ms: Math.round((W.ct - t0) * 1000), kb: +Math.hypot(F.body.x - o.x, F.body.z - o.z).toFixed(2), alive: F.alive };
});
check("parry NORMAL al perro: STUN de 1,2 s y sale despedido ~1,5 baldosas", r.lvl === "normal" && r.stun === 1 && Math.abs(r.ms - 1200) <= 60 && r.kb >= 1.2 && r.kb <= 1.8 && r.alive, r);
// 3) cualquier golpe tuyo durante el STUN lo mata
r = await page.evaluate(() => {
  setup("zombie"); strike(0.13); T(10); const st = F.act && F.act.name;
  W.attackPress("key", performance.now(), F); T(2); W.attackRelease("key"); let n = 0; while (F.alive && n++ < 90) T(1);
  return { st, alive: F.alive, db: L("deathblow").length, hp: F.hp };
});
check("durante el STUN cualquier golpe tuyo lo mata", r.st === "stun" && !r.alive && r.db === 1, r);
// 3b) barra de FATIGA: cada parry normal la llena a la mitad (aturdido 1,2 s); la 2.ª la llena → AGOTADO 2,2 s; baja sola
r = await page.evaluate(() => {
  setup("dog"); W.fodderRespawn(F); setup("dog"); const out = {};
  strike(0.13); out.p1 = Math.round(F.post); let n = 0, t0 = W.ct; while (F.act && F.act.name === "stun" && n++ < 300) T(1); out.stun1 = Math.round((W.ct - t0) * 1000); out.after1 = Math.round(F.post);
  setup("dog"); strike(0.13); out.p2 = Math.round(F.post); out.agotado = L("fodderExhausted").length; t0 = W.ct; n = 0; while (F.act && F.act.name === "stun" && n++ < 300) T(1); out.stun2 = Math.round((W.ct - t0) * 1000);
  setup("dog"); F.post = 60; F.postT = 0; T(60 * 5); out.quieta = Math.round(F.post); T(60 * 4); out.baja = Math.round(F.post);
  const bar = document.querySelector("#duelE .pb i"), dn = document.querySelector("#duelE .dn"); out.hud = dn ? dn.textContent : null;
  return out;
});
check("barra de FATIGA: parry normal +50 (aturdido 1,2 s); el 2.º la llena → ¡AGOTADO! 2,2 s; baja sola si no le desvías",
  r.p1 === 50 && Math.abs(r.stun1 - 1200) <= 60 && r.after1 === 50 && r.p2 === 100 && r.agotado === 1 && Math.abs(r.stun2 - 2200) <= 60 && r.quieta === 60 && r.baja < 60 && /FATIGA/.test(r.hud || ""), r);
// 4) bloqueo: la mitad de stamina, sin aturdir, sin chispas
r = await page.evaluate(() => {
  setup("zombie"); W.pf.st = W.pf.stMax; const st0 = W.pf.st; const s = strike("hold"); T(5);
  return { ev: s.res.ev, cost: Math.round(st0 - W.pf.st), stun: !!(F.act && F.act.name === "stun"), alive: F.alive };
});
const blockSt = await page.evaluate(() => W.COMBAT && W.COMBAT.block ? null : null);
check("bloqueo: cuesta la mitad de stamina y no aturde", r.ev === "block" && r.cost > 0 && r.cost <= 12 && !r.stun && r.alive, r);
// 5) golpe recibido: daño bajo (≈ 1/3 del zarpazo del autómata)
r = await page.evaluate(() => { setup("dog"); const hp0 = W.pf.hp; const s = strike(null); return { ev: s.res.ev, dmg: +(hp0 - W.pf.hp).toFixed(1) }; });
check("golpe recibido: daño bajo (6 = 1/3 del zarpazo del autómata, 18)", r.ev === "hit" && Math.abs(r.dmg - 6) < 0.6, r);
// 6) el anillo llega al centro a ±16 ms del IMPACT (nivel 2), y nivel 1 solo los últimos 250 ms
r = await page.evaluate(() => {
  const out = {};
  for (const kind of ["zombie", "dog"]) {
    setup(kind); W.fodderResetScaffold(); const s = strike(null);
    const rs = s.rs, last = rs[rs.length - 1], prev = rs[rs.length - 2];
    // instante en que r llega a 0 (extrapolación lineal de los dos últimos frames)
    const slope = (last[1] - prev[1]) / (last[0] - prev[0]);
    const tz = last[0] - last[1] / slope;
    out[kind] = { err: Math.round((tz - s.imp.t) * 1000), first: rs[0], lv: s.imp.ringLv, alpha0: rs[3] && rs[3][2] };
  }
  setup("zombie"); W.FODDER_SCAF.zombie.level = 1; const s1 = strike(null);
  const vis = s1.rs.filter((x) => x[2] > 0.01).map((x) => x[0]);
  out.lv1 = { firstVisMs: vis.length ? Math.round((s1.imp.t - vis[0]) * 1000) : null };
  W.FODDER_SCAF.zombie.level = 0; const s0 = strike(null);
  out.lv0 = { vis: s0.rs.filter((x) => x[2] > 0.01).length, click: s0.imp ? 1 : 0 };
  return out;
});
check("el anillo toca el centro a ±16 ms del IMPACT (zombi y perro)", Math.abs(r.zombie.err) <= 16 && Math.abs(r.dog.err) <= 16 && r.zombie.lv === 2, r);
check("nivel 1: el anillo solo se ve los últimos 250 ms; nivel 0: sin anillo (solo pose, gruñido y clic)", r.lv1.firstVisMs != null && r.lv1.firstVisMs <= 260 && r.lv1.firstVisMs >= 200 && r.lv0.vis === 0 && r.lv0.click === 1, r);
// 7) andamio: 4 parries seguidos bajan un nivel (2→1→0); 3 fallos seguidos lo suben
r = await page.evaluate(() => {
  setup("zombie"); W.fodderResetScaffold(); const lv = [];
  for (let i = 0; i < 8; i++) { setup("zombie"); strike(0.13); lv.push(W.FODDER_SCAF.zombie.level); T(80); }
  const dogLv = W.FODDER_SCAF.dog.level;
  for (let i = 0; i < 3; i++) { setup("zombie"); strike(null); lv.push(W.FODDER_SCAF.zombie.level); T(60); }
  return { lv, dogLv, ev: L("fodderLevel").map((x) => x.from + "→" + x.level) };
});
check("andamio: 4 parries seguidos → nivel 1, otros 4 → nivel 0; 3 fallos → sube a 1 (y es por tipo: el perro sigue en 2)",
  r.lv.slice(0, 8).join() === "2,2,2,1,1,1,1,0" && r.lv[10] === 1 && r.dogLv === 2, r);
// 8) panel ⚙: Anillo Auto / Siempre / Nunca
r = await page.evaluate(() => {
  const sel = document.getElementById("fodRing"); const opts = sel ? [...sel.options].map((o) => o.value) : [];
  W.setFodderRingMode("always"); W.FODDER_SCAF.zombie.level = 0; const a = W.fodderRingLevel("zombie");
  W.setFodderRingMode("never"); W.FODDER_SCAF.zombie.level = 2; const b = W.fodderRingLevel("zombie");
  W.setFodderRingMode("auto"); const c = W.fodderRingLevel("zombie");
  return { opts, always: a, never: b, auto: c };
});
check("panel ⚙: «Anillo» Auto (por defecto) / Siempre / Nunca", r.opts.join() === "auto,always,never" && r.always === 2 && r.never === 0 && r.auto === 2, r);
// captura: anillo a medio cerrar sobre el zombi
await page.evaluate(() => { setup("zombie"); W.fodderResetScaffold(); F.ai.strike(Math.atan2(W.pf.body.z - F.body.z, W.pf.body.x - F.body.x)); T(24); W.skipRender = false; T(1); });
await page.screenshot({ path: `${OUT}/anillo_zombi.png` });
await page.evaluate(() => { W.skipRender = true; });
r = await page.evaluate(() => ({ miss: W.animMiss || [] }));
check("nunca se pide una animación inexistente", r.miss.length === 0, r);
const ok = results.filter((x) => x.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
