'use strict';
(function () {
  const TR = window.TR, U = TR.U;

  const RULES = (TR.SCORE_RULES = {
    firstToLot: 200,
    parkMax: 200,
    perBox: 50,
    win: 500,
    speedPerSec: 2,
    crash: -100,
    bump: -20,
    reset: -50,
  });

  // Every second the winner saves under this par time is worth RULES.speedPerSec.
  TR.parTime = (route) => Math.round(route.length / 120 + 120);

  TR.parkPrecision = (st) => {
    const a = U.clamp(1 - st.angleErr / TR.LOT.ANGLE_TOL, 0, 1);
    const l = U.clamp(1 - Math.abs(st.lateral) / TR.LOT.LATERAL_MAX, 0, 1);
    return Math.round((RULES.parkMax * (a + l)) / 2);
  };

  // Rows for the scoring table on the how-to screen; kept next to RULES so the two cannot drift.
  TR.scoreRuleRows = () => [
    ['Park alanına ilk giren', '+' + RULES.firstToLot],
    ['Park hassasiyeti (dorse açısı ve ortalama)', '0 … +' + RULES.parkMax],
    ['Hedefte doğru yerdeki her kutu', '+' + RULES.perBox],
    ['Turu kazanan', '+' + RULES.win],
    ['Hız bonusu (kazanan, par süreden kalan her saniye)', '+' + RULES.speedPerSec],
    ['Kaza (araca çarpma)', String(RULES.crash)],
    ['Bariyere veya duvara sürtünme, öbür tıra çarpma (hızlı giden öder)', String(RULES.bump)],
    ['Kurtarma tuşu (yola / girişe dönüş)', String(RULES.reset)],
  ];

  TR.roundScore = (p, G) => {
    const items = [];
    const add = (label, pts) => items.push({ label, pts });
    if (p.stats.firstToLot) add('Park alanına ilk giriş', RULES.firstToLot);
    if (p.stats.parkPts != null) add('Park hassasiyeti', p.stats.parkPts);
    const boxes = p.unloader ? p.unloader.placedCount() : 0;
    if (boxes) add('Doğru kutu × ' + boxes, boxes * RULES.perBox);
    if (G.winner === p) {
      add('Turu kazandı', RULES.win);
      const spare = Math.floor(TR.parTime(G.route) - p.times.unload);
      if (spare > 0) add('Hız bonusu (' + spare + ' sn)', spare * RULES.speedPerSec);
    }
    if (p.crashes) add('Kaza × ' + p.crashes, p.crashes * RULES.crash);
    if (p.bumps) add('Temas × ' + p.bumps, p.bumps * RULES.bump);
    if (p.resets) add('Kurtarma × ' + p.resets, p.resets * RULES.reset);
    const sum = items.reduce((a, it) => a + it.pts, 0);
    return { items, sum, total: Math.max(0, sum) };
  };
})();
