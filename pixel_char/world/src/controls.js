// controls.js — entrada: tocar un punto para ir (etapa 1: línea recta con colisiones).
(function () {
  "use strict";
  const W = (window.W = window.W || {});
  W.initControls = function (canvas) {
    let down = null;
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener("pointerup", (e) => {
      if (!down) return;
      const p = W.pick(e.clientX, e.clientY);
      down = null;
      if (p) W.player.setPath([{ x: p.x, z: p.z }]);
    });
    const jb = document.getElementById("jump");
    if (jb) jb.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); W.player.doJump(); });
  };
})();
