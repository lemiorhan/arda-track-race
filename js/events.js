'use strict';
(function () {
  const TR = window.TR, U = TR.U, T = TR.TRUCK;
  const { LANE, HALF, RAIL } = TR.ROAD;

  // A flock grazes on one verge, VERGE from the centre line and SPREAD either side of its point. When a
  // racer that has not met it yet comes within TRIGGER of it, but no closer than LATE, it crosses to the
  // other verge. Cars that can still stop GAP short of it do; the sheep wait at EDGE until the rest have
  // gone by. Each sheep sets off within LAG seconds at a pace drawn from WALK. A truck that touches a sheep
  // drops to HIT_V and is stunned for STUN, at most once every CD seconds; the sheep beside it run for the
  // far verge at RUN times their pace for RUN_T seconds.
  const FLOCK = {
    N: 16, SPREAD: 46, VERGE: RAIL + 34, EDGE: HALF + 12, TRIGGER: 1100, LATE: 350, LAG: 2.2, WALK: [38, 60], GAP: 30,
    HIT_V: 60, STUN: 1.1, CD: 1.2, SCATTER: 120, RUN: 4, RUN_T: 1.2,
  };
  // Roadworks close one direction's outer lane over LEN (a range). Cones stand STEP apart along a line
  // that tapers in from the road edge over TAPER at both ends, with a row across the lane every ROW. Cars
  // in that lane move over from MERGE before the taper, or wait GAP short of it. The flagman stands FLAG
  // ahead of the taper.
  const WORK = { LEN: [500, 800], TAPER: 160, STEP: 34, ROW: 260, MERGE: 450, GAP: 20, FLAG: 40 };
  // A knocked cone flies off with the truck's velocity plus KICK away from it and slides to rest at SLIDE.
  const CONE = { R: 7, KICK: 120, SLIDE: 2.4 };
  // Cars brake for a flock or a closure at DECEL.
  const DECEL = 180;
  // Events go between FROM and END_GAP before the road's end, CLEAR from every road section and point,
  // and APART from each other. Each has a warning sign SIGN before it, SIGN_GAP from any other sign.
  const PLACE = { FROM: 3500, END_GAP: 2500, CLEAR: 500, APART: 2500, SIGN: 450, SIGN_GAP: 250, TRIES: 40 };
  const WARN = '#e65100';

  // A round's roadside events: a flock of sheep that crosses the road as racers come, and roadworks that
  // close a lane. Both are placed from the round's seed, so the two players meet the same ones. opts says
  // which of the two this road gets: false, true for a seeded spot, or the s the map placed it at (a flock's
  // middle, the start of the closure), whose stretch is SPAN before and after it, sign included. It also
  // moves the seeded window's ends: from in place of FROM, endGap when it is longer than END_GAP.
  class Events {
    constructor(road, seed, opts) {
      const o = Object.assign({ flock: true, work: true, from: PLACE.FROM, endGap: PLACE.END_GAP }, opts);
      o.endGap = Math.max(PLACE.END_GAP, o.endGap);
      this.road = road;
      this.rnd = U.rng(seed);
      this.time = 0;
      this.flocks = [];
      this.works = [];
      const busy = road.sections.map((sec) => [sec.s0, sec.s1])
        .concat(road.points.map((j) => [j.s - (TR.POINTS[j.type].flat || 0), j.s + (TR.POINTS[j.type].flat || 0)]));
      const taken = [];
      // A spot for an event reaching before and after its anchor s, with its sign ahead of that.
      const spot = (want, before, after, text) => {
        if (typeof want === 'number') {
          taken.push([want - before - PLACE.SIGN, want + after]);
          road.signList.push({ s: want - before - PLACE.SIGN, text, bg: WARN });
          return want;
        }
        for (let k = 0; k < PLACE.TRIES; k++) {
          const s = this.rnd.range(o.from + before + PLACE.SIGN, road.length - o.endGap - after);
          const a = s - before - PLACE.SIGN, b = s + after;
          if (busy.some(([b0, b1]) => a < b1 + PLACE.CLEAR && b > b0 - PLACE.CLEAR)) continue;
          if (taken.some(([t0, t1]) => a < t1 + PLACE.APART && b > t0 - PLACE.APART)) continue;
          if (!road.signFree(a, PLACE.SIGN_GAP)) continue;
          taken.push([a, b]);
          road.signList.push({ s: a, text, bg: WARN });
          return s;
        }
        return null;
      };
      if (o.flock) {
        const fs = spot(o.flock, FLOCK.SPREAD, FLOCK.SPREAD, '⚠ KOYUN SÜRÜSÜ');
        if (fs != null) this.flocks.push(this.makeFlock(fs));
      }
      if (o.work) {
        const len = this.rnd.range(WORK.LEN[0], WORK.LEN[1]);
        const ws = spot(o.work, WORK.TAPER + WORK.FLAG, len + WORK.TAPER + WORK.FLAG, '⚠ YOL ÇALIŞMASI');
        if (ws != null) this.works.push(this.makeWork(ws, len, this.rnd() < 0.5 ? 1 : -1));
      }
    }

    makeFlock(s) {
      const r = this.rnd, side = r() < 0.5 ? -1 : 1;
      const f = { s, side, crossing: false, pass: [], met: [false, false], cd: [0, 0], sheep: [] };
      for (let i = 0; i < FLOCK.N; i++) {
        const d = side * (FLOCK.VERGE + r.range(-14, 26));
        f.sheep.push({ u: r.range(-FLOCK.SPREAD, FLOCK.SPREAD), d, goal: d, wait: 0, pace: r.range(FLOCK.WALK[0], FLOCK.WALK[1]),
          run: 0, du: 0, graze: r.range(0, 6.283), x: 0, y: 0, h: 0, moving: false });
      }
      for (const q of f.sheep) this.placeSheep(q, f, 0);
      return f;
    }

    // The closed stretch is [s0, s1]; a car of the closed direction meets the taper at entry and leaves it at exit.
    makeWork(s0, len, dir) {
      const s1 = s0 + len, road = this.road;
      const w = {
        dir, s0, s1, d: dir * LANE * 1.5, cones: [],
        entry: dir > 0 ? s0 - WORK.TAPER : s1 + WORK.TAPER, exit: dir > 0 ? s1 + WORK.TAPER : s0 - WORK.TAPER,
        yTop: road.posAt(s1 + WORK.TAPER, 0).y, yBot: road.posAt(s0 - WORK.TAPER, 0).y,
      };
      const edge = dir * (HALF - 6), line = dir * (LANE + 8);
      for (let s = s0 - WORK.TAPER; s <= s1 + WORK.TAPER; s += WORK.STEP) {
        const into = Math.min(s - s0 + WORK.TAPER, s1 + WORK.TAPER - s) / WORK.TAPER;
        this.addCone(w, s, U.lerp(edge, line, Math.min(1, into)));
      }
      for (let s = s0 + WORK.ROW / 2; s < s1; s += WORK.ROW) {
        for (const k of [0.35, 0.7]) this.addCone(w, s, U.lerp(line, edge, k));
      }
      w.flag = road.posAt(w.entry - dir * WORK.FLAG, dir * (RAIL + 18));
      return w;
    }

    addCone(w, s, d) {
      const p = this.road.posAt(s, d);
      w.cones.push({ x: p.x, y: p.y, h: 0, fly: null });
    }

    // Moves the flocks and knocked cones and finds trucks that touch a sheep or a cone. Returns events for
    // the game to apply: {type: 'sheep', p, v, stun} | {type: 'cone', p}.
    update(dt, players, traffic) {
      this.time += dt;
      const out = [];
      for (const f of this.flocks) this.updateFlock(f, dt, players, traffic, out);
      for (const w of this.works) this.updateWork(w, dt, players, out);
      return out;
    }

    updateFlock(f, dt, players, traffic, out) {
      const ahead = (p) => f.s - p.s - T.CAB_FRONT;
      for (const p of players) {
        f.cd[p.idx] -= dt;
        if (ahead(p) < -FLOCK.SPREAD) f.met[p.idx] = true;
      }
      if (!f.crossing) {
        const due = players.filter((p) => p.phase === 'race' && !f.met[p.idx] && ahead(p) < FLOCK.TRIGGER);
        if (due.some((p) => ahead(p) > FLOCK.LATE)) {
          for (const p of due) f.met[p.idx] = true;
          f.crossing = true;
          f.side = -f.side;
          f.pass = traffic.cars.filter((c) => {
            const gap = c.dormant > 0 || c.wreck ? Infinity : this.flockGap(f, c);
            return gap < Infinity && gap <= (c.v * c.v) / (2 * DECEL);
          });
          for (const q of f.sheep) {
            q.goal = f.side * (FLOCK.VERGE + this.rnd.range(-14, 26));
            q.wait = this.rnd.range(0, FLOCK.LAG);
          }
        }
      }
      f.pass = f.pass.filter((c) => c.dormant <= 0 && !c.wreck && this.flockGap(f, c) < Infinity);
      let moving = false;
      for (const q of f.sheep) {
        if (q.wait > 0) {
          q.wait -= dt;
          moving = true;
          continue;
        }
        const pace = q.pace * (q.run > 0 ? FLOCK.RUN : 1);
        let d = U.approach(q.d, q.goal, pace * dt);
        if (f.pass.length && q.run <= 0 && Math.abs(q.d) >= FLOCK.EDGE && Math.abs(d) < FLOCK.EDGE) d = Math.sign(q.d) * FLOCK.EDGE;
        q.d = d;
        if (q.run > 0) {
          q.run -= dt;
          q.u = U.clamp(q.u + q.du * dt, -FLOCK.SPREAD, FLOCK.SPREAD);
        }
        q.moving = q.d !== q.goal || q.run > 0;
        if (q.moving) moving = true;
        if (Math.abs(q.d) === FLOCK.EDGE && f.pass.length) q.moving = false;
        this.placeSheep(q, f, Math.sign(q.goal - q.d) * pace);
      }
      if (f.crossing && !moving) f.crossing = false;

      for (const p of players) {
        if (p.phase !== 'race' || Math.abs(ahead(p)) > 400) continue;
        const boxes = p.truck.boxes();
        const touched = f.sheep.some((q) => Math.abs(q.d) < RAIL && boxes.some((b) => U.sat(b, U.obb(q.x, q.y, 8, 6, q.h))));
        if (!touched) continue;
        const rear = p.s - T.LT - T.TR_REAR;
        for (const q of f.sheep) {
          const s = f.s + q.u;
          if (s < rear - 30 || s > p.s + T.CAB_FRONT + FLOCK.SCATTER || Math.abs(q.d - p.d) > FLOCK.SCATTER) continue;
          q.goal = (Math.sign(q.d - p.d) || 1) * (FLOCK.VERGE + this.rnd.range(-14, 26));
          q.run = FLOCK.RUN_T;
          q.wait = 0;
          q.du = this.rnd.range(-60, 60);
        }
        if (f.cd[p.idx] > 0) continue;
        f.cd[p.idx] = FLOCK.CD;
        out.push({ type: 'sheep', p, v: FLOCK.HIT_V, stun: FLOCK.STUN });
      }
    }

    // Heads a walking sheep along its path (lat across the road, du along it); a still one grazes.
    placeSheep(q, f, lat) {
      const p = this.road.posAt(f.s + q.u, q.d);
      q.x = p.x;
      q.y = p.y;
      const du = q.run > 0 ? q.du : 0;
      q.h = lat || du ? p.h + Math.atan2(lat, du) : p.h + q.graze + 0.3 * Math.sin(this.time * 0.7 + q.graze * 5);
    }

    // How far a car's nose is from GAP short of a flock's near edge; Infinity once its rear is past the far edge.
    // The s distance is scaled by the shorter of the lane's stretch (Road.stretchAt) at the car and at the flock.
    flockGap(f, c) {
      const k = Math.min(this.road.stretchAt(c.s, c.d), this.road.stretchAt(f.s, c.d));
      const gap = ((f.s - c.s) * c.dir - FLOCK.SPREAD) * k - c.len / 2 - FLOCK.GAP;
      return gap < -(2 * FLOCK.SPREAD * k + c.len + FLOCK.GAP) ? Infinity : gap;
    }

    updateWork(w, dt, players, out) {
      for (const c of w.cones) {
        if (!c.fly) continue;
        c.x += c.fly.vx * dt;
        c.y += c.fly.vy * dt;
        c.h += c.fly.spin * dt;
        const k = Math.exp(-dt * CONE.SLIDE);
        c.fly.vx *= k; c.fly.vy *= k; c.fly.spin *= k;
      }
      for (const p of players) {
        if (p.phase !== 'race' || p.s < w.s0 - WORK.TAPER - 300 || p.s > w.s1 + WORK.TAPER + 300) continue;
        const t = p.truck, boxes = t.boxes();
        let hit = false;
        for (const c of w.cones) {
          if (c.fly) continue;
          const cb = U.obb(c.x, c.y, CONE.R, CONE.R, 0);
          const m = boxes.map((b) => U.sat(b, cb)).find(Boolean);
          if (!m) continue;
          c.fly = {
            vx: Math.cos(t.th) * t.v + m.nx * CONE.KICK, vy: Math.sin(t.th) * t.v + m.ny * CONE.KICK,
            spin: (this.rnd() < 0.5 ? -1 : 1) * this.rnd.range(4, 9),
          };
          hit = true;
        }
        if (hit) out.push({ type: 'cone', p });
      }
    }

    // The fastest a main-road car may go now and still stop GAP short of a crossing flock. A car that was
    // already too close to stop when the crossing began drives on, and the sheep wait for it.
    carLimit(c) {
      let lim = Infinity;
      for (const f of this.flocks) {
        if (!f.crossing || f.pass.includes(c)) continue;
        const gap = this.flockGap(f, c);
        if (gap < Infinity) lim = Math.min(lim, Math.sqrt(2 * DECEL * Math.max(0, gap)));
      }
      return lim;
    }

    // How far a car of half length half at s can still go along dir before the closed stretch of lane d,
    // keeping GAP: negative once inside it, Infinity when no closure of that lane begins within MERGE.
    shutAhead(dir, d, s, half) {
      let best = Infinity;
      for (const w of this.works) {
        if (w.dir !== dir || Math.abs(d - w.d) > 30) continue;
        const entry = (w.entry - s) * dir - half - WORK.GAP, exit = (w.exit - s) * dir + half;
        if (exit > 0 && entry < WORK.MERGE) best = Math.min(best, entry);
      }
      return best;
    }

    // Whether a car may appear where it stands at its speed: not in a closed lane, and able to stop short of
    // a crossing flock it has not passed.
    spawnOk(c) {
      if (this.shutAhead(c.dir, c.d, c.s, c.len / 2) !== Infinity) return false;
      return this.flocks.every((f) => {
        if (!f.crossing) return true;
        const gap = this.flockGap(f, c);
        return gap === Infinity || gap > (c.v * c.v) / (2 * DECEL);
      });
    }

    draw(ctx, view) {
      for (const w of this.works) {
        if (w.yTop > view.y1 + 200 || w.yBot < view.y0 - 200) continue;
        this.drawPatch(ctx, w);
        for (const c of w.cones) drawCone(ctx, c);
        drawFlagman(ctx, w.flag, this.time);
      }
      for (const f of this.flocks) {
        const y = this.road.posAt(f.s, 0).y;
        if (y > view.y1 + 300 || y < view.y0 - 300) continue;
        for (const q of f.sheep) drawSheep(ctx, q, this.time);
      }
    }

    // The torn-up asphalt of the closed stretch.
    drawPatch(ctx, w) {
      const road = this.road, pts = [];
      const d0 = w.dir * (LANE + 16), d1 = w.dir * (HALF - 2);
      for (let s = w.s0; s <= w.s1; s += 16) pts.push(road.posAt(s, d0));
      for (let s = w.s1; s >= w.s0; s -= 16) pts.push(road.posAt(s, d1));
      ctx.fillStyle = 'rgba(70,52,36,0.55)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  Events.DECEL = DECEL;
  Events.SPAN = {
    flock: [FLOCK.SPREAD + PLACE.SIGN, FLOCK.SPREAD],
    work: [WORK.TAPER + WORK.FLAG + PLACE.SIGN, WORK.LEN[1] + WORK.TAPER + WORK.FLAG],
  };

  function drawCone(ctx, c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.fly) {
      ctx.rotate(c.h);
      ctx.fillStyle = '#ff6d00';
      ctx.beginPath();
      ctx.moveTo(-8, -6); ctx.lineTo(8, -2); ctx.lineTo(8, 2); ctx.lineTo(-8, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(-1, -4, 4, 8);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-CONE.R + 2, -CONE.R + 2, CONE.R * 2, CONE.R * 2);
      ctx.fillStyle = '#263238';
      ctx.fillRect(-CONE.R, -CONE.R, CONE.R * 2, CONE.R * 2);
      ctx.fillStyle = '#ff6d00';
      ctx.beginPath(); ctx.arc(0, 0, CONE.R - 1, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#fafafa';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 6.283); ctx.stroke();
    }
    ctx.restore();
  }

  // Seen from above: a woolly body, a dark head in front, a bob while it walks.
  function drawSheep(ctx, q, time) {
    const bob = q.moving ? 1 + 0.06 * Math.sin(time * 14 + q.graze * 7) : 1;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(q.h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(2, 3, 10, 7, 0, 0, 6.283); ctx.fill();
    ctx.scale(bob, 1);
    ctx.fillStyle = '#f1eee6';
    for (const [x, y, r] of [[-4, -3, 5], [-4, 3, 5], [2, -3, 5], [2, 3, 5], [-1, 0, 6]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
    ctx.fillStyle = '#2b2622';
    ctx.beginPath(); ctx.ellipse(9, 0, 4, 3, 0, 0, 6.283); ctx.fill();
    ctx.fillRect(6, -5, 3, 2);
    ctx.fillRect(6, 3, 3, 2);
    ctx.restore();
  }

  // A worker in an orange vest waving a red and white flag.
  function drawFlagman(ctx, at, time) {
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(2, 3, 8, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ff6d00';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffd600';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.283); ctx.fill();
    ctx.rotate(Math.sin(time * 4) * 0.7);
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.stroke();
    ctx.fillStyle = '#e53935';
    ctx.fillRect(0, -22, 12, 5);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, -17, 12, 4);
    ctx.restore();
  }

  TR.Events = Events;
})();
