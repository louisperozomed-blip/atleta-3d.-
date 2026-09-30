// enemy.js — el "eco": un segundo personaje con las mismas animaciones (recoloreadas en frío, visor
// brillante) que usa la misma máquina de estados de combate (fighter.js).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  const foes = (W.foes = []);

  W.spawnFoe = function (x, z, assets, opts) {
    opts = opts || {};
    const body = new W.Player(x, z);
    const ch = W.makeCharacter(W.scene, assets.tex, assets.meta, assets.ctex, assets.cmeta, { echo: true });
    body.ch = ch;
    const f = W.addFighter(new W.Fighter(body, { team: "foe", name: "eco", hp: 120, stamina: 100, posture: 100, prepK: opts.prepK || 1.7 }), ch);
    f.dmgK = opts.dmgK || 1.3;
    f.home = { x, z };
    f.ai = opts.ai === false ? null : (W.makeFoeAI ? W.makeFoeAI(f) : null);
    body.heading = opts.heading != null ? opts.heading : -Math.PI / 2;
    foes.push(f);
    return f;
  };
  W.updateFoes = function (dt, theta, thetaT) {
    for (const f of foes) {
      if (f.ai && dt > 0) f.ai.update(dt);
      f.update(dt);
      f.body.update(dt);
      f.ch.update(dt, f.body, theta, thetaT);
    }
  };
})();
