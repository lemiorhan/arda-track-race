'use strict';
(function () {
  const TR = window.TR, U = TR.U, T = TR.TRUCK, R = TR.ROAD, RULES = TR.SCORE_RULES;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const COLORS = ['#1e88e5', '#e53935'];
  const DENSITY = { az: 0.6, normal: 1, yogun: 1.4 };
  // After the winner finishes, a rival already in the lot gets LAST_CHANCE seconds to finish too; the
  // round otherwise closes END_DELAY after the last finisher.
  const LAST_CHANCE = 20, END_DELAY = 2.4;
  // Slipstream: within DIST behind the other truck's trailer and LANE of its line, the top speed rises by
  // up to BOOST, building over RISE seconds and fading over FALL.
  const DRAFT = { DIST: 380, LANE: 30, BOOST: 0.12, RISE: 1.2, FALL: 2.5, MIN_V: 120 };
  // Turbo: once a round, at a point picked within AT of the route, the top speed rises by BOOST for LEN
  // seconds, and same-direction cars do not hit the truck meanwhile (Traffic.collide).
  const TURBO = { AT: [0.15, 0.7], LEN: [5, 10], BOOST: 0.45 };
  // The horn moves the first same-direction car within RANGE ahead; it works again after CD seconds.
  const HORN = { RANGE: 420, CD: 2.5 };

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
  G.newSeries = (names, assist) => {
    const s = TR.Settings.get();
    G.series = {
      id: Date.now(), rounds: s.rounds, round: 1, names: (names || s.names).slice(), assist: (assist || s.assist).slice(),
      totals: [0, 0], wins: [0, 0], history: [],
    };
  };

  G.isLastRound = () => G.series.history.length >= G.series.rounds;

  // An online guest passes the host's opts, so both machines build the same round.
  G.startRound = (ri, opts) => {
    const sr = G.series;
    sr.round = sr.history.length + 1;
    const route = TR.ROUTES[ri];
    const s = TR.Settings.get();
    const o = (G.roundOpts = Object.assign({ ri, seed: ((Date.now() & 0xffffff) ^ route.seed) >>> 0, traffic: s.traffic, weather: s.weather }, opts));
    const seed = o.seed;
    G.routeIdx = ri;
    G.route = route;
    G.road = new TR.Road(route);
    TR.Assist.prepare(G.road);
    G.lot = new TR.Lot(G.road.endX, G.road.endY);
    G.events = new TR.Events(G.road, seed * 23 + 7);
    G.traffic = new TR.Traffic(G.road, route, seed, DENSITY[o.traffic] || 1, G.events);
    G.junctions = new TR.Junctions(G.road, G.traffic, seed * 19 + 11);
    G.plan = TR.makeCargoPlan(U.rng(seed * 7 + 3));
    G.contract = U.rng(seed * 13 + 5).pick(TR.CONTRACTS);
    G.weather = o.weather === 'karisik' ? U.rng(seed * 17 + 9).pick(['gunduz', 'gece', 'sis']) : 'gunduz';
    const turboRnd = U.rng(seed * 29 + 13);
    G.players = COLORS.map((color, i) => {
      const lane = i === 0 ? R.LANE / 2 : R.LANE * 1.5;
      const q = G.road.posAt(R.START_S, lane);
      const truck = new TR.Truck(i, color, q.x, q.y, q.h);
      truck.grip = route.grip || 1;
      return {
        idx: i, name: sr.names[i], color, truck, assist: sr.assist[i],
        phase: 'race', s: R.START_S, d: lane, hint: -1, offroad: false,
        inp: null, autoT: 0, draft: 0, hornCd: 0, nearMisses: 0, redLights: 0, speeding: 0, flashT: 0, redAhead: Infinity,
        crashes: 0, bumps: 0, resets: 0, bumpCd: 0, railCd: 0, skidD: 0,
        turbo: 0, ghost: false, turboS: G.road.length * turboRnd.range(...TURBO.AT), turboLen: turboRnd.range(...TURBO.LEN),
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
    G.lastChance = false;
    G.touchCd = 0;
    TR.FX.reset();
    TR.Online.share('round', o);
  };

  G.restartRound = () => G.startRound(G.routeIdx);

  // An online guest only asks; the host pauses and resumes both machines.
  G.pause = () => {
    if (TR.Online.ask('pause')) return;
    if (G.state !== 'play' && G.state !== 'countdown') return;
    G.paused = G.state;
    G.state = 'paused';
    TR.UI.showPause();
    TR.Online.share('pause');
  };

  G.resume = () => {
    if (TR.Online.ask('resume')) return;
    if (G.state !== 'paused') return;
    G.state = G.paused;
    TR.UI.hideAll();
    TR.Online.share('resume');
  };

  G.toMenu = () => {
    G.state = 'menu';
    G.series = null;
  };

  // The records list keeps the round's own score, before the final round's multiplier. Returns each
  // player's place in it, or -1.
  G.recordRound = (scores) => G.players.map((p, i) => scores[i].base > 0
    ? TR.Scores.addRound({ name: p.name, color: p.color, route: G.route.name, score: scores[i].base, date: Date.now(), assist: p.assist })
    : -1);

  function endRound() {
    const sr = G.series;
    const scores = G.players.map((p) => TR.roundScore(p, G, true));
    scores.forEach((sc, i) => (sr.totals[i] += sc.total));
    sr.wins[G.winner.idx]++;
    sr.history.push({ route: G.route.name, scores: scores.map((sc) => sc.total), winner: G.winner.idx, time: G.winner.times.unload });
    const places = G.recordRound(scores);
    const titles = TR.roundTitles(G.players);
    G.state = 'roundover';
    TR.UI.showRoundResult(scores, places, titles);
    TR.Online.share('roundResult', { scores, titles });
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
    for (const p of G.players) emitFx(p, dt);
    TR.FX.update(dt);
    // Traffic appears out of sight of every screen, the online guest's too.
    const views = viewports().concat(TR.Online.remoteViewports()).map((vp) => viewOf(G.players[vp.idx], vp));
    for (const e of G.junctions.update(dt, G.players, G.time)) junctionEvent(e);
    for (const e of G.events.update(dt, G.players, G.traffic)) roadEvent(e);
    G.traffic.update(dt, G.players, views, () => TR.Audio.horn(), G.junctions);
    for (const h of G.traffic.collide(G.players).concat(G.junctions.collide(G.players))) crash(h.player, h.headOn, h.car);
    for (const p of G.traffic.nearMisses(G.players)) nearMiss(p);
    updateCams(dt);
    if (G.state === 'finishing') {
      G.overT -= dt;
      const n = Math.ceil(G.overT);
      if (G.lastChance && n < G.lastBeep && n <= 5 && n > 0) { G.lastBeep = n; TR.Audio.beep(); }
      if (G.overT <= 0) endRound();
    }
  }

  function updatePlayer(p, dt) {
    let inp = TR.Input.player(p.idx);
    p.inp = inp;
    if (p.toastT > 0) p.toastT -= dt;
    if (p.autoT > 0) p.autoT -= dt;
    if (p.hornCd > 0) p.hornCd -= dt;
    if (p.flashT > 0) p.flashT -= dt;
    if (p.shake > 0) p.shake = Math.max(0, p.shake - dt * 2.5);
    p.bumpCd -= dt;
    p.railCd -= dt;
    if (p.phase === 'race' || p.phase === 'park') {
      if (inp.reset) recover(p);
      const loc = G.road.locate(p.truck.x, p.truck.y, p.hint);
      p.hint = loc.i;
      p.s = loc.s;
      p.d = G.road.laneD(loc.s, loc.d);
      if (inp.horn && p.hornCd <= 0) {
        p.hornCd = HORN.CD;
        TR.Audio.truckHorn();
        G.traffic.yieldTo(p, G.players, HORN.RANGE);
      }
      p.offroad = p.phase === 'race' && Math.abs(p.d) > R.HALF + 4 && loc.s < G.road.length && !G.junctions.onSide(p.truck.x, p.truck.y);
      p.redAhead = p.phase === 'race' ? G.junctions.stopAhead(p) : Infinity;
      updateDraft(p, dt);
      updateTurbo(p, dt);
      const boost = DRAFT.BOOST * p.draft + (p.turbo > 0 ? TURBO.BOOST : 0);
      const cap = p.phase === 'park' ? T.LOT_CAP : p.offroad ? T.OFFROAD_CAP : T.MAX_FWD * (1 + boost);
      if (p.phase === 'race' && p.assist === 'tam' && !inp.brake) {
        const auto = TR.Assist.autoBrake(G.road, p, inp, p.redAhead);
        if (auto.thr < 0 && inp.thr >= 0) p.autoT = 0.5;
        inp = auto;
      }
      const jacked = p.truck.jack > 0;
      p.truck.grip = (G.route.grip || 1) * (p.phase === 'race' ? G.road.gripAt(p.s) : 1);
      p.truck.update(dt, inp, cap);
      if (!jacked && p.truck.jack > 0) TR.Audio.jack();
    } else if (p.phase === 'unload') {
      p.unloader.update(dt, inp);
      if (p.unloader.complete()) finish(p);
    } else if (p.phase === 'done' && p.unloader) {
      p.unloader.update(dt, { mx: inp.mx, my: inp.my, action: false });
    }
  }

  // The other truck's s is its rear axle; its trailer ends LT + TR_REAR behind that, and this truck's
  // nose sits CAB_FRONT ahead of its own.
  function updateDraft(p, dt) {
    const o = G.players[1 - p.idx];
    const gap = o.s - p.s - (T.LT + T.TR_REAR + T.CAB_FRONT);
    const inZone = p.phase === 'race' && o.phase === 'race' && !p.offroad && p.truck.v > DRAFT.MIN_V &&
      gap > 0 && gap < DRAFT.DIST && Math.abs(o.d - p.d) < DRAFT.LANE;
    p.draft = inZone ? Math.min(1, p.draft + dt / DRAFT.RISE) : Math.max(0, p.draft - dt / DRAFT.FALL);
  }

  function updateTurbo(p, dt) {
    if (p.phase !== 'race') p.turbo = 0;
    else if (p.turbo > 0) p.turbo = Math.max(0, p.turbo - dt);
    else if (p.s >= p.turboS) {
      p.turbo = p.turboLen;
      p.turboS = Infinity;
      p.ghost = true;
      TR.Audio.go();
      toast(p, 'TURBO!', '#ffab40', 1.4);
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
    // A junction sets its own bounds (side roads, a ring's island); elsewhere the barrier runs along the road.
    let worst = null;
    for (const b of t.boxes()) {
      for (const c of U.corners(b)) {
        if (G.lot.contains(c.x, c.y)) continue;
        let push = G.junctions.limit(c.x, c.y);
        if (push === undefined) {
          const loc = road.locate(c.x, c.y, p.hint);
          if (loc.s >= road.length - 2) continue;
          const sg = Math.sign(loc.d);
          push = { over: Math.abs(loc.d) - road.railAt(loc.s), nx: -road.nx[loc.i] * sg, ny: -road.ny[loc.i] * sg };
        }
        if (push && push.over > 0 && (!worst || push.over > worst.over)) worst = push;
      }
    }
    if (worst) {
      t.x += worst.nx * worst.over;
      t.y += worst.ny * worst.over;
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

  function crash(p, headOn, car) {
    TR.FX.burst('spark', 18, car.x, car.y, 260);
    TR.FX.burst('debris', 8, car.x, car.y, 160, car.color);
    if (p.truck.stun > 0.3) return;
    p.crashes++;
    p.truck.v = headOn ? 0 : Math.min(p.truck.v, 40);
    p.truck.stun = headOn ? 1.6 : 0.9;
    p.shake = 1;
    TR.Audio.crash();
    toast(p, (headOn ? 'KAFA KAFAYA! ' : 'KAZA! ') + RULES.crash, '#ff5252');
  }

  // Wheel positions come from the trailer axle, LT behind the hitch along the trailer's heading.
  function emitFx(p, dt) {
    if (p.phase !== 'race' && p.phase !== 'park') return;
    const t = p.truck, c = Math.cos(t.th), s = Math.sin(t.th);
    if (p.inp && p.inp.thr > 0 && Math.random() < 20 * dt) {
      const x = t.x + c * 6 + s * (T.CAB_HW - 3), y = t.y + s * 6 - c * (T.CAB_HW - 3);
      TR.FX.emit('exhaust', x, y, -c * 30 + (Math.random() - 0.5) * 20, -s * 30 + (Math.random() - 0.5) * 20);
    }
    if (p.turbo > 0 && Math.random() < 40 * dt) {
      const x = t.x + c * 6 + s * (T.CAB_HW - 3), y = t.y + s * 6 - c * (T.CAB_HW - 3);
      TR.FX.emit('spark', x, y, -c * 90 + (Math.random() - 0.5) * 40, -s * 90 + (Math.random() - 0.5) * 40, '#ff9100');
    }
    const fast = Math.abs(t.v) > 40;
    const pc = Math.cos(t.phi), ps = Math.sin(t.phi), hw = T.TR_HW * 0.8;
    const wheels = [-1, 1].map((k) => ({ x: t.x - pc * T.LT + ps * k * hw, y: t.y - ps * T.LT - pc * k * hw }));
    const dirt = p.phase === 'race' && G.road.dirtAt(p.s);
    if ((p.offroad || dirt) && fast && Math.random() < 30 * dt) {
      const dust = G.road.theme.shoulder || '#a58f6a';
      for (const w of wheels) TR.FX.emit('dust', w.x, w.y, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, dust);
    }
    if ((G.route.grip || 1) < 1 && t.braking && fast) {
      p.skidD += Math.abs(t.v) * dt;
      if (p.skidD > 8) {
        p.skidD = 0;
        for (const w of wheels) TR.FX.emit('skid', w.x, w.y);
      }
    }
  }

  function junctionEvent(e) {
    const p = e.p;
    if (e.type === 'red') {
      p.redLights++;
      TR.Audio.fine();
      toast(p, 'KIRMIZIDA GEÇTİN! ' + RULES.redLight, '#ff8a80', 1.4);
    } else if (e.type === 'radar') {
      p.speeding++;
      p.flashT = e.flash;
      TR.Audio.fine();
      toast(p, 'RADARA YAKALANDIN! ' + RULES.speeding, '#ff8a80', 1.4);
    } else {
      const t = p.truck;
      p.bumps++;
      t.stun = Math.max(t.stun, e.stun);
      p.shake = Math.max(p.shake, 0.5);
      TR.FX.burst('debris', 10, t.x + Math.cos(t.th) * T.CAB_FRONT, t.y + Math.sin(t.th) * T.CAB_FRONT, 180, '#e53935');
      TR.Audio.bump();
      toast(p, 'GİŞE KOLUNU KIRDIN! ' + RULES.bump, '#ff8a80', 1.2);
    }
  }

  // A cone costs a bump like the lot's walls, at most one per bumpCd however many go down.
  function roadEvent(e) {
    const p = e.p, t = p.truck;
    if (e.type === 'sheep') {
      t.v = U.clamp(t.v, -e.v, e.v);
      t.stun = Math.max(t.stun, e.stun);
      p.shake = Math.max(p.shake, 0.5);
      TR.Audio.sheep();
      toast(p, 'KOYUNLAR KAÇIŞTI!', '#fff59d', 1.4);
    } else if (p.bumpCd <= 0) {
      p.bumpCd = 0.5;
      p.bumps++;
      TR.Audio.bump();
      toast(p, 'DUBAYA ÇARPTIN! ' + RULES.bump, '#ff8a80', 1.2);
    }
  }

  function nearMiss(p) {
    if (p.nearMisses >= RULES.nearMissMax) return;
    p.nearMisses++;
    TR.Audio.nearMiss();
    toast(p, 'KIL PAYI! +' + RULES.nearMiss, '#ffd740', 1.2);
  }

  function recover(p) {
    p.resets++;
    if (p.phase === 'race') {
      const s = Math.max(R.START_S, p.s);
      const lane = Math.abs(p.d - R.LANE / 2) < Math.abs(p.d - R.LANE * 1.5) ? R.LANE / 2 : R.LANE * 1.5;
      const q = G.road.lanePos(s, lane);
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
    if (G.winner) {
      G.lastChance = false;
      G.overT = Math.min(G.overT, END_DELAY);
      TR.Audio.good();
      toast(p, 'SEN DE BİTİRDİN!', '#69f0ae', 2);
      return;
    }
    G.winner = p;
    G.state = 'finishing';
    const o = G.players[1 - p.idx];
    G.lastChance = o.phase === 'park' || o.phase === 'unload';
    G.overT = G.lastChance ? LAST_CHANCE : END_DELAY;
    G.lastBeep = Math.ceil(G.overT);
    TR.Audio.win();
    toast(p, 'TURU KAZANDIN! +' + RULES.win, '#ffd54f', 3);
    toast(o, p.name + ' bitirdi!' + (G.lastChance ? ' Kutuları yetiştir!' : ''), '#ff8a80', 3);
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
      const look = U.clamp(t.v, -40, T.MAX_FWD * (1 + TURBO.BOOST)) * 1.15;
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

  // Online, a machine may show only its own player's truck, full width.
  function viewports() {
    const solo = TR.Online.soloIdx();
    if (solo >= 0) return [{ idx: solo, x: 0, y: 0, w: W, h: H }];
    const half = Math.floor(W / 2);
    return [{ idx: 0, x: 0, y: 0, w: half - 2, h: H }, { idx: 1, x: half + 2, y: 0, w: W - half - 2, h: H }];
  }
  G.viewSizes = () => viewports().map((vp) => ({ idx: vp.idx, w: vp.w, h: vp.h }));

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

  function drawReversePath(p) {
    const inp = p.inp;
    if (p.assist === 'kapali' || !inp || inp.brake || !(inp.thr < 0 || p.truck.v < -2)) return;
    const path = TR.Assist.reversePath(p.truck, inp.steer, T.LOT_CAP);
    const pts = path.pts, end = pts[pts.length - 1];
    ctx.save();
    const color = path.jack ? '#ff5252' : '#4fc3f7';
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const q of pts) ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(end.x, end.y, path.jack ? 9 : 6, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function drawDraft(q) {
    const t = q.truck, c = Math.cos(t.th), s = Math.sin(t.th), off = (G.time * 600) % 60;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * q.draft).toFixed(2) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const along = T.CAB_FRONT + 10 - k * 60 - off, w = side * (T.TR_HW + 8 + (k % 2) * 6);
        const x = t.x + c * along - s * w, y = t.y + s * along + c * w;
        ctx.moveTo(x, y);
        ctx.lineTo(x - c * 34, y - s * 34);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTruck(q) {
    const open = q.phase === 'unload' || q.phase === 'done';
    q.truck.draw(ctx, { label: !open, steer: !open, open, cargo: q.unloader ? q.unloader.cargoFromDoor() : null, nextGlow: true });
  }

  function renderView(p, vp, solo) {
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
    G.events.draw(ctx, view);
    G.traffic.draw(ctx, view);
    G.junctions.draw(ctx, view);
    TR.FX.draw(ctx, view, false);
    if (p.phase === 'park') {
      drawParkGuide(p);
      drawReversePath(p);
    }
    for (const q of G.players) drawTruck(q);
    for (const q of G.players) if (q.draft > 0.15) drawDraft(q);
    TR.FX.draw(ctx, view, true);
    for (const q of G.players) if (q.unloader) q.unloader.drawWorker(ctx, q === p);
    const world = ctx.getTransform();
    ctx.restore();
    TR.Light.draw(ctx, vp, view, p, G, world, DPR);
    if (G.route.id === 'kar') TR.FX.drawSnow(ctx, vp, p.cam, G.time);
    TR.HUD.draw(ctx, vp, p, G);
    if (solo) TR.HUD.drawRival(ctx, vp, p, G);
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
    for (const vp of vps) renderView(G.players[vp.idx], vp, vps.length === 1);
    if (vps.length === 1) return;
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(Math.floor(W / 2) - 2, 0, 4, H);
  }

  // A hidden tab gets no animation frames, so online a hidden host would freeze both machines; it pauses
  // whatever the setting says.
  window.addEventListener('blur', () => {
    if (TR.Settings.get().autoPause) G.pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (TR.Settings.get().autoPause || TR.Online.role)) G.pause();
  });

  // Engines idle through the countdown and fall silent in menus, pause, the round result and once a
  // truck is parked for unloading.
  function updateEngines() {
    const live = G.state === 'play' || G.state === 'finishing' || G.state === 'countdown';
    G.players.forEach((p, i) => TR.Audio.engine(i, {
      on: live && (p.phase === 'race' || p.phase === 'park'),
      v: p.truck.v, thr: p.inp ? p.inp.thr : 0, brake: !!(p.inp && p.inp.brake),
    }));
  }

  // An online guest simulates nothing: it shows the host's latest state and moves only its own cameras
  // and particles.
  function guestUpdate(dt) {
    TR.Online.apply();
    if (!G.road || !['countdown', 'play', 'finishing'].includes(G.state)) return;
    updateCams(dt);
    TR.FX.update(dt);
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    TR.UI.handleKeys();
    if (TR.Online.role === 'guest') guestUpdate(dt);
    else if (G.state !== 'paused' && G.state !== 'menu') update(dt);
    TR.Online.tick(now);
    render(dt);
    updateEngines();
    TR.Input.endFrame();
    requestAnimationFrame(frame);
  }
  // Started by ui.js once TR.UI exists: a frame can run between two script loads.
  G.start = () => requestAnimationFrame(frame);
})();
