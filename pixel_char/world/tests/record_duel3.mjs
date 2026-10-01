// GIF de la mejora del duelo (paso fijo 1/60 s, una captura cada 3 pasos = 20 fps). Guion con la IA real:
//   1) parry perfecto (cámara lenta, chispas doradas) → DESEQUILIBRADO → riposte de 3 golpes con buen ritmo
//      (anillo del ritmo) → otro parry perfecto + riposte rompe la postura → DEATHBLOW
//   2) su lectura: repites el combo → te desvía y lanza su COUNTER → lo desvías (clin-clin) → falla él → riposte
//   3) choque: los dos a la vez
// uso: node record_duel3.mjs <dist/index.html> <carpeta> [ancho alto]
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
  ai.state = "chase"; ai.cool = 0.5; p.hpMax = p.hp = 400; e.hpMax = e.hp = 400;
  let s = 99; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const toE = () => Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x);
  const atk = (at) => p.input("attack", { dir: toE(), ts: performance.now() + (at - W.ct) * 1000 });
  ai.forced = "dos"; ai.noTricks = true;
  const S = (window.DIR = { seen: null, pend: null, rip: null, pp: 0, combo: null, combos: 0, phase: 1, clashT: null });
  window.dirStep = () => {
    const a = e.act, L = W.combatLog;
    // desvía cada golpe con un perfecto (40 ms antes del impacto, como un jugador que ya lo domina)
    if (a && a.plan && W.isAtk(a) && !a.hitDone && a !== S.seen) { const l = e.toImpact(); if (l != null && l <= 0.045) { S.seen = a; p.input("guardDown", { ts: performance.now() + (l - 0.04) * 1000 }); p.input("guardUp"); } }
    // riposte con buen ritmo tras cada perfecto
    const pp = L.filter((x) => x.ev === "parry" && x.who === "jugador" && x.level === "perfect").length;
    if (pp > S.pp) { S.pp = pp; S.rip = { k: 0, at: W.ct + 0.25 + gauss() * 0.03 }; }
    const R = S.rip, pa = p.act;
    if (R) {
      if (pa && pa.name === "riposte" && pa.ripN === 1 && pa.impactT != null && R.at2 == null) R.at2 = pa.impactT + 0.22;
      if (R.k === 0 && W.ct >= R.at) { atk(R.at); R.k = 1; }
      else if (R.k === 1 && R.at2 != null && W.ct >= R.at2) { atk(R.at2); R.k = 2; }
      else if (R.k === 2 && p.rip && p.rip.beat != null) { R.at3 = p.rip.beat + gauss() * 0.02; R.k = 3; }
      else if (R.k === 3 && W.ct >= R.at3) { atk(R.at3); R.k = 4; S.rip = null; }
    }
    // fase 2 (tras el remate): castiga siempre con el mismo combo en su resoplido → te lee, te desvía y contraataca
    if (S.phase === 2 && ai.vent > 0.8 && !S.combo && !pa) { S.combo = { t0: W.ct, k: 0 }; S.combos++; }
    if (S.combo) { const u = W.ct - S.combo.t0; if (S.combo.k === 0) { atk(W.ct); S.combo.k = 1; } else if (S.combo.k === 1 && u > 0.25) { atk(W.ct); S.combo.k = 2; } if (u > 1.2) S.combo = null; }
    if (L.some((x) => x.ev === "deathblow") && S.phase === 1) { S.phase = 2; ai.forced = "dos"; e.post = 0; }
    const d = Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z);
    if (d > 3.2 && !pa && !W.player.path.length) W.goTo(e.body.x - Math.cos(toE()) * 2.0, e.body.z - Math.sin(toE()) * 2.0);
  };
});
const N = +(process.env.FRAMES || 520);
const info = [];
for (let i = 0; i < N; i++) {
  const s = await page.evaluate(() => { for (let k = 0; k < 3; k++) { dirStep(); W.tick(1 / 60); } const e = W.foe;
    return { e: e.act && (e.act.move || e.act.name), p: W.pf.act && W.pf.act.name, post: [Math.round(W.pf.post), Math.round(e.post)], hp: Math.round(e.hp) }; });
  info.push(s);
  await page.screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` });
}
const log = await page.evaluate(() => W.combatLog.filter((x) => !["swing", "warn", "hold", "release", "chainStart", "chainEnd"].includes(x.ev)).map((x) => x.ev + (x.n ? x.n : "") + (x.level ? "/" + x.level : "")));
fs.writeFileSync(`${out}/info.json`, JSON.stringify({ info, log }));
console.log("frames", info.length, "\n" + log.join(" "));
await browser.close();
