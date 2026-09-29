// Genera el terreno en Node, comprueba conectividad y vuelca un JSON para el mapa cenital.
const fs = require("fs"), path = require("path"), vm = require("vm");
global.THREE = require(process.env.THREE_CJS);
global.window = global;
const src = path.join(__dirname, "..", "src");
for (const f of (process.argv[2] || "core.js,terrain.js").split(",")) vm.runInThisContext(fs.readFileSync(path.join(src, f), "utf8"), { filename: f });
const W = global.W;
W.generateTerrain(1337);
if (W.placeProps) W.placeProps({ dryRun: true });
const n = W.NAV.n, res = W.NAV_RES;
const toCell = (x, z) => [Math.floor((x + W.HALF) * res), Math.floor((z + W.HALF) * res)];
const toW = (cx, cz) => [(cx + 0.5) / res - W.HALF, (cz + 0.5) / res - W.HALF];
function bfs(sx, sz) {
  const seen = new Uint8Array(n * n), q = [toCell(sx, sz)];
  seen[q[0][0] * n + q[0][1]] = 1;
  while (q.length) {
    const [cx, cz] = q.pop();
    const [x, z] = toW(cx, cz);
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n || seen[nx * n + nz]) continue;
      const [x1, z1] = toW(nx, nz);
      if (!W.canStep(x, z, x1, z1)) continue;
      seen[nx * n + nz] = 1; q.push([nx, nz]);
    }
  }
  return seen;
}
// punto de partida: sendero junto al claro
const seen = bfs(0, -6.2);
let reach = 0, walk = 0;
for (let i = 0; i < n * n; i++) { if (seen[i]) reach++; if (!W.NAV.blocked[i]) walk++; }
console.log("celdas alcanzables", reach, "de", walk, "libres");
for (const [k, q] of Object.entries(W.ZONES)) {
  // ¿algún punto de la zona alcanzable?
  let ok = 0, tot = 0;
  for (let a = 0; a < 40; a++) { const r = q.r * 0.5 * (a % 5) / 4, t = a * 0.7; const [cx, cz] = toCell(q.x + Math.cos(t) * r, q.z + Math.sin(t) * r); tot++; if (seen[cx * n + cz]) ok++; }
  console.log(k.padEnd(8), "puntos alcanzables", ok + "/" + tot);
}
const counts = {}; W.T.kind.forEach((k) => counts[k] = (counts[k] || 0) + 1);
console.log("tipos", JSON.stringify(counts), "obstáculos", W.obstacles.length);
fs.writeFileSync(process.argv[3] || "/tmp/terrain.json", JSON.stringify({ N: W.N, H: Array.from(W.T.H), kind: Array.from(W.T.kind), col: Array.from(W.T.col), nav: Array.from(W.NAV.blocked), seen: Array.from(seen), obstacles: W.obstacles }));
