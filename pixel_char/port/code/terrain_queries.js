// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/terrain.js (EXTRACTO)
// Consultas del terreno y rejilla de navegación (la generación del mapa y la malla son contenido/visual).
// Constantes: N = 80 baldosas de 1 u, HALF = 40, STEP = MAX_STEP = 0,5 u, HEAD_H = 0,49 u, JUMP_MAX = 2·0,49·1,03 u,
// JUMP_COST = 2,2. Tipos de baldosa K = {GRASS 0, PATH 1, WATER 2, PUDDLE 3, PLAZA 4, STONE 5, CRYSTAL 6, BORDER 7}.
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
(function () {
  const W = window.W; const K = W.K;
  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------
  W.tileIndex = function (x, z) {
    const ix = Math.floor(x + W.HALF), iz = Math.floor(z + W.HALF);
    if (ix < 0 || iz < 0 || ix >= W.N || iz >= W.N) return -1;
    return ix * W.N + iz;
  };
  W.heightAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? 5 : W.T.H[i]; };
  W.kindAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? K.BORDER : W.T.kind[i]; };
  W.zoneAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? "fuera" : (W.zoneKeys[W.T.zoneId[i]] || "sendero"); };
  W.pathDistAt = function (x, z) { const i = W.tileIndex(x, z); return i < 0 ? 99 : W.T.pdist[i]; };

  // ---------------------------------------------------------------------------
  // Rejilla de navegación (celdas de 0.5): bloqueos por agua, borde y obstáculos.
  // Los desniveles se comprueban entre celdas vecinas (|Δh| <= MAX_STEP).
  // ---------------------------------------------------------------------------
  W.NAV_RES = 2;                          // celdas por baldosa
  W.buildNav = function () {
    const n = W.N * W.NAV_RES;
    W.NAV = { n, blocked: new Uint8Array(n * n) };
    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) {
      const x = (cx + 0.5) / W.NAV_RES - W.HALF, z = (cz + 0.5) / W.NAV_RES - W.HALF;
      const k = W.kindAt(x, z);
      if (k === K.WATER || k === K.BORDER) W.NAV.blocked[cx * n + cz] = 1;
    }
  };
  // Obstáculo circular (tronco, roca, cristal...) en la rejilla de navegación
  W.obstacles = [];
  W.addObstacle = function (x, z, r, tag) {
    W.obstacles.push({ x, z, r, tag });
    const n = W.NAV.n, res = W.NAV_RES;
    const c0x = Math.floor((x - r + W.HALF) * res), c1x = Math.floor((x + r + W.HALF) * res);
    const c0z = Math.floor((z - r + W.HALF) * res), c1z = Math.floor((z + r + W.HALF) * res);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
      const px = (cx + 0.5) / res - W.HALF, pz = (cz + 0.5) / res - W.HALF;
      if (Math.hypot(px - x, pz - z) < r + 0.18) W.NAV.blocked[cx * n + cz] = 1;
    }
  };
  // ¿Está libre un punto? (celda no bloqueada)
  W.cellFree = function (x, z) {
    const n = W.NAV.n, cx = Math.floor((x + W.HALF) * W.NAV_RES), cz = Math.floor((z + W.HALF) * W.NAV_RES);
    if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
    return !W.NAV.blocked[cx * n + cz];
  };
  // ¿Se puede pasar de (x0,z0) a (x1,z1)? (celda libre y desnivel <= MAX_STEP)
  W.canStep = function (x0, z0, x1, z1) {
    if (!W.cellFree(x1, z1)) return false;
    return Math.abs(W.heightAt(x1, z1) - W.heightAt(x0, z0)) <= W.MAX_STEP + 1e-3;
  };

  // ---------------------------------------------------------------------------
})();
