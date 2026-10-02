// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/character.js (EXTRACTO)
// Elección de animación (idle/walk/run/jump, con histéresis de velocidad) y DIRECCIÓN del sprite (8 sectores, histéresis
// de ~30,5°, paso por las intermedias cada 40 ms; 25 ms en acciones; giro instantáneo con objetivo fijado). Extracto de
// los métodos de W.makeCharacter (dirFromHeading, dirCenterHeading, update).
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
const CharacterLogicExcerpt = {
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
          // objetivo fijado (target.js): al atacar, guardar o esquivar se gira AL INSTANTE (sin intermedias)
          if (this.snapDir) { st.dir = st.dirWanted; st.lastStep = st.time; this.snapDir = false; }
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
          // atlas sin run (relleno): siempre walk (acelerado si hace falta)
          if (anim === "run" && ANIMS.indexOf("run") < 0) anim = "walk";
        }
        if (anim === "jump" && ANIMS.indexOf("jump") < 0) anim = "idle";
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
      }
};
