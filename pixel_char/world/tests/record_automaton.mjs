// GIF de una pelea contra el Autómata del bosque (IA activa). Determinista: paso fijo 1/60 s, una captura cada 4 pasos (15 fps).
// El "jugador" lo lleva un guion: se acerca; cuando el autómata prepara un ataque (ojo parpadeando) hace parry
// a ~100 ms del impacto; si el autómata queda aturdido, remate; si retrocede tras un parry, un golpe.
// Al final el autómata muere, se queda en el suelo y se desvanece con esporas.
// uso: node record_automaton.mjs <dist/index.html> <carpeta> [ancho alto segundos]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, out, w = "640", h = "480", secs = "22"] = process.argv.slice(2);
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
  const e = W.foe, p = W.pf, D = W.ENEMY_DIFF;
  for (const f of W.foes) f.ai.enabled = f === e;
  D.parry = 0.15; D.block = 0.25;                      // algo de defensa, sin eternizar la pelea
  e.hp = 120;                                          // pelea corta para el GIF
  for (const id of ["cpad", "tbtn"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
  // en pantalla, uno al lado del otro: el jugador llega por la izquierda (eje "derecha" de la cámara)
  const m = W.camera.matrixWorld.elements, rl = Math.hypot(m[0], m[2]), rx = m[0] / rl, rz = m[2] / rl;
  W.teleport(e.home.x - rx * 6.5, e.home.z - rz * 6.5); W.tick(1 / 60, 20);
  W.goTo(e.home.x - rx * 2.9, e.home.z - rz * 2.9);
  const S = (window.BOT = { cool: 0, combo: 0, pressed: null });
  window.botStep = () => {
    const a = e.act, pp = W.player;
    S.cool -= 1 / 60;
    if (!e.alive) return;
    const aim = Math.atan2(e.body.z - pp.z, e.body.x - pp.x);
    if (a && a.name.startsWith("attack") && a.f < 3 && S.pressed !== a) {
      const ms = e.M().animations[a.name].ms, left = ((ms[0] + ms[1] + ms[2]) / 1000 - (a.tt || 0)) * (a.slow || 1);
      if (left <= 0.1) { p.input("guardDown"); p.input("guardUp"); S.pressed = a; }
      return;
    }
    const d = Math.hypot(e.body.x - pp.x, e.body.z - pp.z);
    const open = e.stunned || (a && a.name === "hit" && a.recoil);
    if (S.combo > 0 && S.cool <= 0) { p.input("attack", { dir: aim }); S.combo--; S.cool = 0.32; return; }
    if (open && d < 2.8 && S.cool <= 0 && (!p.act || p.act.f >= 4)) { S.combo = e.stunned ? 0 : 1; S.cool = 0.32; p.input("attack", { dir: aim }); }
  };
});
const N = Math.round(+secs * 15);
const info = [];
for (let i = 0; i < N; i++) {
  const s = await page.evaluate(() => { for (let k = 0; k < 4; k++) { botStep(); W.tick(1 / 60); }
    const e = W.foe; return { p: W.pf.act && W.pf.act.name, e: e.act && e.act.name, hp: [Math.round(W.pf.hp), Math.round(e.hp)], post: Math.round(e.post), fade: e.ch.uniforms.uFade ? +e.ch.uniforms.uFade.value.toFixed(2) : 1, hidden: !!e.hidden }; });
  info.push(s);
  await page.screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` });
  if (s.hidden) break;
}
const log = await page.evaluate(() => W.combatLog.filter((x) => x.ev !== "swing").map((x) => x.ev + (x.anim ? ":" + x.anim : "")));
fs.writeFileSync(`${out}/info.json`, JSON.stringify({ info, log }));
console.log("frames", info.length, "final", JSON.stringify(info[info.length - 1]), "\neventos", log.join(" "));
await browser.close();
