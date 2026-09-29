// character.js — el personaje como sprite plano vertical orientado a cámara.
// Anima con los atlas de pixel_char (idle/walk/run/jump × 8 direcciones × 6 frames).
// La dirección del sprite se calcula respecto al azimut de la cámara, así que al girar
// la cámara 90° el índice de dirección se desplaza 2 posiciones.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const ANIMS = ["idle", "walk", "run", "jump"];
  const NF = 6;

  W.makeCharacter = function (scene, tex, meta) {
    const [FW, FH] = meta.frame_size, [PVX, PVY] = meta.pivot, [AW, AH] = meta.atlas_size;
    const COLS = meta.columns, STAND = meta.standing_height_px;
    const unitsV = W.CHAR_H / STAND;                         // unidades de mundo por texel (vertical del plano)
    const unitsH = unitsV * Math.cos(W.CAM_EL);              // horizontal: el plano vertical se ve acortado por cos(EL)
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0.5, 0);                              // origen en la esquina inferior izquierda
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
      uColor: { value: null }, uNormal: { value: null }, uSpec: { value: null },
      uRect: { value: new THREE.Vector4() }, uSunW: { value: new THREE.Vector3() },
      uNormalAmt: { value: 1 }, uGrade: { value: 0.6 }, uGain: { value: 1.12 },
      uWarp: { value: new THREE.Vector4() },               // túnica: (amp x, amp y, belt v, hem v) — etapa 3
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
      uniform vec4 uRect, uWarp;
      uniform float uNormalAmt, uGrade, uGain;
      varying vec2 vUv; varying vec2 vQ; varying vec3 vViewPos;
      void main() {
        // deformación de la túnica (etapa 3): desplaza el muestreo en la franja cintura-bajo
        vec2 uv = vUv;
        float vv = 1.0 - vQ.y;
        float band = smoothstep(uWarp.z, uWarp.z + 0.12, vv) * (1.0 - smoothstep(uWarp.w - 0.08, uWarp.w, vv));
        uv.x -= uWarp.x * band * band * uRect.z;
        uv.y -= uWarp.y * band * uRect.w;
        vec4 c = texture2D(uColor, uv);
        if (c.a < 0.5) discard;                                   // alpha test: escribe profundidad limpia
        vec3 n = normalize(texture2D(uNormal, uv).xyz * 2.0 - 1.0);
        n = normalize(mix(vec3(0.0, 0.0, 1.0), n, uNormalAmt));   // normal en espacio de vista (+y arriba)
        float sm = texture2D(uSpec, uv).r;
        vec3 V = vec3(0.0, 0.0, 1.0);                             // cámara ortográfica
        float shin = mix(8.0, 56.0, sm);
        vec3 diff = vec3(0.0), spec = vec3(0.0), rim = vec3(0.0);
        #if NUM_HEMI_LIGHTS > 0
          float hl = dot(n, hemisphereLights[0].direction) * 0.5 + 0.5;
          diff += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, hl);
        #endif
        #if NUM_DIR_LIGHTS > 0
          float sh = 1.0;
          #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
            sh = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
          #endif
          vec3 L = directionalLights[0].direction;
          float w = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0);
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
        vec3 col = c.rgb * diffT * uGain + (spec + rim) * 0.5;
        // ajuste hacia la paleta del mundo: medios algo más fríos, sombras hacia violeta;
        // negros y altas luces (crema, naranja) se mantienen
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float mid = smoothstep(0.05, 0.3, lum) * (1.0 - smoothstep(0.55, 0.9, lum));
        col = mix(col, col * vec3(0.86, 1.0, 1.1), 0.35 * mid * uGrade);
        col += vec3(0.018, 0.0, 0.03) * (1.0 - smoothstep(0.0, 0.22, lum)) * uGrade;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS, lights: true, fog: true });
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
      fragmentShader: `uniform sampler2D uColor; varying vec2 vUv;
        void main(){ vec4 c = texture2D(uColor, vUv); if (c.a < 0.5) discard;
          gl_FragColor = vec4(0.5, 0.85, 1.0, 0.42); }`,
      depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth, transparent: true,
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

    // Versión "sin integrar" para comparar: pegatina 2D encima del canvas (sin luz, sin
    // sombra, sin profundidad, a resolución completa)
    const sticker = document.createElement("canvas");
    Object.assign(sticker.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", display: "none" });
    document.getElementById("wrap").appendChild(sticker);
    const stickerImg = tex.color.image;

    const st = { anim: "idle", dir: 0, dirWanted: 0, lastStep: 0, phase: 0, idleT: 0, time: 0, frame: 0, prevAnim: "idle" };
    const ch = {
      mesh, mat, uniforms, st, meta, unitsV, unitsH, caster, blob, sticker, ghost, integrated: true,
      frameRect(anim, dir, f) {
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
        st.time += dt;
        const H = W.CHAR_H, walkV = p.walkV;
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
        if (anim !== st.anim) { if (anim === "idle") st.idleT = 0; st.anim = anim; }
        if (anim === "walk" || anim === "run") {
          const stride = W.walkStride(W.walkMode, st.dir, anim) * H;
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
          const J = p.jump, P = W.PLAYER_PARAMS, t = J.t;
          if (t < P.jumpPrep) f = 0;
          else if (t < P.jumpPrep + P.jumpAir) { const u = (t - P.jumpPrep) / P.jumpAir; f = u < 0.2 ? 1 : u < 0.45 ? 2 : u < 0.72 ? 3 : 4; }
          else f = 5;
        } else if (anim === "idle") f = Math.floor(st.idleT * meta.animations.idle.fps) % NF;
        else if (anim === "walk") { st.fi = W.walkFrameFor(W.walkMode, st.dir, st.phase); f = st.fi.f; }
        else f = Math.floor(st.phase * NF) % NF;
        st.frame = f;
        // efectos del walk (bob, balanceo, squash, túnica) según la variante
        if (anim === "walk") {
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
        const r = this.frameRect(anim, st.dir, f);
        uniforms.uRect.value.set(r[0], r[1], r[2], r[3]);
        let lift = 0, hgt = 0;
        if (anim === "jump") { hgt = p.jump.h; lift = (meta.foot_lift["jump_" + meta.directions[st.dir]][f] || 0) * unitsV; }
        let bob = 0, sway = 0, wsx = 1, wsy = 1;
        if (anim === "run") bob = 0.026 * W.CHAR_H * Math.pow(Math.sin(st.phase * 2 * Math.PI), 2);
        if (anim === "walk" && st.wfx) { bob = st.wfx.bob * W.CHAR_H; sway = st.wfx.sway * W.CHAR_H; wsx = st.wfx.sx; wsy = st.wfx.sy;
          uniforms.uWarp.value.set(st.wfx.warpX, st.wfx.warpY, 0.5, 0.86); }
        else uniforms.uWarp.value.set(0, 0, 0.5, 0.86);
        const sq = Math.sin(p.squash * Math.PI) * (p.squash > 0 ? 1 : 0);
        const sx = (1 + 0.06 * sq) * wsx, sy = (1 - 0.09 * sq) * wsy;
        const w = FW * unitsH * sx, h = FH * unitsV * sy;
        // hacia la cámara 0.15 para no pelearse con el suelo en los pies
        const tx = Math.sin(camTheta), tz = Math.cos(camTheta);
        mesh.rotation.set(0, camTheta, 0);
        mesh.scale.set(w, h, 1);
        const rx = Math.cos(camTheta), rz = -Math.sin(camTheta);
        const ox = -PVX / FW * w, oy = -(FH - PVY) / FH * h;   // esquina inferior izquierda respecto al pivote
        const baseY = p.y + hgt - lift + bob + oy;
        mesh.position.set(p.x + rx * (ox + sway) + tx * 0.15, baseY, p.z + rz * (ox + sway) + tz * 0.15);
        st.hgt = hgt;
        // proyector de sombra: mismo tamaño, girado de cara al sol
        const sd = W.SUN_DIR, sa = Math.atan2(sd.x, sd.z);
        const srx = Math.cos(sa), srz = -Math.sin(sa);
        caster.rotation.set(0, sa, 0);
        caster.scale.set(w, h, 1);
        caster.position.set(p.x + srx * ox, baseY, p.z + srz * ox);
        uniforms.uSunW.value.copy(sd);
        // contacto: se encoge y aclara con la altura del salto
        const air = hgt / W.CHAR_H, k = 1 / (1 + air * 2.2);
        blob.position.set(p.x, p.ground + 0.03, p.z);
        blob.scale.set(0.95 * k, 1, 0.62 * k);
        blob.material.opacity = 0.75 * k;
        ghost.position.copy(mesh.position); ghost.rotation.copy(mesh.rotation); ghost.scale.copy(mesh.scale);
        mesh.visible = this.integrated; caster.visible = this.integrated; blob.visible = this.integrated; ghost.visible = this.integrated;
        if (!this.integrated) this.drawSticker(p, hgt - lift + bob, r);
        else if (sticker.style.display !== "none") sticker.style.display = "none";
      },
    };
    return ch;
  };
})();
