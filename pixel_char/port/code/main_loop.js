// ============================================================================================================
// COPIA PARA EL PORTADO A UNITY — original: pixel_char/world/src/main.js (EXTRACTO)
// Bucle principal: orden de actualización de cada paso (lo que importa para la lógica). La cámara y el render que siguen
// en el original son visuales. Ver también la resolución automática (main.js, solo rendimiento).
// Las llamadas a W.fx / W.sfx / W.combatStar / W.shakeCam / W.combatPop / flashLight son EFECTOS (en Unity:
// eventos de VFX/SFX), no lógica. Los bloques «[VISUAL OMITIDO]» eran solo de presentación.
// ============================================================================================================
function mainLoopExcerpt(W, clock, player, character, ui) {
  let t = 0;
    // Paso de simulación: frame() en tiempo real; W.tick(dt) avanza a paso fijo cuando W.manual
    // (pruebas y GIF deterministas: el antes y el después ven exactamente el mismo recorrido)
    function frame() {
      // a pocos fps el paso se recorta a 50 ms (el juego va más lento que el reloj): se guarda el tiempo real del
      // frame para que las pulsaciones se conviertan a tiempo de juego con el ritmo de verdad (W.pressTime)
      const real = clock.getDelta(), rdt = Math.min(0.05, real);
      if (!W.manual) { W.frameReal = real; step(rdt); autoStep(real); }
      requestAnimationFrame(frame);
    }
    W.tick = function (dt, n) { for (let i = 0; i < (n || 1); i++) step(dt); };
    function step(dt) {
      t += dt; W.U.uTime.value = t;
      // hitstop: el tiempo de juego se congela un instante (la cámara, la luz y las partículas siguen)
      const gdt = W.combatStep ? W.combatStep(dt) : dt;
      if (W.controlsUpdate) W.controlsUpdate(dt);
      if (W.animViewerStep) W.animViewerStep(dt);
      if (W.pf) W.pf.update(gdt);
      player.update(gdt);
      W.U.uPlayer.value.set(player.x, player.y, player.z);
      W.U.uPush.value += ((player.speed > 0.1 ? 1 : 0.3) - W.U.uPush.value) * Math.min(1, dt * 6);
      ui.theta += (ui.thetaT - ui.theta) * (1 - Math.exp(-dt * 7));
      if (Math.abs(ui.thetaT - ui.theta) < 1e-4) ui.theta = ui.thetaT;
      character.update(gdt, player, ui.theta, ui.thetaT);
      if (W.updateFoes) W.updateFoes(gdt, ui.theta, ui.thetaT);
      if (W.targetUpdate) W.targetUpdate(dt);                    // objetivo fijado (target.js)
      if (W.groupUpdate) W.groupUpdate(gdt);                     // turnos, pinza, multi-parry, indicador de borde (group.js)
    }
}
