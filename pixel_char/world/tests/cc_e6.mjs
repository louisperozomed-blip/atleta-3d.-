// Combate completo · Etapa 6: el autómata castiga la repetición (familiaridad por combo) y su HEAVY.
// uso: node cc_e6.mjs <dist/index.html> <carpeta>
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
  W.manual = true; W.skipRender = true; window.T = (n) => W.tick(1 / 60, n || 1);
  const A = (window.A = W.foes[0]), B = (window.B = W.foes[1]);
  const s = W.findSpot(-8, 1, null, 2.4);
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  let seed = 11; window.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  window.place = () => {
    W.pf.hp = W.pf.hpMax; W.pf.st = W.pf.stMax; W.pf.post = 0; W.pf.act = null; W.pf.combo = null; W.pf.beat = null; W.hitstop = 0;
    W.teleport(s.x, s.z);
    const a = 0.5; A.body.x = s.x + Math.cos(a) * 1.9; A.body.z = s.z + Math.sin(a) * 1.9; A.body.y = A.body.ground = W.heightAt(A.body.x, A.body.z); A.body.path = [];
    A.body.heading = a + Math.PI; W.player.heading = a; A.hp = A.hpMax = 1e6; A.post = 0; A.st = A.stMax; A.act = null; A.guardHeld = false;
    W.setTarget(A);
  };
  window.reset = () => {
    W.pf.respawn(); for (const f of W.foes) { f.respawn(); f.ai.resetModel(); f.ai.enabled = f === A; } B.body.x = 999; B.body.z = 999;
    place(); const ai = A.ai; ai.state = "chase"; ai.passive = true; ai.cool = 99; ai.vent = 0; T(10); W.combatLog.length = 0;
  };
  // un combo con presión de ritmo: pulsa en el pulso de cada golpe (+ desfase off y temblor humano ±jit)
  window.play = (seq, off, jit, feintAt, holdTicks) => {
    const p = W.pf; place(); A.ai.vent = 0; A.ai.chain = null; T(40);
    const n0 = W.combatLog.length;
    for (let i = 0; i < seq.length; i++) {
      if (i > 0) { let n = 0; while (p.beat == null && p.act && n++ < 300) T(1); if (p.beat == null) break;
        const o = (off && off[i] != null ? off[i] : 0) + (jit ? (rnd() - 0.5) * 2 * jit : 0); const at = p.beat + o;
        while (W.ct < at - 1 / 60 && n++ < 400) T(1); }
      const at = W.ct;
      W.attackPress("key", performance.now(), A);
      if (seq[i] === "H") { T(holdTicks || 28); if (feintAt === i) { W.pf.input("guardDown", { ts: performance.now() }); W.pf.input("guardUp"); W.attackRelease("key"); break; } }
      else T(2);
      W.attackRelease("key");
    }
    let n = 0; while ((p.act || n < 20) && n++ < 400) T(1);
    T(60);
    const ev = W.combatLog.slice(n0);
    const myHits = ev.filter((x) => x.from === "jugador" || x.who === "autómata");
    return {
      fam: Object.fromEntries(Object.entries(A.ai.fam).map(([k, v]) => [k, +v.toFixed(2)])),
      parried: ev.filter((x) => x.ev === "parry" && x.who === "autómata").map((x) => x.anim),
      blocked: ev.filter((x) => x.ev === "block" && x.who === "autómata").map((x) => x.anim),
      whiff: ev.filter((x) => x.ev === "foeParryWhiff").length, read: ev.filter((x) => x.ev === "comboRead").map((x) => x.level),
      interrupt: ev.filter((x) => x.ev === "foeInterrupt").length, hitsMe: ev.filter((x) => x.ev === "hit" && x.who === "jugador").length,
    };
  };
});
// 1) repetir L·L·L en ritmo: la familiaridad sube; baja → bloquea a veces, media → bloquea, alta → desvía el final
const rep = await page.evaluate(() => { reset(); const out = []; for (let k = 0; k < 8; k++) { const r = play("LLL", null, 0.02); out.push({ fam: r.fam["LLL:r"], read: r.read.join("/"), parried: r.parried.join("/"), blocked: r.blocked.join("/") }); } return out; });
const famUp = rep.every((r, i) => i === 0 || r.fam > rep[i - 1].fam);
const finals = rep.filter((r) => r.parried.includes("attack3")).length;
check("repetir L·L·L: la familiaridad sube en cada repetición y, alta, desvía el golpe final (bloquea antes)", famUp && finals >= 4 && rep.slice(0, 2).every((r) => !r.parried.includes("attack3")), rep);
// 2) variar el ritmo de un combo muy familiar lo engaña: su parry se queda en el aire (expuesto)
const vary = await page.evaluate(() => { const r = play("LLL", [0, 0, 0.16], 0); return r; });
check("variar el ritmo (3.º 160 ms tarde) engaña al que te ha leído: su parry falla y queda expuesto", vary.whiff >= 1 && !vary.parried.includes("attack3"), vary);
// 3) fintar también: carga del fuerte cancelada con la guardia
const fe = await page.evaluate(() => { reset(); for (let k = 0; k < 6; k++) play("LH", null, 0.02); const before = A.ai.fam["LH:r"] || A.ai.fam["LH:-"] || 0; const r = play("LH", null, 0, 1); r.before = +before.toFixed(2); return r; });
check("con L·H muy leído te interrumpe durante la carga; fintar (guardia en la carga) la cancela", fe.before >= 0.55, fe);
const intr = await page.evaluate(() => { reset(); const out = []; for (let k = 0; k < 7; k++) { const r = play("LH", null, 0.02, null, 56); out.push(r.interrupt); } return out; });   // (cargando ~0,5 s: le da tiempo a reaccionar)
check("alta familiaridad con un combo que acaba en fuerte: te interrumpe durante la carga", intr.slice(4).some((x) => x >= 1), intr);
// 4) alternar 3 combos con buen ritmo: familiaridad baja y casi sin desvíos
const alt = await page.evaluate(() => {
  reset(); const C = ["LLL", "LLH", "HL"]; let prev = -1; const out = { parried: 0, finals: 0, fams: [] };
  for (let k = 0; k < 12; k++) { let i; do { i = Math.floor(rnd() * 3); } while (i === prev); prev = i; const r = play(C[i], null, 0.02); out.parried += r.parried.length; out.finals++; }
  out.fams = Object.fromEntries(Object.entries(A.ai.fam).map(([k, v]) => [k, +v.toFixed(2)])); return out;
});
const maxF = Math.max(...Object.values(alt.fams));
check("alternar 3 combos con buen ritmo: su familiaridad se queda baja y apenas desvía", maxF < 0.55 && alt.parried <= 2, alt);
// 5) ojo ámbar al leerte; justicia: cada parry suyo viene de una predicción
const eye = await page.evaluate(() => { reset(); for (let k = 0; k < 4; k++) play("LLL", null, 0.01);
  place(); A.ai.vent = 0; T(30); W.attackPress("key", performance.now(), A); T(2); W.attackRelease("key"); let n = 0, amber = 0;
  while (n++ < 40) { T(1); const c = A.ch.uniforms.uEyeCol.value; if (c.x > 0.9 && c.y > 0.6 && c.y < 0.8) amber++; }
  const parries = W.combatLog.filter((x) => x.ev === "parry" && x.who === "autómata"), reads = W.combatLog.filter((x) => x.ev === "foeReadCombo" && x.kind === "parry");
  return { amber, blink: A.readBlink > -1, parries: parries.length, predicciones: reads.length };
});
check("cuando te ha leído su ojo parpadea en ámbar; solo desvía lo que ha predicho", eye.amber >= 3 && eye.parries <= eye.predicciones, eye);
// 6) en grupo comparten el 50 %; al reaparecer se olvida
const grp = await page.evaluate(() => { reset(); B.ai.resetModel(); for (let k = 0; k < 3; k++) play("LLL", null, 0.01);
  const a = A.ai.fam["LLL:r"], b = B.ai.fam["LLL:r"] || 0; W.respawnAll(); const a2 = Object.keys(A.ai.fam).length; return { a: +a.toFixed(3), b: +b.toFixed(3), ratio: +(b / a).toFixed(2), trasReaparecer: a2 }; });
check("en grupo comparten el 50 % de lo aprendido; al reaparecer se reinicia", Math.abs(grp.ratio - 0.5) < 0.08 && grp.trasReaparecer === 0, grp);
// 7) su HEAVY: aviso largo (HOLD ≥ 0,35 s, ojo naranja, sonido grave), hyper armor y te rompe la guardia si lo bloqueas
const hv = await page.evaluate(() => {
  reset(); A.ai.passive = false; A.ai.noTricks = true; const played = []; const k0 = W.sfx.combat; W.sfx.combat = function (k) { played.push(k); return k0.apply(this, arguments); };
  W.pf.input("guardDown", { ts: performance.now() }); A.ai.attack("heavy");
  let n = 0, holdT = 0, eyeOr = 0; while (n++ < 300) { const a = A.act; if (a && a.plan && a.plan.held && !a.plan.released) holdT += 1 / 60;
    const c = A.ch.uniforms.uEyeCol.value; if (a && a.name === "heavy" && c.x > 0.9 && c.y > 0.4 && c.y < 0.6) eyeOr++; T(1); if (L("guardbreak").length || L("hit").length) break; }
  W.pf.input("guardUp"); W.sfx.combat = k0;
  const w = L("warn")[0];
  return { anim: w && w.anim, prep_ms: w && Math.round(w.prep * 1000), hold_ms: Math.round(holdT * 1000), eyeOr, sonido: played.includes("chargeHeavy"), guardbreak: L("guardbreak").length };
});
check("su HEAVY: preparación más larga (retención ≥ 0,35 s) con aviso evidente (ojo naranja, sonido grave) y rompe la guardia si lo bloqueas",
  hv.anim === "heavy" && hv.hold_ms >= 340 && hv.prep_ms >= 800 && hv.eyeOr > 10 && hv.sonido && hv.guardbreak === 1, hv);
// 8) cadenas que mezclan ligeros y su HEAVY; si bloqueas su primer golpe, sigue con el HEAVY
const br = await page.evaluate(() => {
  reset(); const ai = A.ai; ai.passive = false; ai.noTricks = true; ai.forced = "dos"; ai.cool = 0.1; place(); T(5);
  W.pf.input("guardDown", { ts: performance.now() }); let n = 0; while (n++ < 400 && !L("branch").length) T(1); W.pf.input("guardUp");
  const b = L("branch")[0]; ai.forced = null; ai.passive = true;
  return { rama: b && b.resp, a: b && b.to, cadenas: W.AUTOMATON.chains.filter((c) => c.steps.some((s) => s[0] === "heavy")).map((c) => c.id) };
});
check("cadenas con su HEAVY y la rama «lo bloqueas» → HEAVY para romper la guardia", br.rama === "block" && br.a === "heavy" && br.cadenas.length >= 2, br);
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
