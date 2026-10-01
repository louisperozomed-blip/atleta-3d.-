// Combate completo · Etapa 7: grupos y multi-parry. uso: node cc_e7.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info).slice(0, 1000) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  window.S0 = W.findSpot(-8, 1, null, 3.5); W.teleport(S0.x, S0.z); T(5);
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  // jugador que aguanta (vida enorme) y no ataca
  window.tank = () => { const p = W.pf; p.hpMax = p.hp = 1e6; p.st = p.stMax; p.post = 0; };
});
// 1) panel: 3 autómatas alrededor
await page.click("#tbtn"); await page.click("#tG3"); await page.click("#tbtn");
let r = await page.evaluate(() => { T(5); return { n: W.foes.length, tipos: W.foes.map((f) => f.type), d: W.foes.map((f) => +Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z).toFixed(1)) }; });
check("panel de pruebas: aparecer 3 autómatas alrededor del jugador", r.n === 3 && r.tipos.every((t) => t === "automaton") && r.d.every((x) => x < 6), r);
await page.screenshot({ path: `${OUT}/grupo_3.png` });
// 2) turnos: como mucho 2 atacan a la vez; el resto rodea
r = await page.evaluate(() => {
  tank(); W.skipRender = true; for (const f of W.foes) { f.ai.enabled = true; f.ai.state = "chase"; f.ai.cool = 0.2; }
  let maxAtk = 0, samples = 0, orbitD = [], attacked = new Set(), pincers = 0;
  for (let i = 0; i < 60 * 25; i++) {
    T(1); tank(); if (W.pf.act && W.pf.act.name === "death") W.pf.respawn();
    const atk = W.foes.filter((f) => f.alive && ((f.act && W.isAtk(f.act)) || f.ai.chain));
    maxAtk = Math.max(maxAtk, atk.length); samples++;
    for (const f of atk) attacked.add(W.foes.indexOf(f));
    if (W.groupActive()) for (const f of W.foes) if (!W.groupHolds(f) && !f.act && f.alive) orbitD.push(Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z));
  }
  W.skipRender = false;
  const od = orbitD.slice(-200);
  return { maxAtk, atacaron: [...attacked], rodeo_medio: +(od.reduce((a, b) => a + b, 0) / (od.length || 1)).toFixed(2), pinzas: L("pincer").length };
});
check("turnos: con 3 autómatas como mucho 2 atacan a la vez (todos acaban atacando); el resto rodea a ~3,6 u", r.maxAtk <= 2 && r.atacaron.length === 3 && r.rodeo_medio > 2.6 && r.rodeo_medio < 5, r);
// 3) pinza: dos a lados opuestos, impactos sincronizados, aviso doble (ojos a la vez + sonido propio)
r = await page.evaluate(() => {
  tank(); const [a, b] = W.foes; for (const f of W.foes) { f.ai.enabled = true; f.act = null; f.ai.chain = null; f.ai.passive = true; }
  const pl = W.player; const put = (f, ang) => { f.body.x = pl.x + Math.cos(ang) * 1.9; f.body.z = pl.z + Math.sin(ang) * 1.9; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z); f.body.path = []; };
  put(a, 0.3); put(b, 0.3 + Math.PI); W.foes[2].body.x += 30; W.combatLog.length = 0;
  const played = []; const k0 = W.sfx.combat; W.sfx.combat = function (k) { played.push(k); return k0.apply(this, arguments); };
  W.groupPincer(a, b, 0.02); let flashBoth = 0, imp = {}; let n = 0;
  while (n++ < 200) { T(1); if (a.pincerFlash > 0 && b.pincerFlash > 0) flashBoth++; for (const f of [a, b]) if (f.act && f.act.impactT != null && imp[f.name + W.foes.indexOf(f)] == null) imp[f.name + W.foes.indexOf(f)] = f.act.impactT; if (Object.keys(imp).length === 2) break; }
  W.sfx.combat = k0; const t = Object.values(imp);
  return { pinza: L("pincer").length, dt_ms: Math.round(Math.abs(t[0] - t[1]) * 1000), ojos_a_la_vez: flashBoth, sonido: played.includes("pincer") };
});
check("pinza: dos autómatas sincronizados (impactos a ≤ 40 ms) con aviso doble (ojos a la vez y sonido propio)", r.pinza === 1 && r.dt_ms <= 40 && r.ojos_a_la_vez > 5 && r.sonido, r);
await page.evaluate(() => { T(120); });
// 4) MULTI-PARRY: una pulsación desvía los dos; todos perfectos = DOBLE PERFECTO (cámara lenta, desequilibrados, bonus)
const mp = async (n, spread, earlyFirst, tgtIdx) => page.evaluate(([n, spread, earlyFirst, tgtIdx]) => {
  tank(); const pl = W.player, F = W.foes.slice(0, n);
  for (const f of W.foes) { f.respawn(); f.ai.enabled = true; f.ai.passive = true; f.ai.chain = null; f.act = null; f.post = 0; f.hp = f.hpMax = 900; f.ai.resetModel(); }
  W.pf.respawn(); tank(); W.pf.pen = 0; W.hitstop = 0;
  F.forEach((f, k) => { const ang = k * 2 * Math.PI / n + 0.3; f.body.x = pl.x + Math.cos(ang) * 1.9; f.body.z = pl.z + Math.sin(ang) * 1.9; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z); f.body.path = []; f.body.heading = ang + Math.PI; });
  for (const f of W.foes) if (!F.includes(f)) { f.body.x += 40; }
  if (tgtIdx != null) W.setTarget(F[tgtIdx]);
  T(5); W.combatLog.length = 0; W.SLOWMO.acc = 0;
  // golpes con impactos escalonados «spread» s
  const at = W.ct + 1.0; F.forEach((f, k) => f.ai.pincerStrike(at + k * spread));
  let pressed = false, n0 = 0;
  while (n0++ < 300) { const l = Math.min(...F.map((f) => f.toImpact() == null ? 9 : f.toImpact()));
    if (!pressed && l <= earlyFirst) { W.pf.input("guardDown", { ts: performance.now() + (l - earlyFirst) * 1000 }); W.pf.input("guardUp"); pressed = true; }
    T(1); if (L("multiParry").length) break; }
  T(3); const defl = F.filter((f) => f.act && f.act.name === "deflected").length; T(12);
  const m = L("multiParry")[0];
  return { parries: L("parry").filter((x) => x.who === "jugador").map((x) => x.level + ":" + x.early), multi: m && { n: m.n, perfecto: m.perfect }, deflected: defl,
    post: F.map((f) => Math.round(f.post)), slow_ms: Math.round(W.SLOWMO.acc * 1000), rip: W.pf.rip && W.foes.indexOf(W.pf.rip.target), hits: L("hit").length };
}, [n, spread, earlyFirst, tgtIdx]);
r = await mp(2, 0.02, 0.04, 1);
check("multi-parry: una sola pulsación desvía los dos impactos (≤ 150 ms); todos perfectos = DOBLE PERFECTO (cámara lenta, los dos desequilibrados, bonus de postura)",
  r.multi && r.multi.n === 2 && r.multi.perfecto && r.deflected === 2 && r.hits === 0 && r.slow_ms >= 100 && r.post.every((p) => p >= 30), r);
check("el riposte tras el multi-parry va al objetivo fijado", r.rip === 1, { rip: r.rip });
await page.screenshot({ path: `${OUT}/doble_perfecto.png` });
r = await mp(3, 0.012, 0.035, 0);   // (los tres en la ventana de perfecto: ≤ 70 ms desde la pulsación)
check("TRIPLE PERFECTO con tres autómatas", r.multi && r.multi.n === 3 && r.multi.perfecto && r.deflected === 3, r);
r = await mp(2, 0.11, 0.04, 0);
check("impactos a 110 ms: la misma pulsación los desvía a los dos, cada uno con su nivel (perfecto y normal)", r.multi && r.multi.n === 2 && !r.multi.perfecto && r.parries.length === 2 && r.parries[0].startsWith("perfect") && r.parries[1].startsWith("normal"), r);
// 5) impactos separados: un parry por golpe, sin penalización por spam si cada pulsación desvía algo
r = await page.evaluate(() => {
  tank(); const pl = W.player, [a, b] = W.foes;
  for (const f of W.foes) { f.respawn(); f.ai.enabled = true; f.ai.passive = true; f.ai.chain = null; f.act = null; f.ai.resetModel(); }
  W.pf.respawn(); tank(); W.pf.pen = 0;
  [a, b].forEach((f, k) => { const ang = k * Math.PI + 0.3; f.body.x = pl.x + Math.cos(ang) * 1.9; f.body.z = pl.z + Math.sin(ang) * 1.9; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z); f.body.path = []; });
  W.foes[2].body.x += 40; T(5); W.combatLog.length = 0;
  const at = W.ct + 1.0; a.ai.pincerStrike(at); b.ai.pincerStrike(at + 0.4);
  const seen = new Set(); let n = 0, pens = [];
  while (n++ < 300) { for (const f of [a, b]) { const l = f.toImpact(); if (l != null && l <= 0.05 && !seen.has(f)) { seen.add(f); W.pf.input("guardDown", { ts: performance.now() + (l - 0.05) * 1000 }); W.pf.input("guardUp"); pens.push(+W.pf.pen.toFixed(3)); } }
    T(1); if (L("parry").filter((x) => x.who === "jugador").length >= 2) break; }
  return { parries: L("parry").filter((x) => x.who === "jugador").map((x) => x.level), pen: pens, hits: L("hit").length };
});
check("impactos separados (400 ms): un parry por golpe y sin penalización por spam", r.parries.length === 2 && r.pen.every((p) => p === 0) && r.hits === 0, r);
// 6) la guardia cubre 360°: un golpe por la espalda se desvía igual
r = await page.evaluate(() => {
  tank(); const pl = W.player, a = W.foes[0];
  for (const f of W.foes) { f.respawn(); f.ai.enabled = f === a; f.ai.passive = true; f.act = null; f.ai.resetModel(); }
  W.pf.respawn(); tank(); W.pf.pen = 0; pl.heading = 0;
  a.body.x = pl.x - 1.9; a.body.z = pl.z; a.body.y = a.body.ground = W.heightAt(a.body.x, a.body.z); a.body.path = [];
  for (const f of W.foes) if (f !== a) f.body.x += 40; W.clearTarget && W.clearTarget("prueba");
  T(5); W.combatLog.length = 0; a.ai.attack("attack1"); let n = 0, pressed = false, ind = null;
  while (n++ < 300) { const l = a.toImpact(); const el = document.querySelector(".edgeInd[data-foe='0']"); if (el && el.style.display === "block") ind = el.dataset.kind;
    if (!pressed && l != null && l <= 0.05) { W.pf.input("guardDown", { ts: performance.now() + (l - 0.05) * 1000 }); W.pf.input("guardUp"); pressed = true; } T(1); if (L("parry").length || L("hit").length) break; }
  return { res: (L("parry")[0] || L("hit")[0] || {}).ev, nivel: (L("parry")[0] || {}).level, indicador: ind };
});
check("la guardia cubre 360° (golpe por la espalda desviado) y su aviso sale como flecha junto al personaje", r.res === "parry" && r.indicador === "espalda", r);
// 7) indicador en el borde: un autómata fuera de pantalla que prepara un golpe
r = await page.evaluate(() => {
  const pl = W.player, a = W.foes[0]; W.ui.zoom = 4; W.resize(); T(2);
  const th = W.ui.theta, rx = Math.cos(th), rz = -Math.sin(th);
  a.act = null; a.body.x = pl.x + rx * 7; a.body.z = pl.z + rz * 7; a.body.y = a.body.ground = W.heightAt(a.body.x, a.body.z); T(2);
  a.startAttack("attack1", { dir: Math.PI, plan: { wind: 0.5, rel: 0.4 } }); let k = null; for (let i = 0; i < 10; i++) { T(1); const el = document.querySelector(".edgeInd[data-foe='0']"); if (el && el.style.display === "block") k = { kind: el.dataset.kind, tr: el.style.transform }; }
  return k;
});
await page.screenshot({ path: `${OUT}/indicador_borde.png` });
check("ataque fuera de pantalla: flecha en el borde de la pantalla", r && r.kind === "borde", r);
await page.evaluate(() => { W.ui.zoom = 1.6; W.resize(); T(60); });
// 8) grupo con el eco
await page.click("#tbtn"); await page.click("#tGE"); await page.click("#tbtn");
r = await page.evaluate(() => {
  T(5); const tipos = W.foes.map((f) => f.type); tank(); W.skipRender = true;
  for (const f of W.foes) { f.ai.enabled = true; f.ai.state = "chase"; f.ai.cool = 0.2; f.ai.passive = false; }
  let maxAtk = 0; for (let i = 0; i < 60 * 15; i++) { T(1); tank(); const atk = W.foes.filter((f) => f.alive && ((f.act && W.isAtk(f.act)) || (f.ai && f.ai.chain))); maxAtk = Math.max(maxAtk, atk.length); }
  W.skipRender = false; return { tipos, maxAtk };
});
check("2 autómatas + el eco: también como mucho 2 atacando a la vez", r.tipos.filter((t) => t === "automaton").length === 2 && r.tipos.includes("echo") && r.maxAtk <= 2, r);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
