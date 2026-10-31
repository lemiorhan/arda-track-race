'use strict';
(function file() {
  window.TR.files.push(file);
  const TR = window.TR, U = TR.U, T = TR.TRUCK, DS = TR.ROAD.DS;

  // MARGIN is the share of the grip-limited bend speed the profile allows. BRAKE_SHARE is the share of
  // the truck's braking the auto brake plans with, so it starts braking a little early. WIN is how many
  // samples either side measure a bend, about one truck length. A bend gets a sign when its speed is
  // under SIGN_BELOW of the top speed, SIGN_LEAD before it starts. At a red light it stops STOP_PAD
  // short of the line.
  const A = (TR.ASSIST = {
    MARGIN: 0.88, BRAKE_SHARE: 0.8, WIN: 6, SIGN_BELOW: 0.92, SIGN_LEAD: 420, HOLD: 6, STOP_PAD: 8,
    PATH_T: 2.4, PATH_DT: 1 / 30,
  });
  TR.ASSIST_LEVELS = [
    { id: 'kapali', name: 'Kapalı' },
    { id: 'hafif', name: 'Hafif' },
    { id: 'tam', name: 'Tam' },
  ];

  // Truck.update caps the tractor's path curvature at LAT * grip / v², so a bend of curvature k can be held
  // up to sqrt(LAT * grip / k). A ring, a toll or a radar caps the speed around it too (TR.POINTS). The
  // limit at each sample is the lower of those and the speed from which the truck can still brake down to
  // every limit further on; bind is the sample whose own limit that is. Bends get a warning sign; points
  // carry their own, and their sign text labels the samples they cap. exit {limit, v, label} is the speed
  // to be under on leaving the segment, and the banner for the samples it binds (bind EXIT).
  const EXIT = -1;
  function prepare(road, exit) {
    const n = road.n, hs = road.hs, w = A.WIN;
    const grip = (i) => (road.route.grip || 1) * road.gripAt(i * DS);
    const safe = new Float64Array(n).fill(Infinity);
    for (let i = w; i < n - w; i++) {
      const k = Math.abs(U.wrap(hs[i + w] - hs[i - w])) / (2 * w * DS);
      if (k > 0) safe[i] = A.MARGIN * Math.sqrt((T.LAT * grip(i)) / k);
    }

    const bends = [], below = A.SIGN_BELOW * T.MAX_FWD;
    for (let i = 0; i < n; i++) {
      if (safe[i] >= below) continue;
      const s = i * DS, last = bends[bends.length - 1];
      if (last && s - last.s1 < A.SIGN_LEAD) {
        last.s1 = s;
        last.v = Math.min(last.v, safe[i]);
      } else bends.push({ s0: s, s1: s, v: safe[i] });
    }
    for (const b of bends) {
      road.signList.push({ s: Math.max(road.isStart ? TR.ROAD.START_LINE + 200 : 0, b.s0 - A.SIGN_LEAD), text: '⚠ ' + signKmh(b.v) + ' km/s', bg: '#e65100' });
    }
    const label = new Array(n).fill('VİRAJ');
    for (const j of road.points) {
      const P = TR.POINTS[j.type], kmh = j.kmh || P.kmh;
      if (!kmh) continue;
      const v = kmh / 0.36;
      for (let i = Math.max(0, Math.ceil((j.s - P.cap[0]) / DS)); i <= Math.min(n - 1, (j.s + P.cap[1]) / DS); i++) {
        if (v > safe[i]) continue;
        safe[i] = v;
        label[i] = P.sign;
      }
    }

    const limit = new Float64Array(n), bind = new Int32Array(n);
    const out = exit ? exit.limit : Infinity;
    limit[n - 1] = Math.min(safe[n - 1], out);
    bind[n - 1] = out < safe[n - 1] ? EXIT : n - 1;
    for (let i = n - 2; i >= 0; i--) {
      const decel = A.BRAKE_SHARE * T.BRAKE * grip(i);
      const reach = Math.sqrt(limit[i + 1] * limit[i + 1] + 2 * decel * DS);
      limit[i] = Math.min(safe[i], reach);
      bind[i] = safe[i] <= reach ? i : bind[i + 1];
    }
    road.assist = { safe, limit, bind, label, exit: exit || null };
  }

  const sample = (road, s) => U.clamp(Math.round(s / DS), 0, road.n - 1);

  function limitAt(road, s) {
    if (s >= road.length) return road.assist.exit ? road.assist.exit.limit : Infinity;
    return road.assist.limit[sample(road, s)];
  }

  // The bend or point whose speed limitAt(road, s) brakes down to, as {v, label}.
  function bindAt(road, s) {
    const a = road.assist, i = a.bind[sample(road, s)];
    if (i === EXIT) return { v: a.exit.v, label: a.exit.label };
    return { v: a.safe[i], label: a.label[i] };
  }

  // Shown speeds are rounded down to a multiple of 5 km/h, the way road signs read.
  const signKmh = (v) => Math.floor((v * 0.36) / 5) * 5;

  // Whether the truck can still stop within dist, braking as hard as S does.
  const canStop = (p, dist) => p.truck.v * p.truck.v <= 2 * T.BRAKE * p.truck.grip * dist;

  // The speed from which full assist stops STOP_PAD short of a stop line stop ahead; Infinity when there
  // is none or the truck can no longer stop for it.
  function redLimit(p, stop) {
    if (stop === Infinity || !canStop(p, stop)) return Infinity;
    return Math.sqrt(2 * A.BRAKE_SHARE * T.BRAKE * p.truck.grip * Math.max(0, stop - A.STOP_PAD));
  }

  // Full assist brakes like the player's own S key would, never harder: the input is rewritten, not the
  // physics. Within HOLD of the limit the throttle is released so the brake does not chatter. stop is
  // the distance to a stop line ahead that is not green (redLimit).
  // Near standstill the brake is let off, since S below 1 would engage reverse.
  function autoBrake(road, p, inp, stop) {
    const v = p.truck.v;
    const lim = Math.min(limitAt(road, p.s + T.CAB_FRONT), redLimit(p, stop));
    if (v > lim) return Object.assign({}, inp, { thr: v > 1 ? -1 : 0 });
    if (v > lim - A.HOLD && inp.thr > 0) return Object.assign({}, inp, { thr: 0 });
    return inp;
  }

  // Runs a copy of the truck through its own update() with the steering held, so the preview cannot drift
  // from the real motion. Stops at the first jackknife.
  function reversePath(truck, steer, cap) {
    const c = Object.assign(Object.create(Object.getPrototypeOf(truck)), truck);
    const inp = { thr: -1, steer, brake: false };
    const pts = [c.trailerRear()];
    for (let t = 0; t < A.PATH_T; t += A.PATH_DT) {
      const jack = c.jack;
      c.update(A.PATH_DT, inp, cap);
      if (c.jack > jack) return { pts, jack: true };
      pts.push(c.trailerRear());
    }
    return { pts, jack: false };
  }

  TR.Assist = { prepare, limitAt, bindAt, signKmh, canStop, redLimit, autoBrake, reversePath };
})();
