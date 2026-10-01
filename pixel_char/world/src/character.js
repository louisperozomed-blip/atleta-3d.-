// character.js — el personaje como sprite plano vertical orientado a cámara.
// Anima con los atlas de pixel_char (idle/walk/run/jump × 8 direcciones × 6 frames).
// La dirección del sprite se calcula respecto al azimut de la cámara, así que al girar
// la cámara 90° el índice de dirección se desplaza 2 posiciones.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const ANIMS0 = ["idle", "walk", "run", "jump"];
  const NF = 6;

  W.makeCharacter = function (scene, tex, meta, ctex, cmeta, opts) {
    opts = opts || {};
    // atlas propio (el enemigo): su lista de animaciones, sus pies y su altura en el mundo
    const ANIMS = meta.anims || ANIMS0;
    const FEETS = opts.feet || W.FEET;
    const [FW, FH] = meta.frame_size, [PVX, PVY] = meta.pivot, [AW, AH] = meta.atlas_size;
    const COLS = meta.columns, STAND = meta.standing_height_px;
    // hojas de combate (combat_atlas.json): otro atlas con celdas de 128x144 y pivote (64, 132); misma escala
    // de dibujo que idle/walk (los frames se normalizaron a la altura de pie de idle)
    const CANIMS = cmeta ? cmeta.anims : [];
    const SETS = {
      base: { tex, FW, FH, PVX, PVY, AW, AH, COLS, emit: 0 },
      combat: cmeta ? { tex: ctex, FW: cmeta.frame_size[0], FH: cmeta.frame_size[1], PVX: cmeta.pivot[0], PVY: cmeta.pivot[1],
        AW: cmeta.atlas_size[0], AH: cmeta.atlas_size[1], COLS: cmeta.columns, emit: 1 } : null,
    };
    const unitsV = (opts.height || W.CHAR_H) / STAND;                         // unidades de mundo por texel (vertical del plano)
    const unitsH = unitsV * Math.cos(W.CAM_EL);              // horizontal: el plano vertical se ve acortado por cos(EL)
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0.5, 0);                              // origen en la esquina inferior izquierda
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
      uColor: { value: null }, uNormal: { value: null }, uSpec: { value: null },
      uRect: { value: new THREE.Vector4() }, uSunW: { value: new THREE.Vector3() },
      uNormalAmt: { value: 1 }, uGrade: { value: 0.6 }, uGain: { value: 1.12 },
      // luz del entorno (feel.js): copas que apagan sol y cielo (x, y), luz fría desde abajo, brillo del visor
      uCovC: { value: new THREE.Vector2(1, 1) }, uUp: { value: new THREE.Vector3() }, uWarm: { value: new THREE.Vector3() }, uVisor: { value: 0 }, uTime: { value: 0 },
      uWarp: { value: new THREE.Vector4() },               // túnica: (amp x, amp y, belt v, hem v) — etapa 3
      uFootA: { value: new THREE.Vector4() }, uFootB: { value: new THREE.Vector4() },   // pies anclados (u, v, du, dv)
      uFootR: { value: new THREE.Vector2(opts.feet ? 9 / FW : 7 / 120, opts.feet ? 26 / FH : 22 / 136) },                             // (sigma u, alto rodilla v)
      uAO: { value: new THREE.Vector3(PVY / FH, (opts.feet ? 40 : 34) / FH, 0) },                            // (v del suelo, alto v, fuerza)
      uGround: { value: new THREE.Color(0, 0, 0) }, uBounce: { value: 0 },
      uBody: { value: new THREE.Vector3(0, 0.76, 0) },                                     // (hundimiento v, v rodilla, inclinación)
      uPal: { value: (W.PALETTE || [[0, 0, 0]]).map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
      uQuant: { value: 0 }, uOutline: { value: 0 },
      uEmit: { value: opts.emit || 0 }, uFlash: { value: 0 }, uEcho: { value: opts.echo ? 1 : 0 }, uWarn: { value: 0 },
      uUnlit: { value: 0 },                                  // visor de animaciones: color plano, sin luz
      uFade: { value: 1 }, uEyeCol: { value: new THREE.Vector3().fromArray(opts.emitCol || (opts.echo ? [0.45, 0.95, 1.0] : [1.0, 0.55, 0.18])) }, uEyeK: { value: 1 },
    }]);
    uniforms.uColor.value = tex.color; uniforms.uNormal.value = tex.normal; uniforms.uSpec.value = tex.spec;
    const VS = `
      #include <common>
      #include <fog_pars_vertex>
      #include <shadowmap_pars_vertex>
      uniform vec4 uRect; uniform vec3 uSunW;
      varying vec2 vUv; varying vec2 vQ; varying vec3 vViewPos;
      void main() {
        vQ = uv;
        vUv = vec2(uRect.x + uv.x * uRect.z, uRect.y + (1.0 - uv.y) * uRect.w);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 mvPosition = viewMatrix * worldPosition;
        vViewPos = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
          // se consulta la sombra un poco hacia el sol: así el propio proyector del
          // personaje no le hace auto-sombra al plano visible
          vDirectionalShadowCoord[0] = directionalShadowMatrix[0] * vec4(worldPosition.xyz + uSunW * 0.7, 1.0);
        #endif
        #include <fog_vertex>
      }`;
    const FS = `
      #include <common>
      #include <packing>
      #include <bsdfs>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <fog_pars_fragment>
      uniform sampler2D uColor, uNormal, uSpec;
      uniform vec4 uRect, uWarp, uFootA, uFootB;
      uniform vec2 uFootR;
      uniform vec3 uAO, uGround, uBody; uniform float uBounce;
      #define NPAL ${Math.max(1, (W.PALETTE || [0]).length)}
      uniform vec3 uPal[NPAL]; uniform float uQuant, uOutline;
      float bayer4(vec2 p) { vec2 a = floor(mod(p, 4.0)); float b2a = fract(a.x / 2.0 + a.y * a.y * 0.75);
        vec2 h = floor(a * 0.5); float b2b = fract(h.x / 2.0 + h.y * h.y * 0.75); return b2b * 0.25 + b2a; }
      // cuantización a la paleta compartida con dither ordenado entre los dos colores más cercanos
      vec3 quantize(vec3 c) {
        float d1 = 1e9, d2 = 1e9; vec3 c1 = c, c2 = c;
        for (int i = 0; i < NPAL; i++) {
          vec3 e = (uPal[i] - c) * vec3(1.0, 1.25, 0.8);
          float d = dot(e, e);
          if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = uPal[i]; } else if (d < d2) { d2 = d; c2 = uPal[i]; }
        }
        float t = sqrt(d1) / max(sqrt(d1) + sqrt(d2), 1e-5);
        // dither solo entre colores próximos (si el segundo está lejos, se queda el más cercano)
        if (d2 > 0.03) return c1;
        return bayer4(gl_FragCoord.xy) * 0.9 + 0.05 < t ? c2 : c1;
      }
      // deformación de la pierna apoyada: 0 en la rodilla, 1 en la suela, gaussiana en horizontal
      vec2 footW(vec2 q, vec4 F) {
        if (F.z == 0.0 && F.w == 0.0) return vec2(0.0);
        float wv = smoothstep(F.y - uFootR.y, F.y - uFootR.y * 0.2, q.y);
        float wh = exp(-pow((q.x - F.x) / uFootR.x, 2.0));
        return F.zw * wv * wh;
      }
      uniform float uNormalAmt, uGrade, uGain, uVisor, uTime, uUnlit; uniform vec2 uCovC; uniform vec3 uUp, uWarm;
      uniform float uEmit, uFlash, uEcho, uWarn, uFade, uEyeK; uniform vec3 uEyeCol;
      varying vec2 vUv; varying vec2 vQ; varying vec3 vViewPos;
      void main() {
        // deformación de la túnica (etapa 3): desplaza el muestreo en la franja cintura-bajo
        vec2 q = vec2(vQ.x, 1.0 - vQ.y);
        q -= footW(q, uFootA) + footW(q, uFootB);
        // peso: de rodillas arriba el cuerpo baja (las piernas se comprimen, las botas no se mueven)
        float above = 1.0 - smoothstep(uBody.y - 0.06, uBody.y + 0.03, q.y);
        q.y -= uBody.x * above;
        // inclinación al correr: cizalla horizontal proporcional a la altura sobre las botas
        q.x -= uBody.z * max(0.0, uBody.y - q.y);
        vec2 uv = vec2(uRect.x + q.x * uRect.z, uRect.y + q.y * uRect.w);
        float vv = q.y;
        float band = smoothstep(uWarp.z, uWarp.z + 0.12, vv) * (1.0 - smoothstep(uWarp.w - 0.08, uWarp.w, vv));
        uv.x -= uWarp.x * band * band * uRect.z;
        uv.y -= uWarp.y * band * uRect.w;
        vec4 c = texture2D(uColor, uv);
        // desvanecerse (enemigo muerto): trama ordenada que se va comiendo el sprite
        if (uFade < 0.999 && bayer4(gl_FragCoord.xy) * 0.94 + 0.03 > uFade) discard;
        if (c.a < 0.5) {
          // contorno de 1 píxel de render (como el de los objetos del mundo): si algún vecino es opaco
          if (uOutline > 0.5) {
            vec2 ex = dFdx(uv), ey = dFdy(uv);
            float nb = max(max(texture2D(uColor, uv + ex).a, texture2D(uColor, uv - ex).a),
                           max(texture2D(uColor, uv + ey).a, texture2D(uColor, uv - ey).a));
            if (nb >= 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          }
          discard;                                                // alpha test: escribe profundidad limpia
        }
        vec3 n = normalize(texture2D(uNormal, uv).xyz * 2.0 - 1.0);
        n = normalize(mix(vec3(0.0, 0.0, 1.0), n, uNormalAmt));   // normal en espacio de vista (+y arriba)
        vec4 sp4 = texture2D(uSpec, uv);
        float sm = sp4.r;
        float em = sp4.g * uEmit;                                  // emisión: cuchilla, estela, chispas (combate)
        vec3 base = c.rgb;
        if (uEcho > 0.5) {
          // eco: los mismos dibujos en tonos fríos (cian y gris); el negro del visor se queda oscuro
          // por materiales: crema/dorado -> gris cian claro, bordado naranja -> cian vivo, tela verde ->
          // pizarra oscura, negro -> azul noche; se conserva la luminancia (el sombreado pintado)
          float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          float warm = clamp((c.r - c.b) * 2.2, 0.0, 1.0), sat = clamp((max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) * 1.8, 0.0, 1.0);
          float cloth = clamp((c.g - c.r) * 4.0, 0.0, 1.0);
          vec3 grey = mix(vec3(0.04, 0.06, 0.09), vec3(0.74, 0.86, 0.9), smoothstep(0.02, 0.92, l));
          vec3 acc = vec3(0.25, 0.8, 0.95) * (0.35 + 1.1 * l);
          vec3 slate = vec3(0.16, 0.22, 0.27) * (0.5 + 1.6 * l);
          c.rgb = mix(grey, acc, warm * sat * smoothstep(0.25, 0.6, sat) * (1.0 - smoothstep(0.75, 0.95, l)));
          c.rgb = mix(c.rgb, slate, cloth);
        }
        vec3 V = vec3(0.0, 0.0, 1.0);                             // cámara ortográfica
        float shin = mix(8.0, 56.0, sm);
        vec3 diff = vec3(0.0), spec = vec3(0.0), rim = vec3(0.0);
        #if NUM_HEMI_LIGHTS > 0
          float hl = dot(n, hemisphereLights[0].direction) * 0.5 + 0.5;
          diff += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, hl) * uCovC.y;
        #endif
        #if NUM_DIR_LIGHTS > 0
          float sh = 1.0;
          #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
            sh = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
          #endif
          vec3 L = directionalLights[0].direction;
          float w = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0);
          sh *= uCovC.x;
          diff += directionalLights[0].color * w * sh;
          spec += directionalLights[0].color * sh * sm * pow(max(dot(n, normalize(L + V)), 0.0), shin) * (shin + 8.0) / 60.0;
          float e = smoothstep(0.55, 0.92, length(n.xy));
          rim += directionalLights[0].color * sh * e * pow(max(dot(normalize(n.xy + 1e-4), normalize(L.xy + 1e-4)), 0.0), 2.0) * smoothstep(0.05, 0.5, length(L.xy)) * 0.35;
        #endif
        #if NUM_POINT_LIGHTS > 0
          for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lv = pointLights[i].position - vViewPos;
            float d = length(lv);
            vec3 L = lv / max(d, 1e-3);
            vec3 lc = pointLights[i].color * punctualLightIntensityToIrradianceFactor(d, pointLights[i].distance, pointLights[i].decay);
            float w = clamp((dot(n, L) + 0.5) / 1.5, 0.0, 1.0);
            diff += lc * w * 0.7;
            spec += lc * sm * pow(max(dot(n, normalize(L + V)), 0.0), shin) * (shin + 8.0) / 40.0;
            float e = smoothstep(0.55, 0.92, length(n.xy));
            rim += lc * e * max(dot(normalize(n.xy + 1e-4), normalize(L.xy + 1e-4)), 0.0) * 0.5;
          }
        #endif
        // r128 no físico: irradiancia neta = color·intensidad. Las luces tiñen, pero con la
        // saturación algo contenida para no perder el crema y el naranja del personaje
        vec3 diffT = mix(vec3(dot(diff, vec3(0.333))), diff, 0.6);
        // oclusión ambiental hacia el suelo (piernas y botas) + rebote del color de la baldosa
        float hgt = uAO.x - q.y;                                   // altura sobre la suela (v)
        float ao = mix(1.0 - uAO.z, 1.0, smoothstep(0.0, uAO.y, hgt));
        vec3 col = c.rgb * diffT * uGain * ao + (spec + rim) * 0.5 * ao;
        col += c.rgb * uGround * uBounce * (1.0 - smoothstep(0.0, uAO.y * 1.4, hgt)) * (0.35 + 0.65 * clamp(0.5 - 0.5 * n.y, 0.0, 1.0));
        // luz cálida que lo envuelve junto al farol (desde todas partes, más en lo que mira al farol ya lo hace la puntual)
        col += c.rgb * uWarm * (0.75 + 0.25 * n.z);
        // luz fría desde abajo (agua y hongos que brillan): más en las botas y en lo que mira al suelo
        float low = 1.0 - smoothstep(0.0, 0.62, hgt);
        col += (c.rgb * 0.8 + 0.12) * uUp * low * low * (0.45 + 0.55 * clamp(0.5 - 0.5 * n.y, 0.0, 1.0));
        // visor del casco: píxeles oscuros y brillantes en la franja de la cabeza, con brillo propio tenue
        float lumC = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        float vis = step(0.13, q.y) * step(q.y, 0.34) * (1.0 - smoothstep(0.08, 0.16, lumC)) * smoothstep(0.5, 0.7, sm);
        col += vec3(0.32, 0.78, 0.72) * vis * uVisor * (0.85 + 0.15 * sin(uTime * 1.7));
        // ajuste hacia la paleta del mundo: medios algo más fríos, sombras hacia violeta;
        // negros y altas luces (crema, naranja) se mantienen
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float mid = smoothstep(0.05, 0.3, lum) * (1.0 - smoothstep(0.55, 0.9, lum));
        col = mix(col, col * vec3(0.86, 1.0, 1.1), 0.35 * mid * uGrade);
        col += vec3(0.018, 0.0, 0.03) * (1.0 - smoothstep(0.0, 0.22, lum)) * uGrade;
        // emisión propia (brilla en la oscuridad, sin depender de las luces)
        col += (c.rgb * 1.5 + uEyeCol * 0.35) * em * uEyeK;
        // eco: brillo del visor (siempre) y destello de aviso antes de su golpe
        if (uEcho > 0.5) col += vec3(0.35, 0.95, 1.0) * vis * (0.9 + 0.5 * uWarn) + vec3(0.6, 0.95, 1.0) * uWarn * 0.25 * (0.6 + 0.4 * n.z);
        if (uQuant > 0.0) col = mix(col, quantize(clamp(col, 0.0, 1.0)), uQuant);
        // visor de animaciones «sin luz»: el color de la hoja tal cual (más la emisión)
        col = mix(col, c.rgb + c.rgb * 1.5 * em, uUnlit);
        // destello blanco al recibir un golpe
        col = mix(col, vec3(1.0, 0.98, 0.94), uFlash * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS, lights: true, fog: true, extensions: { derivatives: true } });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Silueta cuando algo lo tapa: segunda pasada solo donde la profundidad es MAYOR
    // (detrás de arcos, mesetas, copas), translúcida y en un tono frío del mundo.
    const ghost = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uColor: uniforms.uColor, uRect: uniforms.uRect },
      vertexShader: `uniform vec4 uRect; varying vec2 vUv;
        void main(){ vUv = vec2(uRect.x + uv.x * uRect.z, uRect.y + (1.0 - uv.y) * uRect.w);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // trama de tinta cálida (líneas diagonales de puntos): se le encuentra siempre, sin romper el dibujo
      fragmentShader: `uniform sampler2D uColor; varying vec2 vUv;
        void main(){ vec4 c = texture2D(uColor, vUv); if (c.a < 0.5) discard;
          vec2 p = floor(gl_FragCoord.xy);
          if (mod(p.x + p.y, 3.0) > 0.5) discard;
          gl_FragColor = vec4(${opts.echo || opts.feet ? "0.45, 0.9, 1.0" : "0.95, 0.62, 0.34"}, 0.9); }`,
      depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth, transparent: true,
      // un poco hacia la cámara: con un búfer de profundidad de 24 bits la silueta empataba con el propio
      // personaje y lo teñía entero; así solo aparece donde otra cosa está delante de verdad
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
    }));
    ghost.frustumCulled = false; ghost.renderOrder = 10;
    scene.add(ghost);

    // Proyector de sombra: mismo frame, plano girado hacia el sol (un plano de cara a la
    // cámara casi no proyectaría sombra con el sol de lado). Invisible en la pasada de color.
    const casterDepth = new THREE.ShaderMaterial({
      uniforms: { uColor: uniforms.uColor, uRect: uniforms.uRect },
      vertexShader: `uniform vec4 uRect; varying vec2 vUv;
        void main(){ vUv = vec2(uRect.x + uv.x * uRect.z, uRect.y + (1.0 - uv.y) * uRect.w);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `#include <packing>
        uniform sampler2D uColor; varying vec2 vUv;
        void main(){ if (texture2D(uColor, vUv).a < 0.5) discard; gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`,
    });
    const caster = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    caster.castShadow = true; caster.customDepthMaterial = casterDepth; caster.frustumCulled = false;
    scene.add(caster);

    // Oclusión de contacto: elipse oscura bajo los pies
    const blobTex = (function () {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(0,0,0,0.85)"); gr.addColorStop(0.45, "rgba(0,0,0,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, color: 0x05030a, transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    blob.renderOrder = 1; scene.add(blob);
    // Sombra de contacto de cada bota: pequeña, oscura y de borde firme
    const bootTex = (function () {
      const c = document.createElement("canvas"); c.width = c.height = 32;
      const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.55, "rgba(0,0,0,0.85)"); gr.addColorStop(0.8, "rgba(0,0,0,0.3)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })();
    const boots = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: bootTex, color: 0x020106, transparent: true, depthWrite: false, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.renderOrder = 2; scene.add(m); return m;
    });

    // Versión "sin integrar" para comparar: pegatina 2D encima del canvas (sin luz, sin
    // sombra, sin profundidad, a resolución completa)
    const sticker = document.createElement("canvas");
    Object.assign(sticker.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", display: "none" });
    document.getElementById("wrap").appendChild(sticker);
    const stickerImg = tex.color.image;

    const st = { anim: "idle", dir: 0, dirWanted: 0, lastStep: 0, phase: 0, idleT: 0, time: 0, frame: 0, prevAnim: "idle" };
    let curSet = "base";
    function useSet(name) {
      if (curSet === name || !SETS[name]) return SETS[curSet];
      curSet = name;
      const S = SETS[name];
      uniforms.uColor.value = S.tex.color; uniforms.uNormal.value = S.tex.normal; uniforms.uSpec.value = S.tex.spec;
      uniforms.uEmit.value = S.emit;
      uniforms.uAO.value.x = S.PVY / S.FH;
      return S;
    }
    const ch = {
      mesh, mat, uniforms, st, meta, cmeta, unitsV, unitsH, feet: opts.feet || null, locoFps: opts.locoFps || 12, height: opts.height || W.CHAR_H, caster, blob, boots, sticker, ghost, integrated: true,
      isCombat(anim) { return CANIMS.indexOf(anim) >= 0; },
      animList: ANIMS.concat(CANIMS),                    // todas las que sabe pintar (visor de animaciones)
      frameRect(anim, dir, f) {
        if (CANIMS.indexOf(anim) >= 0) {
          const S = SETS.combat, k = (CANIMS.indexOf(anim) * 8 + dir) * NF + f;
          const c = k % S.COLS, r = Math.floor(k / S.COLS);
          return [c * S.FW / S.AW, r * S.FH / S.AH, S.FW / S.AW, S.FH / S.AH];
        }
        const k = (ANIMS.indexOf(anim) * 8 + dir) * NF + f;
        const c = k % COLS, r = Math.floor(k / COLS);
        return [c * FW / AW, r * FH / AH, FW / AW, FH / AH];
      },
      // dirección (0..7) a partir del rumbo en el suelo y el azimut de la cámara
      dirFromHeading(heading, camTheta) {
        const hx = Math.cos(heading), hz = Math.sin(heading);
        const rx = Math.cos(camTheta), rz = -Math.sin(camTheta);      // derecha de cámara en el suelo
        const tx = Math.sin(camTheta), tz = Math.cos(camTheta);       // hacia la cámara
        const xp = hx * rx + hz * rz, zp = hx * tx + hz * tz;
        const a = Math.atan2(-xp, zp);
        return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      },
      dirCenterHeading(i, camTheta) {
        // rumbo en el suelo que corresponde al centro de la dirección i
        const a = i * Math.PI / 4, xp = -Math.sin(a), zp = Math.cos(a);
        const rx = Math.cos(camTheta), rz = -Math.sin(camTheta), tx = Math.sin(camTheta), tz = Math.cos(camTheta);
        return Math.atan2(xp * rz + zp * tz, xp * rx + zp * tx);
      },
      update(dt, p, camTheta, camThetaTarget) {
        st.time += dt; st.dt = dt;
        // visor de animaciones (animviewer.js): animación, dirección y frame fijados a mano
        if (this.view) { const v = this.view; st.dir = v.dir; st.anim = v.anim; st.frame = v.f; st.settle = null; st.fi = null; this.place(p, camTheta, v.anim, v.f); return; }
        const H = W.CHAR_H, walkV = p.walkV;
        // --- acciones de combate (fighter.js): la animación y el frame los decide la máquina de estados ---
        const act = p.fighter && p.fighter.act;
        if (act) {
          const th = camThetaTarget;
          if (st.lastTheta !== undefined && st.lastTheta !== th) {
            const steps = Math.round((th - st.lastTheta) / (Math.PI / 2));
            st.dir = ((st.dir + steps * 2) % 8 + 8) % 8;
          }
          st.lastTheta = th;
          st.dirWanted = this.dirFromHeading(p.heading, th);
          // al girar para golpear, pasa por las intermedias pero más deprisa (25 ms)
          if (st.dir !== st.dirWanted && st.time - st.lastStep >= 0.025) {
            const delta = ((st.dirWanted - st.dir) % 8 + 8) % 8;
            st.dir = (st.dir + (delta <= 4 ? 1 : 7)) % 8; st.lastStep = st.time;
          }
          // act.sheet: hoja que la pinta (Duelo 3: la propia o el sustituto de W.DUEL)
          let an = act.name === "stun" ? "hit" : (act.sheet || act.name), fr = Math.max(0, Math.min(5, act.f | 0));
          // pose compuesta (golpes peligrosos del autómata: frames de otras hojas)
          if (act.show && act.show[fr]) { an = act.show[fr][0]; fr = act.show[fr][1]; }
          st.anim = an; st.frame = fr; st.settle = null; st.wfx = null; st.fi = null; st.idleT = 0;
          st.lastHeading = p.heading;
          if (W.debugFrame) { st.dir = W.debugFrame.dir; }
          this.place(p, camTheta, an, fr);
          return;
        }
        // --- animación -------------------------------------------------------
        let anim;
        if (p.jump) anim = "jump";
        else {
          const runUp = walkV * 1.35, runDown = walkV * 1.18, walkUp = 0.07 * H, walkDown = 0.035 * H;
          if (st.anim === "run") anim = p.speed > runDown ? "run" : (p.speed > walkDown ? "walk" : "idle");
          else if (st.anim === "walk") anim = p.speed > runUp ? "run" : (p.speed > walkDown ? "walk" : "idle");
          else anim = p.speed > runUp ? "run" : (p.speed > walkUp ? "walk" : "idle");
          if (anim === "idle" && p.path.length && p.speed > 0.01 * H) anim = "walk";
        }
        if (anim !== st.anim) {
          // inercia: al pararse, 1-2 frames de asentamiento (frame de contacto + el cuerpo se hunde)
          if (anim === "idle" && (st.anim === "walk" || st.anim === "run") && W.FX.inertia) {
            st.settle = { t: 0, from: st.anim, frame: (FEETS && FEETS[st.anim + "_" + meta.directions[st.dir]] ? FEETS[st.anim + "_" + meta.directions[st.dir]].contact.indexOf(1) : 0) };
            st.dipT = 0; st.dipA = 2.4;
          }
          if (anim === "idle") st.idleT = 0; st.anim = anim;
        }
        if (anim === "walk" || anim === "run") {
          let stride = W.walkStride(W.walkMode, st.dir, anim) * H;
          const lp = W.FX.anchor && W.locoParams ? W.locoParams(anim, st.dir, this) : null;
          if (lp) stride = (anim === "walk" ? lp.v : p.runV) * 6 / lp.fps;     // u por ciclo a cadencia fija
          st.phase = (st.phase + (p.realSpeed || p.speed) * dt / stride) % 1;
        } else if (anim === "idle") st.idleT += dt;
        // velocidad angular del rumbo (la túnica reacciona a los giros)
        let dh = p.heading - (st.lastHeading == null ? p.heading : st.lastHeading);
        while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        st.turnRate = dh / Math.max(dt, 1e-3); st.lastHeading = p.heading;
        // --- dirección (histéresis + paso por intermedias cada 40 ms) --------------
        // se usa el azimut OBJETIVO de la cámara: al girar 90° el índice salta 2 posiciones
        const moving = p.speed > 0.01 * H || (p.jump && p.jump.forward) || p.path.length;
        const th = camThetaTarget;
        if (moving) {
          const cur = this.dirCenterHeading(st.dirWanted, th);
          let d = p.heading - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          if (Math.abs(d) > Math.PI / 8 + 8 * Math.PI / 180) st.dirWanted = this.dirFromHeading(p.heading, th);
        } else {
          st.dirWanted = this.dirFromHeading(p.heading, th);
        }
        if (st.lastTheta !== undefined && st.lastTheta !== th) {
          // giro de cámara: desplaza el índice mostrado de golpe (2 posiciones por 90°)
          const steps = Math.round((th - st.lastTheta) / (Math.PI / 2));
          st.dir = ((st.dir + steps * 2) % 8 + 8) % 8;
        }
        st.lastTheta = th;
        if (st.dir !== st.dirWanted && st.time - st.lastStep >= 0.04) {
          const delta = ((st.dirWanted - st.dir) % 8 + 8) % 8;
          st.dir = (st.dir + (delta <= 4 ? 1 : 7)) % 8;
          st.lastStep = st.time;
        }
        // --- frame -----------------------------------------------------------------
        let f;
        if (anim === "jump") {
          // hoja jump: 0 preparación, 1 impulso, 2-3 vuelo, 4 caída, 5 aterrizaje (el salto por el terreno trae
          // sus propios tiempos: preparación más marcada y vuelo según el desnivel)
          const J = p.jump, P = W.PLAYER_PARAMS, t = J.t, a0 = J.prep != null ? J.prep : P.jumpPrep, A = J.air != null ? J.air : P.jumpAir;
          if (t < a0) f = 0;
          else if (t < a0 + A && !(J.terrain && J.landed)) { const u = (t - a0) / A; f = u < 0.2 ? 1 : u < 0.45 ? 2 : u < 0.72 ? 3 : 4; }
          else f = 5;
        } else if (anim === "idle" && st.settle && st.settle.t < 0.16) {
          st.settle.t += dt;
          this.place(p, camTheta, st.settle.from, Math.max(0, st.settle.frame));
          return;
        } else if (anim === "idle") { st.settle = null; f = Math.floor(st.idleT * meta.animations.idle.fps) % NF; }
        else if (W.FX.anchor && W.locoParams && W.locoParams(anim, st.dir, this)) {
          const w = W.locoParams(anim, st.dir, this).weights; let acc = 0; f = 5;
          for (let i = 0; i < 6; i++) { acc += w[i]; if (st.phase < acc) { f = i; st.fi = { f: i, u: (st.phase - (acc - w[i])) / w[i] }; break; } }
          if (!st.fi || st.fi.f !== f) st.fi = { f, u: 0.5 };
        }
        else if (anim === "walk") { st.fi = W.walkFrameFor(W.walkMode, st.dir, st.phase); f = st.fi.f; }
        else f = Math.floor(st.phase * NF) % NF;
        if (W.debugFrame) { anim = W.debugFrame.anim; st.dir = W.debugFrame.dir; f = W.debugFrame.f; st.anim = anim; st.fi = { f, u: 0.5 }; st.dipT = null; st.settle = null; }
        st.frame = f;
        // efectos del walk (bob, balanceo, squash, túnica) según la variante
        if (anim === "walk" && !opts.feet) {
          const k = Math.min(1, p.speed / Math.max(p.walkV * 0.6, 1e-3));
          st.wfx = W.walkFx(W.walkMode, st.dir, st.phase, st.fi, dt, st.wst || (st.wst = {}), k, st.turnRate);
        } else st.wfx = null;
        this.place(p, camTheta, anim, f);
      },
      drawSticker(p, yUp, r) {
        const dpr = Math.min(window.devicePixelRatio || 1, 3), wrapEl = sticker.parentElement;
        const Wd = Math.round(wrapEl.clientWidth * dpr), Hd = Math.round(wrapEl.clientHeight * dpr);
        if (sticker.width !== Wd || sticker.height !== Hd) { sticker.width = Wd; sticker.height = Hd; }
        sticker.style.display = "block";
        const g = sticker.getContext("2d");
        g.clearRect(0, 0, Wd, Hd);
        const a = W.toScreen(p.x, p.y + yUp, p.z), b = W.toScreen(p.x, p.y + yUp + W.CHAR_H, p.z);
        const scrH = Math.abs(a[1] - b[1]) * dpr;   // alto en pantalla de CHAR_H de pie (ya proyectado)
        const s = scrH / STAND;
        g.imageSmoothingEnabled = true;
        g.drawImage(stickerImg, r[0] * AW, r[1] * AH, FW, FH, a[0] * dpr - PVX * s, a[1] * dpr - PVY * s, FW * s, FH * s);
      },
      place(p, camTheta, anim, f) {
        const S = useSet(CANIMS.indexOf(anim) >= 0 ? "combat" : "base");
        const FW = S.FW, FH = S.FH, PVX = S.PVX, PVY = S.PVY;
        const r = this.frameRect(anim, st.dir, f);
        uniforms.uRect.value.set(r[0], r[1], r[2], r[3]);
        let lift = 0, hgt = 0;
        if (anim === "jump") { hgt = p.jump.h; lift = (meta.foot_lift["jump_" + meta.directions[st.dir]][f] || 0) * unitsV; }
        let bob = 0, sway = 0, wsx = 1, wsy = 1;
        // hundimiento en el contacto (curva de impacto: baja ~70 ms y se recupera)
        let dip = 0;
        if (W.FX.impact && st.dipT != null) {
          st.dipT += st.dt || 0;
          const tau = 0.07, x = st.dipT / tau;
          dip = st.dipA * x * Math.exp(1 - x);                   // píxeles de render
          if (st.dipT > 0.5) st.dipT = null;
        }
        st.dipPx = dip;
        // inclinación leve hacia la dirección de avance al correr (en pantalla)
        let lean = 0;
        if (W.FX.inertia && anim === "run") {
          const hx = Math.cos(p.heading), hz = Math.sin(p.heading);
          const xp = hx * Math.cos(camTheta) - hz * Math.sin(camTheta);
          lean = 0.045 * xp * Math.min(1, p.speed / Math.max(p.runV, 1e-3));
        }
        st.lean = (st.lean || 0) + (lean - (st.lean || 0)) * Math.min(1, (st.dt || 0) * 8);
        // rebote por código (Duelo 3: desequilibrado sin hoja propia, el cuerpo se echa atrás y vuelve)
        const fa = p.fighter && p.fighter.act;
        uniforms.uBody.value.z = st.lean + (fa && fa.bounceLean ? fa.bounceLean : 0);
        uniforms.uBody.value.x = W.wpp ? -dip * W.wpp / unitsH / FH : 0;
        if (anim === "run" && !W.FX.impact) bob = 0.026 * W.CHAR_H * Math.pow(Math.sin(st.phase * 2 * Math.PI), 2);
        // esquiva y golpe recibido: el desplazamiento pintado de los pies se compensa (el cuerpo lo mueve el
        // código), así la posición del personaje coincide siempre con sus pies
        if (cmeta && (anim === "dodge" || anim === "hit")) {
          const rm = cmeta.root_motion_px[anim + "_" + meta.directions[st.dir]];
          if (rm) sway -= (rm[f] - rm[0]) * unitsH;
        }
        if (anim === "walk" && st.wfx) { bob = W.FX.impact ? 0 : st.wfx.bob * W.CHAR_H; sway = st.wfx.sway * W.CHAR_H; wsx = st.wfx.sx; wsy = st.wfx.sy;
          uniforms.uWarp.value.set(st.wfx.warpX, st.wfx.warpY, 0.5, 0.86); }
        else uniforms.uWarp.value.set(0, 0, 0.5, 0.86);
        const sq = Math.sin(p.squash * Math.PI) * (p.squash > 0 ? 1 : 0);
        const cr = (p.fighter && p.fighter.act && p.fighter.act.crouch) || 0;     // agachado (barrido bajo)
        const sx = (1 + 0.06 * sq) * wsx * (1 + 0.3 * cr), sy = (1 - 0.09 * sq) * wsy * (1 - cr);
        const w = FW * unitsH * sx, h = FH * unitsV * sy;
        // hacia la cámara 0.15 para no pelearse con el suelo en los pies
        const tx = Math.sin(camTheta), tz = Math.cos(camTheta);
        mesh.rotation.set(0, camTheta, 0);
        mesh.scale.set(w, h, 1);
        const rx = Math.cos(camTheta), rz = -Math.sin(camTheta);
        const ox = -PVX / FW * w, oy = -(FH - PVY) / FH * h;   // esquina inferior izquierda respecto al pivote
        // pie exactamente sobre la superficie: el píxel opaco más bajo de los frames apoyados va a la línea del suelo
        let corr = 0;
        uniforms.uQuant.value = W.FX.matter ? 1 : 0; uniforms.uOutline.value = W.FX.matter ? 1 : 0;
        if (W.FX.matter && FEETS) {
          const fr = FEETS[anim + "_" + meta.directions[st.dir]];
          if (fr) {
            const grounded = anim === "idle" || anim === "walk" || (fr.contact && fr.contact[f]) || (anim === "jump" && (f === 0 || f === 5));
            if (grounded && fr.frames[f]) corr = fr.frames[f].lowest * (meta.scale_from_full || 0.5) * unitsV * sy;
          }
        }
        st.footCorr = corr;
        const baseY = p.y + hgt - lift + bob + oy + corr;
        mesh.position.set(p.x + rx * (ox + sway) + tx * 0.15, baseY, p.z + rz * (ox + sway) + tz * 0.15);
        st.hgt = hgt;
        // pies anclados: el pivote del sprite en el mundo y la deformación de la pierna apoyada
        if (this.anchor) {
          const base = { x: p.x + rx * sway + tx * 0.15, y: p.y + hgt - lift + bob + corr, z: p.z + rz * sway + tz * 0.15, gx: p.x + rx * sway, gz: p.z + rz * sway };
          const wv = this.anchor.update(st.dt || 0, p, anim, st.dir, f, camTheta, base, sx, sy);
          uniforms.uFootA.value.fromArray(wv.A); uniforms.uFootB.value.fromArray(wv.B);
        }
        // proyector de sombra: mismo tamaño, girado de cara al sol
        const sd = W.SUN_DIR, sa = Math.atan2(sd.x, sd.z);
        const srx = Math.cos(sa), srz = -Math.sin(sa);
        caster.rotation.set(0, sa, 0);
        caster.scale.set(w, h, 1);
        const an = this.anchor && this.anchor.st.anchor;
        if (W.FX.contact && an && !p.jump) {
          // la sombra NACE en el pie apoyado: el plano gira alrededor de esa bota
          const px0 = -PVX / FW * w;
          caster.position.set(an.wx - srx * an.fx * unitsH * sx + srx * px0, baseY, an.wz - srz * an.fx * unitsH * sx + srz * px0);
        } else caster.position.set(p.x + srx * ox, baseY, p.z + srz * ox);
        uniforms.uSunW.value.copy(sd);
        // contacto: se encoge y aclara con la altura del salto
        // (salto por el terreno: la altura sobre el suelo que hay debajo, que cambia al pasar el borde)
        const airH = p.jump && p.jump.terrain ? Math.max(0, p.y + hgt - p.ground) : hgt;
        const air = airH / W.CHAR_H, k = 1 / (1 + air * 2.2);
        blob.position.set(p.x, p.ground + 0.03, p.z);
        if (W.FX.contact) { blob.scale.set(0.7 * k, 1, 0.42 * k); blob.material.opacity = 0.32 * k; }
        else { blob.scale.set(0.95 * k, 1, 0.62 * k); blob.material.opacity = 0.75 * k; }
        // sombras de contacto por bota + oclusión en el sprite + rebote del color del suelo
        const ft = W.FX.contact && this.anchor ? this.anchor.anyFeet(anim, st.dir, f) : null;
        boots.forEach((m) => { m.visible = !!ft && this.integrated; });
        uniforms.uAO.value.z = W.FX.contact ? 0.45 : 0;
        uniforms.uBounce.value = W.FX.contact ? 0.35 : 0;
        if (W.FX.contact) {
          const ti = W.tileIndex(p.x, p.z);
          if (ti >= 0) uniforms.uGround.value.setHex(W.T.col[ti]);
        }
        if (ft) {
          const ref = Math.max(ft[0].y, ft[1].y);
          const EL = W.CAM_EL, gx = p.x + rx * sway, gz = p.z + rz * sway;
          ft.forEach((q, i) => {
            let fx = q.x, lifted = Math.max(0, ref - q.y) * unitsV + hgt;
            let X = gx + rx * fx * unitsH * sx, Z = gz + rz * fx * unitsH * sx;
            // la bota anclada: su sombra donde está clavada
            if (an && !p.jump && Math.hypot(q.x - an.fx, q.y - an.fy) < 0.5) { X = an.wx; Z = an.wz; lifted = 0; }
            else if (q.y > ref - 1.5) { X += tx * (q.y - ref) * unitsH / Math.sin(EL); Z += tz * (q.y - ref) * unitsH / Math.sin(EL); }
            const kk = 1 / (1 + lifted * 7);
            const m = boots[i];
            m.position.set(X, p.ground + 0.035, Z);
            m.rotation.set(0, camTheta, 0);
            m.scale.set(0.34 * kk, 1, 0.17 * kk);
            m.material.opacity = 0.92 * kk * kk;
          });
          if (ft[0].x === ft[1].x && ft[0].y === ft[1].y) boots[1].visible = false;
        }
        ghost.position.copy(mesh.position); ghost.rotation.copy(mesh.rotation); ghost.scale.copy(mesh.scale);
        mesh.visible = this.integrated && !W.hideChar; caster.visible = this.integrated; blob.visible = this.integrated; ghost.visible = this.integrated;
        if (!this.integrated) this.drawSticker(p, hgt - lift + bob, r);
        else if (sticker.style.display !== "none") sticker.style.display = "none";
      },
    };
    ch.anchor = W.makeFootAnchor ? W.makeFootAnchor(ch) : null;
    return ch;
  };
})();
