// A*: caminos entre zonas (tiempo, longitud, ¿llega?) en Node
const fs = require("fs"), path = require("path"), vm = require("vm");
global.THREE = require(process.env.THREE_CJS);
global.window = global;
const src = path.join(__dirname, "..", "src");
for (const f of ["core.js", "terrain.js", "props.js", "player.js", "nav.js"]) vm.runInThisContext(fs.readFileSync(path.join(src, f), "utf8"), { filename: f });
const W = global.W;
W.generateTerrain(1337); W.placeProps();
const Z = W.ZONES, keys = Object.keys(Z);
const pts = { heart: [3.5, -5.5], roots: [-20, -19], crystal: [22, -20], ponds: [21, 19], ruins: [-21, 22] };
for (const a of keys) for (const b of keys) {
  if (a === b) continue;
  const t0 = process.hrtime.bigint();
  const p = W.findPath(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let len = 0, px = pts[a][0], pz = pts[a][1];
  for (const q of p) { len += Math.hypot(q.x - px, q.z - pz); px = q.x; pz = q.z; }
  // ¿todos los tramos son transitables en línea recta?
  let ok = true; px = pts[a][0]; pz = pts[a][1];
  for (const q of p) { if (!W.lineClear({ x: px, z: pz }, q)) ok = false; px = q.x; pz = q.z; }
  console.log(`${a.padEnd(7)} → ${b.padEnd(7)} llega=${p.reached} exacto=${p.exact} puntos=${p.length} long=${len.toFixed(1)} tramos_libres=${ok} ${ms.toFixed(1)} ms`);
}
