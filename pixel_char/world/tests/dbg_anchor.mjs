import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(process.argv[2]));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 90000 });
const rows = await page.evaluate(() => {
  W.manual = true;
  const th = W.ui.thetaT, R = [Math.cos(th), -Math.sin(th)];
  W.teleport(-8, -5.5); W.player.heading = Math.atan2(R[1], R[0]); W.tick(1 / 30, 10);
  W.player.setPath([{ x: -8 + R[0] * 5, z: -5.5 + R[1] * 5 }], { noDelay: true });
  const out = [];
  for (let i = 0; i < 70; i++) {
    W.tick(1 / 30);
    const a = W.character.anchor.st, c = W.character.st;
    out.push([i, c.anim, c.dir, c.frame, a.stance, a.anchor ? a.anchor.fx.toFixed(1) + "," + a.anchor.fy.toFixed(1) : "-", (a.desired || 0).toFixed(1), W.slip.samples.length ? W.slip.samples[W.slip.samples.length - 1].toFixed(2) : "", W.player.speed.toFixed(2)].join(" "));
  }
  return out;
});
console.log(rows.join("\n"));
await browser.close();
