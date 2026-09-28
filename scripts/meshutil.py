"""Utilidades de malla (bpy/bmesh + numpy) para los scripts de construcción."""
import bpy
import bmesh
import numpy as np


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_from_pydata(name, verts, faces, edges=(), collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], list(edges), [tuple(f) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def get_co(ob):
    me = ob.data
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_co(ob, co):
    ob.data.vertices.foreach_set('co', np.asarray(co, float).ravel())
    ob.data.update()


def edges_np(ob):
    me = ob.data
    e = np.zeros(len(me.edges) * 2, int)
    me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def face_centers(ob):
    me = ob.data
    c = np.zeros(len(me.polygons) * 3)
    me.polygons.foreach_get('center', c)
    return c.reshape(-1, 3)


def face_normals(ob):
    me = ob.data
    c = np.zeros(len(me.polygons) * 3)
    me.polygons.foreach_get('normal', c)
    return c.reshape(-1, 3)


def vertex_normals(ob):
    me = ob.data
    n = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def neighbor_mean(co, edges):
    n = len(co)
    acc = np.zeros_like(co)
    cnt = np.zeros(n)
    np.add.at(acc, edges[:, 0], co[edges[:, 1]])
    np.add.at(acc, edges[:, 1], co[edges[:, 0]])
    np.add.at(cnt, edges[:, 0], 1)
    np.add.at(cnt, edges[:, 1], 1)
    return acc / np.maximum(cnt, 1)[:, None]


def relax_project(co, edges, field, rounds=6, lam=0.5, pin=None):
    """Relajación tangencial + reproyección sobre el SDF (mantiene la topología)."""
    for _ in range(rounds):
        m = neighbor_mean(co, edges)
        g = field.grad(co)
        g /= np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
        delta = m - co
        delta -= (delta * g).sum(1)[:, None] * g  # solo componente tangencial
        if pin is not None:
            delta[pin] = 0
        co = co + lam * delta
        co = field.project(co, iters=6)
    return co


def set_flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def implicit_cut(ob, g_func, mask_func=None, snap=0.22):
    """Corta la malla a lo largo de la isolínea g(p)=0 (tipo bisect con función arbitraria).

    Los vértices muy cercanos al corte se desplazan sobre él (evita triángulos
    degenerados); el resto de aristas que cruzan se dividen y las caras se
    parten entre los nuevos vértices. mask_func(p)->bool limita la zona.
    """
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    co = np.array([v.co[:] for v in bm.verts])
    g = g_func(co)
    ok = mask_func(co) if mask_func is not None else np.ones(len(co), bool)
    zero = set()
    # 1) snap de vértices cercanos
    moved = {}
    for e in bm.edges:
        a, b = e.verts
        ga, gb = g[a.index], g[b.index]
        if not (ok[a.index] and ok[b.index]) or ga * gb >= 0:
            continue
        t = ga / (ga - gb)
        if t < snap and a.index not in moved:
            moved[a.index] = a.co.lerp(b.co, t)
        elif t > 1 - snap and b.index not in moved:
            moved[b.index] = b.co.lerp(a.co, 1 - t)
    for i, c in moved.items():
        bm.verts[i].co = c
        g[i] = 0.0
        zero.add(bm.verts[i])
    # 2) dividir aristas que cruzan
    gmap = {v: g[v.index] for v in bm.verts}
    okmap = {v: ok[v.index] for v in bm.verts}
    cross = []
    for e in bm.edges:
        a, b = e.verts
        if not (okmap[a] and okmap[b]):
            continue
        if gmap[a] * gmap[b] < 0:
            cross.append((e, gmap[a] / (gmap[a] - gmap[b])))
    for e, t in cross:
        a = e.verts[0]
        ne, nv = bmesh.utils.edge_split(e, a, t)
        zero.add(nv)
    # 3) partir caras entre vértices del corte
    for f in list({f for v in zero for f in v.link_faces}):
        if not f.is_valid:
            continue
        zs = [v for v in f.verts if v in zero]
        if len(zs) == 2:
            a, b = zs
            if b in [e.other_vert(a) for e in a.link_edges]:
                continue
            try:
                bmesh.utils.face_split(f, a, b)
            except Exception:
                pass
    bm.to_mesh(me)
    bm.free()
    me.update()
