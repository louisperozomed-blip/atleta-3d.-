// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/combat.js
// Resolución de golpes, defensa, postura, hitstop, cámara lenta. Sin partículas, luces ni HUD.
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
// combat.js — resolución de golpes y sensación de impacto.
//
//  · hitbox en el suelo: arco delante del atacante (generoso: ±70°, ±85° en attack3), activa SOLO en el
//    frame activo (IMPACT) de cada ataque; un golpe alcanza a cada objetivo una vez
//  · defensa del objetivo en ese instante (fighter.defense): esquiva (invulnerable), parry, bloqueo o golpe
//  · parry por niveles (fighter.defense, con el instante exacto del impacto):
//      PERFECTO  chispas doradas, sonido propio, hitstop más largo, mucha postura al atacante, 0 para ti y
//                ventana de contraataque (~350 ms: el golpe que empieces en ella hace daño extra y no se defiende)
//      NORMAL    postura media al atacante y un pequeño coste de postura para ti
//      BLOQUEO   sin postura al atacante, más coste para ti y gasto de stamina (sin stamina, guardia rota)
//  · bloqueo: daño reducido, gasta stamina; sin stamina se rompe la guardia
//  · postura llena = aturdido; golpear a un aturdido es un remate (daño ×3)
//  · ataques PELIGROSOS (AT.perilous): no se desvían ni se bloquean; cada uno tiene su respuesta:
//      "jump"   barrido bajo: saltar (y contraatacar en el aire)
//      "mikiri" estocada: esquivar HACIA el atacante en sus frames invulnerables = contraataque (mucha postura);
//               cualquier otra esquiva a tiempo, la evita sin más
//      "side"   agarre: esquivar de lado (la esquiva hacia delante o hacia atrás no basta: te atrapa)
//  · sensación: hitstop 60-120 ms (más en attack3 y en el parry), sacudida de cámara en la dirección del
//    golpe, destello blanco en quien lo recibe, partículas según el terreno y sonidos (audio.js)
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const fighters = (W.fighters = []);
  // ataques del jugador; cada enemigo puede traer su tabla (f.attacks: dmg, reach, arc, stop, kb, heavy, post)
  const PLAYER_ATTACKS = {
    attack1: { dmg: 10, reach: 1.6, arc: 70, stop: 0.075, kb: 0.35, post: 38 },
    attack2: { dmg: 12, reach: 1.65, arc: 70, stop: 0.085, kb: 0.35, post: 38 },
    attack3: { dmg: 22, reach: 1.95, arc: 85, stop: 0.12, kb: 0.6, heavy: true, post: 48 },
    // Duelo 3 (duel.js decide daño, postura y sensación de cada golpe; aquí, el alcance)
    riposte: { dmg: 8, reach: 1.95, arc: 80, stop: 0.07, kb: 0.2, post: 22 },
    deathblow: { dmg: 100, reach: 2.2, arc: 120, stop: 0.18, kb: 0.6, heavy: true, post: 0 },
    // Combate completo: el FUERTE (carga; nivel 2 ×1,5 daño, ×1,6 postura) y el remate giratorio en 360°
    heavy: { dmg: 22, reach: 2.05, arc: 80, stop: 0.13, kb: 0.75, heavy: true, post: 50, postK: 1.5 },
    spin: { dmg: 15, reach: 2.25, arc: 180, stop: 0.12, kb: 0.6, heavy: true, post: 44, postK: 1.7 },
  };
  const STOP = { attack1: 0.075, attack2: 0.085, attack3: 0.12, parry: 0.11, parryHeavy: 0.13, perfect: 0.16, perfectHeavy: 0.18, block: 0.06, deathblow: 0.16 };
  // recompensas por nivel (postura al atacante: × su "post"; coste de postura para quien defiende)
  const LEVEL = (W.PARRY_LEVELS = {
    perfect: { atkPost: 1.33, defPost: 0, defPostHeavy: 0 },
    parry: { atkPost: 1.0, defPost: 7, defPostHeavy: 10 },
    block: { atkPost: 0, defPost: 18, defPostHeavy: 26, st: 22, stHeavy: 36 },
  });
  const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // postura que gana el atacante desviado: su "post" × nivel + racha dentro de la misma cadena de ataques
  // (la cadena la marca la IA en act.chainId; si no, golpes seguidos a menos de chainGap s)
  W.parryPostGain = function (att, t, AT, level) {
    const C = W.COMBAT, base = (AT.post || 38) * LEVEL[level === "perfect" ? "perfect" : "parry"].atkPost;
    const s = att._defl || (att._defl = { n: 0, t: -9, key: null });
    const key = att.act && att.act.chainId != null ? att.act.chainId : null;
    const same = key != null ? key === s.key : W.ct - s.t < C.chainGap;
    s.n = same ? s.n + 1 : 1; s.t = W.ct; s.key = key;
    return base + C.chainBonus * (s.n - 1);
  };
  const breakStreak = (att) => { if (att._defl) att._defl.n = 0; };
  W.combatLog = [];
  // resolución en curso: cada evento que se registra mientras tanto es el resultado de ese golpe (para la IA)
  let curRes = null;
  function log(e) { e.t = W.U ? +W.U.uTime.value.toFixed(3) : 0; W.combatLog.push(e); if (W.combatLog.length > 400) W.combatLog.shift(); feedback(e);
    if (curRes && curRes.att.ai && curRes.att.ai.onResult) curRes.att.ai.onResult(curRes.a, e); }
  // [VISUAL OMITIDO: textos flotantes «¡PARRY!», «BLOQUEO»… (FB, feedback, addPop, el0, updatePops)]
  function feedback(e) {}
  function el0() {}
  W.combatPop = el0;
  function updatePops() {}

  W.addFighter = function (f, ch) { f.ch = ch; fighters.push(f); return f; };
  W.nearestFoe = function (f, maxD, maxAng) {
    let best = null, bd = 1e9;
    for (const o of fighters) {
      if (o === f || o.team === f.team || !o.alive) continue;
      const dx = o.body.x - f.body.x, dz = o.body.z - f.body.z, d = Math.hypot(dx, dz);
      if (d > maxD) continue;
      if (maxAng != null && d > 0.8 && Math.abs(norm(Math.atan2(dz, dx) - f.body.heading)) > maxAng) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  // ---- hitstop y sacudida -----------------------------------------------------------------------------
  W.hitstop = 0;
  // [VISUAL OMITIDO: sacudida de cámara (shakeCam/shakeOffset): solo visual]
  W.shakeCam = function () {};

  // cámara lenta (Duelo 3): tras el hitstop del parry perfecto, un instante (~120 ms reales) al 30 %
  const SLOW = (W.SLOWMO = { t: 0, k: 1, pend: null, acc: 0 });
  W.slowmo = function (dur, k) { SLOW.pend = { dur, k }; };
  W.combatStep = function (dt) {
    W.ctReal = performance.now();
    // ritmo del reloj de combate frente al reloj real en este paso (0 en el hitstop; incluye la cámara lenta y el
    // recorte de dt a pocos fps): W.pressTime lo usa para situar las pulsaciones que llegan entre frames
    const real = W.frameReal; W.frameReal = 0;
    const gdt = combatAdvance(dt);
    W.ctRate = real > 0 ? Math.min(1, gdt / real) : null;
    W.ctFrame = real > 0 ? real : 0;
    // duración esperada del próximo frame: media suave, pero un tirón suelto no la arrastra (mín. con el último)
    if (real > 0) { frameAvg = frameAvg ? frameAvg + (Math.min(real, 0.25) - frameAvg) * 0.2 : Math.min(real, 0.25); W.ctFrameEst = Math.min(real, frameAvg); }
    return gdt;
  };
  let frameAvg = 0;
  function combatAdvance(dt) {
    if (W.hitstop > 0) { W.hitstop = Math.max(0, W.hitstop - dt); W.hitstopAcc = (W.hitstopAcc || 0) + dt; return 0; }
    if (SLOW.pend) { SLOW.t = SLOW.pend.dur; SLOW.k = SLOW.pend.k; SLOW.pend = null; }
    if (SLOW.t > 0) { SLOW.t -= dt; SLOW.acc += dt; dt *= SLOW.k; }
    W.ct += dt;                                      // reloj de combate (fighter.js)
    return dt;
  }
  function stop(v) { W.hitstop = Math.max(W.hitstop, v); }

  // [VISUAL OMITIDO: luz del destello, estrellas de contacto y paletas de partículas]
  function flashLight() {}
  function star() {}
  W.combatStar = function () {};
  function updateStars() {}
  const EMBER = "EMBER", SPARK = "SPARK", GOLD = "GOLD", DULL = "DULL";
  // superficie bajo un punto (tierra, piedra, agua, hierba, hojas, metal): solo elige partículas y sonido
  function groundBurst(x, z) { return (W.surfaceAt && W.surfaceAt(x, z)) || "dust"; }

  // ---- resolución --------------------------------------------------------------------------------
  const pendingHits = [];
  function flushHits() {
    for (let i = pendingHits.length - 1; i >= 0; i--) {
      const q = pendingHits[i];
      if (W.ct + 1e-6 < q.a.resolveAt) continue;
      pendingHits.splice(i, 1);
      if (q.f.alive && q.f.act === q.a) resolve(q.f, q.a);
    }
  }
  W.combatAttacks = PLAYER_ATTACKS;
  W.onCombatFrame = function (f, a) {
    if (W.isAtk(a) && a.f >= W.hitF(a) && !a.hitDone) {
      a.hitDone = true;
      // con calibración positiva (tus pulsaciones llegan tarde) el golpe que te lanzan se resuelve esos ms después
      // del impacto, para que una pulsación "tarde" llegue a contar
      const cal = (W.COMBAT.calib || 0) / 1000;
      if (cal > 0 && f.team !== "player") { a.resolveAt = (a.impactT != null ? a.impactT : W.ct) + cal; pendingHits.push({ f, a }); }
      else resolve(f, a);
    }
    if (W.isAtk(a) && a.f === W.hitF(a) - 1 && W.sfx) W.sfx.combat(a.name === "attack3" || a.name === "deathblow" ? "swingHeavy" : "swing");
    if (a.name === "attack3" && a.f === 3) {
      // el golpe contra el suelo levanta tierra aunque no alcance a nadie
      const b = f.body, x = b.x + Math.cos(b.heading) * 0.9, z = b.z + Math.sin(b.heading) * 0.9;
      groundBurst(x, z, 22, true);
      W.shakeCam(Math.cos(b.heading), Math.sin(b.heading), 0.07, 0.3);
    }
    if (a.name === "dodge" && a.f === 1 && W.sfx) W.sfx.combat("dodge");
    if (a.name === "dodge" && a.f === 4) groundBurst(f.body.x, f.body.z, 6, false);
    if (a.name === "death" && a.f === 3) { groundBurst(f.body.x, f.body.z, 16, true); if (W.sfx) W.sfx.combat("death"); }
    if (W.onCombatFrameExtra) W.onCombatFrameExtra(f, a);
  };
  function resolve(att, a) { curRes = { att, a }; try { resolve0(att, a); } finally { curRes = null; } }
  function resolve0(att, a) {
    const AT = (att.attacks || PLAYER_ATTACKS)[a.move || a.name] || PLAYER_ATTACKS.attack1;
    const b = att.body, reach = AT.reach, arc = AT.arc * Math.PI / 180;
    let any = false;
    for (const t of fighters) {
      if (t === att || t.team === att.team || !t.alive) continue;
      const dx = t.body.x - b.x, dz = t.body.z - b.z, d = Math.hypot(dx, dz);
      const ang = Math.abs(norm(Math.atan2(dz, dx) - b.heading));
      const inArc = d <= reach + (t.radiusHit || 0.3) && (ang <= arc || d < 0.6 + (t.radiusHit || 0));
      log({ ev: "swing", who: att.name, anim: a.name, d: +d.toFixed(2), ang: Math.round(ang * 180 / Math.PI), inArc });
      // la estocada: quien esquiva HACIA ella cuenta aunque se cuele por su lado
      if (!inArc && !(AT.perilous === "mikiri" && t.act && t.act.name === "dodge" && d <= AT.reach + 1.5)) continue;
      any = true;
      const dir = Math.atan2(dz, dx);
      // Duelo 3: riposte (con su ritmo) y remate los resuelve duel.js
      const dctx = { dir, dx, dz, cx: (b.x + t.body.x) / 2, cz: (b.z + t.body.z) / 2, cy: Math.max(b.y, t.body.y) + 1.05 };
      if (W.duelResolve && W.duelResolve(att, a, t, AT, dctx)) continue;
      // choque: los dos golpeáis a la vez → chispas grandes y ambos retrocedéis sin daño (duel.js)
      if (W.duelClash && W.duelClash(att, a, t, AT, dctx)) continue;
      let def = t.defense(a.impactT);
      if (a.counter && def !== "evade") def = "open";        // el contraataque no se puede defender
      if (def === "partial") def = "block";                     // parry parcial = bloqueo
      const heavy = !!AT.heavy;
      const cx = (b.x + t.body.x) / 2, cz = (b.z + t.body.z) / 2, cy = Math.max(b.y, t.body.y) + 1.05;
      const dmg = AT.dmg * (att.dmgK || 1) * (a.dmgK || 1);
      const toPlayer = t === W.pf && att.team !== "player";
      if (toPlayer) W.lastFoeImpact = { t: a.impactT != null ? a.impactT : W.ct, open: false };
      if (AT.perilous) {
        // peligroso: guardia y parry no sirven; solo su respuesta
        const how = perilousAvoid(AT.perilous, t, att, a.impactT);
        if (toPlayer && W.onDefenseInfo) W.onDefenseInfo({ perilous: AT.perilous, how: how || "hit", move: a.move });
        if (toPlayer && !how) W.lastFoeImpact.open = true;
        if (how === "mikiri") {
          // esquivar HACIA la estocada: se la pisa; mucha postura y retrocede; tú quedas listo para contraatacar
          W.fx.dust(cx, cy - 0.45, cz, 40, { pal: GOLD, spd: 2.8, up: 2.0, life: 0.5 });
          flashLight(cx, cy, cz, 0xffc444, 6); star(cx, cy - 0.2, cz, 1.7, 0xffd040, 0.28);
          stop(STOP.perfectHeavy); W.shakeCam(dx, dz, 0.08, 0.3);
          if (W.sfx) W.sfx.combat("parryPerfect");
          const broke = att.addPosture(AT.mikiriPost || 40);
          if (!broke) att.start("hit", { kb: 0.55, kdir: dir + Math.PI, moved: 0, speed: 0.8, recoil: true });
          if (t.act && t.act.name === "dodge") t.act = null;
          t.counterT = W.ct + W.COMBAT.counterWin;
          log({ ev: "mikiri", who: t.name, from: att.name, anim: a.name, move: a.move, post: Math.round(att.post), broke });
          continue;
        }
        if (how) {
          if (how === "jump") t.airCounterT = W.ct + 0.6;
          log({ ev: "evade", how, who: t.name, from: att.name, anim: a.name, move: a.move });
          continue;
        }
        def = "open";
      } else if (toPlayer) {
        if (def === "open") W.lastFoeImpact.open = true;
        if (W.onDefenseInfo) W.onDefenseInfo({ def, early: t.lastEarly, guardT: t.lastGuardT, impactT: a.impactT, move: a.move || a.name, fodder: att.fodder ? att.kind : null });
      }
      if (def === "evade") {
        log({ ev: "evade", who: t.name, anim: a.name });
        continue;
      }
      if (def === "perfect" || def === "parry") {
        // sin daño; el atacante pierde postura y retrocede; destello que ilumina a los dos
        const perfect = def === "perfect", L = LEVEL[def];
        W.fx.dust(cx, cy - 0.35, cz, perfect ? 44 : 26, { pal: perfect ? GOLD : SPARK, spd: perfect ? 3.1 : 2.6, up: perfect ? 2.6 : 2.2, life: perfect ? 0.55 : 0.4 });
        flashLight(cx, cy, cz, perfect ? 0xffc444 : 0xffe2a8, (heavy ? 5.5 : 4.2) * (perfect ? 1.4 : 1));
        star(cx, cy - 0.1, cz, (heavy ? 1.6 : 1.3) * (perfect ? 1.3 : 1), perfect ? 0xffd040 : 0xfff0c8, perfect ? 0.28 : 0.2);
        stop(perfect ? (heavy ? STOP.perfectHeavy : STOP.perfect) : (heavy ? STOP.parryHeavy : STOP.parry));
        W.shakeCam(dx, dz, perfect ? 0.065 : 0.05, 0.22);
        if (W.sfx) W.sfx.combat(perfect ? "parryPerfect" : "parry");
        // relleno (enemies/fodder): sin postura; perfecto = rematado al instante, normal = aturdido (fodder.js)
        const fod = !!att.fodder && t.team === "player";
        const gain = fod ? 0 : (W.parryPostGain ? W.parryPostGain(att, t, AT, def) : (AT.post || (heavy ? 48 : 38)) * L.atkPost);
        const broke = fod ? false : att.addPosture(gain);
        // Duelo 3: tras tu parry perfecto queda DESEQUILIBRADO (~0,7 s) y se abre la ventana de riposte (duel.js)
        const handled = fod ? (W.fodderOnParry ? W.fodderOnParry(t, att, perfect, dir, a) : false) :
          !broke && W.duelOnParry ? W.duelOnParry(t, att, perfect, dir, a) : false;
        // si quien desvía es el enemigo, tú quedas desequilibrado (tus frames de hit, más largos) y él contraataca
        const foeDefl = t.team !== "player" && att.team === "player";
        if (!broke && !handled) att.start("hit", { kb: 0.3, kdir: dir + Math.PI, moved: 0, speed: foeDefl ? 1.0 : 1.35, recoil: true, unbalanced: foeDefl });
        // quien desvía: un parry nunca le rompe la postura
        const cost = heavy ? L.defPostHeavy : L.defPost;
        if (cost) t.addPosture(cost, { noBreak: true });
        // (solo el jugador gana la ventana de contraataque indefendible: el COUNTER del autómata tras desviarte se puede
        //  desviar con un perfecto — el intercambio de desvíos —; antes, tras su parry perfecto, salía indefendible)
        if (perfect && !t.rip && t.team === "player") t.counterT = W.ct + W.COMBAT.counterWin;
        if (perfect && t.team === "player" && W.slowmo) W.slowmo(W.DUEL ? W.DUEL.slowmo[0] : 0.12, W.DUEL ? W.DUEL.slowmo[1] : 0.3);
        t.parries = (t.parries || 0) + 1; t.lastDefT = W.ct; t.pressDeflected = true;
        if (W.multiParryNote) W.multiParryNote(t, att, perfect);   // varios impactos en la misma pulsación (group.js)
        if (att.ai && att.ai.onDeflected) att.ai.onDeflected(perfect ? "perfect" : "normal");
        log({ ev: "parry", level: perfect ? "perfect" : "normal", early: Math.round(t.lastEarly * 1000), who: t.name, from: att.name, anim: a.name,
          win: +t.parryWindow().toFixed(3), gain: Math.round(gain), cost, post: Math.round(att.post), broke });
        if (W.duelFlushLog) W.duelFlushLog();
        if (foeDefl && !broke && t.ai && t.ai.onParriedYou) t.ai.onParriedYou(att, perfect);
        continue;
      }
      if (def === "block") {
        breakStreak(att); t.lastDefT = W.ct;
        const L = LEVEL.block, cost = (a.guardDrain ? a.guardDrain * t.stMax : heavy ? L.stHeavy : L.st) * (att.fodder ? 0.5 : 1);   // quiebraguardia: le vacía la stamina; relleno: la mitad
        t.st -= cost; t.stT = 0;
        if (AT.breaker) t.st = 0;                               // golpe que rompe la guardia (Duelo 3)
        if (t.st <= 0) {
          t.st = 0;
          t.hurt({ dmg: dmg * 0.5, dir, kb: 0.45, guardBreak: true });
          stop(0.1); W.shakeCam(dx, dz, 0.07, 0.3);
          if (W.sfx) W.sfx.combat("guardBreak");
          W.fx.dust(cx, cy - 0.35, cz, 14, { pal: SPARK, spd: 1.6, up: 1.4, life: 0.35 });
          log({ ev: "guardbreak", who: t.name, from: att.name, anim: a.name, hp: Math.round(t.hp) });
          continue;
        }
        t.hp = Math.max(0, t.hp - dmg * 0.15);
        if (t.act && t.act.name === "block") t.act.react = 0.11;
        else t.start("block", { tt: 0.07, react: 0.11 });
        t.body.tryMove(Math.cos(dir) * 0.12, Math.sin(dir) * 0.12);
        const pc = heavy ? L.defPostHeavy : L.defPost;
        if (t.addPosture(pc)) { log({ ev: "block", who: t.name, from: att.name, anim: a.name, st: Math.round(t.st), hp: Math.round(t.hp), postBreak: true }); continue; }
        if (att.fodder) W.fx.dust(cx, cy - 0.35, cz, 7, { pal: DULL, spd: 0.8, up: 0.7, life: 0.35 });   // relleno: polvo apagado, sin chispas
        else { W.fx.dust(cx, cy - 0.35, cz, 8, { pal: SPARK, spd: 1.3, up: 1.2, life: 0.28 }); star(cx, cy - 0.15, cz, 0.7, 0xffd8a0, 0.12); }
        if (att.fodder && t === W.pf && W.fodderOnDefense) W.fodderOnDefense(att, "block");
        stop(STOP.block); W.shakeCam(dx, dz, 0.03, 0.18);
        if (W.sfx) W.sfx.combat("block");
        log({ ev: "block", early: Math.round((t.lastEarly || 0) * 1000), who: t.name, from: att.name, anim: a.name, st: Math.round(t.st), hp: Math.round(t.hp), post: Math.round(t.post) });
        continue;
      }
      // golpe limpio (remate si está aturdido)
      breakStreak(att);
      if (att.ai && att.ai.onPlayerHit && t === W.pf) att.ai.onPlayerHit();
      const exposed = !!(t.act && t.act.exposed);          // su parry falló (le engañaste): más postura
      const deathblow = t.stunned;
      const counter = !!a.counter && !deathblow;
      const dm = t.fodder && !deathblow ? 10 : deathblow ? Math.max(40, dmg * 3) : counter ? dmg * W.COMBAT.counterDmg : dmg;   // relleno: 10 por golpe (3 el zombi, 2 el perro)
      if (att.fodder && t === W.pf && W.fodderOnDefense) W.fodderOnDefense(att, "hit");
      const res = t.hurt({ dmg: dm, dir, kb: AT.kb || (heavy ? 0.6 : 0.35), guardBreak: !!AT.throw, heavy: heavy || counter || deathblow });
      if (res === "armor") {
        // aguanta el golpe sin interrumpir el suyo: chispas de metal y un golpe sordo
        W.fx.dust(t.body.x - Math.cos(dir) * 0.2, t.body.y + 1.0, t.body.z - Math.sin(dir) * 0.2, 12, { pal: SPARK, spd: 1.6, up: 1.2, life: 0.3 });
        if (W.sfx) W.sfx.combat("armor");
      }
      if (AT.throw) log({ ev: "grab", who: t.name, from: att.name, anim: a.name, move: a.move });
      // (la postura no hereda el multiplicador de daño del golpe: el ritmo y los combos traen el suyo, a.postK)
      const pg = dm / (a.dmgK || 1) * 0.7 * (counter ? W.COMBAT.counterPost : 1) * (exposed ? 1.5 : 1) * (AT.postK || 1) * (a.postK || 1);
      if (!deathblow && t.alive) t.addPosture(pg);
      // tras el remate su postura queda como al acabar el aturdido (antes se quedaba llena y cualquier desvío
      // posterior lo volvía a aturdir al instante)
      if (deathblow && t.alive) t.post = t.postMax * 0.35;
      if (counter) { log({ ev: "counter", who: t.name, from: att.name, anim: a.name, dmg: Math.round(dm) }); W.fx.dust(t.body.x, t.body.y + 1.0, t.body.z, 18, { pal: GOLD, spd: 2.2, up: 1.6, life: 0.4 }); }
      const kind = groundBurst(t.body.x, t.body.z, heavy ? 14 : 9, heavy);
      W.fx.dust(t.body.x - Math.cos(dir) * 0.1, t.body.y + 0.9, t.body.z - Math.sin(dir) * 0.1, heavy ? 16 : 10, { pal: EMBER, spd: 1.8, up: 1.3, life: 0.35 });
      if (deathblow) flashLight(t.body.x, t.body.y + 1.1, t.body.z, 0xffd0a0, 6);
      star(t.body.x - Math.cos(dir) * 0.15, t.body.y + 1.0, t.body.z - Math.sin(dir) * 0.15, deathblow ? 1.8 : heavy ? 1.1 : 0.8, deathblow ? 0xfff4d8 : 0xffc890, deathblow ? 0.24 : 0.13);
      stop(deathblow ? STOP.deathblow : AT.stop * (a.stopK || 1));
      W.shakeCam(dx, dz, deathblow ? 0.14 : heavy ? 0.11 : 0.06, heavy || deathblow ? 0.32 : 0.22);
      if (W.sfx) W.sfx.combat(deathblow ? "deathblow" : heavy ? "hitHeavy" : "hit", kind);
      log({ ev: deathblow ? "deathblow" : "hit", who: t.name, from: att.name, anim: a.name, dmg: +dm.toFixed(1), hp: Math.round(t.hp), res, surface: kind, exp: exposed, pg: +pg.toFixed(1) });
    }
    if (!any) log({ ev: "whiff", who: att.name, anim: a.name });
  }
  // ¿esquiva bien el ataque peligroso? (null = le alcanza)
  // Ventana de esquiva de los peligrosos (explícita y generosa, como el mikiri de Sekiro): cuenta la esquiva que
  // empezó entre 40 y 340 ms antes del impacto (o que está en sus frames invulnerables), en la dirección correcta
  const PERIL_DODGE = [0.04, 0.34];
  function perilousAvoid(kind, t, att, impactT) {
    const b = t.body;
    if (kind === "jump") return b.jump && b.jump.h > 0.12 * W.CHAR_H ? "jump" : null;
    const da = t.act && t.act.name === "dodge" ? t.act : null;
    const age = da && da.ct0 != null ? (impactT != null ? impactT : W.ct) - da.ct0 : -1;
    if (!t.invulnerable && !(age >= PERIL_DODGE[0] && age <= PERIL_DODGE[1])) return null;
    // dirección de la esquiva respecto al golpe (contra su rumbo = hacia él), no respecto a la posición: al
    // esquivar hacia la estocada los dos se cruzan
    const ang = Math.abs(norm(t.act.dir - (att.body.heading + Math.PI)));
    if (kind === "mikiri") return ang < 1.05 ? "mikiri" : "dodge";
    if (kind === "side") return ang > 0.8 && ang < 2.35 ? "side" : null;
    return "dodge";
  }
  // efectos para duel.js
  W.combatFx = { star, stop: (v) => stop(v), flash: flashLight, burst: groundBurst, log, GOLD, SPARK, EMBER, STOP };
  W.onStun = function (f) {
    if (W.sfx) W.sfx.combat("stun");
    flashLight(f.body.x, f.body.y + 1.3, f.body.z, 0xfff0c0, 3);
    log({ ev: f.team === "player" ? "playerPostureBreak" : "stun", who: f.name });
  };

  // [VISUAL OMITIDO: barras de vida/stamina/postura y botón GUARDIA en el DOM (makeHud, updateHud)]
  let hud = null;
  function updateHud() {}

  // ---- inicio y paso -----------------------------------------------------------------------------------
  W.initCombat = function (scene, assets) {
    W.pf = W.addFighter(new W.Fighter(W.player, { team: "player", name: "jugador", hp: 100, stamina: 100 }), W.character);
    W.assets = assets;
    // enemigos del tipo elegido (enemies/core.js: por defecto el Autómata del bosque; el eco, desde el panel)
    if (W.spawnEnemies) W.spawnEnemies();
    if (W.initFoeUI) W.initFoeUI();
  };
  // punto libre (sin obstáculo ni agua, al nivel h) más cercano a (x, z)
  // clear: radio de suelo libre alrededor (por defecto 0.5 u)
  W.findSpot = function (x, z, h, clear) {
    clear = clear || 0.5;
    for (let r = 0; r < 6; r += 0.25) {
      for (let k = 0; k < Math.max(1, Math.round(r * 12)); k++) {
        const a = k / Math.max(1, Math.round(r * 12)) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!W.cellFree(px, pz) || W.kindAt(px, pz) === W.K.PUDDLE) continue;
        if (h != null && Math.abs(W.heightAt(px, pz) - h) > 0.3) continue;
        let ok = true;
        for (let rr = 0.5; rr <= clear + 1e-6 && ok; rr += 0.5)
          for (let j = 0; j < 8 && ok; j++) { const b = j * Math.PI / 4; ok = W.cellFree(px + Math.cos(b) * rr, pz + Math.sin(b) * rr) && (h == null || Math.abs(W.heightAt(px + Math.cos(b) * rr, pz + Math.sin(b) * rr) - W.heightAt(px, pz)) < 0.3); }
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  };
  W.combatAfter = function (dt) {
    if (pendingHits.length) flushHits();
    // [VISUAL OMITIDO: estrellas, textos, luz del destello, uniforms de destello y barras]
    if (W.movesAfter) W.movesAfter(dt);               // brillo y brasas de la carga del fuerte (moves.js)
    if (W.duelAfter) W.duelAfter(dt);                 // riposte, ritmo, rebote, cámara del remate (duel.js)
    if (W.practiceAfter) W.practiceAfter(dt);         // barras de postura centrales, entrenamiento (practice.js)
  };
})();
