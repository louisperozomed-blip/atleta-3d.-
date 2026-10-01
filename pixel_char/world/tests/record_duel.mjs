// GIF del duelo contra el autómata (IA real; paso fijo 1/60 s, una captura cada 4 pasos = 15 fps).
// Guion de cadenas (para enseñar cada cosa una vez) y un jugador con reacción humana (250 ms ± 40 ms):
//   1) «dos»: desvía la cadena (clin-clin) y castiga en la ventana de resoplido
//   2) «barrido»: salta el barrido y contraataca en el aire
//   3) «estocada»: esquiva hacia él (contraataque, mucha postura)
//   4) «rápido-rápido-lento» con un golpe retrasado: espera la suelta
//   5) castigas siempre con el mismo combo → te lee (guardia ámbar) y te desvía; luego retrasas el golpe → falla
//      y queda expuesto
//   6) hasta romperle la postura y rematar
// uso: node record_duel.mjs <dist/index.html> <carpeta> [ancho alto]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "720", h = "480"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith(".png")) fs.unlinkSync(path.join(out, f));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; const b = document.querySelector(".bar"); if (b) b.style.display = "none";
  for (const id of ["cpad", "tbtn"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
  const e = W.foe, p = W.pf, ai = e.ai;
  for (const f of W.foes) f.ai.enabled = f === e;
  const m = W.camera.matrixWorld.elements, rl = Math.hypot(m[0], m[2]), rx = m[0] / rl, rz = m[2] / rl;
  W.teleport(e.home.x - rx * 2.1, e.home.z - rz * 2.1); e.body.heading = Math.atan2(-rz, -rx); W.tick(1 / 60, 10);
  ai.state = "chase"; ai.cool = 0.4; p.hpMax = p.hp = 400;
  let s = 99; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const script = [["dos", null], ["barrido", null], ["estocada", null], ["rrl", "delay"], ["dos", null], ["dos", null], ["lpr", null], ["dos", null], ["cuatro", null]];
  const S = (window.DIR = { i: 0, seen: null, pend: null, punish: null, combos: 0, phase: "" });
  ai.forced = script[0][0]; ai.forcedTrick = script[0][1]; ai.noTricks = !script[0][1];
  // al empezar cada cadena, prepara la siguiente del guion
  const start0 = ai.startChain.bind(ai);
  ai.startChain = (def) => { start0(def); S.i++; const nx = script[Math.min(S.i, script.length - 1)]; ai.forced = nx[0]; ai.forcedTrick = nx[1]; ai.noTricks = !nx[1]; };
  const toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x);
  window.dirStep = () => {
    const a = e.act;
    // reacción a la SUELTA de cada golpe
    if (a && a.plan && a.plan.released && a !== S.seen) { S.seen = a; const P = a.plan; S.pend = { at: W.ct - (P.t - P.wind - P.hold) + 0.25 + gauss() * 0.04, move: a.move }; }
    if (S.pend && W.ct >= S.pend.at) {
      const q = S.pend; S.pend = null;
      if (q.move === "sweep") W.player.doJump();
      else if (q.move === "thrust") p.input("dodge", { dir: toE() });
      else if (q.move === "grab") p.input("dodge", { dir: toE() + Math.PI / 2 });
      else { p.input("guardDown", { ts: performance.now() + (q.at - W.ct) * 1000 }); p.input("guardUp"); }
    }
    if (p.airCounterT > W.ct && W.player.jump && W.player.jump.h > 0.25 * W.CHAR_H) p.input("attack", { dir: toE() });
    if (p.counterT > W.ct && !(p.act && p.act.name.startsWith("attack"))) p.input("attack", { dir: toE() });
    // castigo en la ventana de resoplido: siempre el mismo combo (a1 a2) → acaba leyéndote; el 6.º, retrasado
    if (ai.vent > 0.85 && !S.punish && !p.act) { S.combos++; S.punish = { t0: W.ct, k: 0, delay: S.combos === 6 }; }
    if (S.punish) {
      const u = W.ct - S.punish.t0, P = S.punish;
      if (P.delay) { if (P.k === 0) { p.input("attack", { dir: toE(), hold: true }); P.k = 1; } if (P.k === 1 && u > 0.55) { p.input("attackUp"); P.k = 2; } if (u > 1.3) S.punish = null; }
      else { if (P.k === 0) { p.input("attack", { dir: toE() }); P.k = 1; } if (P.k === 1 && u > 0.25) { p.input("attack", { dir: toE() }); P.k = 2; } if (u > 1.0) S.punish = null; }
    }
    // vuelve a su distancia si se ha separado
    const d = Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z);
    if (d > 3.2 && !p.act && !W.player.path.length) W.goTo(e.body.x - Math.cos(toE()) * 2.0, e.body.z - Math.sin(toE()) * 2.0);
  };
});
const N = +(process.env.FRAMES || 540);
const info = [];
for (let i = 0; i < N; i++) {
  const s = await page.evaluate(() => { for (let k = 0; k < 4; k++) { dirStep(); W.tick(1 / 60); } const e = W.foe;
    return { e: e.act && (e.act.move || e.act.name), p: W.pf.act && W.pf.act.name, post: [Math.round(W.pf.post), Math.round(e.post)], hp: Math.round(e.hp), alive: e.alive }; });
  info.push(s);
  await page.screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` });
  if (!s.alive) { for (let k = 0; k < 20; k++) { await page.evaluate(() => W.tick(1 / 60, 4)); await page.screenshot({ path: `${out}/f${String(i + 1 + k).padStart(4, "0")}.png` }); } break; }
}
const log = await page.evaluate(() => W.combatLog.filter((x) => !["swing", "warn", "hold", "release"].includes(x.ev)).map((x) => x.ev + (x.move ? ":" + x.move : x.chain ? "@" + x.chain : "") + (x.level ? "/" + x.level : "")));
fs.writeFileSync(`${out}/info.json`, JSON.stringify({ info, log }));
console.log("frames", info.length, "\n" + log.join(" "));
await browser.close();
