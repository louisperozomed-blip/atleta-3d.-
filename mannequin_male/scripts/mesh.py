"""Poly modeling de la MEDIA malla (x >= 0) con quads, con los patrones de la tabla de
Pedro Amaro Santos (ref/tabla_poligonos.jpg) para las transiciones entre densidades.

  ring / bridge          anillos (edge loops) y Bridge Edge Loops
  step_fpt               Linear Stepping con FourPointTriangle: un quad con 2 aristas arriba y un
                         punto abajo (paso 2 por elemento)
  step_trapezium         Linear Stepping con un par de Trapecios: 3 aristas arriba -> 1 abajo
                         (paso 2 por par, deja un polo de 3 entre los dos trapecios)
  cap_grid / cap_parallel / cap_central   tapar un anillo: Grid, Parallel o Central Division
  extrude_quad           extrusión de una cara (dedos)
Cada paso de reducción se anota en `self.log` con el patrón usado, para PROGRESS.md.
Los vértices del plano de simetría tienen x = 0 exacto (Mirror con clipping).
"""
import numpy as np


class HalfMesh:
    def __init__(self):
        self.V = []
        self.F = []
        self.FT = []             # etiqueta de la cara (bloque anatómico)
        self.tag = None
        self.log = []            # (transición, patrón, detalle)

    # -------------------------------------------------------------- básicos
    def v(self, p):
        self.V.append(np.array(p, float))
        return len(self.V) - 1

    def ring(self, pts):
        return [self.v(p) for p in pts]

    def face(self, *idx):
        assert len(set(idx)) == len(idx), idx
        self.F.append(tuple(idx))
        self.FT.append(self.tag)
        return len(self.F) - 1

    def bridge(self, a, b, closed=True):
        assert len(a) == len(b), (len(a), len(b))
        n = len(a)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.face(a[i], a[j], b[j], b[i])

    # -------------------------------------------------------------- Linear Stepping
    def step(self, A, plan, place, closed=True, name=''):
        """Une el anillo A con un anillo B más pequeño recorriendo A con una lista de elementos:
          'q'  quad normal       (1 arista de A -> 1 arista de B)
          'f'  FourPointTriangle (2 aristas de A -> 1 punto de B)
          't'  par de Trapecios  (3 aristas de A -> 1 arista de B, con un vértice intermedio)
        place(k, verts_de_A) -> posición del vértice k de B;  para 't' se llama además
        place(('m', k), verts) para el vértice intermedio.
        Devuelve (B, polos): polos = vértices creados con valencia distinta de 4."""
        n = len(A)
        ne = n if closed else n - 1
        need = sum({'q': 1, 'f': 2, 't': 3}[e] for e in plan)
        assert need == ne, (need, ne, plan)
        # número de vértices de B
        nb_edges = sum({'q': 1, 'f': 0, 't': 1}[e] for e in plan)
        mB = nb_edges if closed else nb_edges + 1
        # vértices de A que "caen" en cada vértice de B (para colocarlos)
        groups = [[] for _ in range(mB)]
        i, k = 0, 0
        for e in plan:
            if e == 'q':
                groups[k % mB].append(A[i % n])
                i, k = i + 1, k + 1
            elif e == 'f':
                groups[k % mB] += [A[i % n], A[(i + 1) % n], A[(i + 2) % n]]
                i += 2
            else:
                groups[k % mB].append(A[i % n])
                groups[(k + 1) % mB].append(A[(i + 3) % n])
                i, k = i + 3, k + 1
        if not closed:
            groups[mB - 1].append(A[-1])
        B = [self.v(place(q, [self.V[t] for t in groups[q]])) for q in range(mB)]
        poles = []
        i, k = 0, 0
        for e in plan:
            a0 = A[i % n]
            if e == 'q':
                self.face(a0, A[(i + 1) % n], B[(k + 1) % mB], B[k % mB])
                i, k = i + 1, k + 1
            elif e == 'f':
                self.face(a0, A[(i + 1) % n], A[(i + 2) % n], B[k % mB])
                poles.append(B[k % mB])
                i += 2
            else:
                a1, a2, a3 = A[(i + 1) % n], A[(i + 2) % n], A[(i + 3) % n]
                b0, b1 = B[k % mB], B[(k + 1) % mB]
                mm = self.v(place(('m', k), [self.V[a1], self.V[a2], self.V[b0], self.V[b1]]))
                self.face(a0, a1, mm, b0)
                self.face(a1, a2, a3, mm)
                self.face(mm, a3, b1, b0)
                poles.append(mm)
                i, k = i + 3, k + 1
        self.log.append((name, ''.join(plan), f'{ne} → {nb_edges} aristas'))
        return B, poles

    # -------------------------------------------------------------- tapas (tabla: Division)
    def cap_grid(self, ring, cols, rows, inner=None):
        """Grid Division: anillo de 2(cols+rows) vértices empezando en una esquina.
        inner(r, c, p_coons) -> posición de los vértices interiores."""
        assert len(ring) == 2 * (cols + rows)
        g = [[None] * (cols + 1) for _ in range(rows + 1)]
        idx = 0
        for c in range(cols):
            g[0][c] = ring[idx]; idx += 1
        for r in range(rows):
            g[r][cols] = ring[idx]; idx += 1
        for c in range(cols, 0, -1):
            g[rows][c] = ring[idx]; idx += 1
        for r in range(rows, 0, -1):
            g[r][0] = ring[idx]; idx += 1
        P = lambda r, c: self.V[g[r][c]]
        for r in range(1, rows):
            for c in range(1, cols):
                u, w = c / cols, r / rows
                p = ((1 - w) * P(0, c) + w * P(rows, c) + (1 - u) * P(r, 0) + u * P(r, cols)
                     - ((1 - u) * (1 - w) * P(0, 0) + u * (1 - w) * P(0, cols)
                        + (1 - u) * w * P(rows, 0) + u * w * P(rows, cols)))
                g[r][c] = self.v(inner(r, c, p) if inner else p)
        for r in range(rows):
            for c in range(cols):
                self.face(g[r][c], g[r][c + 1], g[r + 1][c + 1], g[r + 1][c])
        return g

    def cap_parallel(self, ring):
        """Parallel Division de un anillo de 4: un solo quad."""
        assert len(ring) == 4
        self.face(*ring)

    def extrude_quad(self, quad, rings_pts):
        """Extrusión de una cara: la cara desaparece y se encadenan los anillos dados."""
        k = next((i for i, f in enumerate(self.F) if set(f) == set(quad)), None)
        if k is not None:
            self.F.pop(k)
            self.FT.pop(k)
        prev = list(quad)
        rings = [prev]
        for pts in rings_pts:
            r = self.ring(pts)
            self.bridge(prev, r)
            prev = r
            rings.append(r)
        return rings

    def compact(self):
        used = sorted({i for f in self.F for i in f})
        remap = {o: n for n, o in enumerate(used)}
        self.V = [self.V[i] for i in used]
        self.F = [tuple(remap[i] for i in f) for f in self.F]
        return remap


def best_alignment(loop_pts, ring_pts):
    """Orden (rotación y sentido) del anillo que minimiza la longitud de las aristas de puente."""
    L, R = np.asarray(loop_pts), np.asarray(ring_pts)
    n = len(L)
    best = None
    for rev in (False, True):
        RR = R[::-1] if rev else R
        for off in range(n):
            d = np.linalg.norm(L - np.roll(RR, -off, axis=0), axis=1).sum()
            if best is None or d < best[0]:
                best = (d, rev, off)
    _, rev, off = best
    order = list(range(n))[::-1] if rev else list(range(n))
    return order[off:] + order[:off]


def frame(axis, ref=(0, -1, 0)):
    """Marco de un anillo: (eje, lateral, delante)."""
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    f = np.asarray(ref, float) - a * np.dot(ref, a)
    f /= np.linalg.norm(f)
    s = np.cross(f, a)
    return a, s, f
