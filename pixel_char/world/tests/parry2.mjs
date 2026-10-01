// Pruebas del parry por niveles y de la IA de duelo del autómata (Playwright + Chromium, WebGL por SwiftShader).
// uso: node parry2.mjs <dist/index.html> <carpeta de salida>      (STAGES=1,2,3 para elegir etapas)
// Simulación determinista (W.manual + W.tick(1/60)); W.skipRender simula sin pintar (se pinta en las capturas).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
const STAGES = (process.env.STAGES || "1,2,3,4,5,6").split(",").map(Number);
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

// =====================================================================================================
// ETAPA 1 · niveles de parry
// =====================================================================================================
if (STAGES.includes(1)) {
  // niveles según la antelación de la pulsación
  const lv = await page.evaluate(() => {
    const out = {};
    for (const an of ["attack1", "attack2"]) for (const L of [0.03, 0.065, 0.1, 0.19, 0.27]) {
      pair(0.6, 2.0); foeAttack(an, pressAt(L));
      const p = lastOf("parry"), b = lastOf("block"), h = lastOf("hit");
      out[an + "@" + Math.round(L * 1000)] = p ? p.level + ":" + p.early : b ? "block:" + b.early : h ? "hit" : evs().join("|");
    }
    pair(0.6, 2.0); foeAttack("attack1", pressAt(0.6, true)); out["held@600"] = evs()[0]; W.pf.input("guardUp"); T(10);
    pair(0.6, 2.0); foeAttack("attack1", pressAt(0.45)); out["tap@450"] = evs()[0];
    return out;
  });
  check("niveles: ≤70 ms = PERFECTO, resto de la ventana (≤200 ms) = NORMAL, fuera de ventana = BLOQUEO, ataque 1 y 2",
    ["attack1", "attack2"].every((an) => lv[an + "@30"].startsWith("perfect") && lv[an + "@65"].startsWith("perfect") && lv[an + "@100"].startsWith("normal") && lv[an + "@190"].startsWith("normal") && lv[an + "@270"].startsWith("block")), lv);
  check("guardia mantenida desde antes = BLOQUEO; tocar demasiado pronto y soltar = golpe", lv["held@600"] === "block" && lv["tap@450"] === "hit", { mantenida: lv["held@600"], pronto: lv["tap@450"] });
  const acc = await page.evaluate(() => { const r = []; for (const L of [0.04, 0.12, 0.18]) { pair(0.6, 2.0); foeAttack("attack1", pressAt(L)); r.push([Math.round(L * 1000), lastOf("parry").early]); } return r; });
  check("la antelación medida coincide con la real (±2 ms): se mide al instante exacto del impacto", acc.every(([a, b]) => Math.abs(a - b) <= 2), acc);

  // recompensas
  const rw = await page.evaluate(() => {
    const r = {}, e = E(), p = W.pf, P = W.AUTOMATON.attacks;
    for (const [lvl, L] of [["perfect", 0.04], ["normal", 0.14]]) for (const an of ["attack1", "attack2"]) {
      pair(0.6, 2.0); const ep0 = e.post, pp0 = p.post, st0 = p.st;
      foeAttack(an, pressAt(L)); const ev = lastOf("parry");
      r[lvl + "_" + an] = { enemigo: Math.round(e.post - ep0), tu: Math.round(p.post - pp0), stamina: Math.round(p.st - st0), contra: +(p.counterT - W.ct).toFixed(3), hitstop: ev && ev.level };
    }
    for (const an of ["attack1", "attack2"]) { pair(0.6, 2.0); const ep0 = e.post, pp0 = p.post, st0 = p.st; foeAttack(an, pressAt(0.6, true)); W.pf.input("guardUp");
      r["block_" + an] = { enemigo: Math.round(e.post - ep0), tu: Math.round(p.post - pp0), stamina: Math.round(p.st - st0) }; T(10); }
    r.post = { attack1: P.attack1.post, attack2: P.attack2.post };
    return r;
  });
  const L = await page.evaluate(() => W.PARRY_LEVELS);
  check("PERFECTO: mucha postura al enemigo, 0 para ti, sin gasto de stamina",
    ["attack1", "attack2"].every((an) => rw["perfect_" + an].enemigo >= rw["normal_" + an].enemigo * 1.3 - 1 && rw["perfect_" + an].tu === 0 && rw["perfect_" + an].stamina >= 0),
    { perfecto: [rw.perfect_attack1, rw.perfect_attack2] });
  check("NORMAL: postura media al enemigo y un pequeño coste de postura para ti",
    ["attack1", "attack2"].every((an) => rw["normal_" + an].enemigo > 0 && rw["normal_" + an].tu > 0 && rw["normal_" + an].tu <= 12),
    { normal: [rw.normal_attack1, rw.normal_attack2] });
  check("BLOQUEO: nada de postura al enemigo, más coste para ti y gasto de stamina",
    ["attack1", "attack2"].every((an) => rw["block_" + an].enemigo === 0 && rw["block_" + an].tu > rw["normal_" + an].tu && rw["block_" + an].stamina < 0),
    { bloqueo: [rw.block_attack1, rw.block_attack2] });
  // chispas doradas, sonido propio y hitstop más largo
  const fx = await page.evaluate(() => {
    const out = {};
    for (const [k, L] of [["perfect", 0.04], ["normal", 0.14]]) {
      pair(0.6, 2.0); let pressed = false, maxHs = 0, snd = null;
      const e = E(); e.startAttack("attack1", { dir: e.body.heading });
      for (let n = 0; n < 300; n++) { const l = e.toImpact(); if (!pressed && l != null && l <= L) { W.pf.input("guardDown", { ts: performance.now() + (l - L) * 1000 }); W.pf.input("guardUp"); pressed = true; }
        T(); maxHs = Math.max(maxHs, W.hitstop); if (W.sfx.last && (W.sfx.last.startsWith("parry"))) snd = W.sfx.last; if (e.act && e.act.name === "hit") break; }
      out[k] = { hitstop: +maxHs.toFixed(3), sonido: snd };
    }
    return out;
  });
  check("PERFECTO: sonido propio y hitstop más largo que el normal", fx.perfect.sonido === "parryPerfect" && fx.normal.sonido === "parry" && fx.perfect.hitstop > fx.normal.hitstop, fx);
  await page.evaluate(() => { pair(Math.PI * 0.75, 2.0); const e = E(); e.startAttack("attack2", { dir: e.body.heading });
    for (let n = 0; n < 300; n++) { const l = e.toImpact(); if (l != null && l <= 0.03) { W.pf.input("guardDown"); W.pf.input("guardUp"); break; } T(); } T(1); W.skipRender = false; T(1); });
  await page.screenshot({ path: `${OUT}/E1_perfecto.png` });
  await page.evaluate(() => { W.skipRender = true; T(40); });

  // ventana de contraataque
  const ct = await page.evaluate(() => {
    const r = {}, e = E(), D = W.ENEMY_DIFF, k = [D.parry, D.block]; D.parry = 1; D.block = 1;
    for (const [k2, wait] of [["dentro", 0.1], ["fuera", 0.45]]) {
      pair(0.6, 2.0); e.ai.enabled = true; e.ai.cool = 99; e.ai.state = "chase";
      foeAttack("attack1", pressAt(0.04)); const open = +(W.pf.counterT - W.ct).toFixed(3), c0 = W.ct - (0.35 - open);
      let n = 0; while (W.ct - c0 < wait && n < 200) { T(); n++; }        // tiempo de juego (el hitstop no cuenta)
      const hp0 = e.hp;
      W.pf.input("attack", { dir: 0.6 + Math.PI }); T(40);
      r[k2] = { ventana: open, ev: evs().filter((x) => x !== "parry").slice(0, 3), dmg: Math.round(hp0 - e.hp) };
    }
    D.parry = k[0]; D.block = k[1]; return r;
  });
  check("ventana de contraataque ~350 ms tras un PERFECTO: el golpe que empiezas en ella hace daño extra (×1.6) y no se puede defender",
    Math.abs(ct.dentro.ventana - 0.35) < 0.02 && ct.dentro.ev.includes("counter") && ct.dentro.dmg >= 16, ct.dentro);
  check("pasada la ventana, el golpe es normal (y el enemigo puede defenderse)", !ct.fuera.ev.includes("counter") && ct.fuera.dmg < 16, ct.fuera);

  // spam y parry parcial se mantienen
  const sp = await page.evaluate(() => { pair(0.6, 2.0); const p = W.pf; let n = 0;
    foeAttack("attack1", (l) => { if (n < 4 && l > 0.35 && Math.round(l * 60) % 6 === 0) { p.input("guardDown"); p.input("guardUp"); n++; } else if (n === 4 && l <= 0.1) { p.input("guardDown", { ts: performance.now() }); p.input("guardUp"); n++; } });
    return { win: +p.parryWindow().toFixed(3), ev: evs()[0] }; });
  check("spam: pulsar seguido encoge la ventana (penalización que se recupera sola)", sp.win < 0.2, sp);

  // 20 fps (móvil): el impacto se detecta tarde en el paso, pero la medida usa su instante exacto
  const lo = await page.evaluate(() => { const r = []; for (const L of [0.05, 0.18]) { pair(0.6, 2.0); foeAttack("attack1", pressAt(L), 0.05); const p = lastOf("parry"); r.push(p ? p.level + ":" + p.early : evs().join("|")); } return r; });
  check("a 20 fps (pasos de 50 ms) los niveles salen igual: 50 ms → PERFECTO, 180 ms → NORMAL", lo[0].startsWith("perfect") && lo[1].startsWith("normal"), lo);

  // marca de tiempo del evento real (botón GUARDIA): un evento creado 60 ms antes de procesarse cuenta desde su creación
  const ts = await page.evaluate(() => {
    const gb = document.getElementById("guard"), r = {};
    const fire = (lagMs) => { const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 7 }); const t0 = performance.now(); while (performance.now() - t0 < lagMs) {} gb.dispatchEvent(ev); gb.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 7 })); };
    fire(0); T(30);                                    // la primera pulsación arranca el audio (tarda)
    for (const [k, lag] of [["sinRetraso", 0], ["procesado60msTarde", 60]]) {
      pair(0.6, 2.0); let done = false, l0 = 0;
      foeAttack("attack1", (l) => { if (!done && l <= 0.03) { l0 = l; fire(lag); done = true; } });
      const p = lastOf("parry"); r[k] = p ? p.level + ":" + p.early : evs().join("|"); r[k + "_faltaba"] = Math.round(l0 * 1000);
    }
    return r;
  });
  check("event.timeStamp: la pulsación cuenta desde el evento, no desde que se procesa (60 ms de retraso → 60 ms antes)",
    ts.sinRetraso.startsWith("perfect") && ts.procesado60msTarde.startsWith("normal") &&
    Math.abs(+ts.sinRetraso.split(":")[1] - ts.sinRetraso_faltaba) <= 4 && Math.abs(+ts.procesado60msTarde.split(":")[1] - ts.procesado60msTarde_faltaba - 60) <= 6, ts);

  // calibración de latencia
  const cal = await page.evaluate(() => {
    const r = {};
    for (const c of [0, 40]) {
      pair(0.6, 2.0); W.COMBAT.calib = c; const e = E(); e.startAttack("attack1", { dir: e.body.heading });
      let n = 0; while (!(e.act && e.act.f >= 3) && n < 300) { T(); n++; }
      const late = Math.round((W.ct - e.act.impactT) * 1000);
      W.pf.input("guardDown", { ts: performance.now() }); W.pf.input("guardUp"); T(4);
      const p = lastOf("parry"); r["calib" + c] = { tarde: late, res: p ? p.level + ":" + p.early : evs()[0] };
    }
    W.COMBAT.calib = 0;
    r.median = W.calibFrom([0, 750, 1500, 2250, 3000, 3750, 4500, 5250], [30, 790, 1540, 2290, 3035, 3790, 4545, 5280]);
    return r;
  });
  check("calibración +40 ms: una pulsación que llega justo después del impacto cuenta como PERFECTO (sin calibrar, golpe)",
    cal.calib0.res === "hit" && String(cal.calib40.res).startsWith("perfect"), cal);
  check("prueba de ritmo: la mediana del desfase de los toques da la calibración", cal.median === 40, { calib: cal.median });
  // el panel tiene la latencia y el botón de calibrar
  await page.evaluate(() => { W.skipRender = false; T(1); });
  await page.click("#tbtn"); await page.click("#tCalib");
  const ui = await page.evaluate(() => ({ slider: !!document.getElementById("dCalib"), box: !document.getElementById("calibBox").hidden }));
  await page.screenshot({ path: `${OUT}/E1_calibrar.png` });
  await page.click("#calibBox .cx"); await page.click("#tbtn");
  check("panel ⚙: deslizador de latencia y prueba de ritmo", ui.slider && ui.box, ui);
}

// =====================================================================================================
// ETAPA 2 · postura con tensión
// =====================================================================================================
if (STAGES.includes(2)) {
  // un parry nunca rompe tu postura; un bloqueo sí
  const nb = await page.evaluate(() => {
    const p = W.pf, r = {};
    pair(0.6, 2.0); p.post = p.postMax; foeAttack("attack2", pressAt(0.12)); r.parry = { ev: evs()[0], post: Math.round(p.post), act: p.act && p.act.name, roto: W.combatLog.some((x) => x.ev === "playerPostureBreak") };
    pair(0.6, 2.0); p.post = p.postMax - 5; foeAttack("attack2", pressAt(0.6, true)); p.input("guardUp");
    r.block = { ev: evs().slice(0, 2), roto: W.combatLog.some((x) => x.ev === "playerPostureBreak"), act: p.act && p.act.name + (p.act.gb ? "(rota)" : "") };
    T(80); return r;
  });
  check("un parry NUNCA rompe tu postura aunque la barra esté llena", nb.parry.ev === "parry" && !nb.parry.roto && nb.parry.post === 100, nb.parry);
  check("un bloqueo sí puede romperla (POSTURA ROTA)", nb.block.roto, nb.block);
  // ganancia: el jugador poco al desviar, mucho al bloquear (ya en la etapa 1); recuperación con la guardia alta
  const rec = await page.evaluate(() => {
    const p = W.pf, r = {};
    pair(0.6, 3.4); p.post = 60; p.postT = 0; p.input("guardDown"); T(150); r.guardia = Math.round(60 - p.post); p.input("guardUp"); T(10);
    pair(0.6, 3.4); p.post = 60; p.postT = 0; T(150); r.quieto = Math.round(60 - p.post);
    return r;
  });
  check("mantener la guardia sin recibir golpes recupera tu postura más deprisa (2.5 s)", rec.guardia >= 2 * rec.quieto && rec.guardia > 20, rec);
  // postura del enemigo por parry: 18-28 según golpe y nivel (el primero de una cadena)
  const g = await page.evaluate(() => {
    const e = E(), r = {};
    for (const [lvl, L] of [["normal", 0.14], ["perfect", 0.04]]) for (const an of ["attack1", "attack2"]) { pair(0.6, 2.0); e.post = 0; foeAttack(an, pressAt(L)); r[lvl + "_" + an] = lastOf("parry").gain; T(90); }
    return r;
  });
  check("postura del autómata por parry: 18-28 según el golpe y el nivel", g.normal_attack1 === 18 && g.normal_attack2 === 21 && g.perfect_attack1 === 24 && g.perfect_attack2 === 28, g);
  // racha: desvíos seguidos dentro de la misma cadena suman cada vez más; tras una pausa vuelve a empezar
  const ch = await page.evaluate(() => {
    const e = E(); pair(0.6, 2.0); e.post = 0; const gains = [];
    for (let k = 0; k < 4; k++) { foeAttack("attack1", pressAt(0.14)); gains.push(lastOf("parry").gain); e.act = null; e.post = 0; T(8); }
    T(100); foeAttack("attack1", pressAt(0.14)); const after = lastOf("parry").gain;
    pair(0.6, 2.0); foeAttack("attack1", pressAt(0.14)); e.act = null; T(8); foeAttack("attack1", pressAt(0.6, true)); W.pf.input("guardUp"); e.act = null; T(8);
    foeAttack("attack1", pressAt(0.14)); const afterBlock = lastOf("parry").gain;
    return { racha: gains, tras_pausa: after, tras_bloqueo: afterBlock };
  });
  check("bonus creciente por desvíos seguidos en la misma cadena (+3 cada uno); se pierde con una pausa o un bloqueo",
    ch.racha.join() === "18,21,24,27" && ch.tras_pausa === 18 && ch.tras_bloqueo === 18, ch);
  // hace falta desviar cadenas enteras: un desvío suelto no aturde; una cadena de 4 desviada (normal) casi; con perfectos sí
  const full = await page.evaluate(() => {
    const e = E(), r = {};
    for (const [k, L] of [["normales", 0.14], ["perfectos", 0.04]]) { pair(0.6, 2.0); e.post = 0;
      for (let i = 0; i < 4 && !e.stunned; i++) { foeAttack(i % 2 ? "attack2" : "attack1", pressAt(L)); if (!e.stunned) { e.act = null; T(6); } }
      r[k] = { post: Math.round(e.post), aturdido: e.stunned }; T(200); }
    return r;
  });
  check("una cadena de 4 desviada con perfectos le rompe la postura; con normales se queda cerca", full.perfectos.aturdido && !full.normales.aturdido && full.normales.post >= 80, full);
  // recuperación según la vida: con poca vida se recupera mucho más despacio (ambos)
  const hp = await page.evaluate(() => {
    const e = E(), p = W.pf, r = {};
    for (const [k, f] of [["vida_llena", 1], ["vida_30", 0.3]]) { pair(0.6, 3.4); e.hp = e.hpMax * f; p.hp = p.hpMax * f; e.post = 60; p.post = 60; e.postT = p.postT = 0; T(240);
      r[k] = { enemigo: Math.round(60 - e.post), jugador: Math.round(60 - p.post) }; }
    return r;
  });
  check("la recuperación de postura depende de la vida (dañar su vida la frena): con 30 % de vida, < 40 % de la recuperación con vida llena",
    hp.vida_30.enemigo < 0.4 * hp.vida_llena.enemigo && hp.vida_30.jugador < 0.4 * hp.vida_llena.jugador, hp);
}

// =====================================================================================================
// ETAPA 3 · el enemigo ataca como un duelista
// =====================================================================================================
if (STAGES.includes(3)) {
  // cadenas con el bot que lo desvía todo (sin error): longitudes, golpes y ritmos
  const ch = await page.evaluate(() => {
    duel(0.6, 2.0, { noTricks: true }); Bot.reset({ react: 0.25, jit: 0 }); const e = E();
    const chains = {}; let n = 0;
    while (n < 60 * 90) { TB(); n++; if (W.combatLog.filter((x) => x.ev === "chainEnd").length >= 16) break; }
    for (const x of W.combatLog) {
      if (x.ev === "chainStart") chains[x.uid] = { id: x.chain, steps: x.steps, warns: [], parries: [], imp: [], clean: null };
      if (x.ev === "chainEnd" && chains[x.uid]) chains[x.uid].clean = x.clean;
      if (x.ev === "warn" && chains[x.chain ? Object.keys(chains).pop() : 0]) chains[Object.keys(chains).pop()].warns.push(x.move);
      if (x.ev === "parry" && x.who === "jugador") { const c = chains[Object.keys(chains).pop()]; if (c) { c.parries.push(x.level); c.imp.push(x.t); } }
    }
    const all = Object.values(chains).filter((c) => c.warns.length);
    const list = all.filter((c) => c.clean || c.warns.length === c.steps.length);     // completas (las cortadas por aturdido no cuentan)
    return { n: list.length, planned: all.map((c) => c.steps.length), list: list.map((c) => ({ id: c.id, golpes: c.warns.join(","), desvios: c.parries.length, intervalos: c.imp.slice(1).map((t, i) => +(t - c.imp[i]).toFixed(2)) })) };
  });
  const lens = ch.list.map((c) => c.golpes.split(",").length);
  check("cadenas de 2 a 4 golpes que combinan attack1 y attack2 (y a veces un peligroso)",
    ch.n >= 8 && Math.min(...lens, ...ch.planned) >= 2 && Math.max(...lens, ...ch.planned) === 4 && ch.list.some((c) => c.golpes.includes("attack1") && c.golpes.includes("attack2")),
    { n: ch.n, planificadas: ch.planned.join(""), completas: lens.join(""), cadenas: ch.list.map((c) => c.id + ":" + c.golpes).slice(0, 10) });
  const normal = ch.list.filter((c) => !/sweep|thrust|grab/.test(c.golpes) && c.desvios === c.golpes.split(",").length);
  check("desviar la cadena completa = un parry por golpe («clin-clin-clin»)", normal.length >= 4, normal.slice(0, 5).map((c) => c.id + ": " + c.desvios + " desvíos, " + c.intervalos.join("/") + " s"));
  const rr = ch.list.filter((c) => c.intervalos.length >= 2).map((c) => Math.max(...c.intervalos) - Math.min(...c.intervalos));
  const rhythm = await page.evaluate(() => { const r = {}; for (const id of ["rrl", "lpr"]) { duel(0.6, 2.0, { chain: id, noTricks: true }); Bot.reset({ react: 0.25 });
    let n = 0; while (n < 60 * 8 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); n++; }
    const w = W.combatLog.filter((x) => x.ev === "warn").map((x) => x.prep), imp = W.combatLog.filter((x) => x.ev === "parry").map((x) => x.t);
    r[id] = { preparaciones: w, entre_impactos: imp.slice(1).map((t, i) => +(t - imp[i]).toFixed(2)) }; } return r; });
  check("ritmos distintos: rápido-rápido-lento y lento-pausa-rápido",
    rhythm.rrl.preparaciones[2] > rhythm.rrl.preparaciones[0] + 0.3 && rhythm.lpr.preparaciones[0] > rhythm.lpr.preparaciones[1] + 0.3 && rhythm.lpr.entre_impactos[0] > 1.0, rhythm);

  // golpe retrasado: retiene la pose con el ojo fijo; quien pulsa de memoria falla, quien espera la suelta no
  const dl = await page.evaluate(() => {
    const r = {};
    for (const mode of ["memory", "react"]) {
      duel(0.6, 2.0, { chain: "dos", trick: "delay" }); Bot.reset({ mode, react: 0.25 }); const e = E();
      const eye = []; let n = 0;
      while (n < 60 * 8 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); n++; const a = e.act; if (a && a.plan && a.plan.held && !a.plan.released) eye.push(+e.ch.uniforms.uEyeK.value.toFixed(2)); }
      const L = W.combatLog; const held = L.find((x) => x.ev === "hold");
      r[mode] = { retenido: !!held, ojo_en_retencion: [...new Set(eye)], res: L.filter((x) => ["parry", "hit", "block"].includes(x.ev)).map((x) => x.ev) };
    }
    return r;
  });
  check("golpe retrasado: retiene la preparación con el ojo FIJO encendido (no parpadea)", dl.react.retenido && dl.react.ojo_en_retencion.length === 1 && dl.react.ojo_en_retencion[0] >= 3, dl.react);
  check("el retraso castiga a quien pulsa de memoria y no a quien espera la suelta", dl.memory.res.includes("hit") && dl.react.res.filter((x) => x === "parry").length === 2, { memoria: dl.memory.res, reaccion: dl.react.res });

  // finta: corta la carga y cambia de golpe, sin falsa señal de suelta; el golpe nuevo tiene su preparación completa
  const ft = await page.evaluate(() => {
    duel(0.6, 2.0, { chain: "dos", trick: "feint" }); Bot.reset({ react: 0.25 }); let n = 0;
    while (n < 60 * 8 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); n++; }
    const L = W.combatLog.filter((x) => x.ev !== "swing"), i = L.findIndex((x) => x.ev === "feint");
    let j = i; while (j > 0 && L[j].ev !== "warn") j--;                  // el aviso del golpe que se finta
    const before = L.slice(j, i), after = L.slice(i + 1), w2 = after.find((x) => x.ev === "warn");
    return { finta: L[i] && L[i].from + "→" + L[i].to, sueltasAntes: before.filter((x) => x.ev === "release").length, avisosAntes: before.filter((x) => x.ev === "warn").length, prepDelNuevo: w2 && w2.prep,
      res: L.filter((x) => ["parry", "hit"].includes(x.ev)).map((x) => x.ev) };
  });
  check("finta: corta la carga sin destello de suelta y el golpe nuevo avisa de nuevo con ≥ 350 ms", ft.finta && ft.sueltasAntes === 0 && ft.prepDelNuevo >= 0.35 && ft.res.every((x) => x === "parry"), ft);

  // como mucho un truco por cadena y nunca dos cadenas seguidas con truco
  const tr = await page.evaluate(() => {
    const keep = W.AUTOMATON.trick; W.AUTOMATON.trick = 1; duel(0.6, 2.0); Bot.reset({ react: 0.25 }); let n = 0;
    while (n < 60 * 120 && W.combatLog.filter((x) => x.ev === "chainStart").length < 14) { TB(); n++; }
    W.AUTOMATON.trick = keep;
    const seq = W.combatLog.filter((x) => x.ev === "chainStart").map((x) => x.steps.filter((s) => /retrasado|finta/.test(s)).length);
    return seq;
  });
  check("como mucho un truco (retraso o finta) por cadena y nunca en dos cadenas seguidas", tr.every((k) => k <= 1) && tr.every((k, i) => !(k && tr[i + 1])) && tr.filter((k) => k).length >= 5, { trucos_por_cadena: tr.join("") });

  // ataques peligrosos: la respuesta correcta los evita; guardia y parry no sirven
  const pe = await page.evaluate(() => {
    const r = {};
    const run = (chain, answer) => { duel(0.6, 2.0, { chain, noTricks: true }); Bot.reset({ react: 0.25, answer }); const e = E(); const p0 = e.post, hp0 = e.hp; let n = 0;
      while (n < 60 * 8 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); n++; }
      const L = W.combatLog.filter((x) => x.move && ["sweep", "thrust", "grab"].includes(x.move) || ["mikiri", "counter", "grab"].includes(x.ev));
      const last = W.combatLog.filter((x) => ["evade", "mikiri", "hit", "grab", "whiff", "parry", "block"].includes(x.ev) && x.who === "jugador").pop();
      return { res: last ? last.ev + (last.how ? ":" + last.how : "") : W.combatLog.filter((x) => x.ev === "whiff").length ? "whiff" : "?", contra: W.combatLog.filter((x) => x.ev === "counter").map((x) => x.dmg), postura: Math.round(e.post - p0) };
    };
    r.barrido_salto = run("barrido", null); r.barrido_parry = run("barrido", { sweep: "parry" }); r.barrido_bloqueo = run("barrido", { sweep: "block" });
    r.estocada_hacia = run("estocada", null); r.estocada_lado = run("estocada", { thrust: "dodgeSide" }); r.estocada_parry = run("estocada", { thrust: "parry" });
    r.agarre_lado = run("agarre", null); r.agarre_atras = run("agarre", { grab: "dodgeBack" }); r.agarre_salto = run("agarre", { grab: "jump" }); r.agarre_parry = run("agarre", { grab: "parry" });
    return r;
  });
  check("BARRIDO bajo: se salta (y en el aire se contraataca con daño extra); guardia y parry no sirven",
    pe.barrido_salto.res === "evade:jump" && pe.barrido_salto.contra.length && pe.barrido_salto.contra[0] >= 30 && pe.barrido_parry.res === "hit" && pe.barrido_bloqueo.res === "hit",
    { salto: pe.barrido_salto, parry: pe.barrido_parry.res, bloqueo: pe.barrido_bloqueo.res });
  check("ESTOCADA: esquivar HACIA él = contraataque que le quita mucha postura; de lado solo la evita; parry no sirve",
    pe.estocada_hacia.res === "mikiri" && pe.estocada_hacia.postura >= 40 && ["evade:dodge", "whiff", "?"].includes(pe.estocada_lado.res) && pe.estocada_lado.postura < 30 && pe.estocada_parry.res === "hit",
    { hacia: pe.estocada_hacia, lado: pe.estocada_lado, parry: pe.estocada_parry.res });
  check("AGARRE: se esquiva de lado; hacia atrás, saltando o con parry te atrapa",
    ["evade:side", "whiff", "?"].includes(pe.agarre_lado.res) && pe.agarre_atras.res === "hit" && pe.agarre_salto.res === "hit" && pe.agarre_parry.res === "hit",
    { lado: pe.agarre_lado.res, atras: pe.agarre_atras.res, salto: pe.agarre_salto.res, parry: pe.agarre_parry.res });
  await page.evaluate(() => { duel(Math.PI * 0.75, 2.0, { chain: "agarre", noTricks: true }); W.skipRender = true; let n = 0; const e = E();
    while (n < 400 && !(e.act && e.act.move === "grab" && e.act.plan.t > 0.2)) { T(); n++; } });
  await shot("E3_peligro_agarre");
  await page.evaluate(() => { duel(Math.PI * 0.75, 2.0, { chain: "barrido", noTricks: true }); let n = 0; const e = E();
    while (n < 400 && !(e.act && e.act.move === "sweep" && e.act.plan.released)) { T(); n++; } });
  await shot("E3_peligro_barrido");

  // reglas de justicia
  const fj = await page.evaluate(() => {
    const keep = W.AUTOMATON.trick; W.AUTOMATON.trick = 0.6;
    duel(0.6, 2.0); Bot.reset({ react: 0.25 }); let n = 0;
    while (n < 60 * 150 && W.combatLog.filter((x) => x.ev === "chainEnd").length < 22) { TB(); n++; }
    W.AUTOMATON.trick = keep;
    const W2 = W.combatLog.filter((x) => x.ev === "warn");
    for (const id of ["barrido", "estocada", "agarre"]) { duel(0.6, 2.0, { chain: id }); Bot.reset({ react: 0.25 }); let k = 0; while (k < 60 * 6 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); k++; } W2.push(...W.combatLog.filter((x) => x.ev === "warn")); }
    return { golpes: W2.length, prepMin: Math.min(...W2.map((x) => x.prep)), sueltaMin: Math.min(...W2.map((x) => x.rel)), niveles: [...new Set(W2.map((x) => x.move + ":" + x.level + ":" + x.rel))].sort() };
  });
  check("justicia: preparación visible ≥ 350 ms en todos los golpes y la suelta avisa ≥ 360 ms antes", fj.golpes >= 40 && fj.prepMin >= 0.35 && fj.sueltaMin >= 0.36, fj);
  const lv = Object.fromEntries(fj.niveles.map((s) => { const [m, l, r] = s.split(":"); return [m, { l: +l, r: +r }]; }));
  const eyeRed = await page.evaluate(() => { duel(0.6, 2.0, { chain: "estocada", noTricks: true }); const e = E(); let red = 0, cyan = 0, n = 0;
    while (n < 60 * 4) { T(); n++; const a = e.act; if (a && a.plan && !a.plan.done) { const c = e.ch.uniforms.uEyeCol.value; if (a.move === "thrust" && c.x > 0.9 && c.y < 0.4) red++; if (a.move === "attack2" && c.x < 0.5) cyan++; } } return { red, cyan }; });
  check("avisos más evidentes cuanto más fuerte: zarpazo (1) < barrido (2) < peligrosos (3, ojo ROJO); la suelta avisa antes en los fuertes",
    lv.attack1 && lv.attack2 && lv.attack1.l < lv.attack2.l && lv.attack2.l < 3 && ["sweep", "thrust", "grab"].every((m) => !lv[m] || lv[m].l === 3) && lv.attack1.r < lv.attack2.r && eyeRed.red > 10 && eyeRed.cyan > 10, { niveles: fj.niveles, ojo: eyeRed });
  const nd = await page.evaluate(() => {
    const r = {}, e = E(), p = W.pf;
    duel(0.6, 2.0); let warns = 0;
    p.start("hit", { kb: 0, kdir: 0, moved: 0, speed: 0.12 }); for (let i = 0; i < 60 * 3; i++) T();      // tambaleo largo (4 s)
    r.golpe_recibido = W.combatLog.filter((x) => x.ev === "warn").length;
    duel(0.6, 2.0); p.hp = 0; p.start("death", { kb: 0, kdir: 0, moved: 0 }); T(180); r.en_el_suelo = W.combatLog.filter((x) => x.ev === "warn").length; p.respawn();
    duel(0.6, 2.0); T(180); r.de_pie = W.combatLog.filter((x) => x.ev === "warn").length;
    return r;
  });
  check("nunca ataca mientras estás en el suelo o en tu animación de golpe recibido", nd.golpe_recibido === 0 && nd.en_el_suelo === 0 && nd.de_pie > 0, nd);
  const pw = await page.evaluate(() => {
    const D = W.ENEMY_DIFF, k = [D.parry, D.block]; D.parry = 1; D.block = 1;
    duel(0.6, 2.0, { chain: "dos", noTricks: true }); Bot.reset({ react: 0.25 }); const e = E(); let n = 0;
    while (n < 60 * 8 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); n++; }
    const endT = W.ct; Bot.on = false; const vent = e.ai.vent; T(6); const hp0 = e.hp;
    W.pf.act = null; W.pf.input("attack", { dir: 0.6 + Math.PI }); T(40);
    const after = W.combatLog.slice(W.combatLog.findIndex((x) => x.ev === "chainEnd"));
    const warnSoon = after.find((x) => x.ev === "warn");
    D.parry = k[0]; D.block = k[1];
    return { ventana: +vent.toFixed(2), defensa: after.filter((x) => /^foe/.test(x.ev)).map((x) => x.ev), golpe: after.some((x) => x.ev === "hit" && x.who === "autómata"), dmg: Math.round(hp0 - e.hp) };
  });
  check("tras cada cadena, ventana de castigo clara (~1 s resoplando: ni ataca ni se defiende)", pw.ventana >= 0.8 && pw.defensa.length === 0 && pw.golpe && pw.dmg > 0, pw);
}

// =====================================================================================================
// ETAPA 4 · defensa del enemigo basada en leerte
// =====================================================================================================
if (STAGES.includes(4)) {
  await page.evaluate(() => {
    // registro de cuándo empieza cada golpe tuyo (para medir sus reacciones)
    const prev = W.onCombatAct;
    W.onCombatAct = function (actor, act) { if (actor === W.pf && act.name.startsWith("attack")) W.combatLog.push({ ev: "pStart", ct: +W.ct.toFixed(3), anim: act.name }); if (prev) prev(actor, act); };
    // guion de combos del jugador contra el autómata pasivo (no ataca: así se mide solo su defensa)
    window.combos = (mode, n, seed) => {
      const e = E(), p = W.pf; pair(0, 1.9); e.ai.enabled = true; e.ai.passive = true; e.ai.state = "chase"; p.hpMax = p.hp = 1e6; e.hpMax = e.hp = 1e6; W.combatLog.length = 0;
      let s = seed || 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const per = [];
      for (let k = 0; k < n; k++) {
        const toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x), n0 = W.combatLog.length;
        let plan, dur;
        if (mode === "repite") { plan = [[0, "a"], [0.25, "a"], [0.5, "a"]]; dur = 1.6; }
        else {
          const L = 1 + Math.floor(rnd() * 3); plan = [[0, rnd() < 0.35 ? "h" : "a"]];
          for (let i = 1; i < L; i++) plan.push([0.25 * i, "a"]);
          if (rnd() < 0.25) plan = [[0, "a"], [0.08, "F"], [0.4 + rnd() * 0.3, "a"]];      // finta y golpe
          dur = 1.0 + rnd() * 1.3;
        }
        const t0 = W.ct; let i = 0, held = false, rel = 0.1 + rnd() * 0.35;
        while (W.ct - t0 < dur) {
          const now = W.ct - t0;
          while (i < plan.length && plan[i][0] <= now) { const a = plan[i][1];
            if (a === "h") { p.input("attack", { dir: toE(), hold: true }); held = true; } else if (a === "F") { p.input("guardDown"); p.input("guardUp"); } else p.input("attack", { dir: toE() }); i++; }
          if (held && now > 0.15 + rel) { p.input("attackUp"); held = false; }
          T();
        }
        per.push(W.combatLog.slice(n0));
        W.teleport(e.body.x + 1.9, e.body.z);
      }
      return per;
    };
    window.outcome = (per, from) => { const r = { parry: 0, block: 0, hit: 0 }; for (const L of per.slice(from)) for (const x of L) if (x.from === "jugador" && r[x.ev] != null) r[x.ev]++; return r; };
  });
  const sp = await page.evaluate(() => { const per = combos("repite", 14); const o = outcome(per, 4);
    return { ...o, desviados: +(o.parry / (o.parry + o.block + o.hit)).toFixed(2), lecturas: per.flat().filter((x) => x.ev === "foeRead").length }; });
  check("te lee si te repites: el mismo combo con el mismo ritmo → la mayoría de tus golpes desviados", sp.desviados > 0.5, sp);
  const va = await page.evaluate(() => { const per = combos("varia", 18, 11); const o = outcome(per, 4); const L = per.flat();
    return { ...o, desviados: +(o.parry / (o.parry + o.block + o.hit)).toFixed(2), fallos_de_su_parry: L.filter((x) => x.ev === "foeParryWhiff").length, fintas: L.filter((x) => x.ev === "feint" && x.who === "jugador").length }; });
  check("si varías el ritmo, retrasas o fintas, falla: pocos golpes desviados", va.desviados <= 0.25 && va.desviados < sp.desviados - 0.3, va);

  // reacción humana: nunca reacciona antes de 200 ms; 200-260 según la dificultad
  const rx = await page.evaluate(() => {
    const D = W.ENEMY_DIFF, keep = D.react, r = {};
    for (const v of [0.5, 1.0, 1.6]) {
      D.react = v; const e = E(), p = W.pf, ts = [];
      for (let k = 0; k < 10; k++) { pair(0, 1.9); e.ai.enabled = true; e.ai.passive = true; e.ai.state = "chase"; e.ai.resetModel(); W.combatLog.length = 0;
        p.input("attack", { dir: Math.PI, hold: true }); T(50); p.input("attackUp"); T(40);       // golpe retenido: le da tiempo a reaccionar
        const s0 = W.combatLog.find((x) => x.ev === "pStart"), b = W.combatLog.find((x) => x.ev === "foeBlock" && x.reactive);
        if (s0 && b) ts.push(Math.round((b.ct - s0.ct) * 1000)); }
      r["x" + v] = { min: Math.min(...ts), max: Math.max(...ts), n: ts.length };
    }
    D.react = keep; return r;
  });
  check("reacción de velocidad humana: 200-260 ms con variación según la dificultad, nunca menos de 200 ms",
    Object.values(rx).every((q) => q.n >= 8 && q.min >= 200 && q.max <= 260 + 17) && rx["x0.5"].min > rx["x1.6"].max - 30, { ...rx, nota: "medido en pasos de 1/60 s (+17 ms)" });
  const fast = await page.evaluate(() => { const e = E(), p = W.pf; const res = [];
    for (let k = 0; k < 6; k++) { pair(0, 1.9); e.ai.enabled = true; e.ai.passive = true; e.ai.state = "chase"; e.ai.resetModel(); W.combatLog.length = 0; p.input("attack", { dir: Math.PI }); T(40);
      res.push(W.combatLog.filter((x) => /^foe|^parry$|^block$|^hit$/.test(x.ev)).map((x) => x.ev).join("|")); }
    return res; });
  check("a un golpe más rápido que su reacción (zarpazo, 205 ms) no puede reaccionar: solo lo para si lo ha leído", fast.every((x) => x === "hit"), fast);

  // su parry se ve venir: guardia (ojo ámbar) unos ms antes; si falla, queda expuesto
  const vis = await page.evaluate(() => {
    const per = combos("repite", 10); const L = per.flat(), e = E();
    const tries = L.filter((x) => x.ev === "foeParryTry"), guards = L.filter((x) => x.ev === "foeGuard");
    const leads = tries.map((t) => { const g = guards.filter((x) => x.ct <= t.ct).pop(); return g ? Math.round((t.ct - g.ct) * 1000) : -1; });
    // color del ojo durante la guardia leída
    let amber = 0; const c = e.ai.commit; return { intentos: tries.length, antelacion_ms: leads, min: Math.min(...leads) };
  });
  const eye = await page.evaluate(() => { combos("repite", 6); const e = E(), p = W.pf; let amber = 0, n = 0;
    // un combo más observando el ojo
    const toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x), t0 = W.ct; let i = 0; const plan = [[0, 1], [0.25, 1], [0.5, 1]];
    while (W.ct - t0 < 1.6) { while (i < plan.length && plan[i][0] <= W.ct - t0) { p.input("attack", { dir: toE() }); i++; } T(); const col = e.ch.uniforms.uEyeCol.value; if (e.ai.commit && e.ai.commit.stanceOn) { n++; if (col.x > 0.95 && col.y > 0.6 && col.y < 0.8) amber++; } }
    return { frames_en_guardia: n, ojo_ambar: amber }; });
  check("su parry se ve venir: alza la guardia (ojo ámbar) ≥ 150 ms antes de intentarlo", vis.intentos >= 3 && vis.min >= 150 && eye.frames_en_guardia > 5 && eye.ojo_ambar === eye.frames_en_guardia, { ...vis, ...eye });
  const ex = await page.evaluate(() => {
    // le enseñas un ritmo y luego lo cambias (retrasas el golpe): su parry se queda en el aire
    const e = E(), p = W.pf; combos("repite", 7); const toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x);
    W.combatLog.length = 0; e.post = 0; const t0 = W.ct; let pressed = false, released = false, gain = null, exp = false;
    while (W.ct - t0 < 1.6) { const now = W.ct - t0;
      if (!pressed) { p.input("attack", { dir: toE(), hold: true }); pressed = true; }
      if (!released && now > 0.55) { p.input("attackUp"); released = true; }
      const before = e.post, wasExp = !!(e.act && e.act.exposed), nh = W.combatLog.filter((x) => x.ev === "hit").length;
      T();
      if (gain == null && W.combatLog.filter((x) => x.ev === "hit").length > nh) { gain = e.post - before; exp = wasExp; window._dbgHit = W.combatLog.filter((x) => x.ev === "hit").pop(); } }
    const L = W.combatLog;
    return { secuencia: L.filter((x) => /^foe|^hit$|^parry$/.test(x.ev)).map((x) => x.ev), golpe_con_expuesto: exp, postura: gain == null ? null : +gain.toFixed(1), golpe: window._dbgHit };
  });
  check("si lo engañas (retrasas el golpe que esperaba), su parry falla y queda EXPUESTO: tu golpe entra con más postura",
    ex.secuencia.includes("foeParryWhiff") && ex.golpe_con_expuesto && ex.postura >= 10.4, ex);
  await page.evaluate(() => { const e = E(); combos("repite", 7); W.skipRender = false; const p = W.pf, toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x);
    const t0 = W.ct; p.input("attack", { dir: toE() }); while (W.ct - t0 < 1.0 && !(e.ai.commit && e.ai.commit.stanceOn)) T(); });
  await shot("E4_guardia_leida");

  // herramientas del jugador: finta (gasta stamina) y retraso manteniendo el ataque
  const tools = await page.evaluate(() => {
    const p = W.pf, r = {};
    pair(0, 1.9); W.combatLog.length = 0; p.input("attack", { dir: Math.PI }); T(5); const st0 = p.st; p.input("guardDown"); p.input("guardUp"); T(2);
    r.finta = { ev: W.combatLog.filter((x) => x.who === "jugador").map((x) => x.ev), stamina: Math.round(p.st - st0), act: p.act && p.act.name };
    T(30);
    for (const [k, hold] of [["normal", 0], ["retenido", 0.35]]) { pair(0, 1.9); W.combatLog.length = 0; const t0 = W.ct; p.input("attack", { dir: Math.PI, hold: true });
      let n = 0; while (!(p.act && p.act.impactT != null) && n < 120) { if (W.ct - t0 >= (hold || 0.0) ) p.input("attackUp"); T(); n++; } r[k] = Math.round((p.act.impactT - t0) * 1000); }
    return r;
  });
  check("tus herramientas: FINTA (guardia durante la preparación cancela tu golpe y gasta stamina) y RETRASO (mantener el ataque)",
    tools.finta.ev.includes("feint") && tools.finta.stamina <= -12 && tools.finta.act === "parry" && tools.retenido >= tools.normal + 150, tools);

  // su conocimiento se reinicia al reaparecer
  const rs = await page.evaluate(() => { const e = E(); combos("repite", 5); const before = Object.keys(e.ai.grams).length; W.respawnAll(); return { antes: before, despues: Object.keys(e.ai.grams).length, fichas: e.ai.tokens.length }; });
  check("su conocimiento de tus hábitos se reinicia cada vez que reaparece", rs.antes > 3 && rs.despues === 0 && rs.fichas === 0, rs);

  // dificultad adaptativa suave
  const ad = await page.evaluate(() => {
    const e = E(), p = W.pf, r = {}; e.ai.adapt = 0; e.ai.deaths = 0;
    pair(0, 2.0); e.ai.enabled = true;
    for (let k = 0; k < 3; k++) { p.hp = 0; p.start("death", { kb: 0, kdir: 0, moved: 0 }); T(5); W.respawnAll(); T(5); }
    r.tras_3_muertes = { adapt: +e.ai.adapt.toFixed(2), pausas: +e.ai.pauseK().toFixed(2), muertes: e.ai.deaths };
    e.ai.deaths = 0;
    e.ai.adapt = 0; e.ai.perfStreak = 0;
    for (let k = 0; k < 5; k++) { pair(0.6, 2.0); foeAttack("attack1", pressAt(0.04)); }
    r.tras_5_perfectos = { adapt: +e.ai.adapt.toFixed(2), pausas: +e.ai.pauseK().toFixed(2) };
    return r;
  });
  await page.evaluate(() => { W.skipRender = false; T(1); });
  await page.click("#tbtn"); await page.evaluate(() => { T(60); });
  const info = await page.evaluate(() => document.getElementById("tInfo").innerText);
  await page.screenshot({ path: `${OUT}/E4_panel.png` });
  await page.click("#tbtn");
  check("dificultad adaptativa suave: muertes seguidas → pausas más largas; perfectos seguidos → más cortas y más trucos; se ve en el panel",
    ad.tras_3_muertes.adapt <= -0.9 && ad.tras_3_muertes.muertes === 3 && ad.tras_3_muertes.pausas >= 1.2 && ad.tras_5_perfectos.adapt > 0.3 && ad.tras_5_perfectos.pausas < 0.95 && /Adaptativa/.test(info) && /Te lee/.test(info), { ...ad, panel: info });
  await page.evaluate(() => { E().ai.adapt = 0; E().ai.deaths = 0; W.skipRender = true; });
}

// =====================================================================================================
// ETAPA 5 · práctica y lectura
// =====================================================================================================
if (STAGES.includes(5)) {
  await page.evaluate(() => { W.skipRender = false; T(1); });
  await page.click("#tbtn");
  const opts = await page.evaluate(() => [...document.querySelectorAll("#trainSel option")].map((o) => o.value));
  await page.selectOption("#trainSel", "cuatro");
  await page.click("#tbtn");
  const tr = await page.evaluate(() => {
    const e = E(), p = W.pf; pair(0.6, 2.0); W.setTraining("cuatro"); e.ai.enabled = true; e.ai.state = "chase"; e.ai.cool = 0.2; W.combatLog.length = 0;
    Bot.reset({ react: 0.25 }); let n = 0;
    while (n < 60 * 25 && W.combatLog.filter((x) => x.ev === "chainEnd").length < 3) { TB(); n++; }
    // sin defenderse: le das durante su cadena
    const ids = W.combatLog.filter((x) => x.ev === "chainStart").map((x) => x.chain);
    const defensa = W.combatLog.filter((x) => /^foe(Read|Guard|ParryTry|Block)/.test(x.ev)).length;
    // nadie muere: te dejas golpear (sin bot)
    Bot.on = false; p.hp = 12; e.hp = 5; for (let i = 0; i < 60 * 4; i++) T();
    return { opciones: [...document.querySelectorAll("#trainSel option")].length, cadenas: ids, defensa, vivos: p.alive && e.alive, sel: document.getElementById("trainSel").value };
  });
  check("modo entrenamiento (panel ⚙): el autómata repite la cadena elegida, sin leerte ni defenderse, y nadie muere",
    opts.length >= 10 && tr.cadenas.length >= 3 && tr.cadenas.every((c) => c === "cuatro") && tr.defensa === 0 && tr.vivos && tr.sel === "cuatro", { ...tr, opciones: opts.join(",") });
  // indicador de timing tras cada golpe suyo
  const ind = await page.evaluate(() => {
    const r = {};
    const one = (L, opt) => { pair(0.6, 2.0); W.setTraining("dos"); const e = E(); W.lastTiming = ""; e.startAttack("attack1", { dir: e.body.heading });
      let n = 0, done = false; while (e.act && e.act.name === "attack1" && !e.act.hitDone && n < 400) { const l = e.toImpact(); if (!done && L != null && l <= L) { W.pf.input("guardDown", { ts: performance.now() + (l - L) * 1000 }); W.pf.input("guardUp"); done = true; } T(); n++; }
      if (opt === "late") { T(2); W.pf.input("guardDown"); W.pf.input("guardUp"); }
      T(3); const p = W.combatLog.filter((x) => x.ev === "parry").pop(); return { txt: W.lastTiming, early: p && p.early }; };
    r.perfecto = one(0.045); r.normal = one(0.13); r.pronto = one(0.45); r.tarde = one(null, "late");
    // peligroso fallado: la respuesta correcta
    duel(0.6, 2.0, { chain: "barrido", noTricks: true }); W.setTraining("barrido"); W.lastTiming = ""; Bot.reset({ react: 0.25, answer: { sweep: "parry" } }); let n = 0, txts = [];
    while (n < 60 * 6 && !W.combatLog.some((x) => x.ev === "chainEnd")) { TB(); n++; if (W.lastTiming && txts[txts.length - 1] !== W.lastTiming) txts.push(W.lastTiming); }
    r.peligro = txts;
    return r;
  });
  check("indicador tras cada golpe: ms de antelación y nivel (PERFECTO / PARRY), PRONTO o TARDE, y en los peligrosos la respuesta",
    ind.perfecto.txt === "PERFECTO · " + ind.perfecto.early + " ms antes" && ind.normal.txt === "PARRY · " + ind.normal.early + " ms antes" &&
    /^PRONTO · 4\d\d ms antes$/.test(ind.pronto.txt) && /^TARDE · \d+ ms$/.test(ind.tarde.txt) && ind.peligro.includes("BARRIDO → salta"), ind);
  await page.evaluate(() => { W.skipRender = false; pair(Math.PI * 0.75, 2.0); W.setTraining("dos"); const e = E(); e.startAttack("attack2", { dir: e.body.heading });
    let n = 0, done = false; while (e.act && e.act.name.startsWith("attack") && !e.act.hitDone && n < 400) { const l = e.toImpact(); if (!done && l <= 0.05) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } T(); n++; } T(3); W.skipRender = false; T(1); });
  await page.screenshot({ path: `${OUT}/E5_entrenamiento.png` });
  // barras de postura de ambos siempre visibles en combate + ventana de contraataque
  const bars = await page.evaluate(() => {
    const r = {}, vis = (id) => getComputedStyle(document.getElementById(id)).display !== "none";
    W.setTraining(""); pair(0.6, 2.0); E().post = 40; W.pf.post = 25; T(2);
    const w = (sel) => parseFloat(document.querySelector(sel).style.width);
    r.cerca = { enemigo: vis("duelE"), tu: vis("duelP"), anchoE: w("#duelE .pb i"), anchoP: w("#duelP .pb i") };
    const e = E(); W.teleport(e.home.x + 20, e.home.z); T(3); r.lejos = { enemigo: vis("duelE"), tu: vis("duelP") };
    pair(0.6, 2.0); foeAttack("attack1", pressAt(0.04)); r.contra = { visible: document.querySelector("#duelP .cw").classList.contains("on"), ancho: w("#duelP .cw i") };
    let n = 0; while (W.ct < W.pf.counterT + 0.02 && n < 60) { T(); n++; } T(1); r.contra_despues = document.querySelector("#duelP .cw").classList.contains("on");
    return r;
  });
  check("barras de postura de ambos siempre visibles en combate (y ocultas lejos), con la ventana de contraataque bajo la tuya",
    bars.cerca.enemigo && bars.cerca.tu && Math.abs(bars.cerca.anchoE - 40) < 6 && Math.abs(bars.cerca.anchoP - 25) < 6 && !bars.lejos.enemigo && !bars.lejos.tu && bars.contra.visible && !bars.contra_despues, bars);
  await page.evaluate(() => { W.skipRender = false; pair(Math.PI * 0.75, 2.0); const e = E(); e.post = 62; e.startAttack("attack1", { dir: e.body.heading });
    let n = 0, done = false; while (e.act && e.act.name.startsWith("attack") && !e.act.hitDone && n < 400) { const l = e.toImpact(); if (!done && l <= 0.04) { W.pf.input("guardDown"); W.pf.input("guardUp"); done = true; } T(); n++; } T(2); W.skipRender = false; T(1); });
  await page.screenshot({ path: `${OUT}/E5_barras_contra.png` });
  await page.evaluate(() => { W.setTraining(""); W.skipRender = true; });
}

// =====================================================================================================
// ETAPA 6 · justicia: bot con reacción humana (250 ms ± 40 ms) que intenta desviarlo todo
// =====================================================================================================
if (STAGES.includes(6)) {
  const fair = await page.evaluate(() => {
    const stats = {}, add = (k, ok) => { const s = stats[k] || (stats[k] = { n: 0, ok: 0 }); s.n++; if (ok) s.ok++; };
    const keep = W.AUTOMATON.trick;
    const runs = [["rrl", null], ["lpr", null], ["dos", null], ["cuatro", null], ["dos", "delay"], ["rrl", "delay"], ["lpr", "delay"], ["cuatro", "delay"], ["dos", "feint"], ["lpr", "feint"], ["barrido", null], ["estocada", null], ["agarre", null]];
    let seed = 101;
    for (const [chain, trick] of runs) for (let rep = 0; rep < 16; rep++) {
      duel(0.6, 2.0, { chain, trick, noTricks: !trick }); Bot.reset({ react: 0.25, jit: 0.04, seed: seed++ });
      const e = E(); e.post = 0; let n = 0;
      // cada golpe: tipo (con su truco) y resultado
      const mine = new Map(); let cur = null;
      while (n < 60 * 9 && !W.combatLog.some((x) => x.ev === "chainEnd")) {
        TB(); n++;
        const a = e.act;
        if (a && a.plan && a !== cur) { cur = a; mine.set(a, { move: a.move, delayed: a.plan.hold > 0, afterFeint: W.combatLog.some((x) => x.ev === "feint") && !a.plan.feint, feinted: !!a.plan.feint }); }
      }
      // resultados en orden de impacto
      const res = W.combatLog.filter((x) => x.who === "jugador" && ["parry", "block", "hit", "evade", "mikiri"].includes(x.ev) || x.ev === "whiff" && x.who === "autómata");
      const kinds = [...mine.values()].filter((k) => !k.feinted);
      kinds.forEach((k, i) => {
        const r = res[i]; if (!r) return;
        const peril = ["sweep", "thrust", "grab"].includes(k.move);
        const key = peril ? k.move : k.move + (k.delayed ? " retrasado" : k.afterFeint ? " tras finta" : "");
        const ok = peril ? (r.ev === "evade" || r.ev === "mikiri" || r.ev === "whiff") : r.ev === "parry";
        add(key, ok);
      });
    }
    W.AUTOMATON.trick = keep;
    const out = {}; for (const k in stats) out[k] = { n: stats[k].n, pct: Math.round(100 * stats[k].ok / stats[k].n) };
    return out;
  });
  window_fair = fair;
  const normal = Object.entries(fair).filter(([k]) => /^attack/.test(k)), peril = Object.entries(fair).filter(([k]) => !/^attack/.test(k));
  check("bot humano (reacción 250 ms ± 40 ms): desvía ≥ 75 % de cada tipo de ataque normal (también retrasados y tras finta)",
    normal.length >= 4 && normal.every(([, v]) => v.n >= 8 && v.pct >= 75), fair);
  check("bot humano: evita cada ataque peligroso con la respuesta correcta (salto, esquiva hacia él, esquiva de lado) ≥ 75 %",
    peril.length === 3 && peril.every(([, v]) => v.n >= 8 && v.pct >= 75), Object.fromEntries(peril));
}

const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
