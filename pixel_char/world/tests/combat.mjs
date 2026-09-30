// Pruebas de combate (Playwright + Chromium, WebGL por SwiftShader).
// uso: node combat.mjs <dist/index.html> <carpeta de salida>
//
// Simulación determinista a paso fijo (W.manual + W.tick(1/60)); para ir rápido, W.skipRender simula sin
// pintar y solo se pinta en las capturas. El eco se controla a mano (IA apagada) salvo en la prueba de IA.
// Comprueba, en las 8 direcciones (el eco colocado a 1.3 u del jugador cada 45°):
//   combo completo · parry en ventana · parry fuera de ventana (pronto = golpe, justo fuera = bloqueo) ·
//   spam de parry (la ventana se encoge y se recupera) · bloqueo hasta romper la guardia · esquiva con
//   invulnerabilidad (a tiempo = sin daño, tarde = golpe) · cancelaciones · muerte y reaparición ·
//   la dirección del sprite en cada acción · controles (teclado, clic, guardia, deslizar) · IA del eco.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); }

async function open(opts) {
  const page = await browser.newPage(opts);
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.goto("file://" + path.resolve(html) + (process.env.HASH || ""));
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => {
    W.manual = true;
    window.T = (n) => W.tick(1 / 60, n || 1);
    const e = W.foe, p = W.pf;
    // arena: el claro del eco; el jugador en el centro y el eco a d u en el ángulo a (mundo)
    window.C = { x: e.home.x, z: e.home.z };
    window.pair = (a, d) => {
      d = d || 1.3;
      e.ai.enabled = false; e.ai.warnT = -1;
      p.respawn(); e.respawn(); W.hitstop = 0;
      W.teleport(C.x, C.z);
      e.body.x = C.x + Math.cos(a) * d; e.body.z = C.z + Math.sin(a) * d; e.body.y = e.body.ground = W.heightAt(e.body.x, e.body.z);
      p.body.heading = a; e.body.heading = a + Math.PI;
      W.skipRender = true; T(12); W.combatLog.length = 0;
    };
    // tiempo real que falta para el impacto del ataque en curso del eco (s)
    window.left = () => { const a = e.act; if (!a || !a.name.startsWith("attack")) return null; const ms = W.CMETA.animations[a.name].ms;
      return ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.f < 3 ? (a.slow || 1) : 1); };
    // el eco ataca; fn(left) se llama en cada tick hasta el impacto
    window.foeAttack = (name, fn) => {
      if (name === "attack3") e.startAttack("attack3", { dir: e.body.heading }); else e.input("attack", { dir: e.body.heading });
      let n = 0; while (e.act && e.act.f < 3 && n < 300) { if (fn) fn(left()); T(); n++; }
      T(2); return n;
    };
    window.evs = () => W.combatLog.filter((x) => x.ev !== "swing" && x.ev !== "warn").map((x) => x.ev);
  });
  return page;
}
const shot = async (page, name) => { await page.evaluate(() => { W.skipRender = false; T(1); }); await page.screenshot({ path: `${OUT}/${name}.png` }); await page.evaluate(() => { W.skipRender = true; }); };
const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * Math.PI / 4);

let page = await open({ viewport: { width: 900, height: 700 } });
// ---------------------------------------------------------------- combo completo (8 direcciones)
let ok8 = 0; const comboInfo = [];
for (const a of DIRS) {
  const r = await page.evaluate((a) => {
    pair(a, 1.5); const p = W.pf, e = W.foe, seq = [];
    p.input("attack", { dir: a }); T(18); p.input("attack", { dir: a }); T(18); p.input("attack", { dir: a });
    for (let i = 0; i < 70; i++) { T(); if (p.act) seq.push(p.act.name); }
    const hits = W.combatLog.filter((x) => x.ev === "hit").map((x) => x.anim);
    // dirección del sprite al golpear = la del rumbo
    return { hits, ehp: e.hp, dirOk: true };
  }, a);
  const good = r.hits.join() === "attack1,attack2,attack3" && r.ehp === 120 - 44;
  if (good) ok8++;
  comboInfo.push(r.hits.length);
}
check("combo attack1→2→3 acierta en las 8 direcciones (10+12+22)", ok8 === 8, { ok: ok8, golpes: comboInfo });
// dirección del sprite durante el ataque en las 8 direcciones
const dirs = await page.evaluate((DIRS) => DIRS.map((a) => { pair(a, 1.5); W.pf.input("attack", { dir: a }); T(10); const ch = W.character;
  return [ch.st.dir, ch.dirFromHeading(W.player.heading, W.ui.thetaT)]; }), DIRS);
check("el sprite mira hacia el golpe en las 8 direcciones", dirs.every((d) => d[0] === d[1]) && new Set(dirs.map((d) => d[0])).size === 8, dirs.map((d) => d[0]));
// capturas del combo (dirección del claro hacia la cámara)
await page.evaluate(() => { pair(Math.PI * 0.75, 1.5); W.pf.input("attack", { dir: Math.PI * 0.75 }); });
for (const [k, n] of [["a1", 14], ["a1b", 2], ["a2", 18], ["a3", 30]]) {
  if (k === "a2") await page.evaluate(() => W.pf.input("attack", { dir: Math.PI * 0.75 }));
  if (k === "a3") await page.evaluate(() => { W.pf.input("attack", { dir: Math.PI * 0.75 }); });
  await page.evaluate((n) => T(n), n);
  await shot(page, "combo_" + k);
}
// ---------------------------------------------------------------- parry en ventana / fuera / parcial (8 dir)
let pin = 0, pout = 0, ppart = 0; const pinfo = [];
for (const a of DIRS) {
  const r = await page.evaluate((a) => {
    const out = {};
    const tryLead = (lead) => { pair(a, 1.3); let done = false;
      foeAttack("attack1", (l) => { if (!done && l != null && l <= lead) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } });
      return { ev: evs(), hp: W.pf.hp, post: Math.round(W.foe.post) }; };
    out.in = tryLead(0.12); out.early = tryLead(0.48); out.partial = tryLead(0.27);
    return out;
  }, a);
  if (r.in.ev[0] === "parry" && r.in.hp === 100 && r.in.post === 38) pin++;
  if (r.early.ev[0] === "hit" && r.early.hp < 100) pout++;
  if (r.partial.ev[0] === "block") ppart++;
  pinfo.push([r.in.ev[0], r.early.ev[0], r.partial.ev[0]]);
}
check("parry en ventana (120 ms antes): sin daño y +38 de postura al eco, 8 direcciones", pin === 8, { ok: pin });
check("guardia demasiado pronto (480 ms antes): recibe el golpe, 8 direcciones", pout === 8, { ok: pout });
check("parry justo fuera de ventana (270 ms antes): cuenta como bloqueo, 8 direcciones", ppart === 8, { ok: ppart, detalle: pinfo });
// captura del parry en el instante del destello
await page.evaluate(() => { pair(Math.PI * 0.75, 1.3); let done = false; const e = W.foe;
  e.input("attack", { dir: e.body.heading }); let n = 0;
  while (!W.combatLog.some((x) => x.ev === "parry") && n < 200) { const l = left(); if (!done && l != null && l <= 0.12) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } T(); n++; } });
await shot(page, "parry");
await page.evaluate(() => T(3)); await shot(page, "parry_b");
// ---------------------------------------------------------------- spam de parry
const spam = await page.evaluate(() => {
  pair(0, 1.3); const p = W.pf, e = W.foe; let win = [];
  // 5 pulsaciones seguidas (cada 90 ms) y la última a 120 ms del impacto
  let presses = 0, last = -1;
  foeAttack("attack1", (l) => { if (l == null) return; const t = p.time; if (presses < 4 && (last < 0 || t - last > 0.085)) { p.input("guardDown"); p.input("guardUp"); presses++; last = t; }
    else if (presses === 4 && l <= 0.12) { p.input("guardDown"); p.input("guardUp"); presses++; win.push(+p.parryWindow().toFixed(3)); } });
  const r1 = { ev: evs(), win: win[0] };
  // descanso de 2 s: la penalización se recupera y el parry vuelve a funcionar
  T(120); W.combatLog.length = 0; p.act = null; e.act = null;
  let done = false; foeAttack("attack1", (l) => { if (!done && l != null && l <= 0.12) { p.input("guardDown"); p.input("guardUp"); done = true; } });
  return { spam: r1, after: evs(), winAfter: +p.parryWindow().toFixed(3) };
});
check("spam de parry: la ventana se encoge (< 200 ms) y el parry falla", spam.spam.win < 0.2 && spam.spam.ev[0] !== "parry", spam.spam);
check("la penalización se recupera sola: tras 2 s el parry vuelve a salir", spam.after[0] === "parry", { ev: spam.after, ventana: spam.winAfter });
// ---------------------------------------------------------------- bloqueo hasta romper la guardia (8 dir)
let gbOk = 0; const gbInfo = [];
for (const a of DIRS) {
  const r = await page.evaluate((a) => {
    pair(a, 1.3); const p = W.pf, e = W.foe; p.input("guardDown"); T(20); const seq = [];
    for (let i = 0; i < 10 && p.alive; i++) { e.act = null; foeAttack("attack1"); const last = W.combatLog.filter((x) => x.ev !== "swing" && x.ev !== "warn").pop(); seq.push(last ? last.ev : "-"); if (last && last.ev === "guardbreak") break; T(40); }
    p.input("guardUp"); T(30);
    return { seq, hp: Math.round(p.hp), st: Math.round(p.st) };
  }, a);
  const i = r.seq.indexOf("guardbreak");
  if (i >= 3 && r.seq.slice(0, i).every((x) => x === "block")) gbOk++;
  gbInfo.push(r.seq.length);
}
check("bloqueo mantenido: bloquea gastando stamina hasta que la guardia se rompe, 8 direcciones", gbOk === 8, { ok: gbOk, golpesHastaRomper: gbInfo });
await page.evaluate(() => { pair(Math.PI * 0.75, 1.3); W.pf.input("guardDown"); T(20); W.foe.input("attack", { dir: W.foe.body.heading }); let n = 0; while (!W.combatLog.some((x) => x.ev === "block") && n < 200) { T(); n++; } });
await shot(page, "block");
await page.evaluate(() => { const p = W.pf, e = W.foe; p.st = 5; T(30); e.act = null; e.input("attack", { dir: e.body.heading }); let n = 0; while (!W.combatLog.some((x) => x.ev === "guardbreak") && n < 200) { T(); n++; } });
await shot(page, "guardbreak");
await page.evaluate(() => { W.pf.input("guardUp"); T(60); });
// ---------------------------------------------------------------- esquiva: invulnerabilidad (8 dir)
let dOk = 0, dIf = 0, dLate = 0; const dInfo = [];
for (const a of DIRS) {
  const r = await page.evaluate((a) => {
    const run = (lead, side) => { pair(a, 1.3); let done = false;
      foeAttack("attack1", (l) => { if (!done && l != null && l <= lead) { W.pf.input("dodge", { dir: a + side }); done = true; } });
      return { ev: evs(), hp: W.pf.hp, moved: +Math.hypot(W.player.x - C.x, W.player.z - C.z).toFixed(2) }; };
    // de lado: sale del alcance (el golpe no le llega); hacia el eco: sigue dentro del alcance y es la
    // invulnerabilidad de los frames DASH la que evita el daño
    return { side: run(0.15, Math.PI / 2), through: run(0.12, 0), late: run(0.01, Math.PI / 2) };
  }, a);
  if (["evade", "whiff"].includes(r.side.ev[0]) && r.side.hp === 100) dOk++;
  if (r.through.ev[0] === "evade" && r.through.hp === 100) dIf++;
  if (r.late.ev[0] === "hit") dLate++;
  dInfo.push([r.side.ev[0], r.through.ev[0], r.late.ev[0]]);
}
check("esquiva lateral a tiempo (150 ms antes): sale del alcance, sin daño, 8 direcciones", dOk === 8, { ok: dOk });
check("esquiva a través del golpe (120 ms antes, dentro del alcance): invulnerable en DASH, 8 direcciones", dIf === 8, { ok: dIf });
check("esquiva tarde (10 ms antes, aún sin DASH): recibe el golpe, 8 direcciones", dLate === 8, { ok: dLate, detalle: dInfo });
await page.evaluate(() => { pair(Math.PI * 0.75, 1.3); let done = false; const e = W.foe; e.input("attack", { dir: e.body.heading }); let n = 0;
  while (!W.combatLog.some((x) => x.ev === "evade") && n < 200) { const l = left(); if (!done && l != null && l <= 0.15) { W.pf.input("dodge", { dir: Math.PI * 0.25 }); done = true; } T(); n++; } });
await shot(page, "dodge");
// ---------------------------------------------------------------- cancelaciones
const canc = await page.evaluate(() => {
  const p = W.pf, out = {};
  // attack1 → esquiva después del impacto: sí
  pair(0, 1.5); p.input("attack", { dir: 0 }); let n = 0; while (!(p.act && p.act.f === 4) && n < 100) { T(); n++; }
  p.input("dodge", { dir: Math.PI }); T(); out.afterImpact = p.act && p.act.name;
  // attack1 → esquiva antes del impacto: no (queda en el búfer 180 ms y se descarta)
  T(60); pair(0, 1.5); p.input("attack", { dir: 0 }); T(4); p.input("dodge", { dir: Math.PI }); T(); out.beforeImpact = p.act && p.act.name;
  T(60);
  // parry → contraataque en READY (frame 5)
  pair(0, 1.5); p.input("guardDown"); p.input("guardUp"); n = 0; while (!(p.act && p.act.f >= 4) && n < 100) { T(); n++; }
  p.input("attack", { dir: 0 }); T(); out.parryToAttack = p.act && p.act.name;
  T(60);
  // encadenar sin pulsar a tiempo: no hay combo (pulsación tras RECOVERY = attack1 nuevo)
  pair(0, 1.5); p.input("attack", { dir: 0 }); n = 0; while (p.act && n < 200) { T(); n++; } p.input("attack", { dir: 0 }); T(); out.lateCombo = p.act && p.act.name;
  // esquiva → ataque en su último frame
  T(60); pair(0, 1.5); p.input("dodge", { dir: Math.PI }); n = 0; while (!(p.act && p.act.f === 5) && n < 100) { T(); n++; } p.input("attack", { dir: 0 }); T(); out.dodgeToAttack = p.act && p.act.name;
  return out;
});
check("cancelación: attack1 → esquiva después del IMPACT", canc.afterImpact === "dodge", canc);
check("sin cancelación antes del IMPACT (el ataque sigue)", canc.beforeImpact === "attack1");
check("parry → contraataque en READY", canc.parryToAttack === "attack1");
check("fuera de la ventana de encadenado no hay combo (vuelve a attack1)", canc.lateCombo === "attack1");
check("esquiva → ataque en su último frame", canc.dodgeToAttack === "attack1");
// ---------------------------------------------------------------- aturdido, remate, muerte y reaparición
const st = await page.evaluate(() => {
  pair(Math.PI * 0.75, 1.3); const p = W.pf, e = W.foe; let k = 0;
  while (!e.stunned && k < 6) { e.act = null; let done = false; foeAttack("attack1", (l) => { if (!done && l != null && l <= 0.12) { p.input("guardDown"); p.input("guardUp"); done = true; } }); T(30); k++; }
  return { stun: e.stunned, parries: k, post: Math.round(e.post) };
});
check("tres parries llenan la postura del eco: aturdido", st.stun && st.parries === 3, st);
await shot(page, "stun");
const db = await page.evaluate(() => { const p = W.pf, e = W.foe; p.act = null; p.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); let n = 0;
  while (!W.combatLog.some((x) => x.ev === "deathblow") && n < 60) { T(); n++; } const d = W.combatLog.find((x) => x.ev === "deathblow"); return d ? d.dmg : null; });
check("golpe al eco aturdido = remate (daño ×3, mínimo 40)", db >= 40, { dmg: db });
await shot(page, "deathblow");
const death = await page.evaluate(() => { const e = W.foe, p = W.pf; T(60); e.hp = 5; e.act = null; p.act = null; p.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); T(120);
  return { alive: e.alive, act: e.act && e.act.name + e.act.f, btn: document.getElementById("respawn").classList.contains("hot") }; });
check("muerte del eco: death hasta el último frame y botón REAPARECER encendido", !death.alive && death.act === "death5" && death.btn, death);
await shot(page, "death_foe");
await page.evaluate(() => { W.skipRender = false; });
await page.click("#respawn");
const resp = await page.evaluate(() => { W.skipRender = true; T(5); const e = W.foe; return { alive: e.alive, hp: e.hp, home: +Math.hypot(e.body.x - e.home.x, e.body.z - e.home.z).toFixed(2), btn: document.getElementById("respawn").classList.contains("hot") }; });
check("REAPARECER devuelve al eco a su claro con la vida llena", resp.alive && resp.hp === 120 && resp.home < 0.01 && !resp.btn, resp);
const pd = await page.evaluate(() => { pair(0, 1.3); const p = W.pf, e = W.foe; p.hp = 5; foeAttack("attack3"); T(90); return { alive: p.alive, act: p.act && p.act.name + p.act.f, btn: document.getElementById("respawn").classList.contains("hot"), canMove: W.player.doJump() }; });
check("muerte del jugador: death y REAPARECER encendido", !pd.alive && pd.act === "death5" && pd.btn, pd);
await shot(page, "death_player");
await page.evaluate(() => { W.skipRender = false; });
await page.click("#respawn");
const pr = await page.evaluate(() => { T(3); return { alive: W.pf.alive, hp: W.pf.hp }; });
check("REAPARECER devuelve la vida al jugador", pr.alive && pr.hp === 100, pr);
// ---------------------------------------------------------------- IA del eco
const ai = await page.evaluate(() => {
  const e = W.foe, p = W.pf; e.respawn(e.home.x, e.home.z); p.respawn(); e.ai.enabled = true; e.ai.state = "dormant";
  W.teleport(e.home.x - 7, e.home.z); T(30); const dormant = e.ai.state;
  W.player.path = [{ x: e.home.x - 3.2, z: e.home.z }]; W.combatLog.length = 0;
  let n = 0; while (n < 600 && W.combatLog.filter((x) => x.ev === "hit" || x.ev === "block" || x.ev === "parry").length < 2) { T(); n++; }
  const log = W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev + ":" + (x.anim || ""));
  // cada golpe del eco va precedido de su aviso
  let warned = true; for (let i = 0; i < log.length; i++) if (log[i].startsWith("hit:")) warned = warned && log.slice(0, i).some((x) => x === "warn:" + log[i].slice(4));
  return { dormant, state: e.ai.state, ticks: n, log, warned };
});
check("IA: dormido lejos, despierta al acercarse, persigue y ataca con aviso antes de cada golpe", ai.dormant === "dormant" && ai.log.some((x) => x.startsWith("hit:")) && ai.warned, ai);
await page.evaluate(() => { W.pf.respawn(); const n0 = W.combatLog.length; let i = 0; while (i < 400 && !W.combatLog.slice(n0).some((x) => x.ev === "warn")) { T(); i++; } T(2); });
await shot(page, "warn");
await page.close();

// ---------------------------------------------------------------- controles: escritorio (teclado y ratón)
page = await open({ viewport: { width: 900, height: 700 } });
await page.evaluate(() => { pair(0, 1.4); W.skipRender = false; });
for (let i = 0; i < 3; i++) { await page.keyboard.press("KeyJ"); await page.evaluate(() => T(18)); }
const kb = await page.evaluate(() => { T(40); return W.combatLog.filter((x) => x.ev === "hit").map((x) => x.anim); });
check("teclado: J J J encadena el combo", kb.join() === "attack1,attack2,attack3", kb);
await page.keyboard.down("KeyK"); await page.evaluate(() => T(2)); await page.keyboard.up("KeyK");
const kt = await page.evaluate(() => W.pf.act && W.pf.act.name); await page.evaluate(() => T(40));
await page.keyboard.down("KeyK"); const kh = await page.evaluate(() => { T(25); return W.pf.act && W.pf.act.name; }); await page.keyboard.up("KeyK"); await page.evaluate(() => T(30));
check("teclado: K tocada = parry, mantenida = bloqueo", kt === "parry" && kh === "block", [kt, kh]);
await page.keyboard.down("KeyD"); await page.keyboard.press("Space"); const sp = await page.evaluate(() => W.pf.act && W.pf.act.name); await page.keyboard.up("KeyD"); await page.evaluate(() => T(40));
await page.keyboard.press("KeyL"); const jl = await page.evaluate(() => { T(4); return !!W.player.jump; }); await page.evaluate(() => T(60));
check("teclado: Espacio esquiva y L salta", sp === "dodge" && jl, [sp, jl]);
const wasd = await page.evaluate(() => { W.teleport(C.x, C.z); T(5); return [W.player.x, W.player.z]; });
await page.keyboard.down("KeyA"); await page.evaluate(() => T(50)); await page.keyboard.up("KeyA");
const wmove = await page.evaluate((p0) => { const a = W.toScreen(p0[0], W.player.y, p0[1]), b = W.toScreen(W.player.x, W.player.y, W.player.z); return [Math.round(b[0] - a[0]), Math.round(b[1] - a[1])]; }, wasd);
check("teclado: A mueve a la izquierda de la pantalla", wmove[0] < -20 && Math.abs(wmove[1]) < Math.abs(wmove[0]), wmove);
await page.evaluate(() => { pair(0, 1.6); W.skipRender = false; T(2); });
const fp = await page.evaluate(() => { const b = W.foe.body; return W.toScreen(b.x, b.y + 0.8, b.z); });
await page.mouse.click(fp[0], fp[1]);
const cl = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return [a, W.combatLog.filter((x) => x.ev === "hit").length]; });
check("ratón: clic sobre el eco = ataque que acierta", cl[0] === "attack1" && cl[1] === 1, cl);
const gb = await page.locator("#guard").boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down(); await page.evaluate(() => T(2)); await page.mouse.up();
const gt = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(40); return a; });
await page.mouse.down(); const gh = await page.evaluate(() => { T(25); return W.pf.act && W.pf.act.name; }); await page.mouse.up();
check("botón GUARDIA: tocar = parry, mantener = bloqueo", gt === "parry" && gh === "block", [gt, gh]);
await page.close();
// ---------------------------------------------------------------- controles: móvil (toques y deslizamientos)
page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.context().newCDPSession(page);
await page.evaluate(() => { W.teleport(C.x, C.z); W.foe.ai.enabled = false; W.skipRender = false; T(10); });
const c = await page.evaluate(() => W.toScreen(W.player.x, W.player.y + 0.5, W.player.z));
// los eventos de cada gesto juntos (con SwiftShader, sueltos se procesan con segundos de retraso)
const gesture = (pts) => Promise.all([
  cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] }),
  ...pts.slice(1).map((q) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: q[0], y: q[1] }] })),
  cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })]);
const sw = [];
for (const [dx, dy] of [[90, 0], [0, -90], [-90, 0], [0, 90], [64, 64], [-64, -64], [64, -64], [-64, 64]]) {
  await page.evaluate(() => { W.teleport(C.x, C.z); T(10); W.pf.act = null; });
  const p0 = await page.evaluate(() => [W.player.x, W.player.z]);
  await gesture([[c[0], c[1]], [c[0] + dx / 2, c[1] + dy / 2], [c[0] + dx, c[1] + dy]]);
  await page.waitForTimeout(80);
  const r = await page.evaluate((p0) => { const a = W.pf.act && W.pf.act.name; T(40);
    const s0 = W.toScreen(p0[0], W.player.y, p0[1]), s1 = W.toScreen(W.player.x, W.player.y, W.player.z); return { a, m: [Math.round(s1[0] - s0[0]), Math.round(s1[1] - s0[1])] }; }, p0);
  // el desplazamiento en pantalla va en la dirección del deslizamiento
  const cos = (r.m[0] * dx + r.m[1] * dy) / (Math.hypot(...r.m) * Math.hypot(dx, dy) || 1);
  sw.push({ dir: [dx, dy], act: r.a, move: r.m, cos: +cos.toFixed(2) });
}
check("móvil: deslizar esquiva hacia allí en las 8 direcciones", sw.every((s) => s.act === "dodge" && s.cos > 0.8), sw);
await page.evaluate(() => { pair(0, 1.6); W.skipRender = false; T(2); });
const tp = await page.evaluate(() => { const b = W.foe.body; return W.toScreen(b.x, b.y + 0.8, b.z); });
await gesture([[tp[0], tp[1]]]); await page.waitForTimeout(80);
const t1 = await page.evaluate(() => { const a = W.pf.act && W.pf.act.name; T(16); return a; });
await gesture([[tp[0], tp[1]]]); await page.waitForTimeout(80); await page.evaluate(() => T(18));
await gesture([[tp[0], tp[1]]]); await page.waitForTimeout(80);
const tc = await page.evaluate(() => { T(60); return W.combatLog.filter((x) => x.ev === "hit").map((x) => x.anim); });
check("móvil: tocar al eco ataca y los toques seguidos encadenan el combo", t1 === "attack1" && tc.join() === "attack1,attack2,attack3", { primero: t1, golpes: tc });
await page.screenshot({ path: `${OUT}/movil.png` });
await page.close();

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
