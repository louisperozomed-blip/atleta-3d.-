// Relleno · Etapa 4: grupos en ritmo de metrónomo, token único, grupo de práctica, contador y selector.
// uso: node fodder_e4.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info).slice(0, 900) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html) + "#enemy=fodder");
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => { W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1); window.L = (ev) => W.combatLog.filter((x) => x.ev === ev); });

// 1) #enemy=fodder: grupo de 4 (2 zombis + 2 perros) junto al jugador
let r = await page.evaluate(() => ({ type: W.enemyType, n: W.foes.length, kinds: W.foes.map((f) => f.kind).sort().join(), d: W.foes.map((f) => +Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z).toFixed(1)) }));
check("#enemy=fodder: grupo de práctica de 4 (zombis y perros) junto al jugador", r.type === "fodder" && r.n === 4 && r.kinds === "dog,dog,zombie,zombie" && r.d.every((x) => x > 2.5 && x < 7), r);

// 2) metrónomo: 25 s con un jugador que desvía (normal) cada golpe a ~130 ms → nunca 2 atacando; 700 ms entre turnos
r = await page.evaluate(() => {
  W.combatLog.length = 0; W.FODDER_TOKEN.log.length = 0;
  const p = W.pf; p.hp = p.hpMax = 9999;
  let maxAtk = 0, n = 0; const pressed = new Set(); const orbitD = [];
  const t0 = W.ct;
  while (W.ct - t0 < 25 && n++ < 25 * 60 + 100) {
    let atk = 0;
    for (const f of W.foes) {
      const ph = W.fodderPhase(f);
      if (ph === "windup" || ph === "attack") atk++;
      if (f.alive && f.act && f.act.name === "attack" && !pressed.has(f.act)) { const l = f.toImpact(); if (l != null && l <= 0.13) { p.input("guardDown", { ts: performance.now() + (l - 0.13) * 1000 }); p.input("guardUp"); pressed.add(f.act); } }
      if (f.ai.state === "orbit") orbitD.push(Math.hypot(f.body.x - p.body.x, f.body.z - p.body.z));
    }
    maxAtk = Math.max(maxAtk, atk);
    T(1);
  }
  // huecos: de «free» (fin de RECOVERY/STUN) al siguiente «take» (inicio del WINDUP)
  const lg = W.FODDER_TOKEN.log, gaps = [];
  for (let i = 1; i < lg.length; i++) if (lg[i].ev === "take" && lg[i - 1].ev === "free") gaps.push(Math.round((lg[i].t - lg[i - 1].t) * 1000));
  orbitD.sort((a, b) => a - b);
  const q = (k) => +orbitD[Math.floor(orbitD.length * k)].toFixed(2);
  return { maxAtk, windups: L("fodderWindup").length, stuns: L("fodderStun").length, gaps: gaps.slice(0, 20), gmed: gaps.sort((a, b) => a - b)[gaps.length >> 1],
    orbit: orbitD.length ? { p10: q(0.1), p25: q(0.25), p50: q(0.5), p90: q(0.9) } : null };
});
check("TOKEN ÚNICO: nunca hay 2 enemigos en WINDUP/ATTACK a la vez", r.maxAtk === 1 && r.windups >= 8, r);
check("el siguiente empieza su WINDUP 700 ms después de que el anterior termine RECOVERY/STUN (metrónomo)", r.gaps.length >= 7 && r.gaps.filter((g) => Math.abs(g - 700) <= 34).length >= r.gaps.length * 0.8, r);
// (la cola baja es el que acaba de atacar mientras vuelve andando al corro)
check("los demás rodean a 2-3 baldosas y esperan", r.orbit && r.orbit.p25 >= 1.9 && r.orbit.p50 >= 2.1 && r.orbit.p50 <= 3 && r.orbit.p90 <= 3.4, r.orbit);

// 3) contador en pantalla: parries seguidos, % de PERFECTOS y nivel del anillo
r = await page.evaluate(() => { const el = document.getElementById("fodHud"); return { on: !!el && el.style.display !== "none", txt: el ? el.textContent : "" }; });
check("contador en pantalla: parries seguidos, % de PERFECTOS y nivel del anillo", r.on && /PARRIES SEGUIDOS\s*\d+/.test(r.txt) && /PERFECTOS\s*\d+ %/.test(r.txt) && /ANILLO zombi \d · perro \d/.test(r.txt), r);
await page.evaluate(() => { W.skipRender = false; T(1); });
await page.screenshot({ path: `${OUT}/grupo_practica.png` });
await page.evaluate(() => { W.skipRender = true; });

// 4) el que cae vuelve enseguida (el bucle no se para)
r = await page.evaluate(() => {
  const f = W.foes[0]; f.hp = 0; f.start("death", { kb: 0, kdir: 0, moved: 0 }); let n = 0;
  while (!f.hidden && n++ < 600) T(1); const tHid = W.ct; n = 0;
  while (f.hidden && n++ < 300) T(1);
  return { back: !f.hidden && f.alive, ms: Math.round((W.ct - tHid) * 1000), d: +Math.hypot(f.body.x - W.player.x, f.body.z - W.player.z).toFixed(1), alert: f.ai.state };
});
check("grupo de práctica: el que cae vuelve a ~5 u un segundo después de desvanecerse", r.back && r.ms <= 1100 && r.d > 3.5, r);

// 5) selector del panel: Zombi, Perro zombi y Grupo de práctica; consola W.setEnemyType
r = await page.evaluate(() => {
  const opts = [...document.querySelectorAll("#enemySel option")].map((o) => o.value);
  W.setEnemyType("zombie"); T(2); const z = W.foes.map((f) => f.kind);
  W.setEnemyType("dog"); T(2); const d = W.foes.map((f) => f.kind);
  const btn = !!document.getElementById("tFod");
  document.getElementById("tFod").click(); T(2); const g = { type: W.enemyType, n: W.foes.length };
  W.setEnemyType("automaton"); T(2); const a = { type: W.enemyType, n: W.foes.length, zones: W.foes.map((f) => f.zone).join() };
  return { opts, z, d, btn, g, a };
});
check("selector: «Zombi», «Perro zombi» y «Grupo de práctica»; botón del panel; W.setEnemyType", ["zombie", "dog", "fodder"].every((k) => r.opts.includes(k)) &&
  r.z.every((k) => k === "zombie") && r.d.every((k) => k === "dog") && r.btn && r.g.type === "fodder" && r.g.n === 4 && r.a.type === "automaton" && r.a.n === 3 && r.a.zones === "heart,roots,ruins", r);

// 6) mundo: grupos de 2-4 en el cementerio y las charcas (aparecen al acercarte); el autómata sigue en sus 3 zonas
r = await page.evaluate(() => {
  const out = {};
  for (const [zn, x, z] of [["ruins", -25, 26], ["ponds", 21, 24]]) {
    W.teleport(x, z); T(3);
    out[zn] = W.foes.filter((f) => f.fodder && f.zone === zn).map((f) => f.kind);
  }
  W.teleport(0, -5); T(3);
  out.lejos = W.foes.filter((f) => f.fodder).length;
  out.automatas = W.foes.filter((f) => f.type === "automaton").map((f) => f.zone).join();
  return out;
});
check("mundo: grupos mezclados de 2-4 en el cementerio y en las charcas (al acercarte); el autómata sigue en sus 3 zonas",
  r.ruins.length >= 2 && r.ruins.length <= 4 && r.ponds.length >= 2 && new Set(r.ponds).size === 2 && r.automatas === "heart,roots,ruins", r);

// 7) entrenamiento: ms antes del impacto y nivel
r = await page.evaluate(() => {
  W.setEnemyType("zombie"); W.setTraining("fodder"); W.combatLog.length = 0;
  const f = W.foes[0]; for (const g of W.foes) { g.ai.enabled = false; if (g !== f) { g.body.x = 999; g.body.z = 999; } }
  W.teleport(f.home.x - 1.5, f.home.z); f.body.heading = 0; T(4);
  W.combatLog.length = 0; f.ai.strike(Math.atan2(W.pf.body.z - f.body.z, W.pf.body.x - f.body.x)); let n = 0, done = false;
  while (n++ < 120) { const l = f.toImpact(); if (!done && l != null && l <= 0.12) { W.pf.input("guardDown", { ts: performance.now() + (l - 0.12) * 1000 }); W.pf.input("guardUp"); done = true; } T(1); if (L("parry").length) break; }
  T(2); const txt = W.lastTiming; W.setTraining(""); return { txt };
});
check("modo entrenamiento: ms antes del impacto y el nivel conseguido contra el relleno", /PARRY · 1[12]\d ms antes · nivel [012]/.test(r.txt || ""), r);
r = await page.evaluate(() => ({ miss: W.animMiss || [] }));
check("nunca se pide una animación inexistente", r.miss.length === 0, r);
const ok = results.filter((x) => x.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
