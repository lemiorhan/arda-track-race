'use strict';
(function () {
  const TR = window.TR, U = TR.U, T = TR.TRUCK, R = TR.ROAD, RULES = TR.SCORE_RULES;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const COLORS = ['#1e88e5', '#e53935'];
  const DENSITY = { az: 0.6, normal: 1, yogun: 1.4 };

  const G = (TR.Game = {
    state: 'menu', route: null, road: null, lot: null, traffic: null, plan: null,
    players: [], time: 0, countdown: 0, winner: null, overT: 0, firstLot: null,
    routeIdx: 0, series: null, preview: null, previewIdx: 0, previewT: 0,
  });

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- match and rounds ----------
  G.newSeries = () => {
    const s = TR.Settings.get();
    G.series = { rounds: s.rounds, round: 1, names: s.names.slice(), totals: [0, 0], wins: [0, 0], history: [] };
  };

  G.isLastRound = () => G.series.history.length >= G.series.rounds;

  G.startRound = (ri) => {
    const sr = G.series;
    sr.round = sr.history.length + 1;
    const route = TR.ROUTES[ri];
    G.routeIdx = ri;
    G.route = route;
    G.road = new TR.Road(route);
    G.lot = new TR.Lot(G.road.endX, G.road.endY);
    const seed = ((Date.now() & 0xffffff) ^ route.seed) >>> 0;
    G.traffic = new TR.Traffic(G.road, route, seed, DENSITY[TR.Settings.get().traffic] || 1);
    G.plan = TR.makeCargoPlan(U.rng(seed * 7 + 3));
    G.players = COLORS.map((color, i) => {
      const lane = i === 0 ? R.LANE / 2 : R.LANE * 1.5;
      const q = G.road.posAt(R.START_S, lane);
      const truck = new TR.Truck(i, color, q.x, q.y, q.h);
      truck.grip = route.grip || 1;
      return {
        idx: i, name: sr.names[i], color, truck,
        phase: 'race', s: R.START_S, d: lane, hint: -1, offroad: false,
        crashes: 0, bumps: 0, resets: 0, bumpCd: 0, railCd: 0,
        stats: { firstToLot: false, parkPts: null },
        cam: { x: q.x, y: q.y - 250, z: 0.8 }, shake: 0,
        toast: '', toastT: 0, toastColor: '#fff',
        park: null, parkHold: 0, unloader: null,
        times: { race: null, park: null, unload: null },
      };
    });
    G.time = 0;
    G.countdown = 4;
    G.lastBeep = 4;
    G.state = 'countdown';
    G.winner = null;
    G.firstLot = null;
    G.touchCd = 0;
  };

  G.restartRound = () => G.startRound(G.routeIdx);

  G.pause = () => {
    if (G.state !== 'play' && G.state !== 'countdown') return;
    G.paused = G.state;
    G.state = 'paused';
    TR.UI.showPause();
  };

  G.resume = () => {
    if (G.state !== 'paused') return;
    G.state = G.paused;
    TR.UI.hideAll();
  };

  G.toMenu = () => {
    G.state = 'menu';
    G.series = null;
  };

  function endRound() {
    const sr = G.series;
    const scores = G.players.map((p) => TR.roundScore(p, G));
    scores.forEach((sc, i) => (sr.totals[i] += sc.total));
    sr.wins[G.winner.idx]++;
    sr.history.push({ route: G.route.name, scores: scores.map((sc) => sc.total), winner: G.winner.idx, time: G.winner.times.unload });
    const places = G.players.map((p, i) => scores[i].total > 0
      ? TR.Scores.addRound({ name: p.name, color: p.color, route: G.route.name, score: scores[i].total, date: Date.now() })
      : -1);
    G.state = 'roundover';
    TR.UI.showRoundResult(scores, places);
  }

  function toast(p, text, color, t) {
    p.toast = text;
    p.toastColor = color || '#fff';
    p.toastT = t || 1.6;
  }

  // ---------- simulation ----------
  function update(dt) {
    if (G.state === 'countdown') {
      G.countdown -= dt;
      const n = Math.ceil(G.countdown);
      if (n < G.lastBeep && n > 0) { G.lastBeep = n; TR.Audio.beep(); }
      if (G.countdown <= 0) {
        G.state = 'play';
        TR.Audio.go();
        G.players.forEach((p) => toast(p, 'BAŞLA!', '#69f0ae', 1));
      }
      updateCams(dt);
      return;
    }
    if (G.state !== 'play' && G.state !== 'finishing') return;
    G.time += dt;
    G.touchCd -= dt;
    for (const p of G.players) updatePlayer(p, dt);
    collideTrucks(dt);
    for (const p of G.players) postPhysics(p, dt);
    const views = viewports().map((vp, i) => viewOf(G.players[i], vp));
    G.traffic.update(dt, G.players, views, () => TR.Audio.horn());
    for (const h of G.traffic.collide(G.players)) crash(h.player, h.headOn);
    updateCams(dt);
    if (G.state === 'finishing') {
      G.overT -= dt;
      if (G.overT <= 0) endRound();
    }
  }

  function updatePlayer(p, dt) {
    const inp = TR.Input.player(p.idx);
    if (p.toastT > 0) p.toastT -= dt;
    if (p.shake > 0) p.shake = Math.max(0, p.shake - dt * 2.5);
    p.bumpCd -= dt;
    p.railCd -= dt;
    if (p.phase === 'race' || p.phase === 'park') {
      if (inp.reset) recover(p);
      const loc = G.road.locate(p.truck.x, p.truck.y, p.hint);
      p.hint = loc.i;
      p.s = loc.s;
      p.d = loc.d;
      p.offroad = p.phase === 'race' && Math.abs(loc.d) > R.HALF + 4 && loc.s < G.road.length;
      const cap = p.phase === 'park' ? T.LOT_CAP : p.offroad ? T.OFFROAD_CAP : T.MAX_FWD;
      const jacked = p.truck.jack > 0;
      p.truck.update(dt, inp, cap);
      if (!jacked && p.truck.jack > 0) TR.Audio.jack();
    } else if (p.phase === 'unload') {
      p.unloader.update(dt, inp);
      if (p.unloader.complete()) finish(p);
    } else if (p.phase === 'done' && p.unloader) {
      p.unloader.update(dt, { mx: inp.mx, my: inp.my, action: false });
    }
  }

  function postPhysics(p, dt) {
    if (p.phase !== 'race' && p.phase !== 'park') return;
    const t = p.truck;
    rails(p, dt);
    const impact = Math.abs(t.v) > 25;
    if (G.lot.collideTruck(t) && impact && p.bumpCd <= 0) {
      p.bumpCd = 0.5;
      p.bumps++;
      TR.Audio.bump();
    }
    if (p.phase === 'race' && t.y < G.lot.oy - 40) {
      p.phase = 'park';
      p.times.race = G.time;
      if (!G.firstLot) {
        G.firstLot = p;
        p.stats.firstToLot = true;
        toast(p, 'PARKA İLK SEN GELDİN! +' + RULES.firstToLot, '#90caf9', 2);
      } else toast(p, 'PARK ALANI!', '#90caf9');
    }
    if (p.phase === 'park') {
      p.park = G.lot.parkStatus(t, p.idx);
      if (p.park.ok) {
        p.parkHold += dt;
        if (p.parkHold > 0.7) startUnload(p);
      } else p.parkHold = 0;
    }
  }

  function rails(p, dt) {
    const t = p.truck, road = G.road;
    // All corners come from one snapshot of the truck, so only the deepest may push:
    // adding up every corner's overshoot would move the truck several times too far.
    let worst = null;
    for (const b of t.boxes()) {
      for (const c of U.corners(b)) {
        if (G.lot.contains(c.x, c.y)) continue;
        const loc = road.locate(c.x, c.y, p.hint);
        if (loc.s >= road.length - 2) continue;
        const over = Math.abs(loc.d) - R.RAIL;
        if (over > 0 && (!worst || over > worst.over)) worst = { over, i: loc.i, sg: Math.sign(loc.d) };
      }
    }
    if (worst) {
      t.x -= road.nx[worst.i] * worst.sg * worst.over;
      t.y -= road.ny[worst.i] * worst.sg * worst.over;
      t.v *= Math.pow(0.35, dt);
      if (p.railCd <= 0) {
        p.railCd = 0.6;
        p.bumps++;
        TR.Audio.bump();
        p.shake = Math.max(p.shake, 0.3);
      }
    }
  }

  function collideTrucks(dt) {
    const [a, b] = G.players;
    const fa = a.phase === 'unload' || a.phase === 'done';
    const fb = b.phase === 'unload' || b.phase === 'done';
    if (fa && fb) return;
    const wa = fa ? 0 : fb ? 1 : 0.5, wb = fb ? 0 : fa ? 1 : 0.5;
    let contact = false;
    for (let iter = 0; iter < 2; iter++) {
      let any = false;
      for (const ba of a.truck.boxes()) {
        for (const bb of b.truck.boxes()) {
          const m = U.sat(ba, bb);
          if (!m) continue;
          any = true;
          a.truck.x -= m.nx * m.depth * wa;
          a.truck.y -= m.ny * m.depth * wa;
          b.truck.x += m.nx * m.depth * wb;
          b.truck.y += m.ny * m.depth * wb;
        }
      }
      if (!any) break;
      contact = true;
    }
    if (contact) {
      // Contact frames less than touchCd (0.5 s) apart count as one contact, charged at most
      // once, on its first frame above impact speed, however long the trucks stay pressed.
      if (G.touchCd <= 0) {
        G.touchCharged = false;
        TR.Audio.bump();
      }
      G.touchCd = 0.5;
      const rammer = Math.abs(a.truck.v) >= Math.abs(b.truck.v) ? a : b;
      if (!G.touchCharged && Math.abs(rammer.truck.v) > 25) {
        G.touchCharged = true;
        rammer.bumps++;
        toast(rammer, 'TIRA ÇARPTIN! ' + RULES.bump, '#ff8a80', 1.2);
      }
      const f = Math.pow(0.25, dt);
      a.truck.v *= f;
      b.truck.v *= f;
    }
  }

  function crash(p, headOn) {
    if (p.truck.stun > 0.3) return;
    p.crashes++;
    p.truck.v = headOn ? 0 : Math.min(p.truck.v, 40);
    p.truck.stun = headOn ? 1.6 : 0.9;
    p.shake = 1;
    TR.Audio.crash();
    toast(p, (headOn ? 'KAFA KAFAYA! ' : 'KAZA! ') + RULES.crash, '#ff5252');
  }

  function recover(p) {
    p.resets++;
    if (p.phase === 'race') {
      const s = Math.max(R.START_S, p.s);
      const lane = Math.abs(p.d - R.LANE / 2) < Math.abs(p.d - R.LANE * 1.5) ? R.LANE / 2 : R.LANE * 1.5;
      const q = G.road.posAt(s, lane);
      p.truck.place(q.x, q.y, q.h);
      p.truck.stun = 1.5;
      p.hint = -1;
      toast(p, 'Yola dönüldü ' + RULES.reset, '#ffd54f', 1.2);
    } else {
      const e = G.lot.entrance();
      p.truck.place(e.x + (p.idx === 0 ? -150 : 40), e.y, e.th);
      p.truck.stun = 1;
      toast(p, 'Girişe dönüldü ' + RULES.reset, '#ffd54f', 1.2);
    }
  }

  function startUnload(p) {
    p.phase = 'unload';
    p.times.park = G.time;
    p.stats.parkPts = TR.parkPrecision(p.park);
    p.truck.v = 0;
    p.truck.braking = false;
    p.unloader = new TR.Unloader(p.idx, G.lot, G.plan, p.color);
    TR.Audio.park();
    toast(p, 'PARK TAMAM! +' + p.stats.parkPts, '#69f0ae', 2);
  }

  function finish(p) {
    p.phase = 'done';
    p.times.unload = G.time;
    if (G.winner) return;
    G.winner = p;
    G.state = 'finishing';
    G.overT = 2.4;
    TR.Audio.win();
    toast(p, 'TURU KAZANDIN! +' + RULES.win, '#ffd54f', 3);
    const o = G.players[1 - p.idx];
    toast(o, p.name + ' bitirdi!', '#ff8a80', 3);
  }

  function score(q) {
    if (q.phase === 'done') return 4e6 - q.times.unload;
    if (q.phase === 'unload') return 3e6 + q.unloader.placedCount() * 1000;
    if (q.phase === 'park') {
      const bay = G.lot.bays[q.idx], r = q.truck.trailerRear();
      return 2e6 - Math.hypot(r.x - bay.cx, r.y - bay.y0);
    }
    return 1e6 + q.s;
  }
  G.rankOf = (p) => {
    const o = G.players[1 - p.idx];
    const a = score(p), b = score(o);
    return a > b || (a === b && p.idx === 0) ? 1 : 2;
  };

  // ---------- cameras ----------
  function camTarget(p) {
    const t = p.truck;
    if (p.phase === 'race') {
      const look = U.clamp(t.v, -40, T.MAX_FWD) * 1.15;
      return { x: t.x + Math.cos(t.th) * look, y: t.y + Math.sin(t.th) * look, z: 1.0 - 0.3 * U.clamp(t.v / T.MAX_FWD, 0, 1) };
    }
    if (p.phase === 'park') {
      const c = t.center(), bay = G.lot.bays[p.idx];
      const bx = bay.cx, by = bay.y0 + 150;
      const k = U.clamp(1 - (Math.hypot(c.x - bx, c.y - by) - 200) / 500, 0, 0.45);
      return { x: U.lerp(c.x, bx, k), y: U.lerp(c.y, by, k), z: 0.95 };
    }
    const w = p.unloader.worker;
    return { x: w.x, y: w.y, z: 1.25 };
  }

  function updateCams(dt) {
    for (const p of G.players) {
      const tg = camTarget(p);
      const k = U.damp(dt, p.phase === 'race' ? 5 : 3.5);
      p.cam.x = U.lerp(p.cam.x, tg.x, k);
      p.cam.y = U.lerp(p.cam.y, tg.y, k);
      p.cam.z = U.lerp(p.cam.z, tg.z, U.damp(dt, 1.8));
    }
  }

  function viewports() {
    const half = Math.floor(W / 2);
    return [{ x: 0, y: 0, w: half - 2, h: H }, { x: half + 2, y: 0, w: W - half - 2, h: H }];
  }

  function viewOf(p, vp) {
    const z = p.cam.z * Math.max(0.6, vp.h / 820);
    return {
      z,
      x0: p.cam.x - vp.w / 2 / z, x1: p.cam.x + vp.w / 2 / z,
      y0: p.cam.y - vp.h / 2 / z, y1: p.cam.y + vp.h / 2 / z,
    };
  }

  // ---------- rendering ----------
  function drawGrass(view, theme) {
    const g = 220;
    ctx.fillStyle = theme.patch;
    for (let gx = Math.floor(view.x0 / g); gx <= Math.ceil(view.x1 / g); gx++) {
      for (let gy = Math.floor(view.y0 / g); gy <= Math.ceil(view.y1 / g); gy++) {
        const h = U.hash(gx * 57.3 + gy * 13.1);
        if (h < 0.5) continue;
        const x = gx * g + U.hash(gx * 3.1 + gy * 7.7) * g;
        const y = gy * g + U.hash(gx * 9.9 + gy * 1.3) * g;
        ctx.beginPath();
        ctx.ellipse(x, y, 40 + h * 60, 25 + h * 40, h * 3, 0, 6.283);
        ctx.fill();
      }
    }
  }

  function drawParkGuide(p) {
    const st = p.park;
    if (!st || !st.near) return;
    const bay = G.lot.bays[p.idx];
    const len = T.TR_FRONT + T.LT + T.TR_REAR;
    const aligned = st.angleErr < TR.LOT.ANGLE_TOL && Math.abs(st.lateral) < TR.LOT.LATERAL_MAX;
    ctx.save();
    ctx.strokeStyle = st.ok ? '#69f0ae' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(bay.cx - T.TR_HW, bay.y0 + 2, T.TR_HW * 2, len);
    const r = p.truck.trailerRear();
    const a = p.truck.phi + Math.PI;
    ctx.strokeStyle = aligned ? 'rgba(105,240,174,0.8)' : 'rgba(255,213,79,0.8)';
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + Math.cos(a) * 320, r.y + Math.sin(a) * 320);
    ctx.stroke();
    ctx.restore();
  }

  function drawTruck(q) {
    const open = q.phase === 'unload' || q.phase === 'done';
    q.truck.draw(ctx, { label: !open, steer: !open, open, cargo: q.unloader ? q.unloader.cargoFromDoor() : null, nextGlow: true });
  }

  function renderView(p, vp) {
    const view = viewOf(p, vp);
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    ctx.fillStyle = G.road.theme.grass;
    ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    const sh = TR.Settings.get().shake ? p.shake * 12 : 0;
    ctx.translate(vp.x + vp.w / 2 + (Math.random() - 0.5) * sh, vp.y + vp.h / 2 + (Math.random() - 0.5) * sh);
    ctx.scale(view.z, view.z);
    ctx.translate(-p.cam.x, -p.cam.y);
    drawGrass(view, G.road.theme);
    G.road.draw(ctx, view);
    G.lot.draw(ctx, view, G.players);
    for (const q of G.players) if (q.unloader) q.unloader.drawZone(ctx);
    G.traffic.draw(ctx, view);
    if (p.phase === 'park') drawParkGuide(p);
    for (const q of G.players) drawTruck(q);
    for (const q of G.players) if (q.unloader) q.unloader.drawWorker(ctx, q === p);
    ctx.restore();
    TR.HUD.draw(ctx, vp, p, G);
  }

  function renderPreview(dt) {
    if (!G.preview || G.preview.route !== TR.ROUTES[G.previewIdx]) {
      G.preview = new TR.Road(TR.ROUTES[G.previewIdx]);
      G.previewT = 0;
    }
    const road = G.preview;
    G.previewT += dt;
    const s = 1200 + ((G.previewT * 160) % (road.length - 3000));
    const c = road.posAt(s, 0);
    const z = 0.7 * Math.max(0.6, H / 820);
    const view = { z, x0: c.x - W / 2 / z, x1: c.x + W / 2 / z, y0: c.y - H / 2 / z, y1: c.y + H / 2 / z };
    ctx.save();
    ctx.fillStyle = road.theme.grass;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(z, z);
    ctx.translate(-c.x, -c.y);
    drawGrass(view, road.theme);
    road.draw(ctx, view);
    ctx.restore();
  }

  function render(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, W, H);
    if (G.state === 'menu' || !G.road) {
      renderPreview(dt);
      return;
    }
    const vps = viewports();
    G.players.forEach((p, i) => renderView(p, vps[i]));
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(Math.floor(W / 2) - 2, 0, 4, H);
  }

  window.addEventListener('blur', () => {
    if (TR.Settings.get().autoPause) G.pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && TR.Settings.get().autoPause) G.pause();
  });

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    TR.UI.handleKeys();
    if (G.state !== 'paused' && G.state !== 'menu') update(dt);
    render(dt);
    TR.Input.endFrame();
    requestAnimationFrame(frame);
  }
  // Started by ui.js once TR.UI exists: a frame can run between two script loads.
  G.start = () => requestAnimationFrame(frame);
})();
