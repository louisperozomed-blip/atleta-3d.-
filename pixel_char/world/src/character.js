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
    const uniforms = {
      uColor: { value: tex.color }, uRect: { value: new THREE.Vector4() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `varying vec2 vUv; uniform vec4 uRect;
        void main(){ vUv = vec2(uRect.x + uv.x*uRect.z, uRect.y + (1.0-uv.y)*uRect.w);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uColor; varying vec2 vUv;
        void main(){ vec4 c = texture2D(uColor, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, 1.0); }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const st = { anim: "idle", dir: 0, dirWanted: 0, lastStep: 0, phase: 0, idleT: 0, time: 0, frame: 0, prevAnim: "idle" };
    const ch = {
      mesh, mat, uniforms, st, meta, unitsV, unitsH,
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
          const stride = (anim === "run" ? W.STRIDE.run : W.STRIDE.walk) * H;
          st.phase = (st.phase + (p.realSpeed || p.speed) * dt / stride) % 1;
        } else if (anim === "idle") st.idleT += dt;
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
        else f = W.walkFrame ? W.walkFrame(anim, st.phase) : Math.floor(st.phase * NF) % NF;
        st.frame = f;
        this.place(p, camTheta, anim, f);
      },
      place(p, camTheta, anim, f) {
        const r = this.frameRect(anim, st.dir, f);
        uniforms.uRect.value.set(r[0], r[1], r[2], r[3]);
        let lift = 0, hgt = 0;
        if (anim === "jump") { hgt = p.jump.h; lift = (meta.foot_lift["jump_" + meta.directions[st.dir]][f] || 0) * unitsV; }
        let bob = 0;
        if (anim === "walk" || anim === "run") bob = (anim === "run" ? 0.026 : 0.011) * W.CHAR_H * Math.pow(Math.sin(st.phase * 2 * Math.PI), 2);
        const sq = Math.sin(p.squash * Math.PI) * (p.squash > 0 ? 1 : 0);
        const sx = 1 + 0.06 * sq, sy = 1 - 0.09 * sq;
        const w = FW * unitsH * sx, h = FH * unitsV * sy;
        // hacia la cámara 0.15 para no pelearse con el suelo en los pies
        const tx = Math.sin(camTheta), tz = Math.cos(camTheta);
        mesh.rotation.set(0, camTheta, 0);
        mesh.scale.set(w, h, 1);
        const rx = Math.cos(camTheta), rz = -Math.sin(camTheta);
        const ox = -PVX / FW * w, oy = -(FH - PVY) / FH * h;   // esquina inferior izquierda respecto al pivote
        const baseY = p.y + hgt - lift + bob + oy;
        mesh.position.set(p.x + rx * ox + tx * 0.15, baseY, p.z + rz * ox + tz * 0.15);
        st.hgt = hgt;
      },
    };
    return ch;
  };
  W.STRIDE = { walk: 0.72, run: 1.35 };                    // alturas por ciclo (etapa 3 lo mide)
})();
