"""Bloques del base mesh (media malla, x >= 0), construidos con las herramientas de topo.py.

Etapas: 1 torso+pelvis, 2 piernas+pies, 3 brazos+manos, 4 cuello+cabeza, 5 = todo (unión y limpieza).
Cada bloque deja sus anillos de conexión en `self.ports` para que el siguiente se una a ellos.
"""
import numpy as np
import params as PR
from topo import HalfMesh, half_ring, full_ring, frame, best_alignment

H_TORSO = 16          # aristas del medio anillo del torso (32 alrededor)
N_LEG = 16            # vértices del anillo de la pierna
N_ARM = 12            # vértices del anillo del brazo
H_NECK = 8            # medio anillo de cuello y cabeza (16 alrededor)

# factores de escala respecto a las medidas de la hoja
HIP = PR.HIP_W / 0.376
WAIST = PR.WAIST_W / 0.184
CHEST = PR.CHEST_W / 0.26
SC = PR.S


def lerp(a, b, t):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t


def catmull(keys, x):
    """Interpolación Catmull-Rom de una tabla [(x, v1, v2, ...)] ordenada (creciente o decreciente)."""
    K = np.asarray(keys, float)
    if K[0, 0] > K[-1, 0]:
        K = K[::-1]
    xs = K[:, 0]
    i = int(np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2))
    p0, p1, p2, p3 = K[max(i - 1, 0)], K[i], K[i + 1], K[min(i + 2, len(K) - 1)]
    t = (x - p1[0]) / (p2[0] - p1[0])
    t2, t3 = t * t, t * t * t
    v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    v[0] = x
    return v


def rotate_to(a, b, v):
    """Rota v con la rotación mínima que lleva el vector unitario a al b (Rodrigues)."""
    k = np.cross(a, b)
    sn, c = np.linalg.norm(k), float(a @ b)
    if sn < 1e-9:
        return np.asarray(v, float)
    k = k / sn
    v = np.asarray(v, float)
    return v * c + np.cross(k, v) * sn + k * (k @ v) * (1 - c)


def interp_table(keys, xs):
    return [tuple(catmull(keys, x)) for x in xs]


def gauss(x, s):
    return np.exp(-(x / s) ** 2)


class Body:
    def __init__(self, stage=5):
        self.m = HalfMesh()
        self.stage = stage
        self.ports = {}
        self.poles_expected = {}
        self.torso()
        if stage >= 2:
            self.legs()
        if stage >= 3:
            self.arms()
        if stage >= 4:
            self.neck_head()
        self.m.compact()

    # ================================================================== 1. torso y pelvis
    # (z delante, z detrás, semiancho x, y delante, y detrás). Medidas de la hoja (FRONT/SIDE);
    # el pecho y los glúteos se añaden como relieves (bumps) sobre la caja torácica / pelvis.
    TORSO = [
        (0.875, 0.875, 0.182, -0.095, 0.100),   # R0: borde del agujero de la pierna
        (0.905, 0.905, 0.187, -0.100, 0.112),
        (0.935, 0.935, 0.185, -0.094, 0.110),
        (0.965, 0.965, 0.177, -0.089, 0.110),
        (0.995, 0.995, 0.165, -0.094, 0.106),
        (1.025, 1.025, 0.153, -0.100, 0.100),
        (1.055, 1.055, 0.139, -0.106, 0.082),
        (1.085, 1.085, 0.123, -0.107, 0.056),
        (1.115, 1.115, 0.103, -0.104, 0.034),   # cintura (3 loops)
        (1.145, 1.145, 0.091, -0.102, 0.028),
        (1.175, 1.175, 0.090, -0.102, 0.029),
        (1.205, 1.205, 0.096, -0.103, 0.033),
        (1.235, 1.235, 0.104, -0.102, 0.045),   # pliegue bajo el pecho
        (1.262, 1.262, 0.112, -0.100, 0.056),
        (1.288, 1.288, 0.119, -0.098, 0.066),
        (1.312, 1.312, 0.122, -0.094, 0.076),
        (1.336, 1.340, 0.123, -0.088, 0.083),   # axila (fila inferior del agujero del brazo)
        (1.365, 1.375, 0.125, -0.076, 0.088),
        (1.392, 1.410, 0.119, -0.058, 0.088),
        (1.407, 1.440, 0.100, -0.036, 0.080),   # borde superior: clavícula delante, C7 detrás
    ]
    ARM_ROWS = (16, 19)      # el agujero del brazo ocupa las filas R16-R19 (3 bandas)
    ARM_SEGS = (7, 10)       # y los segmentos 7..10 del medio anillo (3 segmentos)
    NECK_SPECIALS = [3, 7, 10, 14]   # reducción 32 -> 16; 7 y 10 son las esquinas del agujero

    def torso(self):
        m = self.m
        th = np.linspace(0, np.pi, H_TORSO + 1)

        def bumps(z):
            def breast(t, p):
                sz = 0.058 if z > 1.29 else 0.024
                b = gauss(t - 0.55, 0.40) * gauss(z - 1.290, sz) * PR.BUST
                return (0.10 * b, -b, -0.15 * b)

            def glute(t, p):
                sz = 0.075 if z > 0.955 else 0.05
                g = gauss(t - (np.pi - 0.60), 0.45) * gauss(z - 0.955, sz) * PR.GLUTE
                cleft = gauss(t - np.pi, 0.20) * gauss(z - 0.95, 0.06) * 0.016
                return (0.1 * g, g - cleft, 0)
            return (breast, glute)
        R = []
        for (zf, zb, rx, yf, yb) in self.TORSO:
            fac = HIP if zf < 1.06 else (WAIST if zf < 1.24 else CHEST)
            yc = 0.5 * (yf + yb)
            pts = half_ring((0, yc * SC, zf * SC), rx * fac * SC, (yc - yf) * SC, (yb - yc) * SC,
                            H_TORSO, power=2.3, angles=th, bumps=bumps(zf))
            for t, p in zip(th, pts):
                p[2] = (zf + (zb - zf) * (1 - np.cos(t)) / 2) * SC
            R.append(m.ring(pts, 'torso'))
        self.R = R
        r0, r1 = self.ARM_ROWS
        s0, s1 = self.ARM_SEGS
        for i in range(len(R) - 1):
            for j in range(H_TORSO):
                if r0 <= i < r1 and s0 <= j < s1:
                    continue                  # agujero del brazo
                m.face(R[i][j], R[i][j + 1], R[i + 1][j + 1], R[i + 1][j])
        # cadena de la entrepierna sobre el plano de simetría (de detrás hacia delante)
        cz = PR.CROTCH_Z * SC
        c3 = m.v((0, 0.052 * SC, cz - 0.004), 'torso')
        c2 = m.v((0, 0.000, cz - 0.010), 'torso')
        c1 = m.v((0, -0.050 * SC, cz - 0.004), 'torso')
        self.ports['leg_hole'] = R[0] + [c3, c2, c1]
        # agujero del brazo (12 vértices): abajo, lado trasero, arriba (al revés), lado delantero
        self.ports['arm_hole'] = ([R[r0][j] for j in range(s0, s1 + 1)]
                                  + [R[i][s1] for i in range(r0 + 1, r1)]
                                  + [R[r1][j] for j in range(s1, s0 - 1, -1)]
                                  + [R[i][s0] for i in range(r1 - 1, r0, -1)])
        self.ports['neck_base'] = R[-1]

    # ================================================================== 2. piernas y pies
    # tabla clave de la pierna (z, centro x, centro y, semiancho x, radio delante, radio detrás);
    # los anillos se interpolan (Catmull-Rom) en las alturas de LEG_Z.
    LEG = [
        (0.790, 0.093, -0.008, 0.091, 0.098, 0.090),
        (0.740, 0.093, -0.005, 0.080, 0.091, 0.090),
        (0.690, 0.094, -0.002, 0.067, 0.080, 0.078),
        (0.645, 0.091, 0.003, 0.056, 0.068, 0.062),
        (0.612, 0.090, 0.006, 0.048, 0.060, 0.052),
        (0.585, 0.091, 0.008, 0.045, 0.058, 0.054),
        (0.558, 0.090, 0.012, 0.047, 0.058, 0.054),
        (0.520, 0.098, 0.020, 0.045, 0.053, 0.061),
        (0.470, 0.102, 0.034, 0.059, 0.056, 0.074),
        (0.430, 0.103, 0.043, 0.067, 0.065, 0.075),
        (0.380, 0.102, 0.046, 0.062, 0.061, 0.068),
        (0.330, 0.101, 0.046, 0.049, 0.053, 0.053),
        (0.280, 0.099, 0.045, 0.040, 0.046, 0.044),
        (0.230, 0.096, 0.044, 0.032, 0.039, 0.037),
        (0.190, 0.095, 0.043, 0.027, 0.036, 0.033),
        (0.155, 0.092, 0.043, 0.027, 0.035, 0.031),
        (0.120, 0.093, 0.046, 0.032, 0.044, 0.038),
    ]
    # 27 anillos: 3 loops en la rodilla (0.607/0.590/0.573) y 3 en el tobillo (0.19/0.165/0.14)
    LEG_Z = [0.795, 0.765, 0.735, 0.705, 0.675, 0.648, 0.625, 0.607, 0.590, 0.573, 0.555, 0.535,
             0.510, 0.485, 0.455, 0.425, 0.395, 0.365, 0.335, 0.305, 0.275, 0.245, 0.215, 0.190,
             0.165, 0.140, 0.120]
    # pie: (y, semiancho, altura del empeine, x centro)
    FOOT = [
        (0.094, 0.028, 0.052, 0.096), (0.076, 0.033, 0.072, 0.096), (0.054, 0.035, 0.084, 0.096),
        (0.032, 0.036, 0.088, 0.097), (0.010, 0.037, 0.084, 0.098), (-0.014, 0.039, 0.074, 0.099),
        (-0.050, 0.041, 0.060, 0.101), (-0.085, 0.040, 0.050, 0.102), (-0.116, 0.033, 0.042, 0.103),
    ]
    FOOT_HOLE = (1, 5)        # segmentos del tubo del pie donde se abre el agujero del tobillo

    def legs(self):
        m = self.m
        A = self.ports['leg_hole']
        z0 = 0.835 * SC
        # el anillo L1 sigue la forma del primer anillo del muslo (sin escalón en la cadera)
        c = np.array([self.LEG[0][1] * HIP * SC, self.LEG[0][2] * SC, z0])

        def place(P, k):
            p = np.mean(P, 0)
            d = p[:2] - c[:2]
            ang = np.arctan2(d[0], -d[1])          # 0 = delante
            rx = 0.093 * SC
            ry = (0.099 if np.cos(ang) >= 0 else 0.092) * SC
            q = c + np.array([np.sin(ang) * rx, -np.cos(ang) * ry, 0.0])
            q[0] = max(q[0], 0.012 * SC)            # la cara interna no toca el plano de simetría
            q[2] = z0 + (p[2] - 0.875 * SC) * 0.4
            return q
        L1, poles = m.reduce_to(A, [0, H_TORSO], place, closed=True, group='leg')
        self.poles_expected['ingle/glúteo (reducción 20→16)'] = poles
        angles = self._angles_of(L1, c)
        prev = L1
        for (z, cx, cy, rx, rf, rb) in interp_table(self.LEG, self.LEG_Z):
            zz = z * SC
            cen = np.array([cx * HIP * SC if z > 0.6 else cx * SC, cy * SC, zz])
            ang = angles
            # rótula: relieve delantero en los 3 loops de la rodilla
            knee = 0.007 * SC * gauss(z - 0.598, 0.022)
            pts = [cen + np.array([np.sin(a) * rx * SC,
                                   -np.cos(a) * (rf if np.cos(a) >= 0 else rb) * SC - knee * gauss(np.sin(a / 2), 0.35), 0])
                   for a in ang]
            # relajar la distribución angular hacia uniforme a medida que bajamos
            angles = 0.75 * angles + 0.25 * self._uniform_like(angles)
            ring = m.ring(pts, 'leg')
            m.bridge(prev, ring)
            prev = ring
        self.foot(prev)

    def _angles_of(self, ring, c):
        a = []
        for i in ring:
            d = self.m.V[i][:2] - c[:2]
            a.append(np.arctan2(d[0], -d[1]))
        return np.unwrap(np.array(a))

    @staticmethod
    def _uniform_like(angles):
        n = len(angles)
        step = (angles[-1] - angles[0]) / (n - 1) if n > 1 else 0
        tot = 2 * np.pi * np.sign(step if step else 1)
        return angles[0] + np.arange(n) * tot / n

    def foot(self, ankle):
        m = self.m
        rings = []
        for (y, w, h, cx) in self.FOOT:
            y *= SC; w *= SC; h *= SC; cx *= SC
            xs = np.linspace(cx + w, cx - w, 5)          # de fuera (+x) a dentro
            top = [(x, y, h * (1 - 0.22 * ((x - cx) / w) ** 2)) for x in xs]
            si = (cx - w * 1.12, y, h * 0.36)
            xb = np.linspace(cx - w * 1.08, cx + w * 1.08, 5)   # suela algo más ancha que el empeine
            bot = [(x, y, 0.0 if abs(x - cx) < w * 0.9 else 0.003 * SC) for x in xb]
            so = (cx + w * 1.12, y, h * 0.36)
            pts = top + [si] + bot + [so]                  # 12: arriba 4, lado 2, abajo 4, lado 2
            rings.append(m.ring(pts, 'foot'))
        f0, f1 = self.FOOT_HOLE
        for i in range(len(rings) - 1):
            for j in range(12):
                if f0 <= i < f1 and j < 4:
                    continue                            # agujero del tobillo (arriba, 4x4)
                a, b = rings[i], rings[i + 1]
                m.face(a[j], a[(j + 1) % 12], b[(j + 1) % 12], b[j])
        m.cap_grid(rings[0][4::-1] + rings[0][:4:-1], 4, 2, lift=-0.012 * SC, normal=(0, 1, 0), group='foot')
        m.cap_grid(rings[-1], 4, 2, lift=-0.012 * SC, normal=(0, -1, 0), group='foot')
        hole = ([rings[f0][j] for j in range(0, 5)] + [rings[i][4] for i in range(f0 + 1, f1)]
                + [rings[f1][j] for j in range(4, -1, -1)] + [rings[i][0] for i in range(f1 - 1, f0, -1)])
        self._bridge_aligned(ankle, hole)

    def _bridge_aligned(self, ring, loop):
        """Bridge Edge Loops con la rotación/dirección que minimiza la longitud de las aristas."""
        P = [self.m.V[i] for i in loop]
        Q = [self.m.V[i] for i in ring]
        order = best_alignment(P, Q)
        self.m.bridge(loop, [ring[k] for k in order])

    # ================================================================== 3. brazos y manos
    def arms(self):
        m = self.m
        hole = self.ports['arm_hole']
        sh = np.array([0.162, -0.008, 1.360]) * SC
        el = np.array([0.228, 0.002, 1.135]) * SC
        wr = np.array([0.310, -0.004, 0.960]) * SC
        d1 = (el - sh) / np.linalg.norm(el - sh)
        d2 = (wr - el) / np.linalg.norm(wr - el)
        # A0: extrusión del agujero hacia fuera (arranque del deltoides)
        A0 = m.ring([m.V[i] + np.array([0.026, 0, 0.004]) * SC for i in hole], 'arm')
        m.bridge(hole, A0)
        # (t en el segmento, radio lateral, delante, detrás)
        # (t en el segmento, radio lateral, delante, detrás); 3 loops en el codo (t 0.90/1.00/0.08)
        UPPER = [(0.02, 0.041, 0.050, 0.052), (0.13, 0.037, 0.046, 0.048), (0.26, 0.033, 0.042, 0.044),
                 (0.40, 0.031, 0.039, 0.040), (0.55, 0.030, 0.036, 0.036), (0.70, 0.030, 0.033, 0.033),
                 (0.82, 0.029, 0.031, 0.032), (0.91, 0.028, 0.030, 0.031), (1.00, 0.028, 0.029, 0.031)]
        LOWER = [(0.08, 0.030, 0.029, 0.030), (0.20, 0.033, 0.030, 0.029), (0.34, 0.031, 0.028, 0.027),
                 (0.48, 0.029, 0.026, 0.025), (0.62, 0.026, 0.023, 0.022), (0.76, 0.023, 0.020, 0.019),
                 (0.89, 0.019, 0.018, 0.017), (1.00, 0.018, 0.019, 0.017)]
        prev = A0
        for (t, rs, rf, rb) in UPPER:
            ring = full_ring(sh + (el - sh) * t, d1 if t > 0.05 else (d1 * 0.6 + np.array([0.8, 0, 0])),
                             rs * SC, rf * SC, rb * SC, n=N_ARM)
            prev = self._next_ring(prev, ring, 'arm')
        for (t, rs, rf, rb) in LOWER:
            ring = full_ring(el + (wr - el) * t, d2, rs * SC, rf * SC, rb * SC, n=N_ARM)
            prev = self._next_ring(prev, ring, 'arm')
        self.hand(prev, wr, d2)

    def _next_ring(self, prev, pts, group):
        P = [self.m.V[i] for i in prev]
        order = best_alignment(P, pts)
        ring = self.m.ring([pts[k] for k in order], group)
        self.m.bridge(prev, ring)
        return ring

    def hand(self, wrist, wr, d2):
        m = self.m
        tip = np.array([0.345, -0.012, 0.790]) * SC
        h = (tip - wr) / np.linalg.norm(tip - wr)
        a, s, f = frame(h, (0, -1, 0))          # f = hacia el pulgar (delante), s = lateral
        w_axis = s if s[0] > 0 else -s          # dorso hacia fuera (+X)

        def palm_ring(cen, width, thick, n_top):
            us = np.linspace(width / 2, -width / 2, n_top + 1)
            dors = [cen + f * u + w_axis * (thick / 2 + 0.002 * SC * (1 - (2 * u / width) ** 2)) for u in us]
            palm = [cen + f * u - w_axis * thick / 2 for u in us[::-1]]
            return dors + palm
        # anillo de nudillos (16): dorso D0..D7 (del índice al meñique) + palma P7..P0
        kc = wr + h * 0.085 * SC
        us = np.array([0.040, 0.023, 0.019, 0.002, -0.002, -0.019, -0.023, -0.040]) * SC
        K = m.ring([kc + f * u + w_axis * 0.012 * SC for u in us]
                   + [kc + f * u - w_axis * 0.011 * SC for u in us[::-1]], 'hand')

        def place(P, k):
            return np.mean(P, 0) - h * 0.040 * SC
        Pa1, poles = m.reduce_to(K, [4, 11], place, closed=True, group='hand')
        self.poles_expected['dorso/palma (12→16)'] = poles
        Pa0 = palm_ring(wr + h * 0.012 * SC, 0.058 * SC, 0.026 * SC, 5)
        order = best_alignment([m.V[i] for i in Pa1], Pa0)
        Pa0 = m.ring([Pa0[k] for k in order], 'hand')
        m.bridge(Pa0, Pa1)
        self._bridge_aligned(Pa0, wrist) if False else self._bridge_ring_to_ring(wrist, Pa0)
        # membranas entre dedos
        D = K[:8]
        Pm = K[8:][::-1]                     # P0..P7
        for k in range(3):
            m.face(D[2 * k + 1], D[2 * k + 2], Pm[2 * k + 2], Pm[2 * k + 1])
        lengths = [0.066, 0.074, 0.069, 0.055]
        spread = [0.10, 0.03, -0.04, -0.12]
        for k in range(4):
            quad = [D[2 * k], D[2 * k + 1], Pm[2 * k + 1], Pm[2 * k]]
            dirf = h + f * spread[k] - w_axis * 0.10
            self._finger(quad, dirf / np.linalg.norm(dirf), lengths[k] * SC, 0.0085 * SC, 0.0080 * SC,
                         curl=-w_axis * (0.22 + 0.04 * k))
        # pulgar: sale de la cara lateral entre Pa0 y Pa1 del lado del índice
        side = None
        best = -1e9
        for i in range(len(Pa0)):
            j = (i + 1) % len(Pa0)
            q = [Pa0[i], Pa0[j], Pa1[j], Pa1[i]]
            cpos = np.mean([m.V[x] for x in q], 0)
            sc = (cpos - wr) @ f
            if sc > best:
                best, side = sc, q
        # sale casi perpendicular al lado de la palma (metacarpo) y se curva hacia abajo
        tdir = f * 0.80 + h * 0.45 - w_axis * 0.35
        self._finger(side, tdir / np.linalg.norm(tdir), 0.050 * SC, 0.011 * SC, 0.010 * SC,
                     segs=(0.30, 0.60, 0.82, 1.0), curl=h * 0.55 - w_axis * 0.10)

    def _bridge_ring_to_ring(self, a, b):
        order = best_alignment([self.m.V[i] for i in a], [self.m.V[i] for i in b])
        self.m.bridge(a, [b[k] for k in order])

    def _finger(self, quad, d, length, hw, ht, segs=(0.22, 0.48, 0.75, 1.0), curl=None):
        """Extruye un dedo desde una cara (quad) en 4 segmentos + tapa.
        curl: vector hacia la palma; los segmentos se curvan hacia él (dedos relajados)."""
        m = self.m
        P = np.array([m.V[i] for i in quad])
        base = P.mean(0)
        m.F = [f for f in m.F if set(f) != set(quad)]     # extrusión: la cara base desaparece
        prev = quad
        n0 = np.cross(P[1] - P[0], P[3] - P[0])
        n0 /= np.linalg.norm(n0)
        if n0 @ d < 0:
            n0 = -n0
        cv = np.zeros(3) if curl is None else np.asarray(curl, float)
        for i, t in enumerate(segs):
            scale = 0.86 if i == 0 else 0.86 * (1.0 - 0.28 * t)
            off = d * (length * t) + cv * length * t * t
            # cada anillo es perpendicular a la tangente local del dedo (sin cizalla)
            tan = d + 2 * cv * t
            tan /= np.linalg.norm(tan)
            ring = m.ring([base + off + rotate_to(n0, tan, (p - base) * scale) for p in P], 'hand')
            m.bridge(prev, ring)
            prev = ring
        m.face(*prev)

    # ================================================================== 4. cuello y cabeza
    NECK = [(1.425, 0.050, 0.030, 0.052), (1.460, 0.046, 0.030, 0.050), (1.495, 0.046, 0.030, 0.050)]
    HEAD = [(1.508, 0.052, -0.075, 0.056), (1.532, 0.061, -0.083, 0.068), (1.560, 0.067, -0.089, 0.080),
            (1.590, 0.071, -0.090, 0.088), (1.620, 0.073, -0.088, 0.090), (1.650, 0.071, -0.080, 0.085),
            (1.675, 0.062, -0.068, 0.074), (1.693, 0.045, -0.048, 0.052)]

    def neck_head(self):
        m = self.m
        A = self.ports['neck_base']
        z0, rx0, ry0f, ry0b = self.NECK[0]
        yc0 = 0.012 * SC

        def place(P, k):
            p = np.mean(P, 0)
            t = np.pi * k / H_NECK
            q = np.array([np.sin(t) * rx0 * SC, yc0 - np.cos(t) * (ry0f if np.cos(t) >= 0 else ry0b) * SC, z0 * SC])
            if k in (0, H_NECK):
                q[0] = 0.0
            return q
        N0, poles = m.reduce_to(A, self.NECK_SPECIALS, place, closed=False, group='neck')
        self.poles_expected['base del cuello (32→16)'] = poles
        prev = N0
        for (z, rx, ryf, ryb) in self.NECK[1:]:
            ring = m.ring(half_ring((0, yc0 + 0.004 * SC, z * SC), rx * SC, ryf * SC, ryb * SC, H_NECK), 'neck')
            m.bridge(prev, ring, closed=False)
            prev = ring
        th = np.linspace(0, np.pi, H_NECK + 1)
        H = []
        for idx, (z, rx, yf, yb) in enumerate(self.HEAD):
            yc = 0.5 * (yf + yb)
            pts = half_ring((0, yc * SC, z * SC), rx * SC, (yc - yf) * SC, (yb - yc) * SC, H_NECK, power=2.2, angles=th)
            ring = m.ring(pts, 'head')
            m.bridge(prev, ring, closed=False)
            prev = ring
            H.append(ring)
        # rasgos sugeridos: nariz, cuencas, mandíbula
        V = m.V
        V[H[2][0]][1] -= 0.016 * SC          # punta de la nariz
        V[H[1][0]][1] -= 0.004 * SC
        V[H[3][0]][1] -= 0.004 * SC          # puente
        V[H[3][1]][1] += 0.006 * SC          # cuenca del ojo
        V[H[3][1]][0] -= 0.002 * SC
        V[H[4][1]][1] -= 0.002 * SC          # arco superciliar
        V[H[0][2]][0] -= 0.004 * SC          # mandíbula más estrecha
        # tapa del cráneo: rejilla 2 x 4 sobre el medio anillo + línea central
        top = H[-1]
        center = [m.v((0, lerp(V[top[0]], V[top[-1]], t)[1], 1.702 * SC), 'head') for t in (0.25, 0.5, 0.75)]
        mid = [m.v(lerp(V[top[4]], V[c], 0.5) + np.array([0, 0, 0.004 * SC]), 'head') for c in center]
        grid = [[top[0], top[1], top[2]], [center[0], mid[0], top[3]], [center[1], mid[1], top[4]],
                [center[2], mid[2], top[5]], [top[8], top[7], top[6]]]
        for r in range(4):
            for c in range(2):
                m.face(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c])
        # oreja en bloque: extrusión de la cara lateral entre H2 y H3
        q = [H[2][4], H[2][5], H[3][5], H[3][4]]
        m.extrude_face(q, np.array([0.014, 0.004, 0.002]) * SC, scale=0.85, group='head')
