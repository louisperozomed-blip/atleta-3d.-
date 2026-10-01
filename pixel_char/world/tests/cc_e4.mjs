// Combate completo · Etapa 4: combos en datos (L·L·L, L·H, L·L·H, H·L, H·H), búfer de 2 pulsaciones y ritmo.
// Paso fijo; las pulsaciones llevan su marca de tiempo (como un evento real). uso: node cc_e4.mjs <dist> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info).slice(0, 900) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  const A = (window.A = W.foes[0]), B = (window.B = W.foes[1]);
  for (const f of W.foes) f.ai.enabled = false;
  const s = (window.S0 = W.findSpot(-8, 1, null, 2.6));
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  // enemigo a 1,9 u en el ángulo a (rad, en el suelo); B opcional al otro lado
  window.reset = (a, withB) => {
    W.pf.respawn(); W.pf.combo = null; W.pf.beat = null; W.hitstop = 0; W.teleport(s.x, s.z);
    for (const f of W.foes) { f.respawn(); f.act = null; f.hp = f.hpMax = 9000; f.post = 0; f.postMax = 1e5; f.body.x = 999; f.body.z = 999; }
    const put = (f, ang, d) => { f.body.x = s.x + Math.cos(ang) * d; f.body.z = s.z + Math.sin(ang) * d; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z); f.body.path = []; f.body.heading = ang + Math.PI; };
    put(A, a, 1.9); if (withB) put(B, a + Math.PI, 1.7);
    W.player.heading = a; W.setTarget(A); T(10); W.combatLog.length = 0;
  };
  // una secuencia L/H; off = desfase (s) respecto al pulso de cada golpe (null = pulsar en cuanto se pueda)
  window.combo = (seq, off, hold2) => {
    const p = W.pf, out = { presses: [] };
    for (let i = 0; i < seq.length; i++) {
      const k = seq[i];
      if (i > 0) {
        let n = 0;
        if (off == null) { while (!(p.act && p.act.f >= W.hitF(p.act)) && n++ < 200) T(1); }
        else { while (p.beat == null && n++ < 300) T(1); while (W.ct < p.beat + off - 1 / 60 && n++ < 400) T(1); }
      }
      const target = off != null && i > 0 && p.beat != null ? p.beat + off : W.ct;
      W.attackPress("key", performance.now() + (target - W.ct) * 1000, A);
      out.presses.push(+(target).toFixed(3));
      T(k === "H" ? (hold2 ? 76 : 28) : 2);
      W.attackRelease("key");
    }
    let n = 0; while ((p.act || n < 10) && n++ < 400) T(1);
    T(5);
    out.moves = L("move").map((x) => x.seq + ":" + x.anim + (x.rhythm ? ":" + x.rhythm : ""));
    out.hits = L("hit").map((x) => ({ who: x.who === "autómata" ? (x.anim) : x.who, anim: x.anim, dmg: x.dmg }));
    return out;
  };
});
// 1) cada combo en datos: su hoja y su nombre
const C = await page.evaluate(() => {
  const res = {};
  for (const seq of ["LLL", "LH", "LLH", "HL", "HH"]) { reset(0.4); res[seq] = combo(seq, null); res[seq].names = L("move").map((x) => x.name); }
  return res;
});
const base = (m) => m.map((x) => x.split(":").slice(0, 2).join(":")).join();
check("L·L·L = combo básico (attack1 → attack2 → attack3)", base(C.LLL.moves) === "L:attack1,LL:attack2,LLL:attack3" && C.LLL.hits.length === 3, C.LLL);
check("L·H = Quiebraguardia (fuerte tras un ligero)", base(C.LH.moves) === "L:attack1,LH:heavy" && C.LH.names[1] === "Quiebraguardia", C.LH);
check("L·L·H = Remate giratorio (hoja spin)", base(C.LLH.moves) === "L:attack1,LL:attack2,LLH:spin" && C.LLH.names[2] === "Remate giratorio", C.LLH);
check("H·L = Corte de salida (golpe rápido tras un fuerte)", base(C.HL.moves) === "H:heavy,HL:attack2" && C.HL.names[1] === "Corte de salida", C.HL);
check("H·H = Golpe cargado doble", base(C.HH.moves) === "H:heavy,HH:heavy" && C.HH.names[1] === "Golpe cargado doble", C.HH);
// 2) efectos propios de cada combo
const E = await page.evaluate(() => {
  const o = {};
  // Quiebraguardia contra un enemigo que bloquea: le vacía la stamina (rompe la guardia)
  reset(0.4); A.st = A.stMax; const st0 = A.st;
  A.guardHeld = true; A.start("block"); A.act.tt = 0.07;
  combo("LH", null);
  const bl = L("block"), gbq = L("guardbreak");
  o.quiebra = { stamina0: st0, bloqueos: bl.map((x) => x.anim + ":" + x.st), gb: gbq.length, vaciado: bl.length >= 2 ? bl[0].st - bl[1].st : gbq.length ? bl[0].st : 0 };
  // fuerte normal contra la misma guardia (comparación)
  reset(0.4); A.st = A.stMax; A.guardHeld = true; A.start("block"); A.act.tt = 0.07;
  combo("H", null); o.fuerte = { gb: L("guardbreak").length, vaciado: A.stMax - (L("block")[0] || { st: A.stMax }).st };
  // Remate giratorio: alcanza a varios (A delante, B detrás) y su recuperación es larga
  reset(0.4, true); combo("LL", null); let n = 0; const p = W.pf;
  W.attackPress("key", performance.now(), A); T(28); W.attackRelease("key");
  while (!(p.act && p.act.name === "spin") && n++ < 200) T(1);
  while (!(p.act && p.act.impactT != null) && n++ < 400) T(1);
  const ti = p.act.impactT; while (p.act && p.act.name === "spin" && n++ < 600) T(1); const rec = W.ct - ti;
  o.giro = { golpeados: [...new Set(L("hit").filter((x) => x.anim === "spin").map((x) => x.who + (x.hp)))].length, rec_ms: Math.round(rec * 1000) };
  // y la recuperación de un attack2 normal (comparación)
  reset(0.4); W.attackPress("key", performance.now(), A); T(2); W.attackRelease("key"); n = 0; while (!(p.act && p.act.impactT != null) && n++ < 200) T(1); const t2 = p.act.impactT; while (p.act && n++ < 400) T(1); o.giro.rec_ligero_ms = Math.round((W.ct - t2) * 1000);
  // H·H: postura enorme frente al H solo, y más lento
  const postOf = (seq) => { reset(0.4); combo(seq, null); return L("hit").map((x) => x.pg); };
  o.HH = { H: postOf("H"), HH: postOf("HH") };
  return o;
});
check("Quiebraguardia: si el enemigo lo bloquea le vacía mucha stamina (≥ 60 % de la suya, el doble que un fuerte)", (E.quiebra.vaciado >= 0.6 * 120 || E.quiebra.gb === 1) && E.quiebra.vaciado >= 2 * E.fuerte.vaciado, E.quiebra);
check("Remate giratorio: golpe en 360° que alcanza a varios y recuperación larga (castigable)", E.giro.golpeados >= 2 && E.giro.rec_ms > E.giro.rec_ligero_ms * 2.5, E.giro);
check("Golpe cargado doble: el segundo fuerte da una postura enorme", E.HH.HH.length === 2 && E.HH.HH[1] > E.HH.H[0] * 2, E.HH);
// 3) búfer: 3 toques rápidos durante el primer golpe → los 3 golpes salen
const Bf = await page.evaluate(() => {
  reset(0.4);
  for (let i = 0; i < 3; i++) { W.attackPress("key", performance.now(), A); T(2); W.attackRelease("key"); T(4); }
  let n = 0; while ((W.pf.act || n < 10) && n++ < 400) T(1);
  return L("move").map((x) => x.seq);
});
check("búfer de entrada: tres toques seguidos (los 3 durante el primer golpe) no se pierden: L, LL, LLL", Bf.join() === "L,LL,LLL", Bf);
// 4) ritmo: en el pulso = EN RITMO (+20 % daño y postura); fuera, el combo sigue sin bonus
const R = await page.evaluate(() => {
  const r = {};
  for (const [k, off] of [["ritmo", 0], ["tarde", 0.12], ["pronto", -0.1]]) { reset(0.4); const c = combo("LL", off); r[k] = { moves: c.moves, dmg: L("hit").map((x) => x.dmg), pg: L("hit").map((x) => x.pg), err: L("move").map((x) => x.err) }; }
  return r;
});
check("ritmo: pulsar en el pulso = EN RITMO (+20 % daño y postura); fuera del pulso el combo sigue sin bonus",
  R.ritmo.moves[1] === "LL:attack2:ok" && R.tarde.moves[1] === "LL:attack2:fuera" && R.pronto.moves[1] === "LL:attack2:fuera" &&
  Math.abs(R.ritmo.dmg[1] / R.tarde.dmg[1] - 1.2) < 0.02 && Math.abs(R.ritmo.pg[1] / R.tarde.pg[1] - 1.2) < 0.03, R);
// 5) cada combo en las 8 direcciones: aciertan y cada dirección pinta su fila
const D8 = await page.evaluate(() => {
  W.skipRender = true; const out = {};
  for (const seq of ["LLL", "LH", "LLH", "HL", "HH"]) {
    out[seq] = [];
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4; reset(a);
      const dirs = new Set(); const p = W.pf, ch = W.character; const prev = W.onCombatFrame;
      W.onCombatFrame = function (f, act) { if (f === p && W.isAtk(act) && act.f === W.hitF(act)) dirs.add(ch.st.dir); return prev(f, act); };
      const c = combo(seq, null); W.onCombatFrame = prev;
      out[seq].push({ ang: k * 45, hits: c.hits.length, dirs: [...dirs] });
    }
  }
  W.skipRender = false; return out;
});
const ok8 = Object.entries(D8).map(([seq, L8]) => ({ seq, aciertan: L8.every((x) => x.hits === seq.length), filas: new Set(L8.map((x) => x.dirs[x.dirs.length - 1])).size }));
check("cada combo en las 8 direcciones: todos los golpes aciertan y cada dirección usa su fila de la hoja (8 distintas)", ok8.every((x) => x.aciertan && x.filas === 8), ok8);
// capturas: remate giratorio y golpe cargado doble
for (const [seq, n, tag] of [["LLH", 0, "remate_giratorio"], ["HH", 0, "cargado_doble"], ["LH", 0, "quiebraguardia"]]) {
  await page.evaluate(([seq]) => {
    reset(0.4, seq === "LLH"); const p = W.pf;
    const parts = seq.split("");
    window._seq = parts; window._i = 0;
  }, [seq]);
  await page.evaluate(([seq]) => {
    const p = W.pf; const ks = seq.split("");
    for (let i = 0; i < ks.length; i++) {
      if (i > 0) { let n = 0; while (!(p.act && p.act.f >= W.hitF(p.act)) && n++ < 200) T(1); }
      W.attackPress("key", performance.now(), A); T(ks[i] === "H" ? 28 : 2); W.attackRelease("key");
    }
    let n = 0; const last = { LLH: "spin", HH: "heavy", LH: "heavy" }[seq];
    while (!(p.act && p.act.comboSeq === seq && p.act.f >= W.hitF(p.act)) && n++ < 300) T(1);
  }, [seq]);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  await page.evaluate(() => T(90));
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors, D8 }, null, 1));
await browser.close();
