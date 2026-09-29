"""Maniquí masculino low/mid poly (media malla x >= 0). Resultado final sin subdivisión.

Cada anillo tiene sus vértices en posiciones anatómicas fijas (ranuras), así las aristas
verticales siguen líneas del cuerpo (línea media, borde del recto abdominal, pezón, serrato,
costado, dorsal, escápula, columna) y las horizontales los pliegues (pectoral, costillas,
cintura, cresta ilíaca, glúteo).
Transiciones entre densidades con los patrones de la tabla (mesh.py): se anotan en `m.log`.
"""
import json
import os

import numpy as np

from mesh import HalfMesh, best_alignment, frame

HERE = os.path.dirname(os.path.abspath(__file__))
DEG = np.pi / 180
# ranuras del medio anillo del torso (0 = línea media delantera, 180 = columna)
T_ANG = np.radians([0, 12, 26, 44, 66, 88, 110, 130, 150, 166, 180])
T_SLOTS = ['línea media', 'recto abdominal', 'pezón / abdomen lateral', 'serrato', 'costado delante',
           'costado', 'dorsal', 'escápula', 'erectores', 'columna lateral', 'columna']
HOLE_ROWS = (10, 12)          # agujero del brazo entre el anillo 10 (axila, z 1.39) y el 12 (acromion, anillo superior)
HOLE_SLOTS = (4, 6)           # y las ranuras 4..6 (66°..110°)
HAND_TWIST = 5.0             # grados de pronación: en la hoja el dorso mira hacia fuera (vista SIDE)
N_LEG = 10
N_ARM = 8
H_NECK = 6                    # medio anillo de cuello y cabeza (12 alrededor)
NECK_ANG = np.radians([0, 28, 58, 90, 122, 152, 180])


def g(x, s):
    return np.exp(-(x / s) ** 2)


def load_tables():
    with open(os.path.join(HERE, 'tables.json')) as fh:
        return json.load(fh)


def superellipse(th, w, yf, yb, e):
    s, c = np.sin(th), np.cos(th)
    yc = 0.5 * (yf + yb)
    ry = (yc - yf) if c >= 0 else (yb - yc)
    return np.array([w * abs(s) ** e, yc - ry * np.sign(c) * abs(c) ** e])


class Figure:
    def __init__(self, stage=7, T=None):
        self.T = T or load_tables()
        self.m = HalfMesh()
        self.stage = stage
        self.poles = {}
        self.carve = self._carve_table()
        self.torso()
        self.legs()
        self.arms()
        self.neck_head()
        self.m.compact()

    # ================================================================== torso y pelvis
    def torso_point(self, i, k, row):
        zf, zb, w, yf, yb = row
        th = T_ANG[k]
        x, y = superellipse(th, w, yf, yb, 2 / 2.4)
        z = zf + (zb - zf) * (1 - np.cos(th)) / 2
        if self.stage >= 2:
            # talla por planos (etapa 2): desplaza el vértice según la normal del anillo y en z
            dr, dz = self.carve.get((i, k), (0.0, 0.0))
            if dr:
                if k in (0, 10):                     # línea media: solo en y
                    n = np.array([0.0, -1.0 if k == 0 else 1.0])
                else:
                    a = superellipse(th - 0.01, w, yf, yb, 2 / 2.4)
                    b = superellipse(th + 0.01, w, yf, yb, 2 / 2.4)
                    t = (b - a) / np.linalg.norm(b - a)
                    n = np.array([-t[1], t[0]])
                    if n @ (np.array([x, y]) - [0, 0.5 * (yf + yb)]) < 0:
                        n = -n
                x, y = x + dr * n[0], y + dr * n[1]
            z += dz
        return np.array([x if 0 < k < 10 else 0.0, y, z])

    def _carve_table(self):
        """tables.json 'carve': lista de [filas, ranuras, desplazamiento normal (m), dz (m), nota].
        Las entradas se suman."""
        out = {}
        for rows, slots, dr, dz, _note in self.T.get('carve', []):
            for i in rows:
                for k in slots:
                    a, b = out.get((i, k), (0.0, 0.0))
                    out[(i, k)] = (a + dr, b + dz)
        return out

    def torso(self):
        m = self.m
        m.tag = 'torso'
        R = []
        for i, row in enumerate(self.T['torso']):
            R.append(m.ring([self.torso_point(i, k, row) for k in range(len(T_ANG))]))
        self.R = R
        r0, r1 = HOLE_ROWS
        s0, s1 = HOLE_SLOTS
        for i in range(len(R) - 1):
            for k in range(len(T_ANG) - 1):
                if r0 <= i < r1 and s0 <= k < s1:
                    continue
                m.face(R[i][k], R[i][k + 1], R[i + 1][k + 1], R[i + 1][k])
        self.arm_hole = ([R[r0][k] for k in range(s0, s1 + 1)] + [R[i][s1] for i in range(r0 + 1, r1)]
                         + [R[r1][k] for k in range(s1, s0 - 1, -1)] + [R[i][s0] for i in range(r1 - 1, r0, -1)])
        # entrepierna: cadena de 3 vértices sobre el eje (detrás, centro, delante)
        yf, yb = m.V[R[0][0]][1], m.V[R[0][-1]][1]
        cb = m.v((0.0, yb - 0.35 * (yb - yf), 0.915))
        cm = m.v((0.0, 0.5 * (yf + yb), 0.905))
        cf = m.v((0.0, yf + 0.35 * (yb - yf), 0.915))
        self.leg_hole = [cf] + R[0] + [cb, cm]

    # ================================================================== piernas
    def leg_ring(self, row, angles):
        z, cx, cy, rx, rf, rb = row
        out = []
        for a in angles:
            p = np.array([cx + np.sin(a) * rx, cy - np.cos(a) * (rf if np.cos(a) >= 0 else rb), z])
            if self.stage >= 2:
                # talla por planos: 'leg_carve' = [z mín, z máx, ángulo mín, ángulo máx, dr, nota];
                # ángulo 0 = delante, 90 = fuera, 180 = detrás, 270 = dentro
                d = (np.degrees(a) + 360) % 360
                for z0, z1, a0, a1, dr, _n in self.T.get('leg_carve', []):
                    if z0 <= z <= z1 and (a0 <= d <= a1 or a0 <= d + 360 <= a1):
                        p[:2] += dr * np.array([np.sin(a), -np.cos(a)])
            out.append(p)
        return out

    def legs(self):
        m = self.m
        m.tag = 'leg'
        L = self.T['leg']
        ang = np.linspace(0, 2 * np.pi, N_LEG, endpoint=False)
        first = L[0]
        c = np.array([first[1], first[2]])

        def place(k, P):
            p = np.mean(P, 0)
            a = np.arctan2(p[0] - c[0], -(p[1] - c[1]))
            q = self.leg_ring(first, [a])[0]
            q[0] = max(q[0], 0.012)
            return q
        # pelvis -> muslo: 14 aristas -> 10 con dos FourPointTriangles centrados en la línea media
        # delantera (ingle) y trasera (pliegue del glúteo); así ningún vértice del eje llega a 6 aristas
        L1, poles = m.step(self.leg_hole, ['f'] + ['q'] * 8 + ['f', 'q', 'q'], place, name='pelvis → muslo')
        self.poles['muslo (FourPointTriangles en ingle y pliegue del glúteo)'] = poles
        a1 = [np.arctan2(m.V[v][0] - c[0], -(m.V[v][1] - c[1])) for v in L1]
        prev = L1
        rings = [L1]
        for row in L[1:]:
            r = m.ring(self.leg_ring(row, a1))
            m.bridge(prev, r)
            prev = r
            rings.append(r)
        self.leg_rings = rings
        self.foot(prev)

    def foot(self, ankle):
        """Zapato: el tubo del tobillo gira 90° hacia delante; la puntera se tapa con Grid Division."""
        m = self.m
        m.tag = 'foot'
        # (α giro, centro x, y, z, semiancho, radio arriba/delante, radio abajo/detrás)
        # bloque de zapato como en la hoja: talón cuadrado, empeine en rampa desde la espinilla hasta
        # la puntera, puntera plana y banda de suela vertical (secciones casi rectangulares, e = 0.4)
        F = [(35, 0.184, 0.098, 0.085, 0.034, 0.058, 0.082),   # talón alto: detrás llega a y 0.165
             (60, 0.194, 0.078, 0.074, 0.038, 0.062, 0.078),   # arranque del empeine / talón abajo
             (90, 0.204, 0.030, 0.064, 0.047, 0.052, 0.064),   # empeine
             (90, 0.217, -0.018, 0.052, 0.053, 0.044, 0.052),  # metatarsos
             (90, 0.224, -0.058, 0.043, 0.051, 0.033, 0.043),  # caja de los dedos
             (90, 0.229, -0.090, 0.034, 0.044, 0.025, 0.034)]  # punta
        prev = ankle
        e = 0.4
        for (al, cx, cy, cz, rx, rf, rb) in F:
            a = np.radians(al)
            cc = np.array([cx, cy, cz])
            fdir = np.array([0, -np.cos(a), np.sin(a)])
            pts = []
            for k in range(N_LEG):
                ph = 2 * np.pi * k / N_LEG
                sn, cs = np.sin(ph), np.cos(ph)
                r = rf if cs >= 0 else rb
                xw = rx * (1 - 0.40 * max(cs, 0.0))          # sección en trapecio: más estrecha arriba
                if sn < 0 and al < 90 + 1 and cy > 0.0:      # arco interno / maléolo: abombado hacia dentro
                    xw += 0.012 * max(0.0, 1 - abs(cs - 0.2))
                p = cc + np.array([1.0, 0, 0]) * np.sign(sn) * abs(sn) ** e * xw + fdir * np.sign(cs) * abs(cs) ** e * r
                if al < 90 and cs < -0.6:                    # talón plano sobre el suelo, trasera vertical
                    p[2] = 0.0
                p[2] = max(p[2], 0.0)
                pts.append(p)
            order = best_alignment([m.V[i] for i in prev], pts)
            r = m.ring([pts[j] for j in order])
            m.bridge(prev, r)
            prev = r
        # puntera: Grid Division 2 × 3 del anillo de 10 (empieza en una esquina: arriba-fuera)
        V = [m.V[i] for i in prev]
        cxm, czm = np.mean([p[0] for p in V]), np.mean([p[2] for p in V])
        start = int(np.argmax([(p[0] - cxm) + (p[2] - czm) for p in V]))
        ring = prev[start:] + prev[:start]
        m.cap_grid(ring, 2, 3, inner=lambda r, c, p: p + np.array([0, -0.006, 0]))
        m.log.append(('puntera del pie', 'Grid Division', 'anillo de 10 → rejilla 2 × 3'))

    # ================================================================== brazos y manos
    def arms(self):
        m = self.m
        m.tag = 'arm'
        A = self.T['arm']
        sh, el, wr = (np.array(A[k]) for k in ('shoulder', 'elbow', 'wrist'))
        d1 = (el - sh) / np.linalg.norm(el - sh)
        d2 = (wr - el) / np.linalg.norm(wr - el)

        carve = {}
        if self.stage >= 2:
            # 'arm_carve' = [tramo ('upper'/'lower'), índices de anillo, ranuras k, dr, nota];
            # k: 0 delante, 2 fuera, 4 detrás, 6 dentro (8 ranuras)
            for seg, idx, ks, dr, _n in self.T.get('arm_carve', []):
                for i in idx:
                    for k in ks:
                        carve[(seg, i, k)] = carve.get((seg, i, k), 0.0) + dr

        def ring_at(center, axis, rs, rf, rb, key=None):
            a, s, f = frame(axis, (0, -1, 0))
            if s[0] < 0:
                s = -s
            out = []
            for k in range(N_ARM):
                t = 2 * np.pi * k / N_ARM
                c, sn = np.cos(t), np.sin(t)
                d = carve.get((*key, k), 0.0) if key else 0.0
                out.append(center + f * c * ((rf if c >= 0 else rb) + d) + s * sn * (rs + d))
            return out
        hole = self.arm_hole
        H = np.array([m.V[i] for i in hole])
        t0, rs0, rf0, rb0 = A['upper'][0]
        T = np.array(ring_at(sh + (el - sh) * t0, d1, rs0, rf0, rb0, ('upper', 0)))
        T = T[best_alignment(H, T)]
        prev = hole
        rings = [hole]
        # hombro: loft del agujero del torso al primer anillo del brazo (deltoides)
        for sv in (0.33, 0.66):
            pts = []
            zc = H[:, 2].mean()
            for p0, p3 in zip(H, T):
                up = max(0.0, (p0[2] - zc) / (H[:, 2].max() - zc))
                # sale perpendicular al torso, sin pasar de la mitad del hueco hasta el brazo
                # (en la axila el hueco es corto: si la curva se pasa, el loft se pliega)
                p1 = p0 + np.array([min(0.05, 0.5 * max(p3[0] - p0[0], 0.0)), 0, 0.04 * up])
                p2 = p3 - d1 * 0.05 + np.array([0, 0, 0.03 * up])  # llega alineado con el húmero; cúpula del deltoides
                u = 1 - sv
                q = u ** 3 * p0 + 3 * u * u * sv * p1 + 3 * u * sv * sv * p2 + sv ** 3 * p3
                pts.append(q)
            r = m.ring(pts)
            m.bridge(prev, r)
            prev = r
            rings.append(r)
        r = m.ring(list(T))
        m.bridge(prev, r)
        prev = r
        rings.append(r)
        for i, (t, rs, rf, rb) in enumerate(A['upper'][1:], 1):
            pts = ring_at(sh + (el - sh) * t, d1, rs, rf, rb, ('upper', i))
            prev = self._next_ring(prev, pts)
            rings.append(prev)
        for i, (t, rs, rf, rb) in enumerate(A['lower']):
            pts = ring_at(el + (wr - el) * t, d2, rs, rf, rb, ('lower', i))
            prev = self._next_ring(prev, pts)
            rings.append(prev)
        self.arm_rings = rings
        self.hand(prev, wr, d2)

    def _next_ring(self, prev, pts):
        m = self.m
        order = best_alignment([m.V[i] for i in prev], pts)
        r = m.ring([pts[j] for j in order])
        m.bridge(prev, r)
        return r

    def hand(self, wrist, wr, d2):
        """Palma: nudillos (16) -> 12 -> 8 con FourPointTriangles en el dorso y la palma, unida a la
        muñeca (8). Cuatro dedos y membranas: Parallel Division del anillo de nudillos."""
        m = self.m
        m.tag = 'hand'
        tip = np.array([0.335, -0.030, 0.76])
        h = (tip - wr) / np.linalg.norm(tip - wr)
        a, s, f = frame(h, (0, -1, 0))
        w = s if s[0] > 0 else -s                      # dorso hacia fuera (+X)
        # pronación leve, como en la hoja: el dorso mira hacia fuera y hacia delante
        ca, sa = np.cos(np.radians(HAND_TWIST)), np.sin(np.radians(HAND_TWIST))
        w, f = ca * w + sa * f, ca * f - sa * w
        kc = wr + h * 0.095
        us = np.array([0.041, 0.024, 0.019, 0.003, -0.002, -0.018, -0.023, -0.038])
        K = m.ring([kc + f * u + w * 0.014 for u in us] + [kc + f * u - w * 0.012 for u in us[::-1]])
        mid = wr + h * 0.050

        def place12(k, P):
            return np.mean(P, 0) - h * 0.030
        P12, p1 = m.step(K, ['q', 'q', 'q', 'f', 'q', 'q', 'q', 'q', 'q', 'q', 'q', 'f', 'q', 'q'],
                         place12, name='nudillos → palma')

        def place8(k, P):
            return np.mean(P, 0) - h * 0.028
        P8, p2 = m.step(P12, ['q', 'f', 'q', 'q', 'q', 'q', 'f', 'q', 'q', 'q'], place8, name='palma → muñeca')
        self.poles['dorso y palma (FourPointTriangles 16→12→8)'] = p1 + p2
        order = best_alignment([m.V[i] for i in wrist], [m.V[i] for i in P8])
        m.bridge(wrist, [P8[j] for j in order])
        m.log.append(('muñeca → palma', 'Bridge (8 = 8)', 'mismo número de aristas'))
        # membranas y dedos
        D, P = K[:8], K[8:][::-1]
        for k in range(3):
            m.face(D[2 * k + 1], D[2 * k + 2], P[2 * k + 2], P[2 * k + 1])
        lengths = [0.066, 0.073, 0.068, 0.054]
        spread = [0.06, 0.02, -0.02, -0.07]
        for k in range(4):
            quad = [D[2 * k], D[2 * k + 1], P[2 * k + 1], P[2 * k]]
            d = h + f * spread[k] - w * 0.12
            self._finger(quad, d / np.linalg.norm(d), lengths[k], curl=-w * 0.75, base=1.0, taper=0.15)
        m.log.append(('palma → dedos', 'Parallel Division',
                      'anillo de 16 = 4 bases de dedo + 3 membranas (quads paralelos)'))
        # pulgar: cara lateral de la palma del lado del índice
        best, side = -1e9, None
        faces = [f_ for f_ in m.F if len(set(f_) & set(P8)) == 2 and len(set(f_) & set(P12)) >= 1]
        for f_ in faces:
            cpos = np.mean([m.V[x] for x in f_], 0)
            sc = (cpos - wr) @ (f - 0.6 * w)     # cara delantera del lado de la palma
            if sc > best:
                best, side = sc, list(f_)
        # el pulgar baja por delante de la palma, casi paralelo a los dedos (como en la hoja)
        d = f * 0.4 + h * 0.5 - w * 0.6
        self._finger(side, d / np.linalg.norm(d), 0.070, curl=h * 0.3 - f * 0.3, base=0.85, lead=True)

    def _finger(self, quad, d, length, curl=None, base=0.92, segs=(0.12, 0.45, 0.75, 1.0), taper=0.25, lead=False):
        m = self.m
        P = np.array([m.V[i] for i in quad])
        c = P.mean(0)
        n0 = np.cross(P[1] - P[0], P[3] - P[0])
        n0 /= np.linalg.norm(n0)
        if n0 @ d < 0:
            n0 = -n0
        cv = np.zeros(3) if curl is None else np.asarray(curl)
        rings = []
        t0 = segs[0]
        for i, t in enumerate(segs):
            sc = base * (1 - taper * t)
            if lead and i == 0:
                # primer tramo recto según la normal de la cara: no roza las caras vecinas
                off, tan = n0 * length * t0, n0
            else:
                u = t - t0 if lead else t
                off = (n0 * length * t0 if lead else 0) + d * length * u + cv * length * u * u
                tan = d + 2 * cv * u
                tan = tan / np.linalg.norm(tan)
            rings.append([c + off + rotate_to(n0, tan, (p - c) * sc) for p in P])
        R = m.extrude_quad(quad, rings)
        m.cap_parallel(R[-1])
        return R

    # ================================================================== cuello y cabeza
    def neck_head(self):
        m = self.m
        m.tag = 'neck'
        top = self.R[-1]

        def ring_pts(row, power=2.2):
            zf, zb, w, yf, yb = row
            out = []
            for th in NECK_ANG:
                x, y = superellipse(th, w, yf, yb, 2 / power)
                z = zf + (zb - zf) * (1 - np.cos(th)) / 2
                out.append(np.array([x, y, z]))
            out[0][0] = out[-1][0] = 0.0
            return out
        N = self.T['neck']
        base = ring_pts(N[0], 2.0)
        # torso (10 aristas) -> cuello (6): 2 FourPointTriangles, en la clavícula y en el trapecio
        N0, poles = m.step(top, ['q', 'q', 'f', 'q', 'q', 'q', 'f', 'q'], lambda k, P: base[k],
                           closed=False, name='torso → cuello')
        self.poles['base del cuello (FourPointTriangles 10→6)'] = poles
        prev = N0
        for row in N[1:]:
            r = m.ring(ring_pts(row, 2.0))
            m.bridge(prev, r, closed=False)
            prev = r
        m.tag = 'head'
        Hd = []
        for row in self.T['head']:
            r = m.ring(ring_pts(row, 2.4))
            m.bridge(prev, r, closed=False)
            prev = r
            Hd.append(r)
        self.head_rings = Hd
        # coronilla: Grid Division 2 × 2 del medio anillo (6 aristas) + línea central
        V = m.V
        t = prev
        zt = self.T['top_z']
        c1 = m.v((0.0, 0.5 * (V[t[0]][1] + V[t[-1]][1]) - 0.004, zt))
        m1 = m.v(0.5 * (V[t[3]] + V[c1]) + np.array([0, 0, 0.006]))
        # rejilla: fila 0 = t0 t1 t2 ; fila 1 = cA m1 t3 ; fila 2 = t6 t5 t4
        cA = c1
        g_ = [[t[0], t[1], t[2]], [cA, m1, t[3]], [t[6], t[5], t[4]]]
        for r in range(2):
            for cc in range(2):
                m.face(g_[r][cc], g_[r][cc + 1], g_[r + 1][cc + 1], g_[r + 1][cc])
        m.log.append(('coronilla', 'Grid Division', 'medio anillo de 6 + eje → rejilla 2 × 2'))


def rotate_to(a, b, v):
    k = np.cross(a, b)
    sn, c = np.linalg.norm(k), float(a @ b)
    if sn < 1e-9:
        return np.asarray(v, float)
    k /= sn
    v = np.asarray(v, float)
    return v * c + np.cross(k, v) * sn + k * (k @ v) * (1 - c)
