// Pruebas del Autómata del bosque (Playwright + Chromium, WebGL por SwiftShader).
// uso: node enemy.mjs <dist/index.html> <carpeta de salida>
// Simulación determinista (W.manual + W.tick(1/60)); W.skipRender simula sin pintar (se pinta en las capturas).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); }
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  window.E = () => W.foe;
  // el autómata 0 (junto al titán) en su claro, el jugador a d u en el ángulo a; los demás, quietos
  window.pair = (a, d) => {
    const e = E(), p = W.pf; d = d || 2.1;
    for (const f of W.foes) { f.ai.enabled = f === e; if (f !== e) { f.respawn(f.home.x, f.home.z); } }
    p.respawn(); W.respawnAll(); W.hitstop = 0; e.ai.pending = null; e.ai.hold = 0;
    e.body.x = e.home.x; e.body.z = e.home.z; e.body.y = e.body.ground = W.heightAt(e.home.x, e.home.z);
    W.teleport(e.home.x + Math.cos(a) * d, e.home.z + Math.sin(a) * d);
    W.player.heading = a + Math.PI; e.body.heading = a; e.ai.state = "chase"; e.ai.cool = 99;
    W.skipRender = true; T(6); W.combatLog.length = 0;
  };
  window.evs = () => W.combatLog.filter((x) => x.ev !== "swing" && x.ev !== "warn").map((x) => x.ev);
  // el autómata ataca; fn(left) en cada tick hasta su impacto
  window.foeAttack = (name, fn) => {
    const e = E(); e.ai.attack(name, e.body.heading);
    let n = 0; while (e.act && e.act.name === name && e.act.f < 3 && n < 400) {
      const a = e.act, ms = e.M().animations[name].ms;
      const left = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.f < 3 ? (a.slow || 1) : 1);
      if (fn) fn(left, n); T(); n++;
    }
    T(3); return n;
  };
  window.parryAt = (lead) => { let done = false; return (l) => { if (!done && l <= lead) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } }; };
});
const shot = async (name) => { await page.evaluate(() => { W.skipRender = false; T(1); }); await page.screenshot({ path: `${OUT}/${name}.png` }); await page.evaluate(() => { W.skipRender = true; }); };
const A8 = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * Math.PI / 4);

// ---- aparición --------------------------------------------------------------------------------------
const sp = await page.evaluate(() => ({ type: W.enemyType, zones: W.foes.map((f) => f.zone), labels: W.foes.map((f) => f.label),
  d0: +Math.hypot(W.foe.body.x - W.player.x, W.foe.body.z - W.player.z).toFixed(1), ratio: +(W.foe.ch.height / W.CHAR_H).toFixed(2), states: W.foes.map((f) => f.ai.state) }));
check("por defecto el Autómata, en 3 zonas (titán, raíces, ruinas), patrullando", sp.type === "automaton" && sp.zones.join() === "heart,roots,ruins" && sp.states.every((s) => s === "patrol"), sp);
// altura en pantalla frente al personaje
const hr = await page.evaluate(() => { pair(Math.PI * 0.75, 2.4); W.skipRender = false; T(2);
  const a = (ch) => { const r = ch.mesh; return r.scale.y; }; return +(a(W.foe.ch) * (W.foe.ch.meta.standing_height_px / W.foe.ch.meta.frame_size[1]) / (a(W.character) * (W.character.meta.standing_height_px / W.character.meta.frame_size[1]))).toFixed(2); });
check("altura del autómata = 1.4 × la del personaje (de pie, en el mundo)", Math.abs(hr - 1.4) < 0.03, { ratio: hr });
await shot("00_tamano");

// ---- persecución con A* --------------------------------------------------------------------------
const ch = await page.evaluate(() => {
  const e = E(); for (const f of W.foes) f.ai.enabled = f === e;
  e.respawn(e.home.x, e.home.z); e.ai.state = "patrol"; e.ai.cool = 1.2;
  W.teleport(e.home.x + 7.5, e.home.z - 2); W.skipRender = true; T(30);
  const anims = new Set(), states = []; let dmin = 99, n = 0, d0 = Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z);
  W.player.path = [{ x: e.home.x + 5.5, z: e.home.z - 1 }];
  while (n < 900) { T(); n++; anims.add(e.ch.st.anim); const d = Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z); dmin = Math.min(dmin, d);
    if (n % 60 === 0) states.push(e.ai.state); if (W.combatLog.some((x) => x.ev === "warn")) break; }
  return { d0: +d0.toFixed(1), dmin: +dmin.toFixed(1), anims: [...anims], states, t: +(n / 60).toFixed(1), attacked: W.combatLog.some((x) => x.ev === "warn") };
});
check("persecución: al ver al jugador se acerca corriendo por A* y ataca", ch.states.includes("chase") && ch.anims.includes("run") && ch.dmin <= 2.6 && ch.attacked, ch);
await shot("01_persecucion");

// ---- ataques con aviso ------------------------------------------------------------------------------
const warn = await page.evaluate(() => {
  const r = {};
  for (const name of ["attack1", "attack2"]) {
    pair(0, 2.0); let eyeMax = 0, prep = 0;
    const n = foeAttack(name, () => { eyeMax = Math.max(eyeMax, E().ch.uniforms.uEyeK.value); prep++; });
    const L = W.combatLog.map((x) => x.ev + ":" + (x.anim || ""));
    r[name] = { warnFirst: L[0] === "warn:" + name, prepS: +(prep / 60).toFixed(2), eyeMax: +eyeMax.toFixed(1), hit: L.includes("hit:" + name) };
  }
  return r;
});
check("cada ataque va precedido de aviso (log + ojo que parpadea > 3× su brillo) y preparación larga (≥ 0.6 s)",
  ["attack1", "attack2"].every((k) => warn[k].warnFirst && warn[k].eyeMax >= 3 && warn[k].prepS >= 0.6 && warn[k].hit), warn);
await page.evaluate(() => { pair(Math.PI * 0.75, 2.0); E().ai.attack("attack2", E().body.heading); T(20); });
await shot("02_aviso");
await page.evaluate(() => T(60));

// ---- parry del jugador contra sus ataques, 8 direcciones --------------------------------------------
const pr = await page.evaluate((A8) => A8.map((a) => { pair(a, 2.0); const e = E(); const p0 = e.post;
  foeAttack(a % (Math.PI / 2) === 0 ? "attack1" : "attack2", parryAt(0.1));
  return { ev: evs()[0], hp: W.pf.hp, post: Math.round(e.post - p0), dir: [W.foe.ch.st.dir, W.foe.ch.dirFromHeading(W.foe.body.heading, W.ui.thetaT)] }; }), A8);
check("parry del jugador a 100 ms del impacto: sin daño y +40/+50 de postura, 8 direcciones", pr.every((r) => r.ev === "parry" && r.hp === 100 && r.post >= 40), pr.map((r) => [r.ev, r.post]));
check("el autómata mira al jugador al atacar en las 8 direcciones", pr.every((r) => r.dir[0] === r.dir[1]) && new Set(pr.map((r) => r.dir[0])).size === 8, pr.map((r) => r.dir[0]));
const late = await page.evaluate((A8) => A8.map((a) => { pair(a, 2.0); foeAttack("attack1", parryAt(0.55)); return evs()[0]; }), A8);
check("guardia demasiado pronto contra el autómata (550 ms antes): recibe el golpe, 8 direcciones", late.every((x) => x === "hit"), late);
await page.evaluate(() => { pair(Math.PI * 0.75, 2.0); const e = E(); e.ai.attack("attack1", e.body.heading); let done = false, n = 0;
  while (!W.combatLog.some((x) => x.ev === "parry") && n < 300) { const a = e.act; if (a && a.f < 3) { const ms = e.M().animations.attack1.ms; const l = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * a.slow; if (!done && l <= 0.1) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } } T(); n++; } });
await shot("03_parry_jugador");

// ---- el jugador golpea en las 8 direcciones ------------------------------------------------------------
const ph = await page.evaluate((A8) => { const D = W.ENEMY_DIFF, keep = [D.parry, D.block]; D.parry = 0; D.block = 0;
  const r = A8.map((a) => { pair(a, 2.2); W.pf.input("attack", { dir: a + Math.PI }); T(40); return evs().filter((x) => x !== "foeDodge")[0]; });
  D.parry = keep[0]; D.block = keep[1]; return r; }, A8);
check("los golpes del jugador alcanzan al autómata desde las 8 direcciones", ph.every((x) => x === "hit"), ph);

// ---- su bloqueo y su parry ---------------------------------------------------------------------------
const def = await page.evaluate(() => { const D = W.ENEMY_DIFF, keep = [D.parry, D.block], p = W.pf, r = {};
  D.parry = 0; D.block = 1; pair(0, 2.1); p.input("attack", { dir: Math.PI }); T(50); r.block = evs();
  let st0 = E().st; for (let i = 0; i < 14 && !W.combatLog.some((x) => x.ev === "guardbreak"); i++) { T(40); p.input("attack", { dir: Math.PI }); T(50); }
  r.blockSeq = evs(); r.st = Math.round(E().st);
  D.parry = 1; D.block = 0; pair(0, 2.1); const post0 = p.post; p.input("attack", { dir: Math.PI }); T(60); r.parry = evs(); r.playerPost = Math.round(p.post - post0);
  // repetición: con parry al 30 %, repetir attack1 sube la probabilidad
  D.parry = 0.3; D.block = 0; let tries = 0; const seq = [];
  for (let k = 0; k < 3; k++) { pair(0, 2.1); for (let i = 0; i < 6; i++) { p.act = null; p.input("attack", { dir: Math.PI }); T(55); } seq.push(W.combatLog.filter((x) => x.ev === "foeParryTry").map((x) => x.rep)); }
  r.parryReps = seq.flat();
  D.parry = keep[0]; D.block = keep[1]; return r; });
check("su bloqueo: bloquea el golpe del jugador", def.block.includes("foeBlock") && def.block.includes("block"), def.block);
check("su bloqueo gasta su stamina hasta que se le rompe la guardia", def.blockSeq.includes("guardbreak"), { seq: def.blockSeq.join(","), st: def.st });
check("su parry: desvía el golpe y el jugador pierde postura", def.parry.includes("parry") && def.playerPost >= 38, { ev: def.parry, postura: def.playerPost });
check("su parry sale más cuanto más se repite el mismo ataque", def.parryReps.length > 0 && Math.max(...def.parryReps) >= 2, { repeticiones_en_sus_parries: def.parryReps });
await page.evaluate(() => { const D = W.ENEMY_DIFF, k = D.parry; D.parry = 1; pair(Math.PI * 0.75, 2.1); W.skipRender = false; W.pf.input("attack", { dir: Math.PI * 1.75 });
  let n = 0; while (!W.combatLog.some((x) => x.ev === "parry") && n < 90) { T(); n++; } D.parry = k; });
await shot("04_su_parry");
await page.evaluate(() => { W.skipRender = true; T(60); });

// ---- aturdimiento por postura y remate ------------------------------------------------------------------
const st = await page.evaluate(() => { pair(0, 2.0); const e = E(); let k = 0;
  while (!e.stunned && k < 5) { foeAttack(k % 2 ? "attack2" : "attack1", parryAt(0.1)); T(30); k++; }
  const r = { stunned: e.stunned, parries: k, post: Math.round(e.post), dur: e.stunTime };
  T(20); W.pf.act = null; W.pf.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) });
  let n = 0; while (!W.combatLog.some((x) => x.ev === "deathblow") && n < 80) { T(); n++; }
  const d = W.combatLog.find((x) => x.ev === "deathblow"); r.deathblow = d ? d.dmg : null; return r; });
check("sus ataques desviados le llenan la postura: aturdido en 2-3 parries", st.stunned && st.parries <= 3, st);
check("remate al autómata aturdido (daño ×3, mínimo 40)", st.deathblow >= 40, { dmg: st.deathblow });
await page.evaluate(() => { pair(Math.PI * 0.75, 2.0); const e = E(); for (let k = 0; k < 3 && !e.stunned; k++) { foeAttack("attack2", parryAt(0.1)); T(20); } T(10); });
await shot("05_aturdido");

// ---- muerte: se queda en el suelo, se desvanece con esporas; reaparecer ------------------------------------
const dd = await page.evaluate(() => { pair(0, 2.0); const e = E(); e.hp = 5; W.pf.input("attack", { dir: Math.PI }); T(100);
  const r = { alive: e.alive, act: e.act && e.act.name + e.act.f, btn: document.getElementById("respawn").classList.contains("hot") };
  const dust0 = W.__dust || 0; T(60 * 2.5); r.fadeMid = +e.fade.toFixed(2); T(60 * 3); r.fadeEnd = +e.fade.toFixed(2); r.hidden = !!e.hidden; r.spores = (W.__dust || 0) - dust0;
  return r; });
check("muerte: death hasta el último frame y REAPARECER encendido", !dd.alive && dd.act === "death5" && dd.btn, dd);
check("a los pocos segundos se desvanece con esporas que se levantan", dd.fadeMid < 1 && dd.fadeEnd === 0 && dd.hidden && dd.spores >= 10, { fade: [dd.fadeMid, dd.fadeEnd], esporas: dd.spores });
await page.evaluate(() => { const D = W.ENEMY_DIFF, k = [D.parry, D.block]; D.parry = 0; D.block = 0; pair(Math.PI * 0.75, 2.0); const e = E(); e.hp = 5; const r0 = e.ai.react; e.ai.react = () => {}; W.pf.input("attack", { dir: Math.PI * 1.75 }); T(60 * 4.3); e.ai.react = r0; D.parry = k[0]; D.block = k[1]; });
await shot("06_desvanece");
await page.evaluate(() => { W.skipRender = false; });
await page.click("#respawn");
const rs = await page.evaluate(() => { T(3); const e = E(); return { alive: e.alive, hp: e.hp, hidden: !!e.hidden, fade: e.fade }; });
check("REAPARECER lo devuelve a su sitio con toda la vida", rs.alive && rs.hp === 260 && !rs.hidden && rs.fade === 1, rs);

// ---- pasos pesados ---------------------------------------------------------------------------------------
const steps = await page.evaluate(() => { const e = E(); for (const f of W.foes) f.ai.enabled = f === e; e.respawn(e.home.x, e.home.z);
  W.teleport(e.home.x + 6, e.home.z); e.ai.state = "chase"; e.ai.cool = 99; W.skipRender = true; const s0 = e.steps || 0; let shake = 0; const v = new THREE.Vector3();
  const f0 = W.player.hgt; for (let i = 0; i < 180; i++) { T(); } return { steps: (e.steps || 0) - s0 }; });
check("pisadas pesadas: cada paso del autómata levanta polvo y esporas (y hace temblar la cámara cerca)", steps.steps >= 4, steps);

// ---- cambio al eco desde el panel ---------------------------------------------------------------------
await page.evaluate(() => { W.skipRender = false; T(1); });
await page.click("#tbtn");
await page.selectOption("#enemySel", "echo");
const ec = await page.evaluate(() => { T(5); return { type: W.enemyType, n: W.foes.length, label: W.foe.label, fighters: W.fighters.length, echoTint: W.foe.ch.uniforms.uEcho.value }; });
check("panel de pruebas: cambiar al eco", ec.type === "echo" && ec.n === 1 && ec.label === "ECO" && ec.echoTint === 1 && ec.fighters === 2, ec);
await page.screenshot({ path: `${OUT}/07_panel_eco.png` });
const eb = await page.evaluate(() => { const e = W.foe; e.ai.enabled = false; W.teleport(e.home.x - 1.3, e.home.z); W.player.heading = 0; e.body.heading = Math.PI; T(6); W.combatLog.length = 0;
  e.input("attack", { dir: Math.PI }); let n = 0, done = false;
  while (!(e.act && e.act.f >= 3) && n < 300) { const a = e.act; if (a) { const ms = e.M().animations[a.name].ms; const l = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.f < 3 ? (a.slow || 1) : 1); if (!done && l <= 0.12) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } } T(); n++; }
  T(3); return W.combatLog.filter((x) => x.ev !== "swing" && x.ev !== "warn").map((x) => x.ev); });
check("el eco sigue funcionando igual (su ataque se desvía con parry)", eb[0] === "parry", eb);
await page.selectOption("#enemySel", "automaton");
const back = await page.evaluate(() => { T(5); return { type: W.enemyType, n: W.foes.length, fighters: W.fighters.length }; });
check("y volver al autómata", back.type === "automaton" && back.n === 3 && back.fighters === 4, back);

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
