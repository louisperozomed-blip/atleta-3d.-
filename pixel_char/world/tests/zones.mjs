// Capturas de cada zona (teletransporte) + estadísticas de render
import { chromium } from "playwright";
import fs from "node:fs";
const [html, outPrefix, w = 900, h = 900] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + html);
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 60000 });
const spots = JSON.parse(process.env.SPOTS || '[["heart",3.5,-5.5],["roots",-20,-19],["crystal",22,-20],["ponds",21,19],["ruins",-21,22]]');
for (const [name, x, z, extra] of spots) {
  await page.evaluate(([x, z, e]) => { W.teleport(x, z); if (e) eval(e); }, [x, z, extra || ""]);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => W.lastInfo);
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `${outPrefix}_${name}.png` });
}
await browser.close();
