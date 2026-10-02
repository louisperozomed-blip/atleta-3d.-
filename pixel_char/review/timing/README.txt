Cronometraje del parry/bloqueo en tiempo real (tests/timing_rt.mjs), 40 pulsaciones por modo, zombi.
Cada línea: err = W.pressTime − instante de juego verdadero (ms; + = la pulsación cuenta más tarde de lo que fue),
trueEarly = antelación verdadera al impacto (ms), got = resultado del juego, want = el que corresponde a trueEarly,
d = [ms desde el último paso, ritmo del último paso, ms del último frame, ms del frame siguiente, ms de juego que avanzó].
  smooth: 60 fps estables · hitch: 37 fps con un tirón de 60-110 ms cada 6 frames · render: SwiftShader ~13-16 fps
