// GIF de la LECTURA: repites el mismo combo con el mismo ritmo → el autómata te lee (alza la guardia con el ojo
// ámbar) y te desvía; luego retrasas el 2.º golpe → su parry se queda en el aire y queda EXPUESTO.
// uso: node record_read.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith(".png")) fs.unlinkSync(path.join(out, f));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 720, height: 480 }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; const b = document.querySelector(".bar"); if (b) b.style.display = "none";
  for (const id of ["cpad", "tbtn"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
  const e = W.foe, p = W.pf;
  for (const f of W.foes) f.ai.enabled = f === e;
  const m = W.camera.matrixWorld.elements, rl = Math.hypot(m[0], m[2]), rx = m[0] / rl, rz = m[2] / rl;
  window.place = () => { W.teleport(e.body.x - rx * 1.9, e.body.z - rz * 1.9); };
  e.body.x = e.home.x; e.body.z = e.home.z; place(); e.body.heading = Math.atan2(-rz, -rx); W.tick(1 / 60, 10);
  e.ai.state = "chase"; e.ai.passive = true; p.hpMax = p.hp = 1e6; e.hpMax = e.hp = 1e6;
  // guion: combos a1-a2-a3 cada 1.6 s; los dos últimos, con el primer golpe retenido 0.35 s
  const S = (window.RS = { k: 0, t0: W.ct, i: 0, held: false });
  window.rStep = () => {
    const now = W.ct - S.t0, delay = S.k >= 7, plan = delay ? [[0, "a"], [0.25, "h"]] : [[0, "a"], [0.25, "a"], [0.5, "a"]];
    const toE = Math.atan2(e.body.z - W.player.z, e.body.x - W.player.x);
    while (S.i < plan.length && plan[S.i][0] <= now) { if (plan[S.i][1] === "h") { p.input("attack", { dir: toE, hold: true }); S.held = true; } else p.input("attack", { dir: toE }); S.i++; }
    if (S.held && now > 0.85) { p.input("attackUp"); S.held = false; }
    if (now > 1.6) { S.k++; S.t0 = W.ct; S.i = 0; e.post = Math.min(e.post, 40); if (Math.hypot(e.body.x - W.player.x, e.body.z - W.player.z) > 2.4) place(); }
  };
});
let i = 0;
while (i < 320) {
  const s = await page.evaluate(() => { for (let k = 0; k < 4; k++) { rStep(); W.tick(1 / 60); } return { k: RS.k }; });
  await page.screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` }); i++;
  if (s.k >= 9) break;
}
const log = await page.evaluate(() => W.combatLog.filter((x) => /^foe|^parry$|^hit$/.test(x.ev)).map((x) => x.ev + (x.who ? "(" + x.who[0] + ")" : "")));
console.log("frames", i, "\n" + log.join(" "));
await browser.close();
