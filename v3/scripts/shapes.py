"""Generadores de geometría low poly: lofts, mechones facetados, calcomanías proyectadas."""
import numpy as np


def poly_sdf(px, pz, poly):
    """Distancia con signo 2D a un polígono cerrado (negativa dentro)."""
    poly = np.asarray(poly, float)
    P = np.stack([px, pz], -1)
    d = np.full(len(P), np.inf)
    inside = np.zeros(len(P), bool)
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        v = b - a
        t = np.clip(((P - a) @ v) / (v @ v), 0, 1)
        d = np.minimum(d, np.linalg.norm(P - (a + t[:, None] * v), axis=1))
        cond = ((a[1] > P[:, 1]) != (b[1] > P[:, 1]))
        xint = a[0] + (P[:, 1] - a[1]) * (b[0] - a[0]) / np.where(b[1] - a[1] == 0, 1e-12, b[1] - a[1])
        inside ^= cond & (P[:, 0] < xint)
    return np.where(inside, -d, d)


def polyline_interp(x, pts):
    pts = np.asarray(pts, float)
    return np.interp(x, pts[:, 0], pts[:, 1])


def loft(sections, cap_start=True, cap_end=True):
    """sections: lista de arrays (N,3) con el mismo N. Devuelve verts, faces (quads + caps)."""
    verts = []
    faces = []
    n = len(sections[0])
    for s in sections:
        verts.extend([tuple(p) for p in s])
    m = len(sections)
    for j in range(m - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_start:
        c = len(verts)
        verts.append(tuple(np.mean(sections[0], 0)))
        for i in range(n):
            faces.append((c, (i + 1) % n, i))
    if cap_end:
        c = len(verts)
        verts.append(tuple(np.mean(sections[-1], 0)))
        base = (m - 1) * n
        for i in range(n):
            faces.append((c, base + i, base + (i + 1) % n))
    return verts, faces


def frame_from(d, up=(0, 0, 1)):
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    u = np.asarray(up, float) - d * np.dot(up, d)
    if np.linalg.norm(u) < 1e-6:
        u = np.array([1.0, 0, 0]) - d * d[0]
    u /= np.linalg.norm(u)
    s = np.cross(d, u)
    return d, u, s


def strand(path, radii, sides=6, rng=None, jitter=0.18, flat=1.0, up=(0, 0, 1), twist=0.0, tip=True):
    """Mechón facetado: tubo irregular a lo largo de path que termina en punta."""
    rng = rng or np.random.default_rng(0)
    path = np.asarray(path, float)
    secs = []
    for k, (p, r) in enumerate(zip(path, radii)):
        if k < len(path) - 1:
            d = path[k + 1] - p
        else:
            d = p - path[k - 1]
        if 0 < k < len(path) - 1:
            d = path[k + 1] - path[k - 1]
        d, u, s = frame_from(d, up)
        ring = []
        for i in range(sides):
            a = 2 * np.pi * i / sides + twist * k
            rr = r * (1 + rng.uniform(-jitter, jitter))
            ring.append(p + (u * np.cos(a) * flat + s * np.sin(a)) * rr)
        secs.append(np.array(ring))
    if tip:
        verts, faces = loft(secs, cap_start=True, cap_end=False)
        tipv = len(verts)
        last = path[-1] + (path[-1] - path[-2]) * 0.6
        verts.append(tuple(last))
        base = (len(secs) - 1) * sides
        for i in range(sides):
            faces.append((base + i, base + (i + 1) % sides, tipv))
        return verts, faces
    return loft(secs)


def merge(parts):
    V, F = [], []
    for v, f in parts:
        o = len(V)
        V.extend(v)
        F.extend([tuple(i + o for i in face) for face in f])
    return V, F
