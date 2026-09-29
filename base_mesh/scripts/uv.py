"""UVs de la jaula (malla completa, con el Mirror ya aplicado).

Islas (atributo de cara 'island' de build.py + lado izquierdo/derecho):
  cabeza (cara con más resolución), cuello, torso delante, torso detrás,
  pierna+pie L/R, brazo L/R, dorso de la mano L/R, palma L/R.
Costuras: las de build.py (costados del torso, interior de brazos y piernas hasta la axila y la
entrepierna, detrás del cuello y de la cabeza, contorno lateral de manos y dedos) y todas las
aristas entre islas distintas (hombro, muñeca, cuello, mandíbula, borde de la pierna).

Proceso: Unwrap (Angle Based) → Average Islands Scale (misma densidad de texel en todas) →
cabeza ×HEAD_SCALE → Pack Islands (rotación permitida, margen). `stats()` mide solapes
(rasterizando las caras en el espacio UV), caras con la UV invertida y la densidad de texel por isla.
"""
import bmesh
import bpy
import numpy as np

METHOD = 'ANGLE_BASED'
STRETCH_ITER = 200       # Minimize Stretch después del unwrap
HEAD_SCALE = 1.6          # la cabeza (cara) con 1.6× la densidad de texel del cuerpo (2.56× área)
PER_SIDE = {5: 'pierna', 6: 'brazo', 7: 'dorso_mano', 8: 'palma', 9: 'pie'}
NAMES = {1: 'torso_delante', 2: 'torso_detras', 3: 'cuello', 4: 'cabeza'}


def island_labels(me):
    codes = [0] * len(me.polygons)
    me.attributes['island'].data.foreach_get('value', codes)
    out = []
    for p, c in zip(me.polygons, codes):
        if c == 28:
            out.append(f"pulgar_{'L' if p.center.x > 0 else 'R'}")
        elif c >= 20:
            k, pal = divmod(c - 20, 2)
            dedo = ['indice', 'medio', 'anular', 'menique', 'pulgar'][k]
            out.append(f"{dedo}_{'palma' if pal else 'dorso'}_{'L' if p.center.x > 0 else 'R'}")
        elif c in PER_SIDE:
            out.append(f"{PER_SIDE[c]}_{'L' if p.center.x > 0 else 'R'}")
        else:
            out.append(NAMES.get(c, 'otro'))
    return out


def unwrap(obj, margin=0.004):
    me = obj.data
    labels = island_labels(me)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    for e in bm.edges:                                    # lado izquierdo / derecho en el eje
        fs = e.link_faces
        if len(fs) == 2 and labels[fs[0].index] != labels[fs[1].index]:
            e.seam = True
    bm.to_mesh(me)
    bm.free()
    for uvl in list(me.uv_layers):
        me.uv_layers.remove(uvl)
    me.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method=METHOD, fill_holes=True, correct_aspect=True, margin=margin)
    if STRETCH_ITER:
        bpy.ops.uv.minimize_stretch(fill_holes=True, blend=0.0, iterations=STRETCH_ITER)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # cara con más resolución: escalar la isla de la cabeza alrededor de su centro
    uv = me.uv_layers.active.data
    idx = [li for p, lab in zip(me.polygons, labels) if lab == 'cabeza' for li in p.loop_indices]
    pts = np.array([uv[i].uv for i in idx])
    c = pts.mean(0)
    for i, q in zip(idx, pts):
        uv[i].uv = tuple(c + (q - c) * HEAD_SCALE)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    return labels


def uv_polys(me):
    uv = me.uv_layers.active.data
    return [np.array([uv[i].uv for i in p.loop_indices]) for p in me.polygons]


def stats(obj, labels, res=2048):
    me = obj.data
    polys = uv_polys(me)
    # solapes: contar píxeles cubiertos por más de una cara (centros de píxel estrictamente dentro)
    count = np.zeros((res, res), np.uint16)
    for P in polys:
        Q = P * res
        x0, y0 = np.floor(Q.min(0)).astype(int)
        x1, y1 = np.ceil(Q.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, res), min(y1, res)
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        inside = np.ones(xs.shape, bool)
        n = len(Q)
        area = 0.5 * sum(Q[k][0] * Q[(k + 1) % n][1] - Q[(k + 1) % n][0] * Q[k][1] for k in range(n))
        sgn = 1 if area >= 0 else -1
        for k in range(n):
            a, b = Q[k], Q[(k + 1) % n]
            cross = (b[0] - a[0]) * (ys - a[1]) - (b[1] - a[1]) * (xs - a[0])
            inside &= cross * sgn > 1e-9
        count[y0:y1, x0:x1] += inside.astype(np.uint16)
    overlap_px = int((count > 1).sum())
    out_of_bounds = int(sum(((P < 0) | (P > 1)).any() for P in polys))
    # UV invertidas: dentro de cada isla, caras con el área de signo contrario a la mayoría
    signed = np.array([0.5 * sum(P[k][0] * P[(k + 1) % len(P)][1] - P[(k + 1) % len(P)][0] * P[k][1]
                                 for k in range(len(P))) for P in polys])
    flipped = 0
    for lab in set(labels):
        s = signed[[i for i, l in enumerate(labels) if l == lab]]
        flipped += int(min((s > 0).sum(), (s < 0).sum()))
    # densidad de texel: sqrt(área UV / área 3D) por cara; por isla media y variación
    a3 = np.array([p.area for p in me.polygons])
    dens = np.sqrt(np.abs(signed) / np.maximum(a3, 1e-12))
    body = [i for i, l in enumerate(labels) if l != 'cabeza']
    ref = np.median(dens[body])
    per = {}
    for lab in sorted(set(labels)):
        ii = [i for i, l in enumerate(labels) if l == lab]
        d = dens[ii] / ref
        w = a3[ii]
        mean = float((d * w).sum() / w.sum())
        cv = float(np.sqrt(((d - mean) ** 2 * w).sum() / w.sum()) / mean)
        per[lab] = dict(faces=len(ii), density=round(mean, 3), variation=round(cv, 3))
    used = float((count > 0).mean())
    return dict(islands=len(set(labels)), uv_overlap_pixels=overlap_px, uv_faces_out_of_bounds=out_of_bounds,
                uv_flipped_faces=flipped, uv_space_used=round(used, 3), texel_density=per,
                seams=sum(1 for e in me.edges if e.use_seam))
