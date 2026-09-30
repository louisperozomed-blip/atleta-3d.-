// player.js — movimiento del personaje en el mundo: coordenadas continuas, aceleración y
// frenado suaves con dt, giro limitado, colisiones con la rejilla (obstáculos, agua,
// desniveles > 0.5) deslizando por la pared, altura del terreno suavizada (escalones) y salto.
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const { clamp, smoothstep } = W;

  W.CHAR_H = 1.7;                      // alto del personaje de pie en unidades del mundo
  const P = (W.PLAYER_PARAMS = {
    walkSpeed: 1.05, runSpeed: 2.7,     // en alturas/s (como la demo anterior)
    accel: 5.0, decel: 4.2,
    turnRate: 11.0,
    runDist: 4.0, walkBackDist: 2.2,
    radius: 0.28,
    jumpPrep: 0.07, jumpAir: 0.62, jumpLand: 0.15, jumpHeight: 0.5,
    stepSmooth: 10, stepSmoothFoot: 30,                     // rapidez del ajuste vertical al subir/bajar escalones
  });

  class Player {
    constructor(x, z) {
      this.x = x; this.z = z;
      this.ground = W.heightAt(x, z);
      this.y = this.ground;              // altura de los pies (suavizada)
      this.heading = Math.PI / 2;        // ángulo en el suelo: atan2(dz, dx)
      this.speed = 0;
      this.path = [];                    // puntos de paso [{x,z}]
      this.gait = "walk";
      this.following = false;
      this.jump = null;
      this.squash = 0;
      this.startDelay = 0;
      this.events = [];                  // "land", "step", "splash" para los efectos
      this.moved = 0;                    // distancia recorrida (fase de la animación)
    }
    get H() { return W.CHAR_H; }
    get walkV() {
      let v = P.walkSpeed;
      // pies anclados: la velocidad de marcha sale de los pies (u/s por dirección)
      const chr = this.ch || W.character;
      if (W.FX && W.FX.anchor && W.locoParams && chr) {
        const lp = W.locoParams("walk", chr.st.dir);
        if (lp) return lp.v * (W.speedMul || 1);
      }
      // variante E: la velocidad se ajusta a la zancada medida de la dirección que se ve
      if (W.walkMode === "E" && W.WALK_DATA && chr) {
        const d = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"][chr.st.dir];
        v = Math.min(1.1, Math.max(0.75, W.WALK_DATA.stride[d] * 1.8));
      }
      return v * W.CHAR_H * (W.speedMul || 1);
    }
    get runV() { return P.runSpeed * W.CHAR_H * (W.speedMul || 1); }
    remaining() {
      let d = 0, px = this.x, pz = this.z;
      for (const q of this.path) { d += Math.hypot(q.x - px, q.z - pz); px = q.x; pz = q.z; }
      return d;
    }
    setPath(pts, opts) {
      this.replans = 0;
      const wasIdle = !this.path.length && this.speed < 0.05 * W.CHAR_H && !this.jump;
      this.path = pts.slice();
      const d = this.remaining();
      if (!this.following) this.gait = d > P.runDist * W.CHAR_H ? "run" : "walk";
      if (wasIdle && !(opts && opts.noDelay)) this.startDelay = 0.1;
      return wasIdle;
    }
    stop() { this.path = []; }
    doJump() {
      if (this.jump || (this.fighter && (this.fighter.act || !this.fighter.alive))) return;
      const moving = this.speed > 0.2 * this.walkV;
      this.jump = { t: 0, forward: moving, v: moving ? Math.max(this.speed, this.walkV) : 0, landed: false, h: 0 };
      if (!moving) this.speed = 0;
    }
    // intenta moverse (dx, dz); desliza por la pared si choca
    tryMove(dx, dz) {
      const r = P.radius;
      const ok = (x, z) => {
        // sonda del borde del cuerpo a lo largo de la dirección real del movimiento (antes, con el signo de
        // cada componente, un residuo de 1e-17 en x lanzaba la sonda hacia un acantilado al andar en z)
        const mx = x - this.x, mz = z - this.z, ml = Math.hypot(mx, mz) || 1;
        const hx = mx / ml * r, hz = mz / ml * r;
        return W.canStep(this.x, this.z, x + hx, z + hz) && W.canStep(this.x, this.z, x, z);
      };
      let nx = this.x + dx, nz = this.z + dz;
      if (ok(nx, nz)) { this.x = nx; this.z = nz; return true; }
      if (Math.abs(dx) > 1e-5 && ok(this.x + dx, this.z)) { this.x += dx; return false; }
      if (Math.abs(dz) > 1e-5 && ok(this.x, this.z + dz)) { this.z += dz; return false; }
      return false;
    }
    update(dt) {
      const H = W.CHAR_H, walkV = this.walkV, runV = this.runV;
      let accel = P.accel * H * (W.speedMul || 1);
      const decel = P.decel * H * (W.speedMul || 1);
      // inercia: arranque más pesado, llega a la velocidad de la marcha en ~0.25 s
      if (W.FX && W.FX.inertia) accel = (this.gait === "run" ? runV : walkV) / 0.25;
      const x0 = this.x, z0 = this.z;
      if (this.jump) {
        const J = this.jump;
        J.t += dt;
        const a0 = P.jumpPrep, a1 = P.jumpPrep + P.jumpAir;
        if (J.t >= a0 && J.t < a1) {
          const u = (J.t - a0) / P.jumpAir;
          J.h = 4 * u * (1 - u) * P.jumpHeight * H;
          this.tryMove(Math.cos(this.heading) * J.v * dt, Math.sin(this.heading) * J.v * dt);
        } else if (J.t >= a1 && !J.landed) {
          J.landed = true; J.h = 0; this.squash = 1;
          this.speed = J.forward ? J.v * 0.65 : 0;
          this.events.push({ type: "land", x: this.x, y: this.y, z: this.z });
        }
        if (J.t >= a1 + P.jumpLand) this.jump = null;
      } else if (this.path.length) {
        let q = this.path[0];
        let dx = q.x - this.x, dz = q.z - this.z, d = Math.hypot(dx, dz);
        // pasa al siguiente punto de paso cuando está cerca (no frena en los intermedios)
        while (this.path.length > 1 && d < 0.35) { this.path.shift(); q = this.path[0]; dx = q.x - this.x; dz = q.z - this.z; d = Math.hypot(dx, dz); }
        const rest = this.remaining();
        if (this.following) {
          if (rest > 1.2 * H) this.gait = "run"; else if (rest < 0.7 * H) this.gait = "walk";
        } else if (this.gait === "run" && rest < P.walkBackDist * H) this.gait = "walk";
        const arriveR = this.following ? 0.18 * H : 0.004 * H;
        let vWanted = Math.min(this.gait === "run" ? runV : walkV, Math.sqrt(2 * decel * Math.max(rest - arriveR, 0)));
        if (this.startDelay > 0) { this.startDelay -= dt; vWanted = 0; }
        if (d > 1e-4) {
          const want = Math.atan2(dz, dx);
          let diff = want - this.heading; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
          const mt = P.turnRate * dt;
          this.heading += clamp(diff, -mt, mt);
          if (Math.abs(diff) > 1.6) vWanted *= 0.35; else if (Math.abs(diff) > 0.8) vWanted *= 0.7;
        }
        this.speed += clamp(vWanted - this.speed, -decel * 1.6 * dt, accel * dt);
        this.speed = Math.max(0, this.speed);
        let step = Math.min(this.speed * dt, d);
        this.tryMove(Math.cos(this.heading) * step, Math.sin(this.heading) * step);
        // atasco = no acercarse al punto de paso actual durante 0.45 s (deslizarse a lo largo de un borde
        // mientras avanza no lo es: antes contaba como atasco y a los 3 re-planeos se rendía a medio camino)
        const dq = Math.hypot(q.x - this.x, q.z - this.z);
        if (this._wp !== q || this._bestD == null) { this._wp = q; this._bestD = dq; this.stuck = 0; }
        else if (dq < this._bestD - 0.015) { this._bestD = dq; this.stuck = 0; }
        else if (step > 0) this.stuck = (this.stuck || 0) + dt;
        if (this.stuck > 0.45) {
          // atascado (al cortar una esquina): re-planifica desde aquí hasta el destino; tras 3 intentos se rinde
          this.stuck = 0; this._bestD = null;
          const goal = this.path[this.path.length - 1];
          this.replans = (this.replans || 0) + 1;
          if (this.replans <= 3 && W.findPath) {
            // al atascarse, camino sin suavizar: los centros de celda de A* ya respetan desniveles y esquinas
            const np = W.findPath(this.x, this.z, goal.x, goal.z, undefined, { raw: true });
            if (np.length) { this.path = np; this.speed *= 0.5; } else this.path = [];
          } else { this.path = []; }
        }
        if (this.path.length === 1 && !this.following && Math.hypot(q.x - this.x, q.z - this.z) <= arriveR + 1e-3 && this.speed < 0.12 * walkV) {
          if (W.canStep(this.x, this.z, q.x, q.z)) { this.x = q.x; this.z = q.z; }
          this.path = []; this.speed = 0;
        }
      } else {
        this.speed = Math.max(0, this.speed - decel * 1.6 * dt);
        if (this.speed > 0) this.tryMove(Math.cos(this.heading) * this.speed * dt, Math.sin(this.heading) * this.speed * dt);
      }
      const dist = Math.hypot(this.x - x0, this.z - z0);
      this.moved += dist;
      this.realSpeed = dist / Math.max(dt, 1e-4);
      // altura del cuerpo: la del suelo bajo el pie APOYADO (feet.js); sin apoyo, la del suelo bajo el centro.
      // Al subir o bajar un escalón el cuerpo cambia de nivel cuando el apoyo pasa al pie del otro nivel,
      // con un ajuste corto (~0.1 s) en vez de ir flotando o hundido detrás del centro.
      this.ground = W.heightAt(this.x, this.z);
      const chr = this.ch || W.character;
      const an = W.FX && W.FX.anchor && !this.jump && chr && chr.anchor && chr.anchor.st.anchor;
      let target = this.ground;
      if (an) {
        // solo si el pie está en el nivel de delante o de detrás (cruzando el escalón) o en el mismo: andando junto al
        // borde de un desnivel, una bota que sobresale no hace bajar el cuerpo
        const c = Math.cos(this.heading) * 0.35, s = Math.sin(this.heading) * 0.35;
        const hf = W.heightAt(an.px, an.pz), ha = W.heightAt(this.x + c, this.z + s), hb = W.heightAt(this.x - c, this.z - s);
        if (Math.abs(hf - this.ground) <= W.MAX_STEP + 1e-3 && (hf === this.ground || hf === ha || hf === hb)) target = hf;
        // subiendo: la próxima bota se apoyará en el escalón dentro de < 0.12 s → el cuerpo sube ya (el pie
        // de atrás acompaña: es el impulso) y al apoyarse la bota ya está a la altura del escalón
        const nx = chr.anchor.st.next;
        if (nx && nx.t < 0.12 && nx.h > target && nx.h - this.ground <= W.MAX_STEP + 1e-3 && nx.h === ha) target = nx.h;
      }
      // bajando, el ajuste es más rápido (cae al apoyarse, sin quedarse flotando)
      const k = 1 - Math.exp(-dt * (an ? (target < this.y ? P.stepSmoothFoot * 2 : P.stepSmoothFoot) : P.stepSmooth));
      this.y += (target - this.y) * k;
      if (Math.abs(target - this.y) < 1e-3) this.y = target;
      this.squash = Math.max(0, this.squash - dt / 0.16);
      // eventos: pisadas en charcas
      const kd = W.kindAt(this.x, this.z);
      this.inWater = kd === W.K.PUDDLE;
      return dist;
    }
  }
  W.Player = Player;
})();
