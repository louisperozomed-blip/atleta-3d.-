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
    p.respawn(); W.respawnAll(); W.hitstop = 0; W.COMBAT.calib = 0; if (W.SLOWMO) { W.SLOWMO.t = 0; W.SLOWMO.pend = null; }
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

// bot de riposte (etapas 4 y 5)
  await page.evaluate(() => {
    let rs = 777; const rr = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const gauss = () => { let u = 0, v = 0; while (!u) u = rr(); while (!v) v = rr(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    window.RipBot = {
      reset(o) { Object.assign(this, { mode: "ritmo", st: null, out: [], pp: 0 }, o || {}); rs = ((o && o.seed) || 777) * 48271 % 2147483646 + 1; for (let i = 0; i < 6; i++) rr(); },
      step() {
        const p = W.pf, e = E(), L = W.combatLog;
        const last = L[L.length - 1];
        // un parry perfecto nuevo: empieza el riposte
        const pp = L.filter((x) => x.ev === "parry" && x.who === "jugador" && x.level === "perfect").length;
        if (pp > (this.pp || 0)) { this.pp = pp; this.st = { k: 0, at: W.ct + 0.25 + gauss() * 0.04, imp1: null, res: null }; this.out.push(this.st); }
        const S = this.st; if (!S || S.k >= 9) return;
        const a = p.act;
        if (a && a.name === "riposte" && a.impactT != null && a.ripN === 1 && S.imp1 == null) { S.imp1 = a.impactT; S.at2 = W.ct + 0.25 + gauss() * 0.04 - (W.ct - a.impactT); }
        const R = p.rip;
        if (S.k === 0 && W.ct >= S.at) { atkAt(S.at); S.k = 1; }
        else if (S.k === 1 && S.at2 != null && W.ct >= S.at2) { atkAt(S.at2); S.k = 2; }
        else if (S.k === 2 && R && R.beat != null) { S.at3 = this.mode === "ritmo" ? R.beat + gauss() * 0.04 : this.mode === "fijo" ? R.beat + (this.err3 || 0) : R.beat - 0.17 + rr() * 0.6; S.k = 3; }
        else if (S.k === 3 && W.ct >= S.at3) { atkAt(S.at3); S.k = 4; }
      },
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

// =====================================================================================================
// ETAPA 2 · el enemigo reacciona mejor a tus golpes
// =====================================================================================================
if (STAGES.includes(2)) {
  await page.evaluate(() => {
    // tu golpe al autómata quieto (sin IA): reacción y cuánto dura / cuánto retrocede
    window.hitFoe = (an) => {
      pair(0.6, 1.6); const e = E(), p = W.pf; e.ai.enabled = false; const x0 = e.body.x, z0 = e.body.z;
      p.startAttack(an, { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) });
      let t0 = null, n = 0, frames = new Set();
      while (n++ < 200) { T(1); if (e.act && e.act.name === "hit") { if (t0 == null) t0 = W.ct; frames.add(e.act.f); } else if (t0 != null) break; }
      return { dur: t0 == null ? 0 : +(W.ct - t0).toFixed(2), frames: [...frames], kb: +Math.hypot(e.body.x - x0, e.body.z - z0).toFixed(2), res: lastOf("hit") && lastOf("hit").res };
    };
  });
  const wt = await page.evaluate(() => ({ ligero: hitFoe("attack1"), ligero2: hitFoe("attack2"), pesado: hitFoe("attack3") }));
  check("reacción según el peso: golpe ligero = respingo corto (1-2 frames de hit); pesado = tambaleo con retroceso",
    wt.ligero.res === "flinch" && wt.ligero.dur <= 0.2 && wt.ligero.frames.every((f) => f <= 1) && wt.ligero2.res === "flinch" &&
    wt.pesado.res === "hit" && wt.pesado.dur >= 0.45 && wt.pesado.kb > wt.ligero.kb * 2, wt);
  // hyper armor: en su barrido amplio (nivel 2) recibe el daño pero no se interrumpe; en el zarpazo, sí
  const ha = await page.evaluate(() => {
    const o = {};
    for (const m of ["attack2", "attack1"]) {
      pair(0.6, 1.7); const e = E(), p = W.pf; e.ai.enabled = true; e.ai.passive = true; e.ai.cool = 99; p.hpMax = p.hp = 1e6;
      e.ai.chain = { uid: 999, id: "prueba", steps: [{ m, r: "s", gap: 0 }], i: 0, readyT: null }; e.ai.strike(m, "s", e.ai.chain.steps[0]);
      const hp0 = e.hp; let hitAt = null;
      for (let n = 0; n < 160; n++) {
        if (hitAt == null && e.act && e.act.plan && e.act.plan.t > 0.15) { hitAt = W.ct; p.startAttack("attack1", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); }
        T(1);
      }
      const L = W.combatLog;
      o[m] = { armadura: L.some((x) => x.ev === "hit" && x.who === "autómata" && x.res === "armor"), dano: Math.round(hp0 - e.hp), suGolpe: L.some((x) => x.from === "autómata" && ["hit", "block", "parry"].includes(x.ev)) };
    }
    return o;
  });
  check("hyper armor: durante sus golpes pesados aguanta sin interrumpirse (pero recibe el daño); el zarpazo ligero sí se interrumpe",
    ha.attack2.armadura && ha.attack2.dano > 0 && ha.attack2.suGolpe && !ha.attack1.armadura && !ha.attack1.suGolpe, ha);

  // lee el combo completo: bloquea el 1.º y desvía el 2.º/3.º si el ritmo es predecible
  await page.evaluate(() => {
    window.combo3 = (mode, n, seed) => {
      const e = E(), p = W.pf; pair(0, 1.9); e.ai.enabled = true; e.ai.passive = true; e.ai.state = "chase"; e.ai.resetModel(); p.hpMax = p.hp = 1e6; e.hpMax = e.hp = 1e6; W.combatLog.length = 0;
      let s = seed || 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const pos = { 1: [], 2: [], 3: [] }, seq = [];
      for (let k = 0; k < n; k++) {
        if (e.stunned) e.act = null; e.post = 0; p.post = 0; e.st = e.stMax; p.st = p.stMax;
        const toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x), n0 = W.combatLog.length;
        const plan = mode === "repite" ? [0, 0.25, 0.5] : [0, 0.25 + rnd() * 0.25, 0.6 + rnd() * 0.5].slice(0, 1 + Math.floor(rnd() * 3));
        const dur = mode === "repite" ? 1.7 : 1.4 + rnd() * 1.2;
        // abre el combo un rato después de quedar libre: siempre 0,45 s si repite; de 0,15 a 1,1 s si varía
        // (fuera de su ventana de castigo: en su resoplido no se defiende, por justicia)
        const wait = mode === "repite" ? 0.45 : 0.15 + rnd() * 0.95;
        let w0 = W.ct, nn = 0; while ((p.act || e.ai.vent > 0 || (e.act && W.isAtk(e.act)) || W.ct - w0 < wait) && nn++ < 300) { if (p.act || e.ai.vent > 0 || (e.act && W.isAtk(e.act))) w0 = W.ct; T(); }
        const t0 = W.ct; let i = 0;
        let guardT = 0;
        while (W.ct - t0 < dur) {
          while (i < plan.length && plan[i] <= W.ct - t0 && !guardT) { p.input("attack", { dir: toE() }); i++; }
          // te ha desviado: te cubres de su counter (guardia mantenida) y dejas el combo
          if (!guardT && W.combatLog.slice(n0).some((x) => x.ev === "foeParriedYou")) { guardT = W.ct; i = plan.length; p.input("guardDown"); }
          if (guardT && W.ct - guardT > 0.9) { p.input("guardUp"); guardT = -1; }
          T();
        }
        if (guardT > 0) p.input("guardUp");
        const res = W.combatLog.slice(n0).filter((x) => x.from === "jugador" && ["parry", "block", "hit"].includes(x.ev)).map((x) => x.ev);
        seq.push(W.combatLog.slice(n0).filter((x) => /^foe|^parry$|^block$|^hit$|^counter$/.test(x.ev)).map((x) => x.ev + (x.kind ? ":" + x.kind : "") + (x.from ? "<" + x.from[0] : "")).join(" "));
        res.forEach((r, j) => { if (pos[j + 1]) pos[j + 1].push(r); });
        W.teleport(e.body.x + 1.9, e.body.z);
      }
      const pct = (L, ev) => L.length ? Math.round(100 * L.filter((x) => x === ev).length / L.length) : 0;
      return { "1": { bloquea: pct(pos[1].slice(4), "block"), desvia: pct(pos[1].slice(4), "parry"), n: pos[1].length }, "2-3": { desvia: pct(pos[2].slice(4).concat(pos[3].slice(4)), "parry"), n: pos[2].length + pos[3].length }, seq: seq.slice(4, 9) };
    };
  });
  const rd = await page.evaluate(() => ({ repite: combo3("repite", 14), varia: combo3("varia", 14, 5) }));
  check("lee tu combo completo: repitiendo el ritmo (y fuera de su resoplido), bloquea tus aperturas y desvía el 2.º/3.º (≥ 50 %); variándolo, mucho menos",
    rd.repite["1"].bloquea + rd.repite["1"].desvia >= 50 && rd.repite["2-3"].desvia >= 50 && rd.varia["2-3"].desvia <= rd.repite["2-3"].desvia - 25, rd);

  // si te desvía: quedas desequilibrado (tus frames de hit) y lanza su COUNTER (hoja counter), con aviso ≥ 350 ms
  await page.evaluate(() => {
    // el autómata desvía tu zarpazo (pulsa su guardia 90 ms antes de tu impacto)
    window.foeParriesYou = () => {
      pair(0.6, 1.8); const e = E(), p = W.pf; e.ai.enabled = true; e.ai.passive = true; e.ai.cool = 99; e.ai.state = "chase"; p.hpMax = p.hp = 1e6; W.combatLog.length = 0;
      p.startAttack("attack1", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) });
      let pressed = false;
      for (let n = 0; n < 40 && !lastOf("parry"); n++) { const l = p.toImpact(); if (!pressed && l != null && l <= 0.09) { e.input("guardDown"); e.input("guardUp"); pressed = true; } T(1); }
      return lastOf("parry");
    };
    // sigue hasta su counter; fn(left) en cada paso
    window.untilCounter = (fn) => { const e = E(); let n = 0, start = null, warn = null;
      while (n++ < 120) { const a = e.act; if (a && a.move === "counter") { if (start == null) start = W.ct; if (fn) fn(e.toImpact() == null ? 0 : e.toImpact()); if (a.hitDone) break; } T(1); }
      return start; };
  });
  const ctr = await page.evaluate(() => {
    const o = {};
    for (const mode of ["auto", "sustituto"]) {
      W.DUEL.sheets.counter = mode;
      const pr = foeParriesYou(), p = W.pf, e = E(); const me = p.act && p.act.name, unb = !!(p.act && p.act.unbalanced);
      let sheet = null, prep = null; const t0 = W.ct;
      const st = untilCounter(() => { sheet = e.act.sheet; });
      const w = W.combatLog.find((x) => x.ev === "warn" && x.move === "counter");
      o[mode] = { desvia: pr && pr.who, yo: me, desequilibrado: unb, counter: st != null, empieza_ms: st == null ? null : Math.round((st - t0) * 1000), sheet, prep: w && w.prep,
        resultado: (W.combatLog.filter((x) => x.from === "autómata" && ["hit", "block", "parry"].includes(x.ev)).pop() || {}).ev };
    }
    W.DUEL.sheets.counter = "auto";
    return o;
  });
  check("si te hace parry: quedas desequilibrado (tus frames de hit) y lanza su COUNTER (hoja counter; sin hoja, attack1 rápido) con preparación visible ≥ 350 ms",
    ctr.auto.desvia === "autómata" && ctr.auto.yo === "hit" && ctr.auto.desequilibrado && ctr.auto.counter && ctr.auto.sheet === "counter" && ctr.auto.prep >= 0.35 &&
    ctr.sustituto.counter && ctr.sustituto.sheet === "attack1", ctr);

  // intercambio de desvíos: desvías su counter con un perfecto → otro counter... pierde quien falla primero
  const xc = await page.evaluate(() => {
    const out = { largos: [], ganas: 0, pierdes: 0, riposte: 0 };
    for (let k = 0; k < 12; k++) {
      foeParriesYou(); const e = E(), p = W.pf;
      let n = 0, done = false, seen = null;
      while (n++ < 600 && !done) {
        const a = e.act;
        if (a && a.move === "counter" && a !== seen && a.plan && a.plan.released) { seen = a; }
        if (a && a.move === "counter" && !a.hitDone) { const l = e.toImpact(); if (l != null && l <= 0.04 && !a._pressed) { a._pressed = true; p.input("guardDown", { ts: performance.now() + (l - 0.04) * 1000 }); p.input("guardUp"); } }
        if (W.combatLog.some((x) => x.ev === "xchg" && x.result !== "again")) done = true;
        T(1);
      }
      const xs = W.combatLog.filter((x) => x.ev === "xchg");
      out.largos.push(xs.length);
      // falla él: no aguanta el intercambio (queda desequilibrado) o se le rompe la postura
      const stun = W.combatLog.some((x) => x.ev === "stun");
      if (stun) { out.ganas++; out.riposte++; out.postura = (out.postura || 0) + 1; }
      else if (xs.length && xs[xs.length - 1].result === "foeFails") { out.ganas++; for (let i = 0; i < 20; i++) T(1); if (E().act && E().act.name === "deflected") out.riposte++; }
    }
    // si no pulsas en el counter: te alcanza y el intercambio se acaba
    foeParriesYou(); untilCounter(); for (let i = 0; i < 10; i++) T(1);
    out.sin_pulsar = (W.combatLog.filter((x) => x.from === "autómata" && x.ev === "hit").length);
    return out;
  });
  check("intercambio de desvíos (clin-clin): cada counter desviado con un perfecto puede traer otro; pierde quien falla primero (si falla él, queda desequilibrado y te toca el riposte)",
    xc.largos.every((n) => n >= 1) && Math.max(...xc.largos) >= 2 && xc.ganas === 12 && xc.riposte === 12 && xc.sin_pulsar === 1, xc);

  // choque: los dos golpeáis a la vez → chispas grandes, ambos retrocedéis, sin daño
  const cl = await page.evaluate(() => {
    const o = {};
    for (const [k, off] of [["a_la_vez", 0.0], ["40ms", 0.04], ["150ms", 0.15]]) {
      pair(0.6, 1.9); const e = E(), p = W.pf; e.ai.enabled = false; p.hpMax = p.hp = 100; const hp0 = e.hp;
      e.startAttack("attack1", { dir: e.body.heading });
      let started = false;
      for (let n = 0; n < 120; n++) { const l = e.toImpact(); if (!started && l != null && l <= 0.205 + off) { p.startAttack("attack1", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); started = true; } T(1); }
      o[k] = { choque: !!lastOf("clash"), danoEl: Math.round(hp0 - e.hp), danoTu: Math.round(100 - p.hp), el: e.act && e.act.name, yo: p.act && p.act.name };
    }
    return o;
  });
  check("choque: si los dos golpeáis a la vez (±80 ms) chispas grandes y ambos retrocedéis sin daño; con 150 ms de diferencia, no",
    cl.a_la_vez.choque && cl.a_la_vez.danoEl === 0 && cl.a_la_vez.danoTu === 0 && cl["40ms"].choque && !cl["150ms"].choque, cl);
  await page.evaluate(() => { pair(0.6, 1.9); const e = E(), p = W.pf; e.ai.enabled = false; e.startAttack("attack1", { dir: e.body.heading });
    let st = false; for (let n = 0; n < 120 && !lastOf("clash"); n++) { const l = e.toImpact(); if (!st && l != null && l <= 0.205) { p.startAttack("attack1", { dir: Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x) }); st = true; } T(1); } T(2); });
  await shot("E2_choque");
  await page.evaluate(() => { foeParriesYou(); untilCounter((l) => {}); });
  await page.evaluate(() => { foeParriesYou(); const e = E(); for (let n = 0; n < 60 && !(e.act && e.act.move === "counter" && e.act.f >= 3); n++) T(1); });
  await shot("E2_counter");
}

// =====================================================================================================
// ETAPA 3 · combos del enemigo que se adaptan a tu respuesta
// =====================================================================================================
if (STAGES.includes(3)) {
  await page.evaluate(() => {
    // cadena «dos» (zarpazo → barrido); el bot responde al 1.º con `ans` y al resto desvía con reacción humana
    window.branchRun = (ans, seed, trick) => {
      // sin trucos al azar (probabilidad 0) pero permitidos: el retraso de la rama es el truco de la cadena
      const kt = W.AUTOMATON.trick; W.AUTOMATON.trick = 0;
      duel(0.6, 2.0, { chain: "dos", trick: trick || null, noTricks: false });
      // bloquear = guardia mantenida desde antes del golpe (si se pulsa al verlo llegar sería un parry)
      const a1 = ans === "none" || ans === "block" ? null : ans;
      if (ans === "block") W.pf.input("guardDown");
      Bot.reset({ react: 0.25, jit: 0.02, seed, answer: a1 ? { attack1: a1 } : null });
      const e = E(); e.post = 0; let n = 0, vent = 0, first = true;
      const k0 = Bot.respond;
      if (ans === "none") Bot.respond = function (q) { if (first && q.move === "attack1") { first = false; return; } return k0.call(this, q); };
      let blk = ans === "block";
      if (blk) Bot.respond = function () {};
      while (n++ < 60 * 7 && !W.combatLog.some((x) => x.ev === "chainEnd")) {
        if (blk && W.combatLog.some((x) => x.ev === "block" && x.who === "jugador")) { blk = false; W.pf.input("guardUp"); Bot.respond = k0; }
        TB(); }
      for (let i = 0; i < 30; i++) { TB(); vent = Math.max(vent, e.ai.vent); }
      Bot.respond = k0; W.AUTOMATON.trick = kt;
      const b = lastOf("branch"), ws = W.combatLog.filter((x) => x.ev === "warn");
      const tricks = ws.filter((w) => w.hold > 0).length + W.combatLog.filter((x) => x.ev === "feint" && x.who === "autómata").length;
      return { rama: b ? b.to : "—", resp: b ? b.resp : null, golpes: ws.map((w) => w.move + (w.hold ? "(ret)" : "")), prepMin: Math.min(...ws.map((w) => w.prep)), trucos: tricks, vent: +vent.toFixed(2),
        gb: W.combatLog.some((x) => x.ev === "guardbreak" && x.who === "jugador") };
    };
  });
  const br = await page.evaluate(() => {
    const out = {};
    for (const [k, ans] of [["desvia", null], ["esquiva", "dodgeBack"], ["bloquea", "block"], ["recibe", "none"]]) { out[k] = []; for (let s = 0; s < 4; s++) out[k].push(branchRun(ans, 60 + s)); }
    out.desvia_con_truco = [branchRun(null, 90, "delay"), branchRun(null, 91, "delay")];
    return out;
  });
  const sum = (L) => L.map((r) => r.rama + " [" + r.golpes.join(", ") + "] prep≥" + r.prepMin + " trucos " + r.trucos + " resoplido " + r.vent);
  check("ramas: desvías el 1.º → el siguiente va RETRASADO; esquivas → te persigue con la ESTOCADA; bloqueas → ROMPEGUARDIAS; te alcanza → sigue igual",
    br.desvia.every((r) => r.rama === "attack2(retrasado)") && br.esquiva.every((r) => r.rama === "thrust") && br.bloquea.every((r) => r.rama === "breaker") && br.recibe.every((r) => r.rama === "—"),
    { desvia: sum(br.desvia), esquiva: sum(br.esquiva), bloquea: sum(br.bloquea), recibe: sum(br.recibe) });
  const all = [...br.desvia, ...br.esquiva, ...br.bloquea, ...br.recibe, ...br.desvia_con_truco];
  check("justicia: preparación visible ≥ 350 ms en todas las ramas, como mucho un truco por cadena (si ya lleva uno, la rama no añade otro) y ventana de castigo tras cada cadena",
    all.every((r) => r.prepMin >= 0.35 && r.trucos <= 1 && r.vent > 0.5), { con_truco: sum(br.desvia_con_truco), prep_min: Math.min(...all.map((r) => r.prepMin)) });
  // el rompeguardias: bloquearlo rompe la guardia; desviarlo funciona
  const bk = await page.evaluate(() => {
    const o = {};
    for (const [k, how] of [["bloqueado", "block"], ["desviado", "parry"]]) {
      pair(0.6, 2.0); const e = E(), p = W.pf; p.hpMax = p.hp = 500; e.ai.enabled = true; e.ai.passive = true; e.ai.cool = 99;
      e.ai.chain = { uid: 77, id: "prueba", steps: [{ m: "breaker", r: "s", gap: 0 }], i: 0, readyT: null }; e.ai.strike("breaker", "s", e.ai.chain.steps[0]);
      const w = lastOf("warn"); let done = false;
      for (let n = 0; n < 200; n++) { const l = e.toImpact();
        if (!done && how === "block" && l != null && l < 0.6) { p.input("guardDown"); done = true; }
        if (!done && how === "parry" && l != null && l <= 0.05) { p.input("guardDown", { ts: performance.now() + (l - 0.05) * 1000 }); p.input("guardUp"); done = true; }
        T(1); }
      p.input("guardUp");
      o[k] = { prep: w.prep, nivel: w.level, ev: W.combatLog.filter((x) => ["guardbreak", "parry", "block", "hit"].includes(x.ev) && x.from === "autómata").map((x) => x.ev + (x.level ? "/" + x.level : "")) };
    }
    return o;
  });
  check("ROMPEGUARDIAS: carga larga visible (≥ 350 ms, aviso fuerte); si lo bloqueas te rompe la guardia, si lo desvías no",
    bk.bloqueado.prep >= 0.35 && bk.bloqueado.nivel >= 2 && bk.bloqueado.ev.includes("guardbreak") && bk.desviado.ev.some((x) => x.startsWith("parry")), bk);
  await page.evaluate(() => { pair(0.6, 2.0); const e = E(); e.ai.enabled = true; e.ai.passive = true; e.ai.cool = 99;
    e.ai.chain = { uid: 78, id: "prueba", steps: [{ m: "breaker", r: "s", gap: 0 }], i: 0, readyT: null }; e.ai.strike("breaker", "s", e.ai.chain.steps[0]); T(30); });
  await shot("E3_rompeguardias");
}

// =====================================================================================================
// ETAPA 4 · sensación y entrenamiento del riposte
// =====================================================================================================
if (STAGES.includes(4)) {
  const fe = await page.evaluate(() => {
    const o = {}, A = W.sfx, played = [];
    const k0 = A.combat; A.combat = function (kind, x) { played.push(kind + (x != null && typeof x === "number" ? x : "")); return k0.apply(this, arguments); };
    // parry perfecto: hitstop + cámara lenta (~120 ms reales al 30 %) + metal agudo + chispas doradas
    pair(0.6, 2.0); E().ai.enabled = false; const S = W.SLOWMO; S.acc = 0; let slowSteps = 0, ct0 = null, ctSlow = 0;
    const e = E(); e.startAttack("attack1", { dir: e.body.heading }); let pressed = false, n = 0;
    const nd0 = W.fx && W.fx.count ? W.fx.count() : 0;
    while (n++ < 200) { const l = e.toImpact(); if (!pressed && l != null && l <= 0.04) { W.pf.input("guardDown", { ts: performance.now() + (l - 0.04) * 1000 }); W.pf.input("guardUp"); pressed = true; }
      const c0 = W.ct, s0 = S.t > 0; T(1); if (S.t > 0 || (s0 && S.t <= 0)) { slowSteps++; ctSlow += W.ct - c0; } if (lastOf("parry") && slowSteps > 12) break; }
    o.perfecto = { nivel: lastOf("parry") && lastOf("parry").level, lento_real_ms: Math.round(S.acc * 1000), juego_ms: Math.round(ctSlow * 1000), sonidos: played.slice() };
    // riposte: sonidos de corte crecientes; deathblow: golpe grave y destello
    played.length = 0; perfectParry(); const e2 = E(); e2.post = 60; ripRun({});
    o.riposte = played.filter((x) => x.startsWith("riposte")); o.deathblow = played.includes("deathblow");
    A.combat = k0;
    return o;
  });
  check("parry perfecto: instante de cámara lenta (~120 ms reales al 30 %), sonido metálico agudo y chispas doradas",
    fe.perfecto.nivel === "perfect" && Math.abs(fe.perfecto.lento_real_ms - 120) <= 20 && Math.abs(fe.perfecto.juego_ms - 36) <= 10 && fe.perfecto.sonidos.includes("parryPerfect"), fe.perfecto);
  check("riposte con sonido de corte creciente (1, 2, 3) y deathblow con su golpe grave",
    fe.riposte.join(",") === "riposte1,riposte2,riposte3" && fe.deathblow, { riposte: fe.riposte, deathblow: fe.deathblow });

  // entrenamiento del riposte: siempre la misma cadena y te dice si acertaste el ritmo del 3.er golpe
  const tr = await page.evaluate(() => {
    const out = { cadenas: [], textos: [] };
    const sel = document.getElementById("trainSel"); out.opcion = !!(sel && [...sel.options].some((o) => o.value === "riposte"));
    pair(0.6, 2.0); W.setTraining("riposte"); const e = E(); e.ai.enabled = true; e.ai.cool = 0.3; e.ai.state = "chase";
    Bot.reset({ react: 0.31, jit: 0, seed: 5 }); RipBot.reset({ mode: "fijo", seed: 9 });
    let n = 0, errs = [0.0, 0.15, -0.14, 0.03];
    let k = 0;
    while (n++ < 60 * 70 && out.textos.length < 4) {
      // 3.er golpe: buen ritmo, tarde, pronto, buen ritmo
      RipBot.mode = "fijo"; RipBot.err3 = errs[k % errs.length];
      TB(); RipBot.step();
      const t = W.lastTiming;
      if (t && t.startsWith("RITMO") && out.textos[out.textos.length - 1] !== t) { out.textos.push(t); k++; }
    }
    out.cadenas = W.combatLog.filter((x) => x.ev === "chainStart").map((x) => x.chain);
    W.setTraining("");
    return out;
  });
  check("entrenamiento RIPOSTE (panel ⚙): siempre la misma cadena y tras el 3.er golpe dice si acertaste el ritmo (✓, PRONTO o TARDE y los ms)",
    tr.opcion && tr.cadenas.length >= 3 && tr.cadenas.every((c) => c === "dos") && tr.textos.length >= 3 && tr.textos.some((t) => t.includes("✓")) && tr.textos.some((t) => /TARDE|PRONTO/.test(t)), tr);
  await page.evaluate(() => { pair(0.6, 2.0); W.setTraining("riposte"); });
  await page.evaluate(() => { W.skipRender = true; perfectParry(); ripRun({ steps: 60 }); const el = document.querySelector("#duelP .tmg"); });
  await shot("E4_entrenamiento_riposte");
  await page.evaluate(() => W.setTraining(""));
}

// =====================================================================================================
// ETAPA 5 · bot con reacción humana, ramas, intercambio, choque y deathblow en 8 direcciones
// =====================================================================================================
if (STAGES.includes(5)) {
  // bot de riposte: desvía con reacción humana (250 ms ± 40 ms desde la suelta) y, tras un PERFECTO, lanza el
  // riposte: 1.ª pulsación a su reacción al desvío, 2.ª a su reacción al impacto del 1.º y la 3.ª «con buen
  // ritmo» (el momento ideal ± su error de ritmo humano, 40 ms) o «al azar» (en cualquier momento de 0 a 0,6 s)
  const rb = await page.evaluate(() => {
    const out = {};
    for (const mode of ["ritmo", "azar"]) {
      let perfect = 0, full = 0, third = 0, tries3 = 0, seed = 300;
      for (let rep = 0; rep < 90; rep++) {
        duel(0.6, 2.0, { chain: "dos", noTricks: true }); Bot.reset({ react: 0.25, jit: 0.04, seed: seed++ }); RipBot.reset({ mode, seed: seed * 7 });
        const e = E(); e.post = 0; e.hp = e.hpMax = 1e6;
        let n = 0; const L = W.combatLog;
        while (n++ < 60 * 6) {
          TB(1 / 1); RipBot.step();
          if (L.some((x) => x.ev === "chainEnd") && !(W.pf.act && W.pf.act.name === "riposte") && !(E().act && E().act.name === "deflected") && n > 60) break;
        }
        // por cada parry perfecto: cuántos golpes de riposte siguieron
        const evs = L.filter((x) => (x.ev === "parry" && x.who === "jugador") || x.ev === "riposte" || x.ev === "ripDeflected" || x.ev === "ripBeat");
        let cur = null;
        for (const x of evs) {
          if (x.ev === "parry") { if (x.level === "perfect") { perfect++; cur = { hits: 0 }; } else cur = null; continue; }
          if (!cur) continue;
          if (x.ev === "riposte") { cur.hits = x.n; if (x.n === 3) { full++; third++; cur = null; } }
          if (x.ev === "ripBeat") tries3++;
        }
      }
      out[mode] = { perfectos: perfect, completos: full, pct_completo: perfect ? Math.round(100 * full / perfect) : 0, intentos_3: tries3, pct_3: tries3 ? Math.round(100 * third / tries3) : 0 };
    }
    return out;
  });
  check("bot humano (reacción 250 ± 40 ms): con buen ritmo encadena el riposte completo en ≥ 60 % de sus parries perfectos",
    rb.ritmo.perfectos >= 15 && rb.ritmo.pct_completo >= 60, rb.ritmo);
  check("pulsando el 3.er golpe al azar, la mayoría falla (≤ 40 % entra) y siempre peor que con ritmo",
    rb.azar.intentos_3 >= 10 && rb.azar.pct_3 <= 40 && rb.azar.pct_3 < rb.ritmo.pct_3 - 30, rb.azar);

  // deathblow en las 8 direcciones (con su hoja), capturas
  const dirs = await page.evaluate(() => {
    const D = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"], out = [];
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      pair(a, 2.0); E().ai.enabled = false; foeAttack("attack1", pressAt(0.04)); E().post = 75;
      let dir = null, sheet = null, frames = new Set();
      ripRun({ onStep() { const p = W.pf; if (p.act && p.act.name === "deathblow") { sheet = p.act.sheet; frames.add(p.act.f); dir = W.character.st.dir; } } });
      out.push({ ang: k * 45, dir: dir == null ? null : D[dir], sheet, frames: frames.size, deathblow: !!lastOf("deathblow") });
    }
    return out;
  });
  check("deathblow en las 8 direcciones: cada una con su fila de la hoja (8 direcciones distintas) y el remate entra",
    dirs.every((d) => d.deathblow && d.sheet === "deathblow" && d.frames >= 5) && new Set(dirs.map((d) => d.dir)).size === 8, dirs);
  for (let k = 0; k < 8; k++) {
    await page.evaluate((k) => { const a = k * Math.PI / 4; pair(a, 2.0); E().ai.enabled = false; foeAttack("attack1", pressAt(0.04)); E().post = 75;
      const p = W.pf; ripRun({ steps: 400, stop: () => p.act && p.act.name === "deathblow" && p.act.f >= 3 }); }, k);
    await page.evaluate(() => { const p = W.pf; for (let i = 0; i < 80 && !(p.act && p.act.name === "deathblow" && p.act.f >= 3); i++) T(1); });
    await shot("E5_deathblow_" + ["S", "SW", "W", "NW", "N", "NE", "E", "SE"][k]);
  }
}

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
