// core.js — espacio de nombres, utilidades, materiales y fusión de geometría por chunks.
// Todos los módulos son scripts clásicos que cuelgan de window.W (funcionan desde file://
// y se concatenan tal cual en el HTML final).
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  // ---------------------------------------------------------------------------
  // Aleatoriedad determinista y ruido
  // ---------------------------------------------------------------------------
  W.rng = function (a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function hash2(x, z) {
    let h = (x * 374761393 + z * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  W.hash2 = hash2;
  // ruido de valor 2D suave
  W.vnoise = function (x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
  W.fbm = function (x, z) {
    return W.vnoise(x, z) * 0.55 + W.vnoise(x * 2.1 + 5.3, z * 2.1 - 1.7) * 0.3 + W.vnoise(x * 4.3 - 2.1, z * 4.3 + 7.7) * 0.15;
  };
  W.jr = W.rng(4242);
  W.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  W.smoothstep = (a, b, x) => { const t = W.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  W.lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------------------
  // Parámetros globales compartidos por los shaders
  // ---------------------------------------------------------------------------
  W.U = {
    uTime: { value: 0 },
    uPlayer: { value: null },       // THREE.Vector3 (lo crea main)
    uPush: { value: 0 },            // 1 mientras el personaje se mueve (hierba que se aparta)
    uSteps: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -99, 0)) },   // pisadas recientes: x, z, tiempo, fuerza
    // mapa de cobertura (look.js): R = copas/techo (oscuridad), G = densidad de niebla
    uCover: { value: null },
    uHalf: { value: 40 },
    uCoverK: { value: new THREE.Vector2(0.94, 0.86) },   // cuánto apagan las copas el sol y el cielo
  };

  // Luz bajo las copas: el sol y el cielo se apagan con la cobertura (R del mapa); las luces puntuales
  // (faroles, bioluminiscencia) y el brillo propio no. Vale para cualquier material de three con luces.
  W.patchCover = function (shader) {
    shader.uniforms.uCover = W.U.uCover; shader.uniforms.uHalf = W.U.uHalf; shader.uniforms.uCoverK = W.U.uCoverK;
    shader.vertexShader = "varying vec3 vCovWP;\n" + shader.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\n#ifdef USE_INSTANCING\nvCovWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvCovWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif");
    const lights = THREE.ShaderChunk.lights_fragment_begin
      .replace("getDirectionalDirectLightIrradiance( directionalLight, geometry, directLight );",
               "getDirectionalDirectLightIrradiance( directionalLight, geometry, directLight );\n\t\tdirectLight.color *= covSun;")
      .replace("irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry );",
               "irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry ) * covSky;");
    shader.fragmentShader = "varying vec3 vCovWP;\nuniform sampler2D uCover; uniform float uHalf; uniform vec2 uCoverK;\n" +
      shader.fragmentShader.replace("#include <lights_fragment_begin>",
        "float cov = texture2D(uCover, (vCovWP.xz + uHalf) / (2.0 * uHalf)).r;\nfloat covSun = 1.0 - cov * uCoverK.x, covSky = 1.0 - cov * uCoverK.y;\n" + lights);
  };

  // ---------------------------------------------------------------------------
  // Materiales
  // ---------------------------------------------------------------------------
  // Material "mundo": toon de 3 bandas con color por vértice. Atributos extra:
  //   aGlow  : intensidad emisiva (0 = sólido), el color de vértice es el color emisivo
  //   aPhase : fase del pulso / balanceo
  //   aSway  : amplitud del balanceo (0 = estático); también activa el empuje del personaje
  W.makeGradientMap = function () {
    const gm = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.LuminanceFormat);
    gm.minFilter = gm.magFilter = THREE.NearestFilter;
    gm.needsUpdate = true;
    return gm;
  };
  const SWAY_VS = `
    attribute float aGlow; attribute float aPhase; attribute float aSway;
    uniform float uTime; uniform vec3 uPlayer; uniform float uPush; uniform vec4 uSteps[4];
    varying float vPulse;
  `;
  const SWAY_BODY = `
    vPulse = aGlow * (0.65 + 0.35 * sin(uTime * (1.2 + fract(aPhase * 7.13) * 1.3) + aPhase));
    if (aSway > 0.0) {
      // balanceo por viento + se aparta del personaje al pasar
      float s = aSway;
      transformed.x += sin(uTime * 1.2 + aPhase) * 0.08 * s;
      transformed.z += cos(uTime * 0.9 + aPhase * 1.7) * 0.06 * s;
      vec2 d = transformed.xz - uPlayer.xz;
      float dist = length(d);
      float k = (1.0 - smoothstep(0.25, 1.1, dist)) * s * (0.35 + 0.65 * uPush);
      transformed.xz += normalize(d + 1e-4) * k * 0.35;
      transformed.y -= k * 0.12;
      // aplastada un momento por cada pisada cercana (se recupera en ~0.6 s)
      for (int i = 0; i < 4; i++) {
        vec4 st = uSteps[i];
        float age = uTime - st.z;
        if (age < 0.0 || age > 0.7) continue;
        vec2 e = transformed.xz - st.xy;
        float r = length(e);
        float press = (1.0 - smoothstep(0.1, 0.45, r)) * (1.0 - smoothstep(0.05, 0.7, age)) * st.w * s;
        transformed.y -= press * 0.16;
        transformed.xz += normalize(e + 1e-4) * press * 0.12;
      }
    }
  `;
  function patchWorld(shader, withEmissive) {
    shader.uniforms.uTime = W.U.uTime;
    shader.uniforms.uPlayer = W.U.uPlayer;
    shader.uniforms.uPush = W.U.uPush;
    shader.uniforms.uSteps = W.U.uSteps;
    shader.vertexShader = SWAY_VS + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY_BODY);
    if (withEmissive && W.U.uCover.value) W.patchCover(shader);
    if (withEmissive) {
      shader.fragmentShader = "varying float vPulse;\n" + shader.fragmentShader.replace(
        "vec3 totalEmissiveRadiance = emissive;",
        "vec3 totalEmissiveRadiance = emissive + vColor * vPulse;");
    }
  }
  W.makeWorldMaterial = function (gm) {
    const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gm });
    m.onBeforeCompile = (s) => patchWorld(s, true);
    m.customProgramCacheKey = () => "world";
    return m;
  };
  W.makeOutlineMaterial = function () {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.BackSide });
    m.onBeforeCompile = (s) => patchWorld(s, false);
    m.customProgramCacheKey = () => "outline";
    return m;
  };
  // Profundidad para sombras con el mismo balanceo (si no, la sombra no se mueve)
  W.makeSwayDepthMaterial = function () {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    m.onBeforeCompile = (s) => patchWorld(s, false);
    m.customProgramCacheKey = () => "swaydepth";
    return m;
  };

  // ---------------------------------------------------------------------------
  // Constructor de geometría fusionada (no indexada) con atributos del mundo
  // ---------------------------------------------------------------------------
  const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
  const _nm = new THREE.Matrix3();
  class GeoBuilder {
    constructor(opts) {
      this.pos = []; this.nor = []; this.col = []; this.glow = []; this.phase = []; this.sway = [];
      this.local = opts && opts.local ? [] : null;
    }
    // g: BufferGeometry, m: Matrix4, color: hex|Color, o: {glow, phase, sway, swayByHeight, flat}
    add(g, m, color, o) {
      o = o || {};
      let geo = g.index ? g.toNonIndexed() : g;
      if (o.flat) { geo = geo === g ? g.clone() : geo; geo.computeVertexNormals(); }
      const P = geo.attributes.position, N = geo.attributes.normal;
      _nm.getNormalMatrix(m);
      _c.set(color);
      const hmin = o.swayByHeight ? o.swayByHeight[0] : 0, hmax = o.swayByHeight ? o.swayByHeight[1] : 1;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i);
        if (this.local) this.local.push(_v.x, _v.y, _v.z);
        const ly = _v.y;
        _v.applyMatrix4(m);
        this.pos.push(_v.x, _v.y, _v.z);
        if (N) { _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); this.nor.push(_n.x, _n.y, _n.z); }
        else this.nor.push(0, 1, 0);
        const jit = o.jitter ? 1 + (W.jr() - 0.5) * o.jitter : 1;
        this.col.push(_c.r * jit, _c.g * jit, _c.b * jit);
        this.glow.push(o.glow || 0);
        this.phase.push(o.phase || 0);
        let s = o.sway || 0;
        if (s && o.swayByHeight) s *= W.clamp((ly - hmin) / (hmax - hmin), 0, 1);
        this.sway.push(s);
      }
      return this;
    }
    get count() { return this.pos.length / 3; }
    build() {
      if (!this.pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute("aGlow", new THREE.Float32BufferAttribute(this.glow, 1));
      g.setAttribute("aPhase", new THREE.Float32BufferAttribute(this.phase, 1));
      g.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 1));
      if (this.local) g.setAttribute("aLocal", new THREE.Float32BufferAttribute(this.local, 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
  }
  W.GeoBuilder = GeoBuilder;

  // ---------------------------------------------------------------------------
  // Chunks: cada prop se añade al chunk de su posición; al final cada chunk
  // tiene una malla por material (mundo, contorno, cristal, agua) -> pocas
  // llamadas de dibujo y descarte por frustum a nivel de chunk.
  // ---------------------------------------------------------------------------
  W.CHUNK = 16;
  W.chunks = new Map();
  W.chunkOf = function (x, z) {
    const cx = Math.floor((x + W.HALF) / W.CHUNK), cz = Math.floor((z + W.HALF) / W.CHUNK);
    const key = cx + "," + cz;
    let c = W.chunks.get(key);
    if (!c) {
      c = { cx, cz, solid: new GeoBuilder(), outline: new GeoBuilder(), crys: new GeoBuilder({ local: true }),
            water: new GeoBuilder(), meshes: [] };
      W.chunks.set(key, c);
    }
    return c;
  };

  // Añade una pieza con contorno por "casco invertido" horneado: copia escalada
  // alrededor del centro de su caja, en negro y con caras traseras.
  const _box = new THREE.Box3(), _size = new THREE.Vector3(), _ctr = new THREE.Vector3();
  const _m2 = new THREE.Matrix4(), _s = new THREE.Matrix4(), _t = new THREE.Matrix4();
  W.OUTLINE_T = 0.035;
  W.BAKED_OUTLINE = false;      // contornos de casco invertido (antes); ahora la tinta es un pase de bordes
  W.addPiece = function (g, m, color, o) {
    o = o || {};
    _v.setFromMatrixPosition(m);
    const c = o.chunk || W.chunkOf(_v.x, _v.z);
    const target = o.crystal ? c.crys : c.solid;
    target.add(g, m, color, o);
    if (o.outline !== false && W.BAKED_OUTLINE) {
      if (!g.boundingBox) g.computeBoundingBox();
      _box.copy(g.boundingBox);
      _box.getSize(_size); _box.getCenter(_ctr);
      const T = o.outlineT || W.OUTLINE_T;
      // escala en espacio local para que el grosor sea ~T en mundo (aprox. con la escala de m)
      const sc = new THREE.Vector3().setFromMatrixScale(m);
      const sx = (_size.x * sc.x + 2 * T) / Math.max(_size.x * sc.x, 1e-3);
      const sy = (_size.y * sc.y + 2 * T) / Math.max(_size.y * sc.y, 1e-3);
      const sz = (_size.z * sc.z + 2 * T) / Math.max(_size.z * sc.z, 1e-3);
      _t.makeTranslation(-_ctr.x, -_ctr.y, -_ctr.z);
      _s.makeScale(sx, sy, sz);
      _m2.makeTranslation(_ctr.x, _ctr.y, _ctr.z).multiply(_s).multiply(_t);
      _m2.premultiply(m);
      c.outline.add(g, _m2, o.outlineColor != null ? o.outlineColor : 0x000000, { sway: o.sway, phase: o.phase, swayByHeight: o.swayByHeight });
    }
    return c;
  };

  // Emisores de luz (el pool de PointLights de effects.js elige los más cercanos)
  W.emitters = [];
  W.addEmitter = function (x, y, z, color, intensity, distance, extra) {
    W.emitters.push(Object.assign({ x, y, z, color: new THREE.Color(color), intensity, distance }, extra || {}));
  };
})();
