// effects.js — post-proceso pixel art, cristal cósmico, agua, pool de luces puntuales,
// latido del árbol-corazón, esporas, ondas en charcas y polvo luminoso.
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  // ---------------------------------------------------------------------------
  // Post-proceso: la escena se pinta a baja resolución y se posteriza con dither
  // (igual que la referencia); el personaje se pinta en el mismo RT -> mismo píxel.
  // ---------------------------------------------------------------------------
  W.makePost = function () {
    const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const mat = new THREE.ShaderMaterial({
      uniforms: { tDiff: { value: rt.texture }, levels: { value: 16 }, on: { value: 1 } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: `uniform sampler2D tDiff;uniform float levels,on;varying vec2 vUv;
        float b2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
        float b4(vec2 a){return b2(.5*a)*.25+b2(a);}
        void main(){vec3 c=texture2D(tDiff,vUv).rgb;
          if(on>.5){float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,1.12);
            c=floor(c*levels+(b4(gl_FragCoord.xy)-.5)*.9+.5)/levels;}
          gl_FragColor=vec4(clamp(c,0.,1.),1.);}`,
      depthTest: false, depthWrite: false,
    });
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { rt, mat, scene, cam };
  };

  // ---------------------------------------------------------------------------
  // Cristal cósmico (shader de la referencia, adaptado a geometría fusionada:
  // el espacio local de cada cristal viaja en el atributo aLocal)
  // ---------------------------------------------------------------------------
  W.CU = { time: W.U.uTime, camDir: { value: new THREE.Vector3() }, lightDir: { value: new THREE.Vector3(4, 7, 6).normalize() } };
  W.makeCrystalMaterial = function () {
    return new THREE.ShaderMaterial({
      uniforms: W.CU, extensions: { derivatives: true }, fog: false,
      vertexShader: `attribute vec3 aLocal;uniform vec3 camDir;varying vec3 vLocal,vWorld,vViewL;
        void main(){vLocal=aLocal;vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vViewL=normalize(-camDir);
          gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `uniform float time;uniform vec3 camDir,lightDir;varying vec3 vLocal,vWorld,vViewL;
        float h(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
        float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
        float stars(vec3 p){vec3 c=floor(p),f=fract(p);vec3 r=vec3(h(c),h(c+17.3),h(c+41.7));
          float d=length(f-(.2+.6*r));float tw=.55+.45*sin(time*3.+r.x*40.);return step(.7,r.z)*smoothstep(.16,.0,d)*tw;}
        void main(){
          vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));vec3 V=-camDir;if(dot(N,V)<0.)N=-N;
          float ndv=max(dot(N,V),0.),fres=pow(1.-ndv,2.);
          vec3 flow=vec3(time*.03,time*.09,time*.05),col=vec3(0.);
          for(int i=0;i<3;i++){float fi=float(i);
            vec3 p=vLocal*9.-vViewL*(.25+fi*.7)*1.6+flow*(1.+fi*.6);
            float n=fbm(p*.8+fi*3.1);
            vec3 neb=mix(vec3(.10,.22,.95),vec3(.62,.22,1.),smoothstep(.4,.72,n));
            neb=mix(neb,vec3(.95,.7,1.),smoothstep(.72,.9,n));
            col+=neb*smoothstep(.38,.8,n)*(.75-fi*.18);
            col+=vec3(.9,.95,1.)*stars(p*2.4+fi*7.)*(1.4-fi*.35);}
          vec3 q=vLocal*6.+flow*2.5;float vein=pow(1.-abs(fbm(q)*2.-1.),16.);
          col+=vec3(.55,.85,1.)*vein*1.6;
          vec3 base=mix(vec3(.62,.72,1.),vec3(.9,.94,1.),ndv)*.42;
          col=base+col;
          col+=vec3(.2,.25,.35)*max(dot(N,lightDir),0.);
          col+=pow(max(dot(N,normalize(lightDir+V)),0.),70.)*vec3(1.);
          col+=vec3(.25,.55,1.)*fres*1.6;
          gl_FragColor=vec4(col,1.);}`,
    });
  };

  W.makeWaterMaterial = function () {
    const m = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x04262e, transparent: true, opacity: 0.78, shininess: 60, flatShading: true, depthWrite: false });
    return m;
  };

  // ---------------------------------------------------------------------------
  // Pool de luces puntuales: número fijo (no recompila shaders) asignado cada
  // frame a los emisores más cercanos al centro de la vista, con fundido.
  // ---------------------------------------------------------------------------
  W.LIGHT_POOL = 8;
  W.makeLightPool = function (scene) {
    const pool = [];
    for (let i = 0; i < W.LIGHT_POOL; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 6, 2);
      L.userData.cur = null;
      scene.add(L); pool.push(L);
    }
    return pool;
  };
  const _pick = [];
  W.updateLightPool = function (pool, cx, cz, radius, t, beat) {
    // elige los N emisores más cercanos (con prioridad al árbol-corazón)
    _pick.length = 0;
    for (const e of W.emitters) {
      const d = Math.hypot(e.x - cx, e.z - cz);
      if (d > radius + e.distance) continue;
      _pick.push([d - (e.beat ? 6 : 0), e]);
    }
    _pick.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < pool.length; i++) {
      const L = pool[i], p = _pick[i];
      if (!p) { L.intensity = 0; L.userData.cur = null; continue; }
      const e = p[1];
      if (L.userData.cur !== e) { L.userData.cur = e; L.userData.fade = 0; }
      L.userData.fade = Math.min(1, L.userData.fade + 0.08);   // fundido de entrada al reasignar
      const d = Math.hypot(e.x - cx, e.z - cz);
      const edge = 1 - W.smoothstep(radius * 0.7, radius + e.distance * 0.5, d);
      let I = e.intensity * edge * L.userData.fade;
      if (e.beat) I *= 0.8 + beat * 0.75;
      else I *= 0.8 + 0.2 * Math.sin(t * 1.7 + e.x);
      L.position.set(e.x, e.y, e.z);
      L.color.copy(e.color);
      L.distance = e.distance;
      L.intensity = I;
    }
  };

  // ---------------------------------------------------------------------------
  // Esporas: puntos que flotan; se apartan del personaje.
  // ---------------------------------------------------------------------------
  W.makeSpores = function (scene, n) {
    const R = W.rng(9), g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3), v = new Float32Array(n * 3);
    const pal = [new THREE.Color(0x7ff0ff), new THREE.Color(0xff8be8), new THREE.Color(0xd4ff7a)];
    for (let i = 0; i < n; i++) {
      p[i * 3] = (R() * 2 - 1) * (W.HALF - 4); p[i * 3 + 2] = (R() * 2 - 1) * (W.HALF - 4);
      p[i * 3 + 1] = W.heightAt(p[i * 3], p[i * 3 + 2]) + 0.3 + R() * 5;
      const q = pal[i % 3]; c.set([q.r, q.g, q.b], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), W.HALF * 1.5);
    const mat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, v, mat };
  };
  W.updateSpores = function (S, dt, t, player, playerSpeed, cx, cz, viewR) {
    const a = S.pts.geometry.attributes.position.array, v = S.v;
    const px = player ? player.x : 1e9, py = player ? player.y : 0, pz = player ? player.z : 1e9;
    for (let i = 0; i < a.length; i += 3) {
      // solo se simulan las cercanas a la vista (las lejanas no se ven)
      if (Math.abs(a[i] - cx) > viewR || Math.abs(a[i + 2] - cz) > viewR) continue;
      a[i + 1] += dt * (0.18 + (i % 7) * 0.03);
      a[i] += Math.sin(t * 0.7 + i) * dt * 0.15;
      // reacción al personaje: se apartan y giran un poco
      const dx = a[i] - px, dy = a[i + 1] - (py + 0.8), dz = a[i + 2] - pz, d2 = dx * dx + dy * dy * 0.5 + dz * dz;
      if (d2 < 2.2) {
        const d = Math.sqrt(d2) + 1e-3, f = (1 - d / 1.48) * (1.5 + playerSpeed * 1.2) * dt * 3;
        v[i] += dx / d * f; v[i + 1] += Math.abs(dy / d) * f * 0.6; v[i + 2] += dz / d * f;
      }
      a[i] += v[i] * dt; a[i + 1] += v[i + 1] * dt; a[i + 2] += v[i + 2] * dt;
      v[i] *= 0.94; v[i + 1] *= 0.94; v[i + 2] *= 0.94;
      const base = W.heightAt(a[i], a[i + 2]);
      if (a[i + 1] > base + 6) a[i + 1] = base + 0.3;
    }
    S.pts.geometry.attributes.position.needsUpdate = true;
  };

  // ---------------------------------------------------------------------------
  // Ondas (anillos que se expanden) y polvo luminoso (partículas breves)
  // ---------------------------------------------------------------------------
  W.makeFx = function (scene) {
    const rings = [], RING_N = 14;
    const rg = new THREE.RingGeometry(0.7, 1, 28);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_N; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 2; scene.add(m); rings.push({ m, t: 1, life: 1 });
    }
    const DUST_N = 64, dg = new THREE.BufferGeometry();
    const dp = new Float32Array(DUST_N * 3), dc = new Float32Array(DUST_N * 3);
    dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    dg.setAttribute("color", new THREE.BufferAttribute(dc, 3));
    const dm = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
    const dust = new THREE.Points(dg, dm); dust.frustumCulled = false; scene.add(dust);
    const dv = new Float32Array(DUST_N * 4);   // vx vy vz vida
    let ri = 0, di = 0;
    // huellas: pequeñas manchas oscuras que se desvanecen en unos segundos
    const PRINT_N = 20, printTex = (function () {
      const c = document.createElement("canvas"); c.width = 16; c.height = 32;
      const g = c.getContext("2d"), gr = g.createRadialGradient(8, 16, 0, 8, 16, 8);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.7, "rgba(0,0,0,0.6)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.save(); g.scale(1, 2); g.fillStyle = gr; g.fillRect(0, 0, 16, 16); g.restore();
      return new THREE.CanvasTexture(c);
    })();
    const printGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const prints = [];
    for (let i = 0; i < PRINT_N; i++) {
      const m = new THREE.Mesh(printGeo, new THREE.MeshBasicMaterial({ map: printTex, color: 0x0a0610, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
      m.visible = false; m.renderOrder = 1; scene.add(m); prints.push({ m, t: 9 });
    }
    let pi = 0;
    const fx = {
      footprint(x, y, z, heading, strength) {
        W.__prints = (W.__prints || 0) + 1;
        const p = prints[pi++ % PRINT_N];
        p.m.position.set(x, y + 0.012, z); p.m.rotation.set(0, -heading + Math.PI / 2, 0);
        p.m.scale.set(0.11, 1, 0.2); p.t = 0; p.s = strength == null ? 0.38 : strength; p.m.visible = true;
      },
      ripple(x, y, z, size) {
        W.__ripples = (W.__ripples || 0) + 1;
        const r = rings[ri++ % RING_N];
        r.m.position.set(x, y + 0.02, z); r.t = 0; r.life = 0.9; r.size = size || 0.6; r.m.visible = true;
      },
      dust(x, y, z, n, o) {
        W.__dust = (W.__dust || 0) + 1;
        o = o || {};
        const pal = o.pal || [[0.5, 0.95, 1], [1, 0.55, 0.9], [0.83, 1, 0.48]];
        const spd = o.spd == null ? 1 : o.spd, up = o.up == null ? 1 : o.up, life = o.life || 0.5;
        for (let k = 0; k < n; k++) {
          const i = di++ % DUST_N, a = Math.random() * Math.PI * 2, s = (0.6 + Math.random() * 0.9) * spd;
          dp[i * 3] = x + Math.cos(a) * 0.05; dp[i * 3 + 1] = y + 0.04; dp[i * 3 + 2] = z + Math.sin(a) * 0.05;
          dv[i * 4] = Math.cos(a) * s; dv[i * 4 + 1] = (0.6 + Math.random() * 0.8) * up; dv[i * 4 + 2] = Math.sin(a) * s; dv[i * 4 + 3] = life * (0.7 + Math.random() * 0.6);
          const c = pal[k % 3]; dc[i * 3] = c[0]; dc[i * 3 + 1] = c[1]; dc[i * 3 + 2] = c[2];
        }
      },
      update(dt) {
        for (const p of prints) {
          if (!p.m.visible) continue;
          p.t += dt;
          const k = 1 - W.smoothstep(0.6, 3.5, p.t);
          p.m.material.opacity = p.s * k;
          if (k <= 0) p.m.visible = false;
        }
        for (const r of rings) {
          if (!r.m.visible) continue;
          r.t += dt / r.life;
          if (r.t >= 1) { r.m.visible = false; continue; }
          const s = r.size * (0.25 + r.t);
          r.m.scale.set(s, 1, s);
          r.m.material.opacity = (1 - r.t) * 0.95;
        }
        for (let i = 0; i < DUST_N; i++) {
          if (dv[i * 4 + 3] <= 0) { dp[i * 3 + 1] = -100; continue; }
          dv[i * 4 + 3] -= dt;
          dp[i * 3] += dv[i * 4] * dt; dp[i * 3 + 1] += dv[i * 4 + 1] * dt; dp[i * 3 + 2] += dv[i * 4 + 2] * dt;
          dv[i * 4] *= 0.9; dv[i * 4 + 2] *= 0.9; dv[i * 4 + 1] -= dt * 1.5;
          const f = Math.max(0, dv[i * 4 + 3] * 2);
          dc[i * 3] = Math.min(dc[i * 3], 1) * (0.96 + 0.04 * f);
        }
        dg.attributes.position.needsUpdate = true;
        dg.attributes.color.needsUpdate = true;
      },
    };
    return fx;
  };
})();
