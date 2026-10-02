import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
for (const kind of ["zombie", "dog"]) {
  const r = await page.evaluate((kind) => {
    W.manual = true; const T = (n) => W.tick(1 / 60, n || 1);
    W.setEnemyType(kind); T(2);
    const f = W.foes[0]; for (const g of W.foes) if (g !== f) g.ai.enabled = false;
    W.teleport(f.home.x - 4, f.home.z); T(2);
    const st = []; let last = null, t0 = null, tImp = null;
    W.combatLog.length = 0;
    for (let i = 0; i < 60 * 8; i++) { T(); const s = f.ai.state; if (s !== last) { st.push(s + "@" + W.ct.toFixed(2)); last = s; }
      if (s === "windup" && t0 == null) t0 = f.act.fodderT0; if (s === "attack" && tImp == null) tImp = W.ct; }
    return { st: st.slice(0, 14), windupMs: t0 != null && tImp != null ? Math.round((tImp - t0) * 1000) : null, miss: W.animMiss || [], log: W.combatLog.filter((x) => x.ev !== "swing").slice(0, 8).map((x) => x.ev + (x.level ? ":" + x.level : "")),
      hp: [W.pf.hp, f.hp], loco: f.ch.locoFps, h: +(f.ch.height / W.CHAR_H).toFixed(2) };
  }, kind);
  console.log(kind, JSON.stringify(r));
  await page.evaluate(() => { W.skipRender = false; W.tick(1 / 60, 1); });
  await page.screenshot({ path: `${OUT}/${kind}.png` });
}
await browser.close();
