"""Etapa 2: modelo completo (cuerpo + ropa + accesorios + pelo + cara + colores).

Uso: xvfb-run -a blender -b -P scripts/build_model.py -- [tag]
Guarda export/atleta_model.blend y (si se pasa tag) renderiza las 3 vistas.
"""
import os
import sys
import os, sys  # noqa: E401
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import bmesh
import numpy as np
import common as C
import anatomy
import meshutil as mu
import shapes as S
import build_body

RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- utilidades
def set_face_keys(ob, keys):
    me = ob.data
    at = me.attributes.get('ckey') or me.attributes.new('ckey', 'INT', 'FACE')
    at.data.foreach_set('value', np.asarray(keys, int))


def get_face_keys(ob):
    me = ob.data
    at = me.attributes.get('ckey')
    k = np.zeros(len(me.polygons), int)
    if at:
        at.data.foreach_get('value', k)
    return k


def torso_yc(z):
    t = np.array(anatomy.TORSO)
    return np.interp(z, t[:, 0], 0.5 * (t[:, 2] + t[:, 3]))


def vertex_offsets_from_faces(ob, face_off):
    """Desplazamiento por vértice = mínimo de sus caras (bordes con piel quedan a 0)."""
    me = ob.data
    off = np.full(len(me.vertices), np.inf)
    for p in me.polygons:
        for v in p.vertices:
            off[v] = min(off[v], face_off[p.index])
    off[np.isinf(off)] = 0
    return off


def inflate(ob, off):
    co = mu.get_co(ob)
    n = mu.vertex_normals(ob)
    mu.set_co(ob, co + n * off[:, None])


def extract_faces(src, mask, name):
    """Copia a un objeto nuevo las caras de src indicadas por mask."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if not mask[f.index]]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def delete_faces(ob, mask):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if mask[f.index]], context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def solidify(ob, thickness, offset=-1.0):
    m = ob.modifiers.new('Solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_rim = True
    m.use_even_offset = True
    mu.apply_modifiers(ob)


def labels_faces(ob):
    return anatomy.part_labels(mu.face_centers(ob))


def labels_verts(ob):
    return anatomy.part_labels(mu.get_co(ob))


K = C.CKEY

# ------------------------------------------------------------------ ropa (cuerpo)
TOP_FRONT = [(0, 1.10), (0.40, 1.10), (0.40, 1.245), (0.165, 1.255), (0.142, 1.290), (0.120, 1.330),
             (0.106, 1.380), (0.102, 1.46), (0.064, 1.46), (0.060, 1.37), (0.050, 1.338), (0.028, 1.320),
             (0.0, 1.314)]
TOP_BACK = [(0, 1.10), (0.40, 1.10), (0.40, 1.245), (0.160, 1.250), (0.136, 1.282), (0.108, 1.322),
            (0.094, 1.370), (0.098, 1.46), (0.056, 1.46), (0.036, 1.372), (0.018, 1.340), (0.0, 1.330)]
TOP_Z0, TOP_BAND = 1.19, 1.213
LEG_FRONT = [(0, 0.868), (0.05, 0.873), (0.10, 0.897), (0.15, 0.937), (0.20, 0.978), (0.40, 0.995)]
LEG_BACK = [(0, 0.858), (0.06, 0.852), (0.12, 0.862), (0.17, 0.900), (0.21, 0.945), (0.40, 0.965)]
SOCK_TOP = 0.285
SOCK_STRIPES = [(0.250, 0.262), (0.226, 0.238)]


def mirror_poly(half):
    """Polígono completo a partir de la mitad izquierda (x>=0) que empieza y acaba en x=0."""
    half = [p for p in half if p[0] > 0]
    return [(-x, z) for x, z in reversed(half)] + list(half)


TOP_FRONT_FULL = mirror_poly(TOP_FRONT)
TOP_BACK_FULL = mirror_poly(TOP_BACK)


def g_top(P):
    front = P[:, 1] < torso_yc(P[:, 2])
    return np.where(front, S.poly_sdf(P[:, 0], P[:, 2], TOP_FRONT_FULL),
                    S.poly_sdf(P[:, 0], P[:, 2], TOP_BACK_FULL))


def back_w(P):
    return np.clip((P[:, 1] - torso_yc(P[:, 2]) + 0.05) / 0.10, 0, 1)


def g_shorts(P):
    ax = np.abs(P[:, 0])
    w = back_w(P)
    zl = (1 - w) * S.polyline_interp(ax, LEG_FRONT) + w * S.polyline_interp(ax, LEG_BACK)
    zw = (1 - w) * 1.072 + w * 1.035
    return np.maximum(P[:, 2] - zw, zl - P[:, 2])


def side_phi(P):
    return np.abs(np.arctan2(P[:, 1] - torso_yc(P[:, 2]), np.abs(P[:, 0])))


def dress_body(body):
    torso_parts = {'torso_up', 'torso_low', 'neck'}

    def m_torso(P):
        lab = anatomy.part_labels(P)
        # los tirantes pasan por la zona del trapecio, que a veces se etiqueta como brazo
        return np.isin(lab, list(torso_parts)) | ((np.abs(P[:, 0]) < 0.150) & (P[:, 2] > 1.15) & (P[:, 2] < 1.47))

    def m_shorts(P):
        lab = anatomy.part_labels(P)
        return np.isin(lab, ['torso_low', 'torso_up', 'thigh_L', 'thigh_R']) & (P[:, 2] < 1.12)

    def m_shin(P):
        lab = anatomy.part_labels(P)
        return np.isin(lab, ['shin_L', 'shin_R', 'foot_L', 'foot_R'])

    # --- cortes implícitos (bordes limpios de la ropa y ribetes)
    for off in (0.0, -0.012, -0.026):
        mu.implicit_cut(body, lambda P, o=off: g_top(P) - o * (P[:, 2] > TOP_BAND + 0.012), m_torso)
    for z in (TOP_Z0, TOP_BAND):
        mu.implicit_cut(body, lambda P, z=z: P[:, 2] - z, lambda P: m_torso(P) & (g_top(P) < 0.01))
    mu.implicit_cut(body, g_shorts, m_shorts)
    for ph in (0.48, 0.66):
        mu.implicit_cut(body, lambda P, ph=ph: (side_phi(P) - ph) * 0.15,
                        lambda P: m_shorts(P) & (g_shorts(P) < 0.02))
    for z in [SOCK_TOP] + [z for s in SOCK_STRIPES for z in s]:
        mu.implicit_cut(body, lambda P, z=z: P[:, 2] - z, m_shin)

    # --- borrar pies (quedan dentro de las zapatillas)
    fc = mu.face_centers(body)
    lab = anatomy.part_labels(fc)
    delete_faces(body, np.isin(lab, ['shin_L', 'shin_R', 'foot_L', 'foot_R']) & (fc[:, 2] < 0.13))

    # --- colores por cara
    fc = mu.face_centers(body)
    lab = anatomy.part_labels(fc)
    keys = np.full(len(fc), K['skin'])
    off = np.zeros(len(fc))
    torso = np.isin(lab, list(torso_parts)) | ((np.abs(fc[:, 0]) < 0.150) & (fc[:, 2] > 1.15) & (fc[:, 2] < 1.47))
    gt = g_top(fc)
    top = torso & (gt < 0) & (fc[:, 2] > TOP_Z0)
    keys[top] = K['teal']
    keys[top & (fc[:, 2] < TOP_BAND)] = K['teal_dark']
    upper = top & (fc[:, 2] > TOP_BAND + 0.012)
    keys[upper & (gt > -0.026)] = K['white']
    keys[upper & (gt > -0.012)] = K['coral']
    off[top] = 0.006
    sh = np.isin(lab, ['torso_low', 'torso_up', 'thigh_L', 'thigh_R']) & (g_shorts(fc) < 0) & (fc[:, 2] < 1.12)
    phi = side_phi(fc)
    keys[sh] = K['teal_short']
    keys[sh & (phi < 0.66)] = K['coral']
    keys[sh & (phi < 0.48)] = K['white']
    off[sh] = 0.005
    shin = np.isin(lab, ['shin_L', 'shin_R'])
    sock = shin & (fc[:, 2] < SOCK_TOP)
    keys[sock] = K['white']
    for a, b in SOCK_STRIPES:
        keys[sock & (fc[:, 2] > a) & (fc[:, 2] < b)] = K['teal']
    off[sock] = 0.004
    # ombligo
    nav = (np.abs(fc[:, 0]) < 0.012) & (np.abs(fc[:, 2] - 1.098) < 0.012) & (fc[:, 1] < -0.1)
    keys[nav] = K['skin_shadow']
    set_face_keys(body, keys)
    inflate(body, vertex_offsets_from_faces(body, off))


# ------------------------------------------------------------ rodilleras / muñequeras
def ring_on_surface(field, c, axis, angles, front=(0, -1, 0), rmax=0.2):
    """Puntos de la superficie del SDF en un anillo alrededor de c (rayos radiales)."""
    a = np.array(axis, float); a /= np.linalg.norm(a)  # copia: no modificar el eje del llamador
    f = np.asarray(front, float) - a * np.dot(front, a); f /= np.linalg.norm(f)
    sd = np.cross(a, f)
    out = []
    for th in angles:
        u = f * np.cos(th) + sd * np.sin(th)
        ts = np.linspace(0.0, rmax, 200)
        d = field(c[None] + ts[:, None] * u[None])
        k = np.argmax(d > 0)
        out.append((c + u * ts[k], u))
    return out


def band_mesh(field, name, p0, p1, ts, offs, angles, keyf, front=(0, -1, 0)):
    """Tubo ajustado al cuerpo entre p0-p1 (parámetros ts) separado offs de la piel."""
    p0 = np.asarray(p0, float); p1 = np.asarray(p1, float)
    axis = p1 - p0
    secs, dirs = [], []
    for t, o in zip(ts, offs):
        c = p0 + axis * t
        ring = ring_on_surface(field, c, axis, angles, front)
        secs.append(np.array([p + u * o for p, u in ring]))
    V, F = S.loft(secs, cap_start=False, cap_end=False)
    ob = mu.mesh_from_pydata(name, V, F)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    na = len(angles)
    keys = []
    for jj in range(len(ts) - 1):
        for ii in range(na):
            keys.append(keyf(jj, ii))
    set_face_keys(ob, keys)
    return ob


def knee_pads(body, field):
    # ángulo 0 = delante (-Y); cuadros navy delante [-27,27] y detrás [153,207]
    angs_deg = [-27, 0, 27, 52, 77, 102, 128, 153, 180, 207, 232, 258, 283, 308, 333]
    angs = np.radians(angs_deg)
    zs = [0.468, 0.487, 0.515, 0.560, 0.606, 0.640, 0.664]
    offs = [-0.004, 0.013, 0.023, 0.026, 0.023, 0.013, -0.004]
    pads = []
    for side, tag in ((1, 'L'), (-1, 'R')):
        hip, kn, an = anatomy.jl('hip', side), anatomy.jl('knee', side), anatomy.jl('ankle', side)
        axis = (kn - hip) / np.linalg.norm(kn - hip) + (an - kn) / np.linalg.norm(an - kn)
        axis /= np.linalg.norm(axis)
        # parámetros t a lo largo de un eje que pasa por la rodilla
        p0 = kn + axis * (zs[0] - kn[2]) / axis[2]
        p1 = kn + axis * (zs[-1] - kn[2]) / axis[2]
        ts = [(z - zs[0]) / (zs[-1] - zs[0]) for z in zs]

        def keyf(jj, ii):
            a, a2 = angs_deg[ii], angs_deg[(ii + 1) % len(angs_deg)]
            sq = (a >= -27 and a2 <= 27 and a2 > a) or (a >= 153 and a2 <= 207 and a2 > a)
            return K['navy'] if (jj in (2, 3) and sq) else K['white']
        pads.append(band_mesh(field, f'KneePad_{tag}', p0, p1, ts, offs, angs, keyf))
    # borrar la piel cubierta por las rodilleras
    fc = mu.face_centers(body)
    lab = anatomy.part_labels(fc)
    delete_faces(body, np.isin(lab, ['thigh_L', 'thigh_R', 'shin_L', 'shin_R']) & (fc[:, 2] > 0.492) & (fc[:, 2] < 0.64))
    return pads


def wristbands(body, field):
    angs = np.radians(np.arange(-18, 342, 36))
    ts = [0.735, 0.76, 0.86, 0.955, 0.98]
    offs = [-0.003, 0.007, 0.008, 0.007, -0.003]
    out = []
    for side, tag in ((1, 'L'), (-1, 'R')):
        el, wr = anatomy.jl('elbow', side), anatomy.jl('wrist', side)

        def keyf(jj, ii):
            return K['teal'] if (jj == 1 and ii == 0) else K['navy']
        out.append(band_mesh(field, f'Wristband_{tag}', el, wr, ts, offs, angs, keyf))
    # borrar la piel bajo las muñequeras
    fc = mu.face_centers(body)
    lab = anatomy.part_labels(fc)
    kill = np.zeros(len(fc), bool)
    for side, tag in ((1, 'L'), (-1, 'R')):
        el, wr = anatomy.jl('elbow', side), anatomy.jl('wrist', side)
        ax = wr - el
        t = ((fc - el) @ ax) / (ax @ ax)
        kill |= np.isin(lab, [f'forearm_{tag}']) & (t > 0.765) & (t < 0.95)
    delete_faces(body, kill)
    return out


# ------------------------------------------------------------------- zapatillas
def shoe(side, tag):
    heel = np.array([0.214 * side, 0.142, 0.0])
    toe = np.array([0.244 * side, -0.178, 0.0])
    d = toe - heel
    L = np.linalg.norm(d)
    d /= L
    lat = np.cross(d, [0, 0, 1.0])
    # (u, semiancho suela, altura empeine, elevación puntera)
    prof = [(0.00, 0.048, 0.100, 0.010), (0.03, 0.064, 0.140, 0.003), (0.10, 0.072, 0.164, 0.0),
            (0.20, 0.076, 0.168, 0.0), (0.30, 0.078, 0.158, 0.0), (0.40, 0.080, 0.134, 0.0),
            (0.50, 0.081, 0.122, 0.0), (0.60, 0.081, 0.106, 0.0), (0.70, 0.079, 0.092, 0.002),
            (0.79, 0.075, 0.080, 0.006), (0.87, 0.066, 0.070, 0.011), (0.94, 0.052, 0.060, 0.017),
            (1.00, 0.032, 0.048, 0.022)]
    # media sección (lateral normalizado, altura): suela gruesa navy y empeine más estrecho
    half = [(0.0, 'b'), (0.85, 'b'), (1.06, 0.012), (1.08, 0.036), (0.92, 0.048), (0.80, 'm'),
            (0.55, 'h'), (0.22, 't')]
    secs = []
    for u, hw, h, lift in prof:
        c = heel + d * (u * L) + np.array([0, 0, lift])
        pts = []
        for lx, lz in half:
            z = {'b': 0.0, 'm': 0.55 * h, 'h': 0.88 * h, 't': h}.get(lz, lz)
            if isinstance(lz, float):
                z = lz
            pts.append((lx, z))
        full = pts + [(-lx, z) for lx, z in reversed(pts[1:])]
        full = full[:-1] + [(0.0, h * 1.0)] if False else full
        secs.append(np.array([c + lat * lx * hw + np.array([0, 0, z]) for lx, z in full]))
    V, F = S.loft(secs)
    ob = mu.mesh_from_pydata(f'Shoe_{tag}', V, F)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    fc = mu.face_centers(ob)
    rel = fc - heel
    u = (rel @ d) / L
    lx = np.abs(rel @ lat)
    z = fc[:, 2]
    keys = np.full(len(fc), K['shoe_white'])
    sidep = lx > 0.052
    keys[z < 0.036] = K['navy']                                       # suela
    keys[(u < 0.16) & (z < 0.11)] = K['navy']                         # contrafuerte
    keys[(u < 0.06) & (z >= 0.11)] = K['coral']                       # lengüeta del talón
    band = np.mod((u * 4.0 + z * 9.0), 1.0)
    keys[sidep & (u > 0.22) & (u < 0.78) & (z > 0.045) & (band < 0.33)] = K['teal']   # franjas
    keys[sidep & (u > 0.18) & (u < 0.30) & (z > 0.05) & (z < 0.10)] = K['coral']
    keys[(u > 0.84) & (z > 0.048) & (lx < 0.05)] = K['coral']         # puntera
    keys[(u > 0.08) & (u < 0.34) & (z > 0.150)] = K['teal']           # cuello acolchado
    keys[(u > 0.36) & (u < 0.74) & (lx < 0.028) & (z > 0.09)] = K['white']   # cordones
    set_face_keys(ob, keys)
    return ob


# ---------------------------------------------------------------------- pelo
PONY_PATH = [(-0.010, 0.020, 1.695), (-0.020, 0.070, 1.715), (-0.040, 0.130, 1.672),
             (-0.060, 0.172, 1.595), (-0.075, 0.170, 1.500), (-0.085, 0.165, 1.415)]
def hair():
    rng = np.random.default_rng(11)
    parts = []
    keys = []

    def add(vf, key):
        v, f = vf
        parts.append((v, f))
        keys.extend([key] * len(f))

    def lock(root, mid, tip, r, sides=4, flat=0.55, up=(0, -1, 0), key=None):
        add(S.strand([np.array(root), np.array(mid), np.array(tip)], [r, r * 0.75, r * 0.3], sides=sides,
                     rng=rng, flat=flat, up=up, jitter=0.15), key if key is not None else K['hair'])

    # (a) casquete facetado sobre el cráneo (más ancho que la cabeza: volumen)
    cap_v, cap_f = [], []
    nlat, nlon = 7, 14
    c = np.array([0.0, -0.072, 1.618])
    R = np.array([0.118, 0.116, 0.104])
    for ii in range(nlat + 1):
        th = np.pi * 0.66 * ii / nlat
        for jj in range(nlon):
            ph = 2 * np.pi * jj / nlon
            dirv = np.array([np.sin(th) * np.sin(ph), -np.sin(th) * np.cos(ph), np.cos(th)])
            cap_v.append(tuple(c + dirv * R * (1 + rng.uniform(-0.04, 0.08))))
    for ii in range(nlat):
        for jj in range(nlon):
            a = ii * nlon + jj
            b = ii * nlon + (jj + 1) % nlon
            cap_f.append((a, b, b + nlon, a + nlon))
    cv = np.array(cap_v)
    keep = []
    for f in cap_f:
        fc = cv[list(f)].mean(0)
        if fc[1] < -0.085 and fc[2] < 1.66 and abs(fc[0]) < 0.08:   # frente/cara
            continue
        if fc[2] < 1.56 and fc[1] < -0.035:                         # mejillas
            continue
        keep.append(f)
    add((cap_v, keep), K['hair'])

    # (b) flequillo en picos: cubre la frente hasta las cejas y sobresale hacia delante
    for x, zt, lean, fwd in [(-0.078, 1.600, -0.35, 0.00), (-0.056, 1.622, -0.20, 0.02), (-0.034, 1.612, -0.05, 0.03),
                             (-0.012, 1.628, 0.05, 0.035), (0.010, 1.614, -0.08, 0.035), (0.032, 1.626, 0.10, 0.03),
                             (0.054, 1.616, 0.22, 0.02), (0.078, 1.602, 0.35, 0.00)]:
        root = (x * 0.8, -0.120, 1.708)
        mid = (x * 1.08, -0.185 - fwd * 0.6, 1.672)
        tip = (x * 1.12 + lean * 0.03, -0.172 - fwd * 0.8, zt)
        lock(root, mid, tip, 0.030, sides=4, flat=0.45, up=(0, -1, 0.3))
    # mechones de la coronilla: tumbados sobre el casquete hacia la coleta
    for k in range(8):
        a = -2.2 + k * 0.63
        dirv = np.array([np.sin(a), -np.cos(a), 0.0])
        root = c + np.array([0, 0, 0.095]) + dirv * 0.03
        tip = c + dirv * np.array([0.118, 0.125, 0]) + np.array([0, 0, 0.035])
        lock(tuple(root), tuple((root + tip) / 2 + np.array([0, 0, 0.03])), tuple(tip), 0.032, sides=4, flat=0.5,
             up=(0, 0, 1), key=K['hair_dark'] if k % 3 == 0 else K['hair'])
    # (c) mechones laterales que enmarcan la cara
    for sx in (1, -1):
        for x0, y0, z1, r in [(0.082, -0.118, 1.505, 0.020), (0.100, -0.085, 1.470, 0.026),
                              (0.112, -0.045, 1.50, 0.030), (0.110, 0.000, 1.53, 0.030)]:
            lock((x0 * 0.92 * sx, y0, 1.675), ((x0 + 0.022) * sx, y0 - 0.008, 1.590), ((x0 + 0.006) * sx, y0 - 0.004, z1),
                 r, sides=5, flat=0.6, up=(sx, 0, 0))
    # nuca
    for x in (-0.06, -0.02, 0.02, 0.06):
        lock((x, 0.015, 1.62), (x * 1.1, 0.045, 1.56), (x * 1.2, 0.035, 1.50), 0.03, sides=5, flat=0.6,
             up=(0, 1, 0), key=K['hair_dark'])
    # (d) coleta alta y voluminosa
    path = [np.array(p) for p in PONY_PATH]
    radii = [0.032, 0.052, 0.068, 0.080, 0.082, 0.064]
    add(S.strand(path, radii, sides=9, rng=rng, jitter=0.24, flat=1.0, up=(0, 1, 0)), K['hair'])
    for k, (dx, dy, dz) in enumerate([(0.035, 0.02, -0.08), (-0.035, 0.035, -0.11), (0.0, -0.025, -0.12),
                                      (-0.05, -0.01, -0.07), (0.04, 0.05, -0.06), (-0.015, 0.06, -0.09)]):
        base = path[-1] + np.array([dx * 0.6, dy * 0.6, 0.03])
        tipp = base + np.array([dx, dy, dz - 0.07])
        add(S.strand([base, (base + tipp) / 2, tipp], [0.036, 0.028, 0.012], sides=5, rng=rng, up=(0, 1, 0)),
            K['hair_dark'] if k % 2 else K['hair'])
    for k in range(6):
        a = path[2] + rng.uniform(-0.025, 0.025, 3)
        b = path[4] + np.array([rng.uniform(-0.06, 0.04), rng.uniform(-0.01, 0.06), rng.uniform(-0.06, 0.0)])
        add(S.strand([a, (a + b) / 2 + np.array([0, 0.035, 0]), b], [0.04, 0.034, 0.012], sides=5, rng=rng,
                     up=(0, 1, 0)), K['hair_dark'] if k % 2 else K['hair'])
    V, F = S.merge(parts)
    ob = mu.mesh_from_pydata('Hair', V, F)
    set_face_keys(ob, keys)
    # (e) goma y cintas turquesa
    tv, tf = [], []
    tie = path[0] + (path[1] - path[0]) * 0.3
    tie_d = path[1] - path[0]
    d, u, s = S.frame_from(tie_d, (0, 1, 0))
    ring = []
    for h in (-0.012, 0.012):
        for i in range(8):
            a = 2 * np.pi * i / 8
            ring.append(tie + d * h + (u * np.cos(a) + s * np.sin(a)) * 0.046)
    secs = [np.array(ring[:8]), np.array(ring[8:])]
    v1, f1 = S.loft(secs, cap_start=False, cap_end=False)
    ribbons = []
    for sgn in (1, -1):
        r0 = tie + np.array([0.03 * sgn, 0.02, -0.01])
        r1 = r0 + np.array([0.015 * sgn, 0.02, -0.08])
        r2 = r1 + np.array([0.005 * sgn, 0.01, -0.07])
        w = 0.012
        vv = [r0 - [w, 0, 0], r0 + [w, 0, 0], r1 - [w, 0, 0], r1 + [w, 0, 0], r2 + [0, 0, -0.01]]
        ff = [(0, 1, 3, 2), (2, 3, 4)]
        ribbons.append(([tuple(p) for p in vv], ff))
    V2, F2 = S.merge([(v1, f1)] + ribbons)
    tob = mu.mesh_from_pydata('HairTie', V2, F2)
    set_face_keys(tob, [K['teal']] * len(F2))
    solidify(tob, 0.004, 0.0)
    return ob, tob, path


# --------------------------------------------------------------------- cara
def face_decals():
    """Ojos, cejas y boca como polígonos proyectados sobre la cara (vista frontal)."""
    field = anatomy.Field()
    anatomy.head_parts(field)
    polys = []  # (lista de (x,z), clave, desplazamiento)
    for sx in (1, -1):
        cx, cz = 0.040 * sx, 1.574
        eye = [(cx - 0.024 * sx, cz + 0.001), (cx - 0.010 * sx, cz + 0.015), (cx + 0.012 * sx, cz + 0.014),
               (cx + 0.025 * sx, cz + 0.002), (cx + 0.014 * sx, cz - 0.013), (cx - 0.010 * sx, cz - 0.013)]
        polys.append((eye, K['eye_white'], 0.0012))
        ix = cx - 0.001 * sx
        iris = [(ix + 0.0125 * np.cos(a), cz - 0.001 + 0.0145 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 9)[:-1]]
        polys.append((iris, K['iris'], 0.0020))
        pupil = [(ix + 0.0045 * np.cos(a), cz + 0.001 + 0.006 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 7)[:-1]]
        polys.append((pupil, K['lash'], 0.0026))
        hl = [(ix + 0.004 * sx, cz + 0.006), (ix + 0.0065 * sx, cz + 0.0035), (ix + 0.004 * sx, cz + 0.001), (ix + 0.0015 * sx, cz + 0.0035)]
        polys.append((hl, K['eye_white'], 0.0032))
        lash = [(cx - 0.022 * sx, cz + 0.000), (cx - 0.009 * sx, cz + 0.013), (cx + 0.011 * sx, cz + 0.013),
                (cx + 0.025 * sx, cz + 0.005), (cx + 0.021 * sx, cz + 0.001), (cx + 0.010 * sx, cz + 0.008),
                (cx - 0.008 * sx, cz + 0.008), (cx - 0.018 * sx, cz - 0.002)]
        polys.append((lash, K['lash'], 0.0034))
        low = [(cx - 0.004 * sx, cz - 0.011), (cx + 0.014 * sx, cz - 0.010), (cx + 0.013 * sx, cz - 0.008), (cx - 0.004 * sx, cz - 0.009)]
        polys.append((low, K['brow'], 0.0022))
        # ceja decidida: más baja en el interior
        brow = [(0.014 * sx, 1.597), (0.032 * sx, 1.605), (0.054 * sx, 1.610), (0.071 * sx, 1.604),
                (0.069 * sx, 1.599), (0.052 * sx, 1.602), (0.032 * sx, 1.597), (0.016 * sx, 1.589)]
        polys.append((brow, K['brow'], 0.0022))
    mouth = [(-0.014, 1.514), (0.0, 1.5155), (0.014, 1.514), (0.013, 1.5115), (0.0, 1.5125), (-0.013, 1.5115)]
    polys.append((mouth, K['lips'], 0.0018))
    nose = [(-0.006, 1.536), (0.006, 1.536), (0.0, 1.531)]
    polys.append((nose, K['skin_shadow'], 0.0015))
    V, F, keys = [], [], []
    for pts, key, off in polys:
        base = len(V)
        pts3 = []
        for x, z in pts:
            # buscar la superficie a lo largo de -Y
            ys = np.linspace(-0.25, -0.05, 400)
            P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], -1)
            d = field(P)
            i = np.argmax(d < 0)
            y = ys[i]
            p = np.array([x, y, z])
            g = field.grad(p[None])[0]
            g /= np.linalg.norm(g)
            pts3.append(p + g * off)
        c = np.mean(pts3, 0)
        g = field.grad(c[None])[0]
        g /= np.linalg.norm(g)
        V.extend([tuple(p) for p in pts3])
        ci = len(V)
        V.append(tuple(c + g * 0.0003))
        n = len(pts3)
        for i in range(n):
            F.append((base + i, base + (i + 1) % n, ci))
        keys.extend([key] * n)
    ob = mu.mesh_from_pydata('FaceDecals', V, F)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    set_face_keys(ob, keys)
    return ob


# ----------------------------------------------------------------- colores / atlas
def build_atlas(path):
    cell = 4
    w, h = C.N_SHADES * cell, len(C.PALETTE) * cell
    img = bpy.data.images.new('atleta_atlas', w, h, alpha=False)
    px = np.zeros((h, w, 4))
    for k in range(len(C.PALETTE)):
        for s in range(C.N_SHADES):
            rgb = [c / 255.0 for c in C.shade_rgb(k, s)]  # imagen de 8 bits: valores sRGB
            px[k * cell:(k + 1) * cell, s * cell:(s + 1) * cell, :3] = rgb
            px[k * cell:(k + 1) * cell, s * cell:(s + 1) * cell, 3] = 1
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.colorspace_settings.name = 'sRGB'
    img.pack()
    return img


def make_material(img):
    mat = bpy.data.materials.new('Atleta_Mat')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    for nm in ('Specular IOR Level', 'Specular'):
        if nm in bsdf.inputs:
            bsdf.inputs[nm].default_value = 0.15
    return mat


def apply_colors(ob, mat, rng):
    """UV al centro de la celda del atlas + color de vértice con variación por cara."""
    me = ob.data
    keys = get_face_keys(ob)
    nf = len(me.polygons)
    shades = np.clip(np.round(rng.normal(3.5, 1.6, nf)), 0, C.N_SHADES - 1).astype(int)
    # (crear las capas antes de pedir referencias: añadir capas invalida punteros previos)
    if not me.color_attributes.get('Col'):
        me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    if not me.uv_layers.get('UVMap'):
        me.uv_layers.new(name='UVMap')
    nrows = len(C.PALETTE)
    uvs = np.zeros((len(me.loops), 2))
    cols = np.zeros((len(me.loops), 4))
    for p in me.polygons:
        k, s = keys[p.index], shades[p.index]
        u = (s + 0.5) / C.N_SHADES
        v = (k + 0.5) / nrows  # fila 0 del atlas = abajo en Blender
        rgb = [C.srgb_to_linear(c) for c in C.shade_rgb(k, s)]
        for li in p.loop_indices:
            uvs[li] = (u, v)
            cols[li] = (*rgb, 1)
    me.uv_layers['UVMap'].data.foreach_set('uv', uvs.astype(np.float32).ravel())
    me.color_attributes['Col'].data.foreach_set('color', cols.astype(np.float32).ravel())
    me.materials.clear()
    me.materials.append(mat)
    mu.set_flat(ob)


# --------------------------------------------------------------------- main
def build_all():
    mu.clear_scene()
    body, field = build_body.build_body()
    dress_body(body)
    pads = knee_pads(body, field)
    bands = wristbands(body, field)
    shoes = [shoe(1, 'L'), shoe(-1, 'R')]
    hr, tie, ponypath = hair()
    face = face_decals()
    obs = [body] + pads + bands + shoes + [hr, tie, face]
    img = build_atlas(os.path.join(C.EXPORT, 'atleta_atlas.png'))
    mat = make_material(img)
    rng = np.random.default_rng(3)
    for ob in obs:
        apply_colors(ob, mat, rng)
    total = sum(mu.tri_count(o) for o in obs)
    for o in obs:
        print(f'  {o.name:14s} tris={mu.tri_count(o)}')
    print('TOTAL TRIS', total)
    return obs, total


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    os.makedirs(C.EXPORT, exist_ok=True)
    obs, total = build_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.EXPORT, 'atleta_model.blend'))
    if argv:
        import render_views
        render_views.render_views(argv[0])
