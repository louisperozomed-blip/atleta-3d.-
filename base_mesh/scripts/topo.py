"""Herramientas de poly modeling para construir la MEDIA malla (x >= 0) con quads.

Equivalentes programáticos de las operaciones de box modeling:
  ring()          -> un edge loop (anillo de vértices)
  bridge()        -> Bridge Edge Loops entre dos anillos con el mismo número de vértices
  bridge_reduce() -> bridge entre anillos de distinto tamaño SOLO con quads: cada reducción
                     es un quad que cubre 2 aristas del anillo grande y 1 vértice del pequeño
                     (crea un polo de 5 aristas en ese vértice, se coloca en zonas planas)
  cap_grid()      -> tapa un anillo con una rejilla de quads (como un Grid Fill)
  extrude_face()  -> extrusión de una cara (orejas, pulgar...)
Los vértices del plano de simetría tienen x = 0 exacto (Mirror con clipping).
"""
import numpy as np


class HalfMesh:
    def __init__(self):
        self.V = []
        self.F = []
        self.FT = []              # etiqueta de cada cara (isla UV / bloque): la de self.tag al crearla
        self.tag = None
        self.seams = set()        # aristas de costura UV (pares de vértices)
        self.groups = {}          # nombre -> set de índices de vértice (para bloques/etapas)

    # -------------------------------------------------------------- vértices y anillos
    def v(self, p, group=None):
        p = np.array(p, float)
        self.V.append(p)
        i = len(self.V) - 1
        if group:
            self.groups.setdefault(group, set()).add(i)
        return i

    def ring(self, pts, group=None):
        return [self.v(p, group) for p in pts]

    def face(self, *idx):
        assert len(set(idx)) == len(idx), idx
        self.F.append(tuple(idx))
        self.FT.append(self.tag)

    def remove_face(self, quad):
        k = next((i for i, f in enumerate(self.F) if set(f) == set(quad)), None)
        if k is not None:
            self.F.pop(k)
            self.FT.pop(k)

    def seam(self, a, b):
        self.seams.add(frozenset((a, b)))

    # -------------------------------------------------------------- bridges
    def bridge(self, a, b, closed=True):
        n = len(a)
        assert n == len(b), (n, len(b))
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            j = (i + 1) % n
            self.face(a[i], a[j], b[j], b[i])

    def reduce_to(self, A, specials, place, closed=True, group=None):
        """Crea un anillo B más pequeño unido a A SOLO con quads.

        specials: índices de A donde se concentra la reducción -> quad (A[s-1], A[s], A[s+1], B[k]).
        Cada special quita 2 aristas; el vértice B[k] de ese quad queda como polo de 5 aristas.
        place(lista_de_posiciones_A_conectadas, k) -> posición del vértice B[k].
        closed=False: medio anillo abierto (extremos en el plano de simetría).
        Devuelve (B, polos)."""
        n = len(A)
        ne = n if closed else n - 1
        sp = set(specials)
        assert closed or (0 not in sp and n - 1 not in sp)
        start = (min(specials) + 1) % n if closed else 0
        plan = []            # ('n', a0, a1, k) o ('s', a0, a1, a2, k)
        targets = [[A[start]]]
        i, steps, k = start, 0, 0
        while steps < ne:
            a0, a1, a2 = i % n, (i + 1) % n, (i + 2) % n
            if a1 in sp:
                plan.append(('s', a0, a1, a2, k))
                targets[k % len(targets)] += [A[a1], A[a2]]
                i += 2
                steps += 2
            else:
                plan.append(('n', a0, a1, k))
                k += 1
                if closed and steps + 1 == ne:
                    targets[0] += [A[a1]]
                else:
                    targets.append([A[a1]])
                i += 1
                steps += 1
        mB = k if closed else k + 1
        B = [self.v(place([self.V[t] for t in targets[q]], q), group) for q in range(mB)]
        poles = []
        for st in plan:
            if st[0] == 's':
                _, a0, a1, a2, kk = st
                self.face(A[a0], A[a1], A[a2], B[kk % mB])
                poles.append(B[kk % mB])
            else:
                _, a0, a1, kk = st
                self.face(A[a0], A[a1], B[(kk + 1) % mB], B[kk % mB])
        return B, poles

    # -------------------------------------------------------------- tapas y extrusiones
    def cap_grid(self, ring, cols, rows, lift=0.0, normal=None, group=None):
        """Tapa un anillo cerrado de 2*(cols+rows) vértices con una rejilla cols x rows.
        El anillo empieza en una esquina y recorre: fila 0 (cols aristas), lado (rows),
        fila final al revés (cols) y lado de vuelta (rows)."""
        assert len(ring) == 2 * (cols + rows)
        P = np.array([self.V[i] for i in ring])
        grid = [[None] * (cols + 1) for _ in range(rows + 1)]
        idx = 0
        for c in range(cols):
            grid[0][c] = ring[idx]; idx += 1
        for r in range(rows):
            grid[r][cols] = ring[idx]; idx += 1
        for c in range(cols, 0, -1):
            grid[rows][c] = ring[idx]; idx += 1
        for r in range(rows, 0, -1):
            grid[r][0] = ring[idx]; idx += 1
        # interior: interpolación bilineal (Coons) de los bordes + elevación
        def pos(r, c):
            return self.V[grid[r][c]]
        nrm = np.zeros(3) if normal is None else np.asarray(normal, float)
        for r in range(1, rows):
            for c in range(1, cols):
                u, w = c / cols, r / rows
                p = ((1 - w) * pos(0, c) + w * pos(rows, c) + (1 - u) * pos(r, 0) + u * pos(r, cols)
                     - ((1 - u) * (1 - w) * pos(0, 0) + u * (1 - w) * pos(0, cols)
                        + (1 - u) * w * pos(rows, 0) + u * w * pos(rows, cols)))
                bump = np.sin(np.pi * u) * np.sin(np.pi * w)
                grid[r][c] = self.v(p + nrm * lift * bump, group)
        for r in range(rows):
            for c in range(cols):
                self.face(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c])
        return grid

    def extrude_face(self, quad, offset, scale=1.0, group=None):
        """Extruye una cara (la borra y crea 4 laterales + tapa). Devuelve el nuevo anillo."""
        P = np.array([self.V[i] for i in quad])
        c = P.mean(0)
        new = [self.v(c + (p - c) * scale + offset, group) for p in P]
        self.remove_face(quad)
        for i in range(4):
            j = (i + 1) % 4
            self.face(quad[i], quad[j], new[j], new[i])
        self.face(*new)                       # tapa de la extrusión
        return new

    def inset_region(self, region, on_plane=lambda p: abs(p[0]) < 1e-9):
        """Inset de una región de caras (índices de self.F): crea un loop de quads alrededor.

        Las aristas de la región que están sobre el plano de simetría (solo una cara en la media
        malla) no son borde: la región continúa en el lado espejo, así que el loop se abre allí.
        Devuelve (exterior, interior, cerrado): cadenas ordenadas de vértices, interior[k] es la
        copia de exterior[k]. Las copias nacen en la misma posición: el llamador las coloca."""
        region = list(region)
        rset = set(region)
        use = {}
        for fi, f in enumerate(self.F):
            for k in range(len(f)):
                e = frozenset((f[k], f[(k + 1) % len(f)]))
                use.setdefault(e, []).append(fi)
        nxt = {}
        for fi in region:
            f = self.F[fi]
            for k in range(len(f)):
                a, b = f[k], f[(k + 1) % len(f)]
                fs = use[frozenset((a, b))]
                if all(x in rset for x in fs):
                    if len(fs) == 1 and not (on_plane(self.V[a]) and on_plane(self.V[b])):
                        raise ValueError('borde abierto dentro de la región')
                    continue                       # arista interior o sobre el plano de simetría
                assert a not in nxt, 'la región no es un disco'
                nxt[a] = b
        prev = {b: a for a, b in nxt.items()}
        starts = [a for a in nxt if a not in prev]
        start = starts[0] if starts else next(iter(nxt))
        chain, v = [start], start
        while v in nxt and nxt[v] != start:
            v = nxt[v]
            chain.append(v)
        closed = not starts
        assert len(chain) == len(set(nxt) | set(prev)), 'borde de la región en varias piezas'
        copy = {v: self.v(self.V[v].copy()) for v in chain}
        for g, members in self.groups.items():
            for v in chain:
                if v in members:
                    members.add(copy[v])
        for fi in region:
            self.F[fi] = tuple(copy.get(v, v) for v in self.F[fi])
        for a, b in nxt.items():
            self.face(a, b, copy[b], copy[a])
        return chain, [copy[v] for v in chain], closed

    # -------------------------------------------------------------- limpieza
    def compact(self):
        used = sorted({i for f in self.F for i in f})
        remap = {o: n for n, o in enumerate(used)}
        self.V = [self.V[i] for i in used]
        self.F = [tuple(remap[i] for i in f) for f in self.F]
        self.seams = {frozenset(remap[i] for i in e) for e in self.seams if all(i in remap for i in e)}
        self.groups = {g: {remap[i] for i in s if i in remap} for g, s in self.groups.items()}
        return remap


# ------------------------------------------------------------------ geometría de anillos
def half_ring(center, rx, ry_front, ry_back, n_edges, z=None, power=2.0, angles=None, bumps=()):
    """Medio anillo (x >= 0) de n_edges aristas, del centro delantero (θ=0, -Y) al trasero (θ=π).
    power > 2 lo hace más 'cuadrado' (superelipse). bumps: funciones f(θ) -> (dx, dy, dz)."""
    cx, cy, cz = center
    th = np.linspace(0, np.pi, n_edges + 1) if angles is None else np.asarray(angles)
    pts = []
    for t in th:
        s, c = np.sin(t), np.cos(t)
        ry = ry_front if c >= 0 else ry_back
        # superelipse
        e = 2.0 / power
        x = rx * np.sign(s) * abs(s) ** e
        y = -ry * np.sign(c) * abs(c) ** e
        p = np.array([x, cy + y, cz])
        for b in bumps:
            p = p + np.asarray(b(t, p), float)
        pts.append(p)
    pts[0][0] = 0.0
    pts[-1][0] = 0.0
    return pts


def frame(axis, ref=(0, -1, 0)):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    f = np.asarray(ref, float) - a * np.dot(ref, a)
    if np.linalg.norm(f) < 1e-6:
        f = np.array([0, 0, 1.0]) - a * a[2]
    f /= np.linalg.norm(f)
    s = np.cross(f, a)
    return a, s, f


def full_ring(center, axis, r_side, r_front, r_back=None, n=16, start_angle=0.0, ref=(0, -1, 0),
              power=2.0, r_side_in=None, angles=None):
    """Anillo cerrado de n vértices perpendicular a axis. Ángulo 0 = dirección 'ref' (delante)."""
    a, s, f = frame(axis, ref)
    r_back = r_front if r_back is None else r_back
    r_side_in = r_side if r_side_in is None else r_side_in
    th = (np.linspace(0, 2 * np.pi, n, endpoint=False) + start_angle) if angles is None else np.asarray(angles)
    e = 2.0 / power
    pts = []
    for t in th:
        c, sn = np.cos(t), np.sin(t)
        rf = r_front if c >= 0 else r_back
        rs = r_side if sn >= 0 else r_side_in
        u = np.sign(c) * abs(c) ** e * rf
        w = np.sign(sn) * abs(sn) ** e * rs
        pts.append(np.asarray(center, float) + f * u + s * w)
    return pts


def ring_angles(pts, center, axis, ref=(0, -1, 0)):
    a, s, f = frame(axis, ref)
    out = []
    for p in pts:
        d = np.asarray(p) - center
        out.append(np.arctan2(d @ s, d @ f))
    return np.unwrap(np.array(out))


def best_alignment(loop_pts, ring_pts):
    """Rotación/dirección del anillo que minimiza la longitud total de las aristas de puente."""
    n = len(loop_pts)
    best = None
    L = np.asarray(loop_pts)
    R = np.asarray(ring_pts)
    for rev in (False, True):
        RR = R[::-1] if rev else R
        for off in range(n):
            cand = np.roll(RR, -off, axis=0)
            d = np.linalg.norm(L - cand, axis=1).sum()
            if best is None or d < best[0]:
                best = (d, rev, off)
    _, rev, off = best
    order = list(range(n))[::-1] if rev else list(range(n))
    return order[off:] + order[:off]
