"""Cuello y cabeza con topología facial (media malla, x >= 0).

La cabeza es una rejilla de quads sobre una superficie paramétrica P(θ, zf):
  θ   ángulo del medio anillo (0 = centro de la cara, π = nuca), 12 segmentos más densos delante;
  zf  altura del anillo en el centro de la cara (los anillos se inclinan: detrás suben a zb).
La topología facial se hace con operaciones de poly modeling sobre esa rejilla:
  - ojo: región 2×2 caras con 3 insets → 3 loops concéntricos (órbita, párpados, borde del ojo);
  - nariz + boca: región 3×5 con 1 inset → loop nasolabial alrededor de nariz y boca;
  - boca: región 2×2 (sobre el plano de simetría) con 3 insets → 3 loops concéntricos (labios);
  - oreja: región 1×4 en el lateral, inset + extrusión (base y hélix) e inset hacia dentro (concha),
    con el lóbulo abajo.
Cada vértice guarda sus coordenadas (θ, zf); los loops se recolocan en elipses en ese espacio y
al final todo se proyecta sobre la superficie y se desplaza por la normal (relieve de nariz,
labios, cejas, pómulos, barbilla y cuencas).
"""
import numpy as np

import params as PR

SC = PR.S
DEG = np.pi / 180
TH = np.radians([0, 12, 24, 36, 48, 60, 74, 90, 106, 122, 140, 160, 180])
HJ = len(TH) - 1                                   # 12 segmentos por medio anillo (24 alrededor)
POWER = 2.5
# superficie de la cabeza: (zf, zb, semiancho x, y delante, y detrás) medidos en la hoja (SIDE/FRONT)
HEAD_KEYS = [
    (1.494, 1.535, 0.050, -0.058, 0.054),   # debajo de la barbilla -> ángulo de la mandíbula
    (1.502, 1.546, 0.050, -0.072, 0.065),   # barbilla
    (1.512, 1.557, 0.054, -0.079, 0.075),
    (1.525, 1.568, 0.060, -0.083, 0.083),   # boca
    (1.540, 1.580, 0.066, -0.086, 0.088),
    (1.556, 1.592, 0.069, -0.088, 0.090),   # nariz
    (1.573, 1.604, 0.071, -0.089, 0.092),   # ojos
    (1.590, 1.616, 0.069, -0.091, 0.093),
    (1.607, 1.628, 0.068, -0.093, 0.093),   # cejas
    (1.627, 1.643, 0.069, -0.093, 0.091),   # frente
    (1.650, 1.660, 0.066, -0.089, 0.085),
    (1.668, 1.674, 0.059, -0.078, 0.074),
    (1.683, 1.686, 0.047, -0.058, 0.055),
]
ROWS = [1.494, 1.502, 1.511, 1.521, 1.531, 1.541, 1.551, 1.562, 1.573, 1.586, 1.599, 1.614,
        1.632, 1.652, 1.668, 1.683]
TOP_Z = 1.703
# cuello: anillos inclinados (zf, zb, semiancho, y delante, y detrás)
NECK = [(1.428, 1.458, 0.058, -0.018, 0.068), (1.450, 1.478, 0.046, -0.020, 0.064),
        (1.468, 1.497, 0.044, -0.023, 0.061), (1.486, 1.516, 0.045, -0.022, 0.058)]
NECK_SPECIALS = [4, 12]           # reducción 32 -> 24 en la clavícula y el trapecio (zonas planas)

# regiones de la rejilla (filas i entre ROWS[i] y ROWS[i+1], segmentos j entre TH[j] y TH[j+1])
EYE = dict(rows=(8, 10), segs=(1, 3))
NASO = dict(rows=(2, 7), segs=(0, 3))
MOUTH = dict(rows=(3, 5), segs=(0, 2))
EAR = dict(rows=(6, 10), segs=(7, 8))
# loops en el espacio (θ, zf): centro y radios de cada loop (del exterior al interior)
EYE_C = (21 * DEG, 1.585)
EYE_R = [(15 * DEG, 0.0165), (12 * DEG, 0.0125), (10 * DEG, 0.0088), (8.5 * DEG, 0.0048)]
EYE_TILT = 0.0015                # el rabillo exterior del ojo algo más alto
MOUTH_C = (0.0, 1.531)
MOUTH_R = [(20 * DEG, 0.0125), (16 * DEG, 0.0090), (13.5 * DEG, 0.0062), (11 * DEG, 0.0015)]
NASO_C = (0.0, 1.537)
NASO_R = (31 * DEG, 0.0215)


def catmull_rows(keys, x):
    K = np.asarray(keys, float)
    xs = K[:, 0]
    i = int(np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2))
    p0, p1, p2, p3 = K[max(i - 1, 0)], K[i], K[i + 1], K[min(i + 2, len(K) - 1)]
    t = (x - p1[0]) / (p2[0] - p1[0])
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def ring_point(th, zf, zb, rx, yf, yb, power=POWER):
    e = 2.0 / power
    s, c = np.sin(th), np.cos(th)
    yc = 0.5 * (yf + yb)
    ry = (yc - yf) if c >= 0 else (yb - yc)
    x = rx * abs(s) ** e
    y = yc - ry * np.sign(c) * abs(c) ** e
    z = zf + (zb - zf) * (1 - c) / 2
    return np.array([x, y, z])


def surface(th, zf):
    """Punto de la superficie base de la cabeza (sin relieve), en metros."""
    _, zb, rx, yf, yb = catmull_rows(HEAD_KEYS, zf)
    return ring_point(th, zf, zb, rx, yf, yb) * SC


def normal(th, zf):
    h = 1e-4
    a = surface(th + h, zf) - surface(th - h, zf)
    b = surface(th, zf + h) - surface(th, zf - h)
    n = np.cross(b, a) if th > 1e-6 else np.cross(b, surface(2 * h, zf) - surface(0.0, zf))
    n /= np.linalg.norm(n)
    p = surface(th, zf)
    _, zb, rx, yf, yb = catmull_rows(HEAD_KEYS, zf)
    if n @ (p - np.array([0, 0.5 * (yf + yb) * SC, p[2]])) < 0:
        n = -n
    return n


def g(x, s):
    return np.exp(-(x / s) ** 2)


def relief(th, zf):
    """Relieve por la normal (m): nariz, aletas, labios, barbilla, cuenca, ceja y pómulo."""
    nose_z = np.interp(zf, [1.538, 1.545, 1.551, 1.557, 1.563, 1.570, 1.580, 1.590, 1.600, 1.612],
                       [0.0, 0.003, 0.008, 0.0115, 0.012, 0.0095, 0.006, 0.0038, 0.0015, 0.0])
    d = nose_z * g(th, 0.13)
    d += 0.004 * g(th - 0.22, 0.09) * g(zf - 1.551, 0.006)                     # aletas de la nariz
    d += 0.0040 * g(zf - 1.536, 0.0040) * g(th, 0.26)                          # labio superior
    d += 0.0045 * g(zf - 1.525, 0.0045) * g(th, 0.23)                          # labio inferior
    d -= 0.0010 * g(zf - 1.531, 0.0020) * g(th, 0.30)                          # línea de la boca
    d += 0.0030 * g(zf - 1.502, 0.0080) * g(th, 0.35)                          # barbilla
    d -= 0.0050 * g(th - 0.37, 0.22) * g(zf - 1.584, 0.013)                    # cuenca del ojo
    d += 0.0060 * g(zf - 1.601, 0.0055) * g(th - 0.40, 0.30)                   # arco de la ceja
    d += 0.0030 * g(th - 0.80, 0.22) * g(zf - 1.566, 0.012)                    # pómulo
    return d * SC


def neck_head(body):
    """Construye cuello y cabeza sobre body.m a partir de body.ports['neck_base']."""
    from topo import half_ring  # noqa: F401  (misma familia de herramientas)
    m = body.m
    A = body.ports['neck_base']

    def tilted(row):
        zf, zb, rx, yf, yb = row
        return [ring_point(t, zf, zb, rx, yf, yb, power=2.0) * SC for t in TH]
    base = tilted(NECK[0])
    m.tag = 'neck'
    N0, poles = m.reduce_to(A, NECK_SPECIALS, lambda P, k: base[k], closed=False, group='neck')
    body.poles_expected['base del cuello (32→24)'] = poles
    prev = N0
    m.seam(A[-1], N0[-1])                          # costura UV por detrás del cuello (eje trasero)
    for row in NECK[1:]:
        ring = m.ring(tilted(row), 'neck')
        m.bridge(prev, ring, closed=False)
        m.seam(prev[-1], ring[-1])
        prev = ring
    # ------------------------------------------------------------ rejilla de la cabeza
    param = {}
    G = []
    for zf in ROWS:
        ring = []
        for t in TH:
            v = m.v(surface(t, zf), 'head')
            param[v] = [t, zf]
            ring.append(v)
        G.append(ring)
    m.bridge(prev, G[0], closed=False)
    m.seam(prev[-1], G[0][-1])
    m.tag = 'head'
    for i in range(len(ROWS) - 1):                 # costura UV por detrás de la cabeza (nuca -> coronilla)
        m.seam(G[i][-1], G[i + 1][-1])
    fidx = {}
    for i in range(len(ROWS) - 1):
        for j in range(HJ):
            fidx[i, j] = len(m.F)
            m.face(G[i][j], G[i][j + 1], G[i + 1][j + 1], G[i + 1][j])

    def region(r):
        (i0, i1), (j0, j1) = r['rows'], r['segs']
        return [fidx[i, j] for i in range(i0, i1) for j in range(j0, j1)]

    def inset(r):
        out, inn, closed = m.inset_region(region(r))
        for a, b in zip(out, inn):
            param[b] = list(param[a])
        return out, inn

    def place_loop(loop, center, radii, ext, tilt=0.0):
        """Coloca un loop en una elipse del espacio (θ, zf): cada vértice conserva la dirección que
        tenía en la rejilla (normalizada por la media extensión `ext` de la región)."""
        c0, c1 = center
        for v in loop:
            t, z = param[v]
            ang = np.arctan2((z - c1) / ext[1], (t - c0) / ext[0])
            nt = c0 + radii[0] * np.cos(ang)
            nz = c1 + radii[1] * np.sin(ang) + tilt * np.cos(ang)
            param[v] = [max(nt, 1e-4) if t > 1e-9 else 0.0, nz]

    def ext(r):
        (i0, i1), (j0, j1) = r['rows'], r['segs']
        half_t = (TH[j1] - TH[j0]) / 2 if TH[j0] > 0 else TH[j1]
        return (half_t, (ROWS[i1] - ROWS[i0]) / 2)

    # nariz + boca: loop nasolabial (1 inset) y 3 loops alrededor de la boca
    _, naso = inset(NASO)
    mouth_loops = []
    mouth0 = None
    for _ in range(3):
        out, inn = inset(MOUTH)
        mouth0 = mouth0 or out
        mouth_loops.append(inn)
    # ojo: 3 loops concéntricos
    eye_loops = []
    out0 = None
    for _ in range(3):
        out, inn = inset(EYE)
        out0 = out0 or out
        eye_loops.append(inn)
    # colocar loops (del exterior al interior)
    place_loop(naso, NASO_C, NASO_R, ext(NASO))
    place_loop(mouth0, MOUTH_C, MOUTH_R[0], ext(MOUTH))
    for loop, r in zip(mouth_loops, MOUTH_R[1:]):
        place_loop(loop, MOUTH_C, r, ext(MOUTH))
    place_loop(out0, EYE_C, EYE_R[0], ext(EYE), EYE_TILT)
    for loop, r in zip(eye_loops, EYE_R[1:]):
        place_loop(loop, EYE_C, r, ext(EYE), EYE_TILT)
    placed = set(naso) | set(mouth0) | set(out0)
    for lp in mouth_loops + eye_loops:
        placed |= set(lp)

    def fill_interior(r, center, radii):
        """Vértices interiores de la región: del cuadrado de la rejilla al disco del loop interior."""
        e = ext(r)
        verts = {v for fi in region(r) for v in m.F[fi]} - placed
        for v in verts:
            t, z = param[v]
            u = np.clip((t - center[0]) / e[0], -1, 1)
            w = np.clip((z - center[1]) / e[1], -1, 1)
            u2, w2 = u * np.sqrt(1 - w * w / 2), w * np.sqrt(1 - u * u / 2)
            param[v] = [center[0] + 0.9 * radii[0] * u2 if t > 1e-9 else 0.0, center[1] + 0.9 * radii[1] * w2]
            placed.add(v)
    fill_interior(MOUTH, MOUTH_C, MOUTH_R[-1])
    fill_interior(NASO, NASO_C, NASO_R)
    fill_interior(EYE, EYE_C, EYE_R[-1])
    eye_inner = set(eye_loops[-1]) | {G[9][2]}
    center_eye = G[9][2]                           # vértice central de la región del ojo
    # ------------------------------------------------------------ oreja (hélix, concha, lóbulo)
    ear_base, ear_rim = inset(EAR)
    _, ear_in = inset(EAR)
    # ------------------------------------------------------------ posiciones finales
    for v, (t, z) in param.items():
        p = surface(t, z) + normal(t, z) * relief(t, z)
        if v in eye_inner or v == center_eye:
            p = p + normal(t, z) * 0.0012 * SC             # globo ocular y borde de los párpados
        if t <= 1e-9 or t >= np.pi - 1e-9:
            p[0] = 0.0                                     # vértices del plano de simetría
        m.V[v] = p
    _shape_ear(m, param, ear_base, ear_rim, ear_in)
    # tapa del cráneo: rejilla 3 × 6 sobre el último medio anillo + línea central
    top = G[-1]
    _cap(m, top)
    body.head_info = dict(eye_loops=[out0] + eye_loops, mouth_loops=mouth_loops, naso=naso, grid=G)


def _shape_ear(m, param, base, rim, inner):
    """Oreja: la base queda en la cabeza; el hélix (rim) sale hacia fuera y atrás; la concha
    (inner) vuelve hacia la cabeza; el lóbulo es la parte baja, más gruesa y sin concha."""
    tc = 0.5 * (TH[EAR['segs'][0]] + TH[EAR['segs'][1]])
    zc = 0.5 * (ROWS[EAR['rows'][0]] + ROWS[EAR['rows'][1]])
    c = surface(tc, zc)
    n = normal(tc, zc)
    up = np.array([0, 0, 1.0])
    back = np.cross(up, n)
    if back[1] < 0:
        back = -back
    uc, wc = 0.5 * (TH[EAR['segs'][0]] + TH[EAR['segs'][1]]), zc
    ext_u = (TH[EAR['segs'][1]] - TH[EAR['segs'][0]]) / 2
    ext_w = (ROWS[EAR['rows'][1]] - ROWS[EAR['rows'][0]]) / 2
    for v in rim + inner:
        t, z = param[v]
        ang = np.arctan2((z - wc) / ext_w, (t - uc) / ext_u)     # 0 = detrás, 90° = arriba
        ca, sa = np.cos(ang), np.sin(ang)
        if v in rim:
            # hélix: contorno en C, más ancho arriba y detrás; abajo se estrecha en el lóbulo
            ru = 0.0115 if ca > 0 else 0.0085
            rw = 0.0255 if sa > 0 else 0.0235
            du = 0.003 + ru * ca * (0.75 if sa < -0.5 else 1.0)
            dw = 0.001 + rw * sa
            out = 0.0065 * (0.55 + 0.45 * ca) + 0.0015
        else:
            # concha: más pequeña, delante del centro y hundida hacia la cabeza; el lóbulo no se hunde
            du = 0.0015 + 0.0065 * ca
            dw = 0.003 + 0.0155 * sa
            lobe = sa < -0.6
            out = 0.0060 if lobe else 0.0025
        m.V[v] = c + (back * du + up * dw + n * out) * SC


def _cap(m, top):
    """Tapa del cráneo (Grid Fill) sobre el medio anillo superior de 12 aristas."""
    n = len(top) - 1
    cols = 3
    rows = n - 2 * cols
    V = m.V
    P0, P1 = V[top[0]], V[top[-1]]
    yc = 0.5 * (P0[1] + P1[1])
    ring_z = np.mean([V[v][2] for v in top])
    rx = max(V[v][0] for v in top)
    ry = 0.5 * (P1[1] - P0[1])
    center = []
    for r in range(1, rows):
        y = P0[1] + (P1[1] - P0[1]) * r / rows
        center.append(y)

    def lift(p):
        rho = min((p[0] / rx) ** 2 + ((p[1] - yc) / ry) ** 2, 1.0)
        p = p.copy()
        p[2] = p[2] + (TOP_Z * SC - ring_z) * (1 - rho) ** 0.55
        return p
    grid = [[top[0], top[1], top[2], top[3]]]
    for r in range(1, rows):
        side = top[cols + r]
        cz = np.interp(r, [0, rows], [V[top[0]][2], V[top[-1]][2]])
        cpt = np.array([0.0, center[r - 1], cz])
        row = [m.v(lift(cpt), 'head')]
        for k in (1, 2):
            q = cpt + (V[side] - cpt) * k / cols
            row.append(m.v(lift(q), 'head'))
        row.append(side)
        grid.append(row)
    grid.append([top[n], top[n - 1], top[n - 2], top[n - 3]])
    for r in range(rows, 0, -1):                   # la costura trasera sigue hasta la coronilla
        a_, b_ = grid[r][0], grid[r - 1][0]
        m.seam(a_, b_)
        if V[b_][1] <= 0.5 * (P0[1] + P1[1]):
            break
    for r in range(rows):
        for c in range(cols):
            m.face(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c])
