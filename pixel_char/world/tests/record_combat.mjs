// GIF de una pelea contra el eco (IA activa). Determinista: paso fijo 1/60 s, una captura cada 4 pasos (15 fps).
// El "jugador" lo lleva un guion sencillo: se acerca; si el eco ataca, parry a ~110 ms del impacto (o esquiva
// de lado si es attack3); si el eco está aturdido o acaba de fallar, combo de tres golpes.
// uso: node record_combat.mjs <dist/index.html> <carpeta> [ancho alto segundos]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "640", h = "480", secs = "13"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith(".png")) fs.unlinkSync(path.join(out, f));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + path.resolve(html) + (process.env.HASH || ""));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; const b = document.querySelector(".bar"); if (b) b.style.display = "none";
  const e = W.foe, p = W.pf;
  W.teleport(e.home.x - 5.2, e.home.z + 0.8); W.tick(1 / 60, 20);
  W.goTo(e.home.x - 2.6, e.home.z + 0.3);
  const S = (window.BOT = { cool: 0, combo: 0, pressed: null, hits: 0 });
  window.botStep = () => {
    const a = e.act, pp = W.player;
    S.cool -= 1 / 60;
    if (a && a.name.startsWith("attack") && S.pressed !== a) {
      const ms = W.CMETA.animations[a.name].ms, left = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.f < 3 ? (a.slow || 1) : 1);
      if (a.name === "attack3" && left <= 0.16) { p.input("dodge", { dir: Math.atan2(pp.z - e.body.z, pp.x - e.body.x) + Math.PI / 2 }); S.pressed = a; }
      else if (a.name !== "attack3" && left <= 0.11) { p.input("guardDown"); p.input("guardUp"); S.pressed = a; }
      return;
    }
    const d = Math.hypot(e.body.x - pp.x, e.body.z - pp.z);
    const open = e.stunned || (a && a.name === "hit" && a.recoil);
    if (S.combo > 0 && S.cool <= 0) { p.input("attack", { dir: Math.atan2(e.body.z - pp.z, e.body.x - pp.x) }); S.combo--; S.cool = 0.3; return; }
    if (open && d < 2.6 && S.cool <= 0 && (!p.act || p.act.f >= 4) && e.alive) { S.combo = e.stunned ? 0 : 1; S.cool = 0.3; p.input("attack", { dir: Math.atan2(e.body.z - pp.z, e.body.x - pp.x) }); }
  };
});
const N = Math.round(+secs * 15);
const info = [];
for (let i = 0; i < N; i++) {
  const s = await page.evaluate(() => { for (let k = 0; k < 4; k++) { botStep(); W.tick(1 / 60); }
    return { p: W.pf.act && W.pf.act.name, e: W.foe.act && W.foe.act.name, hp: [Math.round(W.pf.hp), Math.round(W.foe.hp)], post: Math.round(W.foe.post) }; });
  info.push(s);
  await page.screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` });
}
const log = await page.evaluate(() => W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev + (x.anim ? ":" + x.anim : "")));
fs.writeFileSync(`${out}/info.json`, JSON.stringify({ info, log }));
console.log("frames", N, "eventos", log.join(" "));
await browser.close();
