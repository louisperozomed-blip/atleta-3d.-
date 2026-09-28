"""Proporciones del personaje: articulaciones, perfiles y músculos.

Todas las medidas salen de las siluetas de reference/ (512 px = 1 m).
Este archivo es el que se ajusta en cada iteración del bucle de revisión.
Perfiles de Limb: (t, r_exterior, r_interior, r_frontal, r_trasero[, despl_frontal])
"""
import numpy as np
from sdf import Ellipsoid, Limb, Capsule, Field

# ---------------------------------------------------------------- articulaciones
# Lado izquierdo (+X). El derecho se obtiene reflejando X.
J = {
    'pelvis':   (0.0, -0.015, 0.93),
    'spine':    (0.0, -0.050, 1.08),
    'chest':    (0.0, -0.050, 1.24),
    'neck':     (0.0, -0.030, 1.415),
    'head':     (0.0, -0.050, 1.495),
    'head_top': (0.0, -0.070, 1.705),
    'hip':      (0.098, -0.013, 0.905),
    'knee':     (0.140, -0.020, 0.590),
    'ankle':    (0.212, 0.045, 0.105),
    'ball':     (0.226, -0.075, 0.03),
    'toe':      (0.232, -0.150, 0.03),
    'clavicle': (0.040, -0.030, 1.390),
    'shoulder': (0.158, -0.022, 1.335),
    'elbow':    (0.278, -0.015, 1.150),
    'wrist':    (0.412, -0.018, 0.968),
    'knuckle':  (0.458, -0.030, 0.885),
}



def _hand_fingers():
    """Dedos (base, punta, radio) a partir de un marco de mano girado ~45°:
    la palma mira hacia el muslo y ligeramente hacia atrás, como en la referencia."""
    wr = np.array([0.412, -0.018, 0.968])
    d = np.array([0.50, 0.0, -0.866])                 # dirección muñeca -> dedos
    w = np.array([-0.55, -0.80, 0.0])                 # meñique -> índice
    w = w - d * (w @ d); w /= np.linalg.norm(w)
    n = np.cross(d, w)                                # normal del dorso
    kn = wr + d * 0.088
    out = {}
    spec = [('index', 0.026, 0.092, 0.0098, 0.10), ('middle', 0.008, 0.100, 0.0100, 0.03),
            ('ring', -0.010, 0.094, 0.0095, -0.05), ('pinky', -0.026, 0.076, 0.0085, -0.14)]
    for name, off, ln, r, spread in spec:
        b = kn + w * off - d * abs(off) * 0.25
        dirf = d + w * spread - n * 0.18             # ligera flexión hacia la palma
        out[name] = (tuple(b), tuple(b + dirf / np.linalg.norm(dirf) * ln), r)
    tb = wr + d * 0.030 + w * 0.030 - n * 0.012
    td = d * 0.75 + w * 0.55 - n * 0.35
    out['thumb'] = (tuple(tb), tuple(tb + td / np.linalg.norm(td) * 0.068), 0.0125)
    return out


# Dedos: (base, punta, radio). Lado izquierdo.
FINGERS = _hand_fingers()


def jl(name, side=1):
    p = np.array(J[name], float)
    if side < 0:
        p[0] = -p[0]
    return p


def lerp(a, b, t):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t


# ------------------------------------------------------------------ campo SDF
TORSO_ZB, TORSO_ZT = 0.86, 1.48
# (z, r_lateral, y_frente, y_espalda)  medidos de las siluetas front/side
TORSO = [
    (0.86, 0.120, -0.120, 0.060),
    (0.90, 0.185, -0.138, 0.080),
    (0.95, 0.188, -0.136, 0.085),
    (1.00, 0.170, -0.142, 0.070),
    (1.04, 0.150, -0.145, 0.055),
    (1.08, 0.116, -0.144, 0.038),
    (1.12, 0.101, -0.148, 0.038),
    (1.16, 0.101, -0.150, 0.033),
    (1.20, 0.111, -0.150, 0.034),
    (1.25, 0.134, -0.148, 0.042),
    (1.30, 0.148, -0.140, 0.050),
    (1.35, 0.140, -0.120, 0.052),
    (1.40, 0.090, -0.085, 0.038),
    (1.44, 0.058, -0.078, 0.018),
    (1.48, 0.052, -0.082, 0.012),
]


def build_field():
    F = Field()
    zb, zt = TORSO_ZB, TORSO_ZT
    prof = []
    for z, rs, yf, yb in TORSO:
        yc = 0.5 * (yf + yb)
        r = 0.5 * (yb - yf)
        prof.append(((z - zb) / (zt - zb), rs, rs, r, r, -yc))
    F.add(Limb((0, 0, zb), (0, 0, zt), prof, k=0.0, name='torso'))

    # cuello y cabeza
    F.add(Limb((0, -0.025, 1.39), (0, -0.065, 1.53),
               [(0, 0.058, 0.058, 0.052, 0.054), (0.5, 0.050, 0.050, 0.046, 0.050), (1, 0.050, 0.050, 0.045, 0.050)],
               k=0.02, name='neck'))
    head_parts(F)

    for side in (1, -1):
        sx = side
        lat = (sx, 0, 0)

        def P(x, y, z):
            return (x * sx, y, z)
        # ------------------------------------------------------------ pierna
        hip, knee, ankle = jl('hip', side), jl('knee', side), jl('ankle', side)
        F.add(Limb(hip + np.array([0, 0, 0.02]), knee, [
            (0.00, 0.112, 0.090, 0.128, 0.090),
            (0.16, 0.108, 0.091, 0.132, 0.087),
            (0.40, 0.090, 0.094, 0.127, 0.094),
            (0.63, 0.074, 0.076, 0.102, 0.081),
            (0.85, 0.058, 0.063, 0.073, 0.070),
            (1.00, 0.050, 0.047, 0.056, 0.055),
        ], k=0.035, name=f'thigh{side}', lat_dir=lat))
        F.add(Limb(knee, ankle, [
            (0.00, 0.050, 0.047, 0.056, 0.055),
            (0.10, 0.060, 0.055, 0.060, 0.075),
            (0.245, 0.100, 0.057, 0.042, 0.118),
            (0.35, 0.100, 0.062, 0.044, 0.122),
            (0.43, 0.090, 0.050, 0.037, 0.108),
            (0.53, 0.078, 0.036, 0.034, 0.092),
            (0.63, 0.064, 0.028, 0.031, 0.072),
            (0.74, 0.042, 0.030, 0.031, 0.050),
            (1.00, 0.040, 0.036, 0.040, 0.040),
        ], k=0.01, name=f'shin{side}', lat_dir=lat))
        F.add(Limb(ankle, jl('toe', side) + np.array([0, 0.012, 0.005]), [
            (0.0, 0.040, 0.040, 0.045, 0.040), (0.35, 0.044, 0.044, 0.035, 0.030),
            (0.75, 0.042, 0.042, 0.022, 0.024), (1.0, 0.035, 0.035, 0.018, 0.018)],
            k=0.02, front=np.array([0, 0, 1.0]), name=f'foot{side}', lat_dir=lat))
        # rellenos esféricos en las articulaciones (evitan pliegues entre segmentos)
        F.add(Ellipsoid(knee, knee - hip, (0.052, 0.050, 0.055), k=0.015, name='knee'))
        F.add(Ellipsoid(ankle, (0, 0, 1), (0.040, 0.038, 0.040), k=0.015, name='ankle'))
        # músculos de la pierna
        F.add(Ellipsoid(P(0.075, 0.030, 0.945), (0, 0, 1), (0.105, 0.090, 0.080), k=0.03, name='glute'))
        F.add(Ellipsoid(P(0.098, -0.060, 0.670), knee - hip, (0.068, 0.040, 0.042), k=0.015, name='vmedialis'))
        F.add(Ellipsoid(P(0.190, -0.028, 0.760), knee - hip, (0.135, 0.040, 0.060), k=0.02, name='vlateralis'))
        F.add(Ellipsoid(P(0.128, -0.082, 0.780), knee - hip, (0.150, 0.052, 0.048), k=0.02, name='rectus'))
        F.add(Ellipsoid(P(0.125, 0.070, 0.450), (0.05 * sx, 0.1, 1), (0.090, 0.044, 0.044), k=0.012, name='gastro_m'))
        F.add(Ellipsoid(P(0.215, 0.052, 0.460), (0.05 * sx, 0.1, 1), (0.085, 0.036, 0.042), k=0.012, name='gastro_l'))

        # ------------------------------------------------------------ brazo
        sh, el, wr, kn = jl('shoulder', side), jl('elbow', side), jl('wrist', side), jl('knuckle', side)
        F.add(Limb(sh, el, [
            (0.00, 0.058, 0.050, 0.058, 0.058),
            (0.30, 0.048, 0.042, 0.060, 0.060),
            (0.60, 0.044, 0.041, 0.056, 0.056),
            (0.88, 0.042, 0.038, 0.044, 0.046),
            (1.00, 0.044, 0.040, 0.042, 0.044),
        ], k=0.02, name=f'upperarm{side}', lat_dir=lat))
        F.add(Limb(el, wr, [
            (0.00, 0.046, 0.040, 0.044, 0.044),
            (0.22, 0.054, 0.046, 0.048, 0.046),
            (0.60, 0.040, 0.036, 0.036, 0.034),
            (0.88, 0.032, 0.028, 0.028, 0.027),
            (1.00, 0.030, 0.026, 0.026, 0.026),
        ], k=0.012, name=f'forearm{side}', lat_dir=lat))
        F.add(Limb(wr, kn, [
            (0.0, 0.020, 0.018, 0.030, 0.028), (0.5, 0.019, 0.017, 0.042, 0.037),
            (1.0, 0.015, 0.014, 0.042, 0.035)], k=0.012, name=f'palm{side}', lat_dir=lat))
        for fname, (b, t, r) in FINGERS.items():
            b = np.array(b); t = np.array(t)
            if side < 0:
                b[0] = -b[0]; t[0] = -t[0]
            F.add(Capsule(b, t, r, r * 0.8, k=0.006, name=f'{fname}{side}'))
        F.add(Ellipsoid(el, el - sh, (0.042, 0.042, 0.042), k=0.012, name='elbow'))
        # músculos del brazo / hombro
        arm = el - sh
        F.add(Ellipsoid(sh + arm * 0.16 + np.array([0.0, 0, -0.008]), arm, (0.105, 0.056, 0.062), k=0.02, name='deltoid'))
        F.add(Ellipsoid(sh + arm * 0.52 + np.array([0, -0.026, 0]), arm, (0.085, 0.034, 0.034), k=0.012, name='biceps'))
        F.add(Ellipsoid(sh + arm * 0.40 + np.array([0, 0.030, 0]), arm, (0.105, 0.038, 0.034), k=0.012, name='triceps'))
        F.add(Ellipsoid(el + (wr - el) * 0.2 + np.array([0.006 * sx, -0.012, 0]), wr - el, (0.075, 0.042, 0.038), k=0.012, name='brachiorad'))
        F.add(Ellipsoid(P(0.100, -0.012, 1.378), (0.13 * sx, 0.0, -0.045), (0.095, 0.034, 0.042), k=0.035, name='traps'))
        F.add(Ellipsoid(P(0.095, 0.015, 1.255), (0, 0, 1), (0.115, 0.045, 0.055), k=0.03, name='lats'))
        # pecho (bajo el top)
        F.add(Ellipsoid(P(0.064, -0.128, 1.262), (0, 0, 1), (0.064, 0.068, 0.068), k=0.02, name='breast'))
        # abdominales y oblicuos
        for z in (1.180, 1.132, 1.085):
            F.add(Ellipsoid(P(0.030, -0.140 + (1.180 - z) * 0.03, z), (0, 0, 1), (0.021, 0.024, 0.013), k=0.010, name='abs'))
        F.add(Ellipsoid(P(0.100, -0.080, 1.060), (0, 0, 1), (0.070, 0.035, 0.050), k=0.03, name='oblique'))
    return F


def head_parts(F):
    F.add(Ellipsoid((0, -0.080, 1.608), (0, 0, 1), (0.092, 0.080, 0.096), k=0.0, name='cranium'))
    F.add(Ellipsoid((0, -0.105, 1.546), (0, 0, 1), (0.066, 0.066, 0.076), k=0.03, name='jaw'))
    F.add(Ellipsoid((0, -0.148, 1.494), (0, 0.4, 1), (0.024, 0.030, 0.022), k=0.02, name='chin'))
    F.add(Ellipsoid((0, -0.180, 1.548), (0, -0.5, 1), (0.024, 0.010, 0.016), k=0.012, name='nose'))
    for sx in (1, -1):
        F.add(Ellipsoid((0.048 * sx, -0.140, 1.565), (0, 0, 1), (0.020, 0.028, 0.022), k=0.02, name='cheek'))
        F.add(Ellipsoid((0.079 * sx, -0.062, 1.560), (0, 0, 1), (0.030, 0.012, 0.020), k=0.008, name='ear'))


# ------------------------------------------------- esqueleto para el Skin modifier
def skin_skeleton():
    """Lista de vértices (pos, radio, es_mano) y aristas para el Skin modifier."""
    verts, edges = [], []

    def v(p, r, hand=False):
        verts.append((tuple(float(c) for c in p), r, hand))
        return len(verts) - 1

    def chain(start, pts, hand=False):
        prev = start
        idx = []
        for p, r in pts:
            i = v(p, r, hand)
            edges.append((prev, i))
            prev = i
            idx.append(i)
        return idx

    pelvis = v((0, -0.02, 0.91), (0.17, 0.11))
    spine = chain(pelvis, [((0, -0.035, 1.00), (0.15, 0.10)), ((0, -0.055, 1.10), (0.11, 0.09)),
                           ((0, -0.055, 1.20), (0.12, 0.095)), ((0, -0.045, 1.30), (0.15, 0.10)),
                           ((0, -0.03, 1.39), (0.10, 0.07))])
    chain(spine[-1], [((0, -0.035, 1.46), (0.055, 0.05)), ((0, -0.08, 1.53), (0.07, 0.08)),
                      ((0, -0.08, 1.62), (0.085, 0.095)), ((0, -0.078, 1.69), (0.06, 0.07))])
    for side in (1, -1):
        def P(p):
            p = np.array(p, float)
            p[0] *= side
            return p
        hip = jl('hip', side); knee = jl('knee', side); ankle = jl('ankle', side)
        chain(pelvis, [(hip + np.array([0, 0, -0.02]), (0.11, 0.11)),
                       (lerp(hip, knee, 0.5), (0.10, 0.10)),
                       (knee, (0.055, 0.055)),
                       (lerp(knee, ankle, 0.3), (0.075, 0.07)),
                       (lerp(knee, ankle, 0.65), (0.05, 0.045)),
                       (ankle, (0.042, 0.04)),
                       (jl('toe', side), (0.03, 0.018))])
        sh = jl('shoulder', side); el = jl('elbow', side); wr = jl('wrist', side); kn = jl('knuckle', side)
        arm = chain(spine[-1], [(P((0.09, -0.03, 1.375)), (0.06, 0.06)), (sh, (0.058, 0.058)),
                                (lerp(sh, el, 0.5), (0.05, 0.05)), (el, (0.043, 0.043)),
                                (lerp(el, wr, 0.5), (0.04, 0.04)), (wr, (0.028, 0.026))])
        palm = chain(arm[-1], [(lerp(wr, kn, 0.9), (0.018, 0.036))], hand=True)
        for fname, (b, t, r) in FINGERS.items():
            b = P(b); t = P(t)
            root = arm[-1] if fname == 'thumb' else palm[-1]
            chain(root, [(b, (r, r)), (t, (r * 0.8, r * 0.8))], hand=True)
    return verts, edges


# ------------------------------------------------------------ asignación de parte
def segments():
    """Segmentos (nombre, p0, p1) usados para etiquetar vértices por parte del cuerpo."""
    segs = [('torso_low', (0, -0.015, 0.86), (0, -0.05, 1.08)),
            ('torso_up', (0, -0.05, 1.08), (0, -0.03, 1.40)),
            ('neck', (0, -0.03, 1.40), (0, -0.05, 1.49)),
            ('head', (0, -0.07, 1.49), (0, -0.075, 1.70))]
    for side, tag in ((1, 'L'), (-1, 'R')):
        kn = jl('knuckle', side); wr = jl('wrist', side)
        segs += [
            (f'thigh_{tag}', jl('hip', side), jl('knee', side)),
            (f'shin_{tag}', jl('knee', side), jl('ankle', side)),
            (f'foot_{tag}', jl('ankle', side), jl('toe', side)),
            (f'upperarm_{tag}', jl('shoulder', side), jl('elbow', side)),
            (f'forearm_{tag}', jl('elbow', side), wr),
            (f'hand_{tag}', wr, kn + (kn - wr) * 0.8),
        ]
    return segs


def part_labels(co):
    """Etiqueta cada punto con el segmento más cercano (distancia punto-segmento)."""
    segs = segments()
    D = np.zeros((len(co), len(segs)))
    for j, (_, a, b) in enumerate(segs):
        a = np.asarray(a, float); b = np.asarray(b, float)
        v = b - a
        t = np.clip(((co - a) @ v) / (v @ v), 0, 1)
        D[:, j] = np.linalg.norm(co - (a + t[:, None] * v), axis=1)
    idx = D.argmin(1)
    names = [s[0] for s in segs]
    return np.array([names[i] for i in idx])
