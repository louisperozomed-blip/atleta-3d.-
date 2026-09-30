// Capturas de revisión del autómata en el mundo: las 8 direcciones (atacando al jugador, frame IMPACT de attack1
// y de attack2) y sus estados (aviso, bloqueo, parry, esquiva, aturdido, muerte). Recorta alrededor del autómata.
// uso: node enemy_stills.mjs <dist/index.html> <carpeta>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
await page.evaluate(() => {
  W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1);
  for (const id of ["cpad", "tbtn"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
  const b = document.querySelector(".bar"); if (b) b.style.display = "none";
  window.E = () => W.foe;
  window.pair = (a, d) => {
    const e = E(); for (const f of W.foes) f.ai.enabled = false;
    W.pf.respawn(); W.respawnAll(); W.hitstop = 0;
    e.body.x = e.home.x; e.body.z = e.home.z; e.body.y = e.body.ground = W.heightAt(e.home.x, e.home.z);
    W.teleport(e.home.x + Math.cos(a) * d, e.home.z + Math.sin(a) * d);
    W.player.heading = a + Math.PI; e.body.heading = a; T(8); W.combatLog.length = 0;
  };
  window.scr = () => { const e = E(), v = new THREE.Vector3(e.body.x, e.body.y + 0.9, e.body.z).project(W.camera);
    return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)]; };
});
const crop = async (name, w = 300, h = 300) => { const [x, y] = await page.evaluate(() => scr());
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2 - 20), width: w, height: h } }); };
const A8 = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * Math.PI / 4);
for (const an of ["attack1", "attack2"]) for (let k = 0; k < 8; k++) {
  await page.evaluate(([a, an]) => { pair(a, 2.0); const e = E(); e.ai.attack(an, a); let n = 0; while (!(e.act && e.act.f >= 3) && n < 300) { T(); n++; } }, [A8[k], an]);
  await crop(`dir_${an}_${k}`);
}
const states = {
  aviso: () => { pair(Math.PI * 0.75, 2.0); E().ai.attack("attack2", Math.PI * 0.75); T(24); },
  bloqueo: () => { const D = W.ENEMY_DIFF; D.parry = 0; D.block = 1; pair(Math.PI * 0.75, 2.0); E().ai.enabled = true; E().ai.cool = 99; W.pf.input("attack", { dir: Math.PI * 1.75 }); let n = 0; while (!W.combatLog.some((x) => x.ev === "block") && n < 90) { T(); n++; } T(2); },
  parry: () => { const D = W.ENEMY_DIFF; D.parry = 1; D.block = 0; pair(Math.PI * 0.75, 2.0); E().ai.enabled = true; E().ai.cool = 99; W.pf.input("attack", { dir: Math.PI * 1.75 }); let n = 0; while (!W.combatLog.some((x) => x.ev === "parry") && n < 90) { T(); n++; } T(2); },
  esquiva: () => { pair(Math.PI * 0.75, 2.0); const e = E(); e.ai.react({ kind: "dodge", dir: Math.PI * 0.75, rep: 0 }); let n = 0; while (!(e.act && e.act.name === "dodge" && e.act.f >= 2) && n < 90) { T(); n++; } },
  aturdido: () => { pair(Math.PI * 0.75, 2.0); const e = E(); e.addPosture(200); T(30); },
  muerte: () => { const D = W.ENEMY_DIFF; D.parry = 0; D.block = 0; pair(Math.PI * 0.75, 2.0); const e = E(); e.hp = 3; W.pf.input("attack", { dir: Math.PI * 1.75 }); T(100); },
  desvanece: () => { T(60 * 3.4); },
};
for (const [k, fn] of Object.entries(states)) { await page.evaluate(`(${fn.toString()})()`); await crop("st_" + k); }
await page.evaluate(() => { const D = W.ENEMY_DIFF; D.parry = 0.3; D.block = 0.35; });
console.log("ok");
await browser.close();
