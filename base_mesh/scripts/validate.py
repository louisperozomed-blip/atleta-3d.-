"""Validación de topología con bmesh sobre la malla COMPLETA (Mirror aplicado, sin Subdivision).

Informa: n-gons, triángulos, polos (3, 5 y >5 aristas), aristas no manifold (borde y >2 caras),
normales invertidas, vértices duplicados, caras duplicadas/internas, caras degeneradas,
error de simetría y distancia de cada polo a las articulaciones que se doblan.
"""
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

# centros de articulación (lado +X; el lado -X se comprueba en espejo) y radio de la zona de pliegue
JOINTS = {
    'hombro': ((0.185, -0.008, 1.345), 0.045),
    'codo': ((0.222, 0.000, 1.165), 0.045),
    'muñeca': ((0.305, -0.004, 0.975), 0.025),
    'cadera': ((0.100, -0.005, 0.850), 0.050),
    'rodilla': ((0.098, 0.006, 0.590), 0.060),
    'tobillo': ((0.101, 0.043, 0.170), 0.040),
}


def region(p):
    x, y, z = abs(p[0]), p[1], p[2]
    if z > 1.49:
        return 'cabeza'
    if z > 1.40 and x < 0.08:
        return 'cuello'
    if x > 0.27 and z < 1.0:
        return 'mano'
    if x > 0.15 and z > 0.95:
        return 'brazo/axila'
    if z < 0.13:
        return 'pie'
    if z < 0.83:
        return 'pierna'
    return 'torso/pelvis'


def validate(bm, expect_closed=True):
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    r = {}
    r['verts'] = len(bm.verts)
    r['edges'] = len(bm.edges)
    r['faces'] = len(bm.faces)
    r['quads'] = sum(1 for f in bm.faces if len(f.verts) == 4)
    r['tris'] = sum(1 for f in bm.faces if len(f.verts) == 3)
    r['ngons'] = sum(1 for f in bm.faces if len(f.verts) > 4)
    r['subdiv1_tris'] = 2 * sum(len(f.verts) for f in bm.faces)
    boundary = [e for e in bm.edges if len(e.link_faces) == 1]
    over = [e for e in bm.edges if len(e.link_faces) > 2]
    loose = [e for e in bm.edges if len(e.link_faces) == 0]
    r['boundary_edges'] = len(boundary)
    r['nonmanifold_edges'] = len(over) + len(loose) + (len(boundary) if expect_closed else 0)
    r['edges_gt2_faces'] = len(over)
    r['loose_edges'] = len(loose)
    r['loose_verts'] = sum(1 for v in bm.verts if not v.link_faces)
    # polos (solo vértices interiores; los del borde abierto de una etapa no cuentan)
    bverts = {v for e in boundary for v in e.verts}
    poles = {3: [], 5: [], 6: []}
    for v in bm.verts:
        if v in bverts:
            continue
        n = len(v.link_edges)
        if n == 3:
            poles[3].append(v)
        elif n == 5:
            poles[5].append(v)
        elif n > 5:
            poles[6].append(v)
    r['poles_3'] = len(poles[3])
    r['poles_5'] = len(poles[5])
    r['poles_gt5'] = len(poles[6])

    def pole_info(v):
        p = v.co
        d = {}
        for name, (c, rad) in JOINTS.items():
            cc = Vector((c[0] if p.x >= 0 else -c[0], c[1], c[2]))
            d[name] = (p - cc).length - rad
        near = min(d, key=d.get)
        return dict(co=[round(p.x, 4), round(p.y, 4), round(p.z, 4)], region=region(p),
                    joint=near, joint_margin=round(d[near], 4))
    r['pole_list_5'] = [pole_info(v) for v in poles[5] if v.co.x >= -1e-6]
    r['pole_list_3'] = [pole_info(v) for v in poles[3] if v.co.x >= -1e-6]
    r['pole_list_gt5'] = [pole_info(v) for v in poles[6]]
    r['poles_in_joint_zone'] = [p for p in r['pole_list_5'] + r['pole_list_3'] + r['pole_list_gt5']
                                if p['joint_margin'] < 0]
    # duplicados
    dmap = bmesh.ops.find_doubles(bm, verts=bm.verts, dist=1e-5)['targetmap']
    r['duplicate_verts'] = len(dmap)
    seen, dupf = set(), 0
    for f in bm.faces:
        k = tuple(sorted(v.index for v in f.verts))
        if k in seen:
            dupf += 1
        seen.add(k)
    r['duplicate_faces'] = dupf
    r['internal_faces'] = sum(1 for f in bm.faces if all(len(e.link_faces) > 2 for e in f.edges))
    r['degenerate_faces'] = sum(1 for f in bm.faces if f.calc_area() < 1e-8)
    # normales: comparar con un recálculo consistente + volumen con signo (>0 = hacia fuera)
    cp = bm.copy()
    bmesh.ops.recalc_face_normals(cp, faces=cp.faces)
    cp.faces.ensure_lookup_table()
    flipped = sum(1 for f, g in zip(bm.faces, cp.faces) if f.normal.dot(g.normal) < 0)
    vol = 0.0
    for f in bm.faces:
        vs = [v.co for v in f.verts]
        for i in range(1, len(vs) - 1):
            vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
    cp.free()
    r['flipped_normals'] = min(flipped, len(bm.faces) - flipped) if expect_closed else flipped
    r['signed_volume'] = round(vol, 5)
    r['normals_outward'] = vol > 0
    # simetría
    kd = KDTree(len(bm.verts))
    for i, v in enumerate(bm.verts):
        kd.insert(v.co, i)
    kd.balance()
    err = 0.0
    for v in bm.verts:
        _, _, d = kd.find(Vector((-v.co.x, v.co.y, v.co.z)))
        err = max(err, d)
    r['symmetry_error'] = err
    r['center_verts_off_plane'] = 0
    # triángulos/n-gons: lista para justificar
    r['tri_list'] = [[round(c, 4) for c in f.calc_center_median()] for f in bm.faces if len(f.verts) == 3][:20]
    xs = [v.co.x for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    r['bbox'] = dict(x=[round(min(xs), 4), round(max(xs), 4)], z=[round(min(zs), 4), round(max(zs), 4)])
    return r


def summary(r):
    keys = ['verts', 'faces', 'quads', 'tris', 'ngons', 'subdiv1_tris', 'poles_3', 'poles_5', 'poles_gt5',
            'boundary_edges', 'nonmanifold_edges', 'edges_gt2_faces', 'duplicate_verts', 'duplicate_faces',
            'internal_faces', 'degenerate_faces', 'flipped_normals', 'normals_outward', 'symmetry_error']
    s = '\n'.join(f'  {k:18s} {r[k]}' for k in keys)
    s += f"\n  polos en zona de articulación: {len(r['poles_in_joint_zone'])}"
    for p in r['poles_in_joint_zone']:
        s += f"\n    - {p}"
    return s
