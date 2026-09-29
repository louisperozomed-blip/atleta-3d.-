"""Primitivas SDF (signed distance fields) vectorizadas con numpy.

Se usan para *esculpir* la malla base: cada vértice de la malla generada con el
Skin modifier se proyecta sobre la isosuperficie 0 del campo anatómico.
Las distancias son aproximadas (elipsoides / secciones elípticas), suficiente
para una proyección de Newton iterativa.
"""
import numpy as np

WORLD_FRONT = np.array([0.0, -1.0, 0.0])


def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def make_frame(axis, front=WORLD_FRONT):
    """Devuelve (a, s, f): eje, lateral y frontal ortonormales."""
    a = _unit(axis)
    f = np.asarray(front, float) - a * np.dot(front, a)
    if np.linalg.norm(f) < 1e-6:
        f = np.array([0.0, 0.0, 1.0]) - a * a[2]
    f = _unit(f)
    s = np.cross(a, f)
    return a, s, f


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Ellipsoid:
    """Elipsoide orientado. radii = (a lo largo del eje, lateral, frontal)."""

    def __init__(self, center, axis, radii, k=0.015, front=WORLD_FRONT, name=''):
        self.c = np.asarray(center, float)
        self.a, self.s, self.f = make_frame(axis, front)
        self.r = np.asarray(radii, float)
        self.k = k
        self.name = name

    def __call__(self, P):
        d = P - self.c
        q = np.stack([d @ self.a, d @ self.s, d @ self.f], -1)
        k0 = np.linalg.norm(q / self.r, axis=-1)
        k1 = np.linalg.norm(q / (self.r ** 2), axis=-1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class Limb:
    """Cilindro generalizado entre p0 y p1 con perfil de sección elíptica asimétrica.

    prof: filas (t, r_exterior, r_interior, r_frontal, r_trasero[, desplazamiento_frontal])
    'exterior' es el lado de lat_dir (p.ej. +X para el lado izquierdo).
    """

    def __init__(self, p0, p1, prof, k=0.03, front=WORLD_FRONT, name='', lat_dir=(1, 0, 0)):
        self.p0 = np.asarray(p0, float)
        self.p1 = np.asarray(p1, float)
        v = self.p1 - self.p0
        self.L = np.linalg.norm(v)
        self.a, self.s, self.f = make_frame(v, front)
        if np.dot(self.s, lat_dir) < 0:
            self.s = -self.s
        prof = np.array([list(r) + [0.0] * (6 - len(r)) for r in prof], float)
        self.prof = prof
        self.k = k
        self.name = name

    def params(self, t):
        pr = self.prof
        return [np.interp(t, pr[:, 0], pr[:, i]) for i in range(1, 6)]

    def __call__(self, P):
        d = P - self.p0
        t = (d @ self.a) / self.L
        tc = np.clip(t, 0.0, 1.0)
        ro, ri, rf, rb, off = self.params(tc)
        x = d @ self.s
        y = d @ self.f - off
        rx = np.where(x > 0, ro, ri)
        ry = np.where(y > 0, rf, rb)
        rad = np.sqrt((x / rx) ** 2 + (y / ry) ** 2)
        rmin = np.minimum(rx, ry)
        d_rad = (rad - 1.0) * rmin
        ax = np.maximum(-t * self.L, (t - 1.0) * self.L)
        outside = np.sqrt(np.maximum(d_rad, 0) ** 2 + np.maximum(ax, 0) ** 2)
        inside = np.minimum(np.maximum(d_rad, ax), 0)
        return outside + inside


class Capsule:
    def __init__(self, p0, p1, r0, r1=None, k=0.02, name=''):
        self.p0 = np.asarray(p0, float)
        self.p1 = np.asarray(p1, float)
        self.r0 = r0
        self.r1 = r0 if r1 is None else r1
        self.k = k
        self.name = name

    def __call__(self, P):
        v = self.p1 - self.p0
        t = np.clip(((P - self.p0) @ v) / (v @ v), 0, 1)
        q = self.p0 + t[:, None] * v
        return np.linalg.norm(P - q, axis=-1) - (self.r0 + (self.r1 - self.r0) * t)


class Field:
    """Unión suave de primitivas (cada primitiva usa su propio k)."""

    def __init__(self, prims=None, subtract=None):
        self.prims = list(prims or [])
        self.subtract = list(subtract or [])

    def add(self, p):
        self.prims.append(p)
        return p

    def __call__(self, P):
        P = np.atleast_2d(P)
        d = self.prims[0](P)
        for p in self.prims[1:]:
            d = smin(d, p(P), p.k)
        for p in self.subtract:
            d = smax(d, -p(P), p.k)
        return d

    def grad(self, P, h=1e-4):
        g = np.zeros_like(P)
        for i in range(3):
            e = np.zeros(3)
            e[i] = h
            g[:, i] = (self(P + e) - self(P - e)) / (2 * h)
        return g

    def project(self, P, iters=12, step=1.0, max_step=0.012):
        """Proyección de Newton sobre la isosuperficie 0 (paso limitado para estabilidad)."""
        P = P.copy()
        for _ in range(iters):
            d = self(P)
            g = self.grad(P)
            gn = np.maximum((g * g).sum(1), 1e-6)
            delta = step * (d / gn)[:, None] * g
            ln = np.linalg.norm(delta, axis=1)
            delta *= (np.minimum(ln, max_step) / np.maximum(ln, 1e-12))[:, None]
            P -= delta
        return P
