// nav.js — búsqueda de camino A* sobre la rejilla de navegación (celdas de 0.5 u, 8 vecinos)
// respetando obstáculos, agua y desniveles (> 0.5 no se sube andando), con coste extra junto
// a las paredes y suavizado por línea de visión (string pulling).
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  let near = null;          // coste extra por cercanía a celdas bloqueadas
  function prepare() {
    const n = W.NAV.n, b = W.NAV.blocked;
    near = new Float32Array(n * n);
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
      if (b[x * n + z]) continue;
      let c = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= n || zz >= n || b[xx * n + zz]) { const d = Math.max(Math.abs(dx), Math.abs(dz)); c = Math.max(c, d === 1 ? 1.2 : d === 2 ? 0.4 : 0); }
      }
      near[x * n + z] = c;
    }
  }
  const toCell = (v) => Math.floor((v + W.HALF) * W.NAV_RES);
  const toW = (c) => (c + 0.5) / W.NAV_RES - W.HALF;
  function heightC(cx, cz) { return W.heightAt(toW(cx), toW(cz)); }
  function passable(ax, az, bx, bz) {
    const n = W.NAV.n;
    if (bx < 0 || bz < 0 || bx >= n || bz >= n || W.NAV.blocked[bx * n + bz]) return false;
    return Math.abs(heightC(bx, bz) - heightC(ax, az)) <= W.MAX_STEP + 1e-3;
  }

  // Montículo binario mínimo sobre índices de celda
  class Heap {
    constructor() { this.a = []; this.f = []; }
    push(i, f) { const a = this.a, F = this.f; a.push(i); F.push(f); let k = a.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (F[p] <= F[k]) break; [a[p], a[k]] = [a[k], a[p]]; [F[p], F[k]] = [F[k], F[p]]; k = p; } }
    pop() { const a = this.a, F = this.f, top = a[0], lf = F.pop(), la = a.pop();
      if (a.length) { a[0] = la; F[0] = lf; let k = 0;
        for (;;) { const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < a.length && F[l] < F[m]) m = l; if (r < a.length && F[r] < F[m]) m = r;
          if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; [F[m], F[k]] = [F[k], F[m]]; k = m; } }
      return top; }
    get size() { return this.a.length; }
  }

  // Celda libre alcanzable más cercana a (cx,cz) (si el destino está bloqueado)
  function nearestFree(cx, cz, fromH) {
    const n = W.NAV.n;
    for (let r = 0; r < 14; r++) {
      let best = null, bd = 1e9;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n || W.NAV.blocked[x * n + z]) continue;
        const d = dx * dx + dz * dz + (fromH != null ? Math.abs(heightC(x, z) - fromH) * 4 : 0);
        if (d < bd) { bd = d; best = [x, z]; }
      }
      if (best) return best;
    }
    return null;
  }

  const SQ2 = Math.SQRT2;
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];
  let gBuf = null, fromBuf = null, stamp = null, stampN = 0;

  // Devuelve [{x,z}...] desde (x0,z0) hasta (x1,z1) o hasta el punto alcanzable más cercano
  W.findPath = function (x0, z0, x1, z1, maxNodes, opts) {
    if (!near) prepare();
    const n = W.NAV.n, N = n * n;
    if (!gBuf) { gBuf = new Float32Array(N); fromBuf = new Int32Array(N); stamp = new Uint32Array(N); }
    stampN++;
    let s = [toCell(x0), toCell(z0)];
    if (W.NAV.blocked[s[0] * n + s[1]]) s = nearestFree(s[0], s[1]) || s;
    let t = [toCell(x1), toCell(z1)];
    const exactGoal = !W.NAV.blocked[t[0] * n + t[1]];
    if (!exactGoal) t = nearestFree(t[0], t[1], W.heightAt(x1, z1)) || t;
    const si = s[0] * n + s[1], ti = t[0] * n + t[1];
    const heap = new Heap();
    const h = (i) => { const dx = Math.abs(((i / n) | 0) - t[0]), dz = Math.abs((i % n) - t[1]); return (dx + dz) + (SQ2 - 2) * Math.min(dx, dz); };
    stamp[si] = stampN; gBuf[si] = 0; fromBuf[si] = -1;
    heap.push(si, h(si));
    let bestI = si, bestH = h(si), expanded = 0;
    const limit = maxNodes || 40000;
    while (heap.size) {
      const i = heap.pop();
      if (i === ti) { bestI = i; break; }
      if (++expanded > limit) break;
      const cx = (i / n) | 0, cz = i % n, gi = gBuf[i];
      const hi = h(i); if (hi < bestH) { bestH = hi; bestI = i; }
      for (const [dx, dz, c] of NB) {
        const nx = cx + dx, nz = cz + dz;
        if (!passable(cx, cz, nx, nz)) continue;
        // sin cortar esquinas: las dos celdas ortogonales pasables desde aquí Y hacia el destino (si no, al rozar
        // la esquina el personaje pisaba una celda desde la que el destino queda 1 u más abajo y se atascaba)
        if (dx && dz && (!passable(cx, cz, cx + dx, cz) || !passable(cx, cz, cx, cz + dz) ||
            !passable(cx + dx, cz, nx, nz) || !passable(cx, cz + dz, nx, nz))) continue;
        const j = nx * n + nz, g = gi + c + near[j];
        if (stamp[j] === stampN && g >= gBuf[j]) continue;
        stamp[j] = stampN; gBuf[j] = g; fromBuf[j] = i;
        heap.push(j, g + h(j) * 1.001);
      }
    }
    // reconstruye
    const cells = [];
    for (let i = bestI; i !== -1; i = fromBuf[i]) { cells.push(i); if (i === si) break; }
    cells.reverse();
    let pts = cells.map((i) => ({ x: toW((i / n) | 0), z: toW(i % n) }));
    // el último punto: el destino exacto si era libre y alcanzado
    if (bestI === ti && exactGoal) pts[pts.length - 1] = { x: x1, z: z1 };
    // sin suavizar (opts.raw): de centro de celda en centro de celda, para salir de un atasco
    if (!(opts && opts.raw)) pts = W.smoothPath({ x: x0, z: z0 }, pts);
    pts.reached = bestI === ti;
    pts.exact = bestI === ti && exactGoal;
    return pts;
  };

  // ¿Se puede ir en línea recta de a a b? (muestreo cada 0.2 u con radio del personaje)
  W.lineClear = function (a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(d / 0.2));
    const r = (W.PLAYER_PARAMS ? W.PLAYER_PARAMS.radius : 0.28), nx = -(b.z - a.z) / (d || 1), nz = (b.x - a.x) / (d || 1);
    // el borde del cuerpo en la dirección de avance: la misma comprobación que hace player.tryMove
    // (si no, el camino suavizado cortaba esquinas de baldosas con 1 u de desnivel y se atascaba)
    const hx = (b.x - a.x) / (d || 1) * r, hz = (b.z - a.z) / (d || 1) * r;
    // y en una franja estrecha a ambos lados de la línea: si pasa justo por la esquina de 4 baldosas, el
    // personaje real (que gira con suavidad) se desvía unos cm y puede pisar la del desnivel
    const band = [-0.12, 0, 0.12];
    let px = a.x, pz = a.z;
    for (let k = 1; k <= steps; k++) {
      const x = a.x + (b.x - a.x) * k / steps, z = a.z + (b.z - a.z) * k / steps;
      for (const o of band) {
        const qx = x + nx * o, qz = z + nz * o, qpx = px + nx * o, qpz = pz + nz * o;
        if (!W.canStep(qpx, qpz, qx, qz) || !W.canStep(qpx, qpz, qx + hx, qz + hz) || !W.canStep(qx, qz, qx + hx, qz + hz)) return false;
      }
      if (!W.cellFree(x + nx * r, z + nz * r) || !W.cellFree(x - nx * r, z - nz * r)) return false;
      px = x; pz = z;
    }
    return true;
  };
  // String pulling: se queda con los puntos imprescindibles
  W.smoothPath = function (start, pts) {
    if (pts.length <= 1) return pts;
    const out = [];
    let cur = start, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !W.lineClear(cur, pts[j])) j--;
      out.push(pts[j]); cur = pts[j]; i = j + 1;
    }
    return out;
  };
})();
