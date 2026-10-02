// GIF del relleno (paso fijo 1/60 s, una captura cada 4 pasos = 15 fps), con la IA y el combate reales:
//   anillo_perfecto  el anillo se cierra sobre el zombi → parry PERFECTO → rematado con fogonazo
//   perro_despedido  el perro salta → parry NORMAL → aturdido y despedido ~1,5 baldosas
//   metronomo        grupo de práctica de 4: un atacante cada vez, como un metrónomo (parries normales)
//   niveles          el mismo zarpazo con el anillo en nivel 2, 1 y 0 (con su rótulo)
// uso: node record_fodder.mjs <dist/index.html> <carpeta> [ancho alto]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "720", h = "480"] = process.argv.slice(2);
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
  const cap = document.createElement("div"); cap.id = "cap";
  cap.style.cssText = "position:absolute;left:50%;top:14px;transform:translateX(-50%);font-size:11px;color:#8ff0ff;background:rgba(8,14,20,.7);padding:5px 10px;border:1px solid rgba(120,220,240,.4);z-index:9;display:none";
  document.getElementById("wrap").appendChild(cap);
  window.caption = (t) => { cap.textContent = t || ""; cap.style.display = t ? "block" : "none"; };
  window.L = (ev) => W.combatLog.filter((x) => x.ev === ev);
  // un enemigo delante del jugador, en diagonal hacia la cámara (se ve bien el anillo)
  window.stage = (kind, d) => {
    if (W.enemyType !== kind) W.setEnemyType(kind);
    const f = (window.F = W.foes[0]); for (const g of W.foes) if (g !== f) { g.ai.enabled = false; g.body.x = 999; g.body.z = 999; }
    f.ai.enabled = false; if (!f.alive || f.hidden) W.fodderRespawn(f); f.act = null; f.slide = null;
    const m = W.camera.matrixWorld.elements, rl = Math.hypot(m[0], m[2]), rx = m[0] / rl, rz = m[2] / rl;
    const s = W.findSpot(f.home.x, f.home.z, null, 2.6);
    W.teleport(s.x - rx * d * 0.5, s.z - rz * d * 0.5);
    f.body.x = s.x + rx * d * 0.5; f.body.z = s.z + rz * d * 0.5; f.body.y = f.body.ground = W.heightAt(f.body.x, f.body.z);
    f.body.heading = Math.atan2(-rz, -rx); W.player.heading = Math.atan2(rz, rx); W.pf.hp = W.pf.hpMax = 9999; W.pf.act = null;
    W.tick(1 / 60, 20); W.combatLog.length = 0;
  };
  window.Q = { lead: null, done: null };
  window.go = (lead) => { const f = window.F; Q.lead = lead; Q.done = null; f.ai.strike(Math.atan2(W.pf.body.z - f.body.z, W.pf.body.x - f.body.x)); };
  // pulsa la guardia «lead» s antes del impacto del golpe en curso (de cualquiera del grupo)
  window.bot = () => {
    for (const f of W.foes) { const a = f.act; if (!a || a.name !== "attack" || a === Q.done || Q.lead == null) continue; const l = f.toImpact();
      if (l != null && l <= Q.lead) { W.pf.input("guardDown", { ts: performance.now() + (l - Q.lead) * 1000 }); W.pf.input("guardUp"); Q.done = a; } }
  };
});
async function rec(dir, n) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".png")) fs.unlinkSync(path.join(dir, f));
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => { for (let k = 0; k < 4; k++) { bot(); W.tick(1 / 60); } });
    await page.screenshot({ path: `${dir}/f${String(i).padStart(4, "0")}.png` });
  }
}
// 1) anillo + perfecto al zombi
await page.evaluate(() => { stage("zombie", 1.5); W.setFodderRingMode("always"); caption("ZOMBI · el anillo se cierra en el IMPACTO → PERFECTO"); W.tick(1 / 60, 12); go(0.035); });
await rec(`${out}/anillo_perfecto`, 50);
// 2) perro despedido por un parry normal
await page.evaluate(() => { stage("dog", 2.3); caption("PERRO · parry NORMAL → aturdido y despedido"); W.tick(1 / 60, 12); go(0.13); });
await rec(`${out}/perro_despedido`, 48);
// 3) grupo de 4 en metrónomo
await page.evaluate(() => { W.setFodderRingMode("auto"); W.fodderResetScaffold(); W.setEnemyType("fodder"); W.pf.hp = W.pf.hpMax = 9999; caption("GRUPO DE PRÁCTICA · un atacante cada vez"); Q.lead = 0.12; Q.done = null; W.tick(1 / 60, 60); });
await rec(`${out}/metronomo`, 150);
// 4) niveles del anillo 2 → 1 → 0
for (const lv of [2, 1, 0]) {
  await page.evaluate((lv) => { stage("zombie", 1.5); W.setFodderRingMode("auto"); W.FODDER_SCAF.zombie.level = lv;
    caption(["NIVEL 0 · sin anillo: pose + gruñido + clic", "NIVEL 1 · el anillo solo los últimos 250 ms", "NIVEL 2 · anillo completo"][lv]); W.tick(1 / 60, 12); go(0.1); }, lv);
  await rec(`${out}/niveles_${lv}`, 26);
}
await page.evaluate(() => caption(""));
await browser.close();
// une los tres tramos de niveles en una carpeta
const nd = `${out}/niveles`; fs.mkdirSync(nd, { recursive: true });
for (const f of fs.readdirSync(nd)) fs.unlinkSync(path.join(nd, f));
let k = 0;
for (const lv of [2, 1, 0]) for (const f of fs.readdirSync(`${out}/niveles_${lv}`).sort()) fs.copyFileSync(`${out}/niveles_${lv}/${f}`, `${nd}/f${String(k++).padStart(4, "0")}.png`);
console.log("listo");
