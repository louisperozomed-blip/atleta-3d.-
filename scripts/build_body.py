"""Etapa 1: cuerpo base como una sola malla.

Skin modifier sobre un esqueleto de vértices -> Subdivision (nivel 1) -> aplicar
-> subdivisión selectiva (todo menos las manos, que quedan más ligeras) ->
proyección de cada vértice sobre el campo SDF anatómico (musculatura) ->
relajación tangencial. La topología conserva los anillos del Skin en cada
articulación (hombro, codo, cadera, rodilla...).
"""
import os, sys  # noqa: E401
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import bmesh
import numpy as np
import common  # noqa: F401  (añade scripts/ al sys.path)
import anatomy
import meshutil as mu


def build_skin_mesh():
    verts, edges = anatomy.skin_skeleton()
    ob = mu.mesh_from_pydata('Body', [p for p, r, h in verts], [], edges)
    me = ob.data
    sk = ob.modifiers.new('Skin', 'SKIN')
    sk.branch_smoothing = 0.3
    sk.use_x_symmetry = True
    for i, (p, r, h) in enumerate(verts):
        me.skin_vertices[0].data[i].radius = r
    me.skin_vertices[0].data[0].use_root = True
    sub = ob.modifiers.new('Subsurf', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    mu.apply_modifiers(ob)
    return ob


def is_hand(co):
    out = np.zeros(len(co), bool)
    for side in (1, -1):
        el, wr = anatomy.jl('elbow', side), anatomy.jl('wrist', side)
        d = (wr - el) / np.linalg.norm(wr - el)
        out |= ((co - wr) @ d > 0.004) & (co[:, 0] * side > 0.2)
    return out


def subdivide_except_hands(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    co = np.array([v.co[:] for v in bm.verts])
    hand = is_hand(co)
    edges = [e for e in bm.edges if not (hand[e.verts[0].index] or hand[e.verts[1].index])]
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True, use_only_quads=False)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def normal_shoot(co, nrm, field, reach=0.12, step=0.002):
    """Mueve cada vértice a lo largo de su normal hasta el cruce F=0 más cercano.

    Los anillos de aristas del Skin quedan a su altura (no se deslizan sobre los
    músculos como con Newton). Si no hay cruce se usa proyección de Newton.
    """
    n = int(reach / step)
    best = np.full(len(co), np.nan)
    f0 = field(co)
    # orientación coherente: desde fuera se busca hacia dentro (-n) y viceversa,
    # así nunca se "salta" a una superficie enfrentada (brazo contra torso...)
    sgn = np.where(f0 > 0, -1.0, 1.0)
    prev = f0.copy()
    for k in range(1, n + 1):
        cur = field(co + nrm * (sgn * k * step)[:, None])
        h = np.isnan(best) & (np.sign(cur) != np.sign(prev))
        best[h] = sgn[h] * (k - 1 + prev[h] / (prev[h] - cur[h])) * step
        prev = cur
    out = co.copy()
    ok = ~np.isnan(best)
    out[ok] = co[ok] + nrm[ok] * best[ok][:, None]
    if (~ok).any():
        out[~ok] = field.project(co[~ok], iters=16, step=0.8)
    return out


def shoot_mesh(ob, field):
    co = mu.get_co(ob)
    nrm = mu.vertex_normals(ob)
    co = normal_shoot(co, nrm, field)
    mu.set_co(ob, co)
    return co


def decimate_hands(ob, ratio):
    """Las manos (dedos) son muy densas tras la subdivisión: Decimate limitado a ellas."""
    co = mu.get_co(ob)
    hand = is_hand(co)
    g = ob.vertex_groups.new(name='_hand')
    g.add([int(i) for i in np.nonzero(hand)[0]], 1.0, 'REPLACE')
    # el ratio de Decimate es global: se calcula para quitar solo (1-ratio) de las caras de las manos
    nf = len(ob.data.polygons)
    nh = sum(1 for p in ob.data.polygons if all(hand[v] for v in p.vertices))
    dec = ob.modifiers.new('DecHand', 'DECIMATE')
    dec.ratio = (nf - (1 - ratio) * nh) / nf
    dec.vertex_group = '_hand'
    dec.vertex_group_factor = 1.0
    dec.use_symmetry = True
    dec.symmetry_axis = 'X'
    mu.apply_modifiers(ob)
    ob.vertex_groups.remove(ob.vertex_groups['_hand'])


def untangle(ob, field, rounds=12):
    """Elimina pliegues: caras cuya normal se opone al gradiente del SDF (volteadas).

    Sus vértices (y vecinos) se mueven a la media de sus vecinos y se reproyectan.
    """
    E = mu.edges_np(ob)
    for r in range(rounds):
        co = mu.get_co(ob)
        fc = mu.face_centers(ob)
        fn = mu.face_normals(ob)
        g = field.grad(fc)
        g /= np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
        bad = (fn * g).sum(1) < 0.2
        if not bad.any():
            break
        verts = set()
        for p in ob.data.polygons:
            if bad[p.index]:
                verts.update(p.vertices)
        mask = np.zeros(len(co), bool)
        mask[list(verts)] = True
        # ampliar a los vecinos
        m2 = mask.copy()
        m2[E[mask[E[:, 0]], 1]] = True
        m2[E[mask[E[:, 1]], 0]] = True
        mean = mu.neighbor_mean(co, E)
        co[m2] = field.project(mean[m2], iters=8, step=0.8)
        mu.set_co(ob, co)
        print('untangle round', r, 'bad faces', int(bad.sum()))


def build_body(field=None):
    field = field or anatomy.build_field()
    ob = build_skin_mesh()
    shoot_mesh(ob, field)
    subdivide_except_hands(ob)
    shoot_mesh(ob, field)
    co = shoot_mesh(ob, field)
    co = mu.relax_project(co, mu.edges_np(ob), field, rounds=1, lam=0.2)
    mu.set_co(ob, co)
    untangle(ob, field)
    decimate_hands(ob, ratio=0.55)
    mu.set_flat(ob)
    return ob, field


if __name__ == '__main__':
    mu.clear_scene()
    ob, f = build_body()
    print('BODY tris', mu.tri_count(ob), 'verts', len(ob.data.vertices))
