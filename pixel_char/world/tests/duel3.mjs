// Pruebas de la mejora del duelo (Duelo 3): recompensa del parry perfecto, riposte con ritmo, deathblow,
// reacciones del enemigo, counter, intercambio de desvíos, choque, cadenas que se ramifican y sensación.
// uso: node duel3.mjs <dist/index.html> <carpeta de salida>      (STAGES=1,2,3 para elegir etapas)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
const STAGES = (process.env.STAGES || "1,2,3,4,5").split(",").map(Number);
let window_fair = null;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); }
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await page.goto("file://" + path.resolve(html) + (process.env.HASH || ""));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n, dt) => W.tick(dt || 1 / 60, n || 1);
  window.E = () => W.foe;
  // el autómata 0 en su claro, el jugador a d u en el ángulo a; los demás, quietos; la IA no ataca sola
  window.pair = (a, d) => {
    const e = E(), p = W.pf; d = d || 2.0;
    for (const f of W.foes) { f.ai.enabled = false; if (f !== e) f.respawn(f.home.x, f.home.z); }
    p.respawn(); W.respawnAll(); W.hitstop = 0; W.COMBAT.calib = 0;
    e.body.x = e.home.x; e.body.z = e.home.z; e.body.y = e.body.ground = W.heightAt(e.home.x, e.home.z);
    W.teleport(e.home.x + Math.cos(a) * d, e.home.z + Math.sin(a) * d);
    W.player.heading = a + Math.PI; e.body.heading = a;
    W.skipRender = true; T(6); W.combatLog.length = 0;
  };
  window.evs = () => W.combatLog.filter((x) => x.ev !== "swing" && x.ev !== "warn").map((x) => x.ev);
  window.lastOf = (ev) => { for (let i = W.combatLog.length - 1; i >= 0; i--) if (W.combatLog[i].ev === ev) return W.combatLog[i]; return null; };
  // el autómata lanza un ataque (sin la IA); fn(left) en cada paso hasta su impacto (left = s hasta el impacto)
  window.foeAttack = (name, fn, dt) => {
    const e = E(); e.startAttack(name, { dir: e.body.heading });
    let n = 0;
    while (e.act && e.act.name === name && !e.act.hitDone && n < 600) { const l = e.toImpact(); if (fn) fn(l == null ? 0 : l, n); T(1, dt); n++; }
    T(3, dt); return n;
  };
  // pulsa guardia (y suelta) exactamente L s antes del impacto: la marca de tiempo coloca la pulsación entre pasos
  window.pressAt = (L, hold) => { let done = false; return (l) => { if (!done && l <= L) { W.pf.input("guardDown", { ts: performance.now() + (l - L) * 1000 }); if (!hold) W.pf.input("guardUp"); done = true; } }; };
  // BOT de duelo: ve la SUELTA de cada golpe (destello del ojo) y responde con reacción humana (react ± jit s):
  // golpe normal → guardia (parry); barrido → salta (y contraataca en el aire); estocada → esquiva hacia él;
  // agarre → esquiva de lado. mode "memory": pulsa a la hora "de siempre" contando desde el aviso (sin mirar la suelta)
  let bs = 12345; const brand = () => ((bs = (bs * 16807) % 2147483647) / 2147483647);
  const gauss = () => { let u = 0, v = 0; while (!u) u = brand(); while (!v) v = brand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  window.Bot = {
    on: false, react: 0.25, jit: 0, mode: "react", seen: null, seenWarn: null, pending: null, out: [], airAttack: true,
    reset(o) { Object.assign(this, { on: true, seen: null, seenWarn: null, pending: null, out: [], answer: null, mode: "react", jit: 0 }, o || {});
      // semilla mezclada (las semillas pequeñas seguidas daban un primer número ~0 → error extremo) y descarte inicial
      bs = (((o && o.seed) || 12345) * 2654435761) % 2147483646 + 1; for (let i = 0; i < 8; i++) brand(); },
    step() {
      if (!this.on) return;
      const e = E(), a = e.act, p = W.pf;
      if (this.mode === "memory" && a && a.plan && a !== this.seenWarn) {
        // de memoria: impacto supuesto = aviso + carga + suelta (sin retención), pulsa 0.11 s antes
        this.seenWarn = a; const P = a.plan, startCt = W.ct - P.t / (a.speed || 1);
        this.pending = { at: startCt + P.wind + P.rel - 0.11, move: a.move, act: a };
      }
      if (this.mode === "react" && a && a.plan && a.plan.released && a !== this.seen) {
        this.seen = a; const P = a.plan, relCt = W.ct - (P.t - P.wind - P.hold) / (a.speed || 1);
        const err = this.jit ? Math.max(-3, Math.min(3, gauss())) * this.jit : 0;
        this.pending = { at: relCt + this.react + err, move: a.move, act: a, err };
      }
      if (this.pending && W.ct >= this.pending.at - 1e-9) { const q = this.pending; this.pending = null; this.respond(q); }
      // contraataque en el aire tras saltar el barrido
      if (this.airAttack && p.airCounterT > W.ct && W.player.jump && W.player.jump.h > 0.2 * W.CHAR_H) p.input("attack", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) });
    },
    respond(q) {
      const e = E(), b = W.player, toE = Math.atan2(e.body.z - b.z, e.body.x - b.x), mv = q.move;
      const kind = this.answer ? this.answer[mv] || this.answer.all : null;
      const act = kind || (mv === "sweep" ? "jump" : mv === "thrust" ? "dodgeToward" : mv === "grab" ? "dodgeSide" : "parry");
      if (act === "jump") b.doJump();
      else if (act === "dodgeToward") W.pf.input("dodge", { dir: toE });
      else if (act === "dodgeSide") W.pf.input("dodge", { dir: toE + Math.PI / 2 });
      else if (act === "dodgeBack") W.pf.input("dodge", { dir: toE + Math.PI });
      else if (act === "block") { W.pf.input("guardDown"); setTimeout(() => {}, 0); this.holdUntil = W.ct + 0.8; }
      else { W.pf.input("guardDown", { ts: performance.now() + (q.at - W.ct) * 1000 }); W.pf.input("guardUp"); }
      this.out.push({ move: mv, act, err: q.err });
    },
  };
  // simulación con el bot: n pasos
  window.TB = (n) => { for (let i = 0; i < (n || 1); i++) { Bot.step(); if (Bot.holdUntil && W.ct > Bot.holdUntil) { W.pf.input("guardUp"); Bot.holdUntil = 0; } T(); } };
  // pelea con la IA de cadenas: el autómata 0 ataca solo; el jugador no muere
  window.duel = (a, d, o) => { pair(a, d || 2.0); const e = E(); e.ai.enabled = true; e.ai.passive = false; e.ai.state = "chase"; e.ai.cool = 0.2; e.ai.vent = 0; e.ai.forced = (o && o.chain) || null; e.ai.forcedTrick = (o && o.trick) || null; e.ai.noTricks = !!(o && o.noTricks);
    const p = W.pf; p.hpMax = p.hp = 1e6; W.combatLog.length = 0; };
});
const shot = async (name) => { await page.evaluate(() => { W.skipRender = false; T(1); }); await page.screenshot({ path: `${OUT}/${name}.png` }); await page.evaluate(() => { W.skipRender = true; }); };

// ---- ayudantes del duelo -------------------------------------------------------------------------------
await page.evaluate(() => {
  const toE = () => Math.atan2(E().body.z - W.player.z, E().body.x - W.player.x);
  // pulsa ataque como si el evento hubiera llegado en el instante `at` (reloj de combate)
  window.atkAt = (at) => W.pf.input("attack", { dir: toE(), ts: performance.now() + (at - W.ct) * 1000 });
  // parry perfecto (40 ms antes del impacto) a un zarpazo suelto
  window.perfectParry = (an, L) => { pair(0.6, 2.0); E().ai.enabled = false; foeAttack(an || "attack1", pressAt(L == null ? 0.04 : L)); return lastOf("parry"); };
  // riposte guiado: 1.ª pulsación d1 s tras el parry; 2.ª d2 s tras el impacto del 1.º; 3.ª en el ritmo ideal + e3
  // (e3 = null: no pulsa la 3.ª). Devuelve lo que pasó
  window.ripRun = (o) => {
    o = Object.assign({ d1: 0.25, d2: 0.2, e3: 0, n: 3, steps: 150, after: 0 }, o || {});
    const p = W.pf, e = E(), t0 = W.ct, imp = {};
    let k = 0, next = t0 + o.d1;
    for (let s = 0; s < o.steps; s++) {
      const a = p.act;
      if (a && a.name === "riposte" && a.impactT != null && imp[a.ripN] == null) imp[a.ripN] = a.impactT;
      if (k === 0 && W.ct >= next) { atkAt(next); k = 1; }
      else if (k === 1 && o.n >= 2 && imp[1] != null) { next = imp[1] + o.d2; k = 2; }
      else if (k === 2 && W.ct >= next) { atkAt(next); k = 3; }
      else if (k === 3 && o.n >= 3 && o.e3 != null && p.rip && p.rip.beat != null) { next = p.rip.beat + o.e3; k = 4; }
      else if (k === 3 && o.n >= 3 && o.e3 != null && o.early && p.act && p.act.ripN === 2 && p.act.f < 3) { atkAt(W.ct); k = 5; }
      else if (k === 4 && W.ct >= next) { atkAt(next); k = 5; }
      if (o.onStep) o.onStep();
      if (o.stop && o.stop()) break;
      T(1);
    }
    const L = W.combatLog;
    return { rip: L.filter((x) => x.ev === "riposte").map((x) => ({ n: x.n, dmg: x.dmg, post: x.post, sheet: x.sheet })), beat: lastOf("ripBeat"),
      defl: !!lastOf("ripDeflected"), db: !!lastOf("deathblow"), dbStart: lastOf("deathblowStart"), foe: e.act ? e.act.name : null, me: p.act ? p.act.name : null, imp,
      stops: L.filter((x) => x.ev === "riposte").map((x) => x.stop) };
  };
});

// =====================================================================================================
// ETAPA 1 · recompensa del parry perfecto
// =====================================================================================================
if (STAGES.includes(1)) {
  const sh = await page.evaluate(() => {
    const r = {};
    for (const [f, n] of [[W.pf, "riposte"], [W.pf, "deathblow"], [E(), "deflected"], [E(), "counter"]]) r[n] = W.duelSheet(f, n).sheet;
    for (const k in W.DUEL.sheets) W.DUEL.sheets[k] = "sustituto";
    for (const [f, n] of [[W.pf, "riposte"], [W.pf, "deathblow"], [E(), "deflected"], [E(), "counter"]]) { const s = W.duelSheet(f, n); r[n + "_sust"] = s.sheet + (s.speed !== 1 ? "×" + s.speed : ""); }
    for (const k in W.DUEL.sheets) W.DUEL.sheets[k] = "auto";
    return r;
  });
  check("hojas nuevas en uso (riposte, deathblow, deflected, counter) y sustitutos configurables (W.DUEL.sheets = \"sustituto\")",
    sh.riposte === "riposte" && sh.deathblow === "deathblow" && sh.deflected === "deflected" && sh.counter === "counter" &&
    sh.riposte_sust === "attack1×1.4" && sh.deathblow_sust === "attack3" && sh.deflected_sust.startsWith("hit") && sh.counter_sust === "attack1×1.35", sh);

  // desequilibrado ~0,7 s tras el parry perfecto
  const df = await page.evaluate(() => {
    const out = {};
    for (const mode of ["auto", "sustituto"]) {
      W.DUEL.sheets.deflected = mode;
      const pr = perfectParry("attack1"), e = E(); let t = 0, lean = 0, sheet = e.act && e.act.sheet;
      const ct0 = e.act && e.act.ct0;
      while (e.act && e.act.name === "deflected" && t < 300) { lean = Math.max(lean, Math.abs(e.act.bounceLean || 0)); T(1); t++; }
      out[mode] = { level: pr && pr.level, sheet, dur: +((W.ct - ct0)).toFixed(2), rebote: +lean.toFixed(3) };
    }
    W.DUEL.sheets.deflected = "auto";
    const pr = perfectParry("attack2"); out.attack2 = { level: pr && pr.level, act: E().act && E().act.name };
    perfectParry("attack1", 0.14); out.normal = { act: E().act && E().act.name, rip: W.pf.rip && W.pf.rip.max };
    return out;
  });
  check("parry perfecto → DESEQUILIBRADO ~0,7 s (hoja deflected; sin hoja, frames de hit + rebote por código)",
    df.auto.level === "perfect" && df.auto.sheet === "deflected" && Math.abs(df.auto.dur - 0.7) < 0.1 && df.sustituto.sheet === "hit" && Math.abs(df.sustituto.dur - 0.7) < 0.1 && df.sustituto.rebote > 0.03 && df.attack2.act === "deflected" && df.normal.act === "hit", df);

  // riposte completo con buen ritmo
  const full = await page.evaluate(() => { perfectParry(); const e = E(); const hp0 = e.hp; const r = ripRun({}); r.dhp = hp0 - e.hp; return r; });
  check("riposte: 3 golpes con buen ritmo (hoja riposte), daño, postura, hitstop y sacudida crecientes; desde postura 0 no la rompe (no es un premio automático)",
    !full.db && full.rip.length === 3 && full.rip.every((x, i) => x.n === i + 1 && x.sheet === "riposte") && full.rip[0].dmg < full.rip[1].dmg && full.rip[1].dmg < full.rip[2].dmg &&
    full.stops[0] < full.stops[1] && full.stops[1] < full.stops[2] && full.beat && full.beat.ok && !full.defl, full);
  // 3.er golpe fuera de ritmo
  const bad = await page.evaluate(() => {
    const o = {};
    for (const [k, e3] of [["tarde", 0.16], ["pronto", -0.14], ["justo", 0.05], ["justo-", -0.06]]) { perfectParry(); const r = ripRun({ e3 }); o[k] = { golpes: r.rip.length, desviado: r.defl, err: r.beat && r.beat.err, yo: r.me }; }
    perfectParry(); const r = ripRun({ e3: 0, early: true }); o.machaca = { golpes: r.rip.length, desviado: r.defl, err: r.beat && r.beat.err };
    return o;
  });
  check("3.er golpe fuera de la ventana de ritmo (pronto, tarde o machacando): se recupera y lo desvía; dentro (±80 ms) entra",
    bad.tarde.golpes === 2 && bad.tarde.desviado && bad.pronto.golpes === 2 && bad.pronto.desviado && bad.machaca.desviado && bad.justo.golpes === 3 && bad["justo-"].golpes === 3, bad);
  // parry normal: ventana corta y 1 golpe
  const nor = await page.evaluate(() => {
    const o = {};
    perfectParry("attack1", 0.14); let r = ripRun({ d1: 0.2, n: 2 }); o.dos = r.rip.length;
    perfectParry("attack1", 0.14); r = ripRun({ d1: 0.5, n: 1 }); o.tarde = r.rip.length;
    perfectParry("attack1", 0.04); r = ripRun({ d1: 0.5, n: 1 }); o.perfectoTarde = r.rip.length;
    o.win = W.DUEL.ripWin;
    return o;
  });
  check("parry normal: un solo golpe de riposte y ventana más corta (0,32 s frente a 0,7 s)", nor.dos === 1 && nor.tarde === 0 && nor.perfectoTarde === 1, nor);
  // sustituto del riposte: attack1 ×1,4 con estela naranja
  const fb = await page.evaluate(() => {
    W.DUEL.sheets.riposte = "sustituto"; perfectParry(); let trail = false, sheet = null, sp = null;
    const p = W.pf; const t0 = W.ct; atkAt(W.ct + 0.01);
    for (let i = 0; i < 40; i++) { if (p.act && p.act.name === "riposte") { sheet = p.act.sheet; sp = p.act.speed; trail = trail || !!p.act.trail; } T(1); }
    const r = ripRun({ d1: 0, n: 1, steps: 30 });
    W.DUEL.sheets.riposte = "auto";
    perfectParry(); const r3 = (() => { W.DUEL.sheets.riposte = "sustituto"; const x = ripRun({}); W.DUEL.sheets.riposte = "auto"; return x; })();
    return { sheet, sp, trail, golpes3: r3.rip.length, hoja: r3.rip.map((x) => x.sheet) };
  });
  check("sin hoja: riposte = attack1 ×1,4 con estela naranja, y también encadena 3", fb.sheet === "attack1" && fb.sp === 1.4 && fb.trail && fb.golpes3 === 3, fb);
  // postura rota durante el riposte → deathblow directo
  const db = await page.evaluate(() => {
    const o = {};
    for (const mode of ["auto", "sustituto"]) {
      W.DUEL.sheets.deathblow = mode;
      perfectParry(); const e = E(); e.post = 75; const hp0 = e.hp;
      let zoom = 0, flash = 0; const p = W.pf; let sheet = null;
      const r = ripRun({ onStep() { zoom = Math.max(zoom, W.duelZoom()); if (p.act && p.act.name === "deathblow") sheet = p.act.sheet; const fe = document.getElementById("dflash"); if (fe) flash = Math.max(flash, +fe.style.opacity); } });
      o[mode] = { golpes: W.combatLog.filter((x) => x.ev === "riposte").length, deathblow: !!lastOf("deathblow"), sheet, zoom: +zoom.toFixed(3), flash: +flash.toFixed(2), dano: Math.round(hp0 - e.hp) };
    }
    W.DUEL.sheets.deathblow = "auto";
    return o;
  });
  check("postura rota durante el riposte → DEATHBLOW directo (hoja deathblow; sin hoja, attack3) con cámara más cerca y destello",
    db.auto.deathblow && db.auto.sheet === "deathblow" && db.auto.zoom > 0.08 && db.auto.flash > 0.3 && db.auto.golpes < 3 &&
    db.sustituto.deathblow && db.sustituto.sheet === "attack3", db);
  await page.evaluate(() => { perfectParry(); });
  await page.evaluate(() => { W.skipRender = false; const p = W.pf; atkAt(W.ct + 0.25); for (let i = 0; i < 60 && !(p.act && p.act.name === "riposte" && p.act.f >= 3); i++) T(1); });
  await shot("E1_riposte");
  await page.evaluate(() => { perfectParry(); for (let i = 0; i < 15; i++) T(1); });
  await shot("E1_deflected");
}

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
