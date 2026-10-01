// Combate completo · Etapa 1: animaciones nuevas en el juego y visor de animaciones (escritorio y móvil).
// uso: node cc_e1.mjs <dist/index.html> <carpeta>
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "OK   " : "FALLO") + " " + name + (info != null ? "  " + JSON.stringify(info) : "")); };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function open(opts) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.goto("file://" + path.resolve(html));
  await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
  await page.evaluate(() => { W.manual = true; window.T = (n) => W.tick(1 / 60, n || 1); T(5); });
  return { ctx, page };
}
// 1) atlas: las animaciones nuevas están y con sus fases
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
  const m = await page.evaluate(() => {
    const C = W.CMETA, E = W.foe.ch.meta;
    return { pl: C.anims, heavy: C.animations.heavy, spin: C.animations.spin, eheavy: E.animations.heavy, eanims: E.anims,
      hf: { heavy: W.hitFrameOf(C, "heavy"), spin: W.hitFrameOf(C, "spin"), attack1: W.hitFrameOf(C, "attack1"), eheavy: W.hitFrameOf(E, "heavy") } };
  });
  check("atlas del personaje: heavy y spin con sus fases (heavy: carga 1-2, impacto 4; spin: activos 2-3 en 360°)",
    m.pl.includes("heavy") && m.pl.includes("spin") && m.heavy.carga.join() === "1,2" && m.hf.heavy === 4 && m.spin.giro360.join() === "2,3" && m.hf.spin === 2 && m.hf.attack1 === 3,
    { heavy: m.heavy.fase, spin: m.spin.fase, hf: m.hf });
  check("atlas del autómata: heavy con HOLD (aviso largo) e impacto en IMPACT", m.eanims.includes("heavy") && m.eheavy.fase[2] === "hold" && m.hf.eheavy === 4, { fase: m.eheavy.fase, ms: m.eheavy.ms });
  // 2) visor: abrir desde el panel ⚙, recorrer heavy en las 8 direcciones (capturas), con y sin luz
  await page.click("#tbtn"); await page.click("#avOpen");
  const vis = await page.evaluate(() => !document.getElementById("aview").hidden && W.ANIM_VIEW.on);
  const shots = [];
  for (const [who, an] of [["jugador", "heavy"], ["jugador", "spin"], ["autómata", "heavy"]]) {
    await page.selectOption("#avWho", who);
    await page.selectOption("#avAnim", an);
    for (let dir = 0; dir < 8; dir += (an === "heavy" && who === "jugador" ? 1 : 2)) {
      await page.click(`[data-dir="${dir}"]`);
      for (let f = 0; f < 6; f++) {
        await page.evaluate(([d, f]) => { W.ANIM_VIEW.dir = d; W.ANIM_VIEW.f = f; W.openAnimViewer({}); T(2); }, [dir, f]);
        if ((dir === 0 || dir === 6) && (f === 1 || f === 3 || f === 4)) { const p = `${OUT}/visor_${who === "jugador" ? "pj" : "auto"}_${an}_${dir}_${f}.png`; await page.screenshot({ path: p }); shots.push(p); }
      }
    }
  }
  const st = await page.evaluate(() => { const v = W.ANIM_VIEW, ch = v.ch; return { anim: ch.st.anim, dir: ch.st.dir, frame: ch.st.frame, who: v.who }; });
  check("visor: se abre desde el panel y pinta la animación, dirección y frame elegidos", vis && st.anim === "heavy" && st.who === "autómata", st);
  await page.click("#avLit");
  const unlit = await page.evaluate(() => { T(2); return W.ANIM_VIEW.ch.uniforms.uUnlit.value; });
  await page.screenshot({ path: `${OUT}/visor_auto_heavy_sinluz.png` });
  await page.click("#avLit");
  const lit = await page.evaluate(() => { T(2); return W.ANIM_VIEW.ch.uniforms.uUnlit.value; });
  check("visor: con y sin luz", unlit === 1 && lit === 0, { unlit, lit });
  await page.click("#avPlay");
  const play = await page.evaluate(() => { const f0 = W.ANIM_VIEW.f; T(40); return { f0, f1: W.ANIM_VIEW.f }; });
  check("visor: reproducir avanza los frames con sus tiempos", play.f1 !== play.f0, play);
  await page.click("#avClose");
  const closed = await page.evaluate(() => ({ on: W.ANIM_VIEW.on, view: !!W.character.view, ai: W.foes.every((f) => f.ai.enabled) }));
  check("visor: al cerrar, todo vuelve (sin vista fija, IA activa)", !closed.on && !closed.view && closed.ai, closed);
  fs.writeFileSync(`${OUT}/shots.json`, JSON.stringify(shots));
  await ctx.close();
}
// 3) móvil: el visor cabe y no tapa los botones de la guardia
{
  const ip = devices["iPhone 13"];
  const { ctx, page } = await open({ viewport: ip.viewport, deviceScaleFactor: ip.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: ip.userAgent });
  await page.tap("#tbtn"); await page.tap("#avOpen");
  await page.evaluate(() => { W.openAnimViewer({ who: "jugador", anim: "spin", dir: 0, f: 3 }); T(3); });
  const r = await page.evaluate(() => { const a = document.getElementById("aview").getBoundingClientRect(); return { a: [a.left, a.top, a.right, a.bottom], w: innerWidth, h: innerHeight }; });
  await page.screenshot({ path: `${OUT}/visor_movil.png` });
  check("móvil: el visor cabe en la pantalla", r.a[0] >= 0 && r.a[2] <= r.w && r.a[1] >= 0 && r.a[3] <= r.h, r);
  await ctx.close();
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} OK`, errors.length ? `, ${errors.length} errores JS` : ", sin errores JS");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
