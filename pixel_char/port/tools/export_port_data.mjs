// Exporta las tablas de datos de la LÓGICA tal como están en el juego en marcha (no en la documentación) a
// pixel_char/port/data/*.json, para el portado a Unity. Lee los objetos de configuración vivos (W.COMBAT,
// W.AUTOMATON, W.FODDER, W.MOVES, W.DUEL, W.GROUP, W.TARGET, W.PLAYER_PARAMS...) y los metadatos de animación.
// uso: node export_port_data.mjs <dist/index.html> <carpeta port/data>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [html, OUT] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.route("**/three.min.js", (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: "application/javascript" }));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
await page.goto("file://" + path.resolve(html));
await page.waitForFunction(() => window.W && W.ready, null, { timeout: 120000 });
const D = await page.evaluate(() => {
  W.manual = true;
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "function" ? undefined : k.startsWith("_") ? undefined : v instanceof Map ? undefined : v)));
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  const ctrlNote = "valores literales de controls.js (constantes locales, no expuestas en W)";
  return {
    "combat_constants.json": { _source: "fighter.js W.COMBAT", ...clean(W.COMBAT), calib: 0,
      _units: "s salvo calib (ms); postura/stamina en puntos; dodgeDist en u (1 u = 1 baldosa)" },
    "player_attacks.json": { _source: "combat.js PLAYER_ATTACKS (W.combatAttacks)", _units: "dmg puntos, reach u, arc grados (semiángulo: el arco es ±arc), stop s (hitstop), kb u (retroceso), post = postura que gana el atacante si se lo desvían (NORMAL; PERFECTO ×1.33)", attacks: clean(W.combatAttacks) },
    "hitstop.json": { _source: "combat.js STOP (constante local)", STOP: { attack1: 0.075, attack2: 0.085, attack3: 0.12, parry: 0.11, parryHeavy: 0.13, perfect: 0.16, perfectHeavy: 0.18, block: 0.06, deathblow: 0.16 },
      other: { guardBreak: 0.1, clash: 0.13, deathblowDuel: 0.2, mikiri: 0.18 }, _units: "s" },
    "parry_levels.json": { _source: "combat.js W.PARRY_LEVELS", levels: clean(W.PARRY_LEVELS),
      _notes: "atkPost multiplica el 'post' del ataque; defPost = postura que paga quien defiende (noBreak en parry); st = stamina del bloqueo; la guardia rota cuando st <= 0" },
    "moves_combos.json": { _source: "moves.js W.MOVES", ...clean(W.MOVES) },
    "duel.json": { _source: "duel.js W.DUEL", ...clean(W.DUEL), clashWin: 0.08 },
    "group.json": { _source: "group.js W.GROUP", ...pick(clean(W.GROUP), ["max", "orbitR", "pincerP", "pincerCool", "multiWin", "mpBonus", "slow"]) },
    "target.json": { _source: "target.js W.TARGET", ...pick(clean(W.TARGET), ["maxD", "losMax", "camK", "camMax"]), autoSwitch: { maxD: 9, nearD: 6 }, sightHeight: 1.1, tallTags: ["tree", "dead", "titan", "arch", "ruin", "wall", "crystal", "beacon", "hand", "heart"] },
    "movement.json": { _source: "player.js W.PLAYER_PARAMS + terrain.js + feet.js", CHAR_H: W.CHAR_H, params: clean(W.PLAYER_PARAMS),
      _units: "walkSpeed/runSpeed/accel/decel/runDist/walkBackDist en ALTURAS (× CHAR_H = u); turnRate rad/s; radius u; tiempos s",
      measured: { walkV_by_sprite_dir_u_s: { S: 1.25, SW: 1.039, W: 0.8, NW: 1.075, N: 1.25, NE: 1.128, E: 0.85, SE: 0.8 }, runV_u_s: +W.player.runV.toFixed(3),
        note: "con W.FX.anchor = true (por defecto) la velocidad de marcha NO es walkSpeed × CHAR_H: sale de los pies (feet.js locoParams, cadencia 12 fps) y se recorta a [0.8, 1.25] u/s según la dirección del sprite" },
      inertia: { accelTime: 0.25, note: "con W.FX.inertia: accel = velocidad de la marcha / 0.25 s; frenado = decel × 1.6" },
      gait: { followRunAbove: 1.2, followWalkBelow: 0.7, arriveFollow: 0.18, arriveTap: 0.004, units: "alturas" },
      animThresholds: { runUp: "walkV×1.35", runDown: "walkV×1.18", walkUp: "0.07 alturas/s", walkDown: "0.035 alturas/s" },
      direction: { sectors: 8, hysteresisRad: Math.PI / 8 + 8 * Math.PI / 180, stepMs: 40, stepMsInAction: 25, order: ["S", "SW", "W", "NW", "N", "NE", "E", "SE"] },
      stuck: { noProgressS: 0.45, progressU: 0.015, maxReplans: 3 },
      waypoint: { advanceR: 0.35, jumpTakeoffR: 0.12 } },
    "navigation.json": { _source: "terrain.js + nav.js", N: W.N, tileU: 1, NAV_RES: W.NAV_RES, cellU: 1 / W.NAV_RES, STEP: W.STEP, MAX_STEP: W.MAX_STEP, HEAD_H: W.HEAD_H, JUMP_MAX: +W.JUMP_MAX.toFixed(4), JUMP_COST: W.JUMP_COST,
      obstacleInflate: 0.18, wallCost: { ring1: 1.2, ring2: 0.4 }, heuristic: "octile (dx+dz)+(√2−2)·min(dx,dz), ×1.001 al empujar", maxNodesDefault: 40000, followMaxNodes: 12000,
      lineClear: { sampleU: 0.2, band: [-0.12, 0, 0.12] }, nearestFreeMaxR: 14, offMapHeight: 5, heights: [...new Set(Array.from(W.T.H))].sort((a, b) => a - b) },
    "controls.json": { _source: ctrlNote, TAP_MS: 170, SWIPE_MS: 260, SWIPE_PX: 42, followReplan: 0.2, followMinMove: 0.4, followStartPx: 12, followStartSpeedPxMs: 0.35,
      attackFoeRange: 3.2, attackApproachStop: 1.1, pendingAttackRange: [2.4, 3.4], pendingAttackTimeout: 5, keyboardLead: { walk: 1.0, shiftRun: 3.2 }, nearestFoeForKey: { maxD: 3.4, maxAng: 2.0 }, foeTapBox: "ancho = alto×0.42+22 px a cada lado, de 18 px sobre la cabeza a 16 px bajo los pies" },
    "calibration.json": { _source: "calib.js", rangeMs: [-60, 150], stepMs: 5, test: { beats: 10, gapMs: 750, firstDelayMs: 1000, matchMs: 300, skipFirst: 2, minTaps: 4, stat: "mediana" } },
    "automaton.json": { _source: "enemies/automaton/automaton.js W.AUTOMATON", ...clean(W.AUTOMATON),
      fighter: { stunTime: 3.2, stunRate: 2.2, dodgeDist: 2.6, kbK: 0.45, dodgeInv: [1, 3], radius: 0.42, radiusHit: 0.5, runMul: 0.6, attackWant: { attack1: 1.55, attack2: 1.75 } } },
    "difficulty.json": { _source: "enemies/core.js W.ENEMY_DIFF (deslizadores del panel)", ...clean(W.ENEMY_DIFF), ranges: { react: [0.5, 1.6], parry: [0, 0.9], block: [0, 0.9] } },
    "echo.json": { _source: "enemies/echo/echo.js (literales)", hp: 120, stamina: 100, posture: 100, prepK: 1.7, dmgK: 1.3, wake: 4.5, homeLeash: 14, attackRange: 2.4, chaseStop: 1.75, replan: 0.35,
      heavyChanceFar: 0.7, heavyChanceNear: 0.25, farD: 1.75, chainChance: 0.35, cool: [0.9, 1.6], heavyCoolExtra: 0.4, backOff: { t: 0.5, d: 0.8, below: 1.9 } },
    "fodder.json": { _source: "enemies/fodder/fodder.js W.FODDER + W.FODDER_TOKEN", ...clean(W.FODDER), token: pick(clean(W.FODDER_TOKEN), ["gap"]), orbitR: 2.5, practiceMix: ["zombie", "dog", "zombie", "dog"] },
    "_meta.json": { exportedFrom: "dist/index.html (juego en marcha)", date: new Date().toISOString() },
  };
});
fs.mkdirSync(OUT, { recursive: true });
for (const [k, v] of Object.entries(D)) fs.writeFileSync(path.join(OUT, k), JSON.stringify(v, null, 2) + "\n");
// animaciones: los metadatos de las hojas sin lo puramente visual (UV, ojos, pies...)
const A = path.resolve(path.dirname(html), "../assets");
const drop = new Set(["layout", "frames", "eye_px", "feet", "foot_lift", "corrections", "root_motion_px", "atlas_size", "columns", "spec_channels"]);
for (const [src, dst] of [["atlas.json", "player_locomotion"], ["combat_atlas.json", "player_combat"], ["enemy_atlas.json", "automaton"], ["fodder_zombie_atlas.json", "fodder_zombie"], ["fodder_dog_atlas.json", "fodder_dog"]]) {
  const m = JSON.parse(fs.readFileSync(path.join(A, src)));
  const o = {};
  for (const [k, v] of Object.entries(m)) if (!drop.has(k)) o[k] = v;
  for (const an of Object.values(o.animations)) {
    if (an.ms) { an.total_ms = an.ms.reduce((x, y) => x + y, 0); let c = 0; an.start_ms = an.ms.map((x) => { const s = c; c += x; return s; }); }
  }
  fs.mkdirSync(path.join(OUT, "animations"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "animations", dst + ".json"), JSON.stringify(o, null, 2) + "\n");
}
console.log("ok", Object.keys(D).length, "tablas");
await browser.close();
