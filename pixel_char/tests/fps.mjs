import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [w, h, d] of [[1280, 800, 2], [1280, 800, 1], [390, 844, 3], [640, 420, 1]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: d });
  await page.goto("file://" + process.argv[2]);
  await page.waitForFunction(() => window.__demo && window.__demo.ready, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => window.__demo.state());
  console.log(w, h, d, "fps", s.fps.toFixed(1));
  await page.close();
}
await browser.close();
