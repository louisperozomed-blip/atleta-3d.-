// Pruebas de interfaz del duelo en ESCRITORIO (teclado y ratón) y MÓVIL (toques reales por CDP):
// marca de tiempo de la pulsación de guardia, golpe retrasado manteniendo, finta, panel (entrenar, latencia,
// calibrar), barras de postura centrales sin tapar los controles y sin scroll horizontal. Capturas en <carpeta>.
// uso: node parry2_ui.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); }

async function open(opts) {
  const page = await browser.newPage(opts);
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.goto("file://" + path.resolve(html));
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => {
    W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
    window.E = () => W.foe;
    window.pair = (a, d) => { const e = E(), p = W.pf; for (const f of W.foes) { f.ai.enabled = false; } p.respawn(); W.respawnAll(); W.hitstop = 0;
      e.body.x = e.home.x; e.body.z = e.home.z; e.body.y = e.body.ground = W.heightAt(e.home.x, e.home.z);
      W.teleport(e.home.x + Math.cos(a) * d, e.home.z + Math.sin(a) * d); W.player.heading = a + Math.PI; e.body.heading = a; if (W.setTarget) W.setTarget(e); T(8); W.combatLog.length = 0; };   // (objetivo fijado: tocarlo ataca)
    // registro de la marca de tiempo de cada pulsación de guardia (para comprobar que se usa)
    // (en el momento en que llega al juego: lo que tardó desde el evento, incluido arrancar el audio la 1.ª vez)
    window.GT = []; const inp = W.pf.input.bind(W.pf);
    W.pf.input = (type, data) => { if (type === "guardDown" && data && data.ts != null) GT.push({ ts: data.ts, now: performance.now(), ct: W.ct }); return inp(type, data); };
    // lanza su golpe y avanza hasta que falten L s para el impacto
    window.toLead = (L) => { const e = E(); e.startAttack("attack1", { dir: e.body.heading }); let n = 0; while (e.toImpact() > L && n < 300) { T(); n++; } return e.toImpact(); };
    window.finish = () => { const e = E(); let n = 0; while (e.act && e.act.name === "attack1" && !e.act.hitDone && n < 120) { T(); n++; } T(3); const p = W.combatLog.filter((x) => x.ev === "parry").pop(); return p ? p.level + ":" + p.early : W.combatLog.filter((x) => ["hit", "block"].includes(x.ev)).map((x) => x.ev).join("|"); };
  });
  return page;
}
const layout = (page) => page.evaluate(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, over = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const dE = R(document.getElementById("duelE")), dP = R(document.getElementById("duelP")), g = R(document.getElementById("guard")), bar = R(document.querySelector(".bar"));
  const btns = [...document.querySelectorAll(".bar button")].map(R), hudL = R(document.getElementById("cbars")), tb = R(document.getElementById("tbtn"));
  const title = [...document.querySelectorAll(".hud .t, .hud .s")].map(R);                 // título y zona (arriba a la izquierda)
  return { solapa: over(dP, g) || btns.some((b) => over(dP, b)) || over(dE, dP) || over(dE, hudL) || over(dE, tb) || title.some((t) => over(dE, t)), dentro: dE[0] >= 0 && dP[0] >= 0 && dE[2] <= innerWidth && dP[2] <= innerWidth,
    duelE: dE.map(Math.round),
    scrollX: document.documentElement.scrollWidth - innerWidth, duelP: dP.map(Math.round), guardia: g.map(Math.round), barra: bar.map(Math.round) };
});

for (const prof of ["escritorio", "movil"]) {
  const mob = prof === "movil";
  const page = await open(mob ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } });
  const cdp = mob ? await page.context().newCDPSession(page) : null;
  const touch = async (x, y, hold) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    if (hold) await hold();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const guardXY = await page.evaluate(() => { const r = document.getElementById("guard").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const foeXY = async () => page.evaluate(() => { const e = E(); return W.toScreen(e.body.x, e.body.y + e.ch.height * 0.5, e.body.z); });
  const pressGuard = async () => { if (mob) await touch(guardXY[0], guardXY[1]); else { await page.keyboard.down("k"); await page.keyboard.up("k"); } };

  // 1) la pulsación de guardia cuenta desde su marca de tiempo (aunque llegue tarde al juego)
  const pr = [];
  for (const L of [0.04, 0.13]) {
    await page.evaluate(() => { pair(0.6, 2.0); GT.length = 0; });
    const left = await page.evaluate((L) => toLead(L), L);
    await pressGuard();
    await page.waitForFunction(() => GT.length > 0 && W.pf.act && W.pf.act.name === "parry", null, { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate((left) => { const g = GT[0]; const lagMs = g ? g.now - g.ts : null; return { left: Math.round(left * 1000), lag: lagMs != null ? Math.round(lagMs) : null, res: finish() }; }, left);
    r.esperado = r.lag != null ? Math.round(r.left + Math.min(120, r.lag)) : null;
    pr.push(r);
  }
  check(`[${prof}] guardia (${mob ? "toque en GUARDIA" : "tecla K"}): parry medido desde la marca de tiempo del evento (antelación = lo que faltaba + el retraso del evento)`,
    pr.every((r) => /^(perfect|normal):/.test(r.res) && Math.abs(+r.res.split(":")[1] - r.esperado) <= 4), pr);

  // 2) golpe retrasado manteniendo (dedo sobre el enemigo / J) y 3) finta (guardia durante tu preparación)
  await page.evaluate(() => pair(0.6, 1.9));
  const [fx, fy] = await foeXY();
  const t0 = await page.evaluate(() => W.ct);
  if (mob) await touch(fx, fy, async () => { await page.waitForTimeout(400); await page.evaluate(() => T(36)); });
  else { await page.keyboard.down("j"); await page.evaluate(() => T(36)); await page.keyboard.up("j"); }
  const hold = await page.evaluate((t0) => { const p = W.pf; let n = 0; while (!(p.act && p.act.impactT != null) && n < 120) { T(); n++; } const a = p.act; return { anim: a && a.name, retenido_ms: Math.round((a && a.heldT || 0) * 1000), impacto_ms: a && a.impactT != null ? Math.round((a.impactT - t0) * 1000) : null }; }, t0);
  check(`[${prof}] golpe retrasado ${mob ? "manteniendo el dedo sobre el enemigo" : "manteniendo J"}: la carga se retiene y el impacto llega más tarde`, hold.anim === "attack1" && hold.retenido_ms >= 250 && hold.impacto_ms >= 450, hold);
  await page.evaluate(() => { T(40); pair(0.6, 1.9); });
  const [gx, gy] = await foeXY();
  if (mob) await touch(gx, gy); else { await page.keyboard.down("j"); await page.keyboard.up("j"); }
  await page.waitForFunction(() => W.pf.act && W.pf.act.name === "attack1", null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => T(4));
  await pressGuard();
  await page.waitForFunction(() => W.combatLog.some((x) => x.ev === "feint"), null, { timeout: 5000 }).catch(() => {});
  const ft = await page.evaluate(() => ({ finta: W.combatLog.some((x) => x.ev === "feint" && x.who === "jugador"), act: W.pf.act && W.pf.act.name }));
  check(`[${prof}] finta: ${mob ? "tocar GUARDIA" : "K"} durante la preparación de tu golpe lo cancela y pasa a guardia`, ft.finta && ft.act === "parry", ft);

  // 4) duelo en pantalla: barras centrales sin tapar controles, sin scroll horizontal
  await page.evaluate(() => { pair(Math.PI * 0.75, 2.0); const e = E(); e.post = 55; W.pf.post = 30; e.ai.enabled = true; e.ai.state = "chase"; e.ai.cool = 0.1; e.ai.forced = "rrl"; e.ai.noTricks = true; let n = 0;
    while (n < 400 && !(e.act && e.act.plan && e.act.plan.released)) { T(); n++; } T(6); e.ai.forced = null; e.ai.noTricks = false; });
  const lay = await layout(page);
  await page.screenshot({ path: `${OUT}/ui_${prof}_duelo.png` });
  check(`[${prof}] barras de postura centrales visibles sin tapar GUARDIA ni la barra de botones, sin scroll horizontal`, !lay.solapa && lay.dentro && lay.scrollX <= 0, lay);

  // 5) panel: entrenar, latencia, calibrar (cabe en pantalla)
  await page.evaluate(() => { T(1); });
  if (mob) { const b = await page.evaluate(() => { const r = document.getElementById("tbtn").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await touch(b[0], b[1]); }
  else await page.click("#tbtn");
  await page.waitForFunction(() => !document.getElementById("tpanel").hidden, null, { timeout: 5000 }).catch(() => {});
  await page.selectOption("#trainSel", "dos+delay");
  await page.evaluate(() => T(30));
  const pan = await page.evaluate(() => { const r = document.getElementById("tpanel").getBoundingClientRect(); return { abierto: !document.getElementById("tpanel").hidden, cabe: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, entrenando: W.TRAINING.on && W.TRAINING.id, latencia: !!document.getElementById("dCalib"), lectura: document.getElementById("tInfo").innerText.split("\n")[0] }; });
  await page.screenshot({ path: `${OUT}/ui_${prof}_panel.png` });
  if (mob) { const b = await page.evaluate(() => { const r = document.getElementById("tCalib").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await touch(b[0], b[1]); }
  else await page.click("#tCalib");
  await page.waitForFunction(() => !document.getElementById("calibBox").hidden, null, { timeout: 5000 }).catch(() => {});
  const cal = await page.evaluate(() => { const r = document.getElementById("calibBox").getBoundingClientRect(); return { visible: !document.getElementById("calibBox").hidden, cabe: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  await page.screenshot({ path: `${OUT}/ui_${prof}_calibrar.png` });
  check(`[${prof}] panel ⚙: entrenar (cadena retrasada), latencia y prueba de ritmo, todo dentro de la pantalla`, pan.abierto && pan.cabe && pan.entrenando === "dos+delay" && pan.latencia && cal.visible && cal.cabe, { ...pan, calibrar: cal });
  await page.evaluate(() => { document.getElementById("calibBox").hidden = true; W.setTraining(""); });
  await page.close();
}

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results_ui.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
