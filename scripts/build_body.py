"""Etapa 1: cuerpo base como una sola malla.

Skin modifier sobre un esqueleto de vértices -> Subdivision (nivel 1) -> aplicar
-> subdivisión selectiva (todo menos las manos, que quedan más ligeras) ->
proyección de cada vértice sobre el campo SDF anatómico (musculatura) ->
relajación tangencial. La topología conserva los anillos del Skin en cada
articulación (hombro, codo, cadera, rodilla...).
"""
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


def build_body(field=None):
    field = field or anatomy.build_field()
    ob = build_skin_mesh()
    shoot_mesh(ob, field)
    subdivide_except_hands(ob)
    shoot_mesh(ob, field)
    co = shoot_mesh(ob, field)
    co = mu.relax_project(co, mu.edges_np(ob), field, rounds=1, lam=0.2)
    mu.set_co(ob, co)
    mu.set_flat(ob)
    return ob, field


if __name__ == '__main__':
    mu.clear_scene()
    ob, f = build_body()
    print('BODY tris', mu.tri_count(ob), 'verts', len(ob.data.vertices))
