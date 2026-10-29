'use strict';
(function () {
  const TR = window.TR, U = TR.U, MAP = TR.MAP, JAM = TR.JAM;
  const LANE = TR.ROAD.LANE;
  const COLORS = ['#f4f4f4', '#26282b', '#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#8d6e63', '#00838f', '#ef6c00', '#90a4ae'];
  const KINDS = [
    { kind: 'car', len: 40, wid: 20, w: 5 },
    { kind: 'car', len: 46, wid: 22, w: 4 },
    { kind: 'van', len: 58, wid: 24, w: 2 },
    { kind: 'bus', len: 92, wid: 28, w: 1 },
  ];
  const KIND_TOTAL = KINDS.reduce((a, k) => a + k.w, 0);
  const NO_TRAFFIC_TAIL = 900;
  // A respawn goes ahead of the racer whose [s - WIN_BACK, s + WIN_AHEAD] window is furthest below
  // target[dir], so the last racer is not flooded once the other leaves. A surplus is never
  // removed, and a window stays short while every POOL car is awake.
  const WIN_BACK = 200, WIN_AHEAD = 2800, WINDOW_SHARE = 0.3, POOL = 2.4;
  // A truck and an oncoming car, each in its own inner lane, pass 22 to 26 apart (LANE - TR_HW - the
  // car's half width), so GAP sits below that: only a truck drifting over the centre line earns it.
  const NEAR = { GAP: 12, MIN_V: 150 };
  const DIRT_SLOW = 0.6;
  // A car keeps to a speed from which it stops PAD short of where the car ahead could stop, planning with
  // DECEL, a little under the braking update() gives it. laneFree leaves room to brake at DECEL too. YAW is
  // the most place()'s lane-change yaw swings a car's corners out sideways. A sibling branch's car also counts
  // where it will be AHEAD_T seconds on, so a car yields before two branches' lanes cross under them; two
  // siblings' frames may disagree by up to SKEW on which of two such cars leads.
  const FOLLOW = { DECEL: 180, PAD: 12, YAW: 12, AHEAD_T: 3, SKEW: 10 };

  // The fastest a car may go gap behind o (front to rear).
  const followV = (o, gap) => Math.sqrt((o.wreck ? 0 : o.v * o.v) + 2 * FOLLOW.DECEL * Math.max(0, gap - FOLLOW.PAD));

  // Whether o, where it is, in the lane it is moving to or on its way there, is side by side with a car c at
  // lane offset d.
  function inLaneOf(o, c, d) {
    const w = (o.wid + c.wid) / 2 + FOLLOW.YAW;
    return Math.abs(o.d - d) < w || Math.abs(o.dTarget - d) < w || (o.d - d) * (o.dTarget - d) < 0;
  }

  const seen = (views, c, pad) => views.some((v) => c.x > v.x0 - pad && c.x < v.x1 + pad && c.y > v.y0 - pad && c.y < v.y1 + pad);

  class Traffic {
    constructor(road, route, seed, density, events) {
      this.road = road;
      this.events = events;
      this.rnd = U.rng(seed);
      this.onSpeed = route.onSpeed || 1;
      this.cars = [];
      this.ghosts = [];
      // The traffics that meet this one at a node, as { traffic, k } with k the segment's flow; game.js sets them.
      this.links = { next: [], prev: [], endSibs: [], startSibs: [] };
      const L = road.atLot ? road.length - NO_TRAFFIC_TAIL : road.length;
      const count = { 1: Math.round(route.same * density), '-1': Math.round(route.oncoming * density) };
      this.target = { 1: Math.max(1, Math.round(count[1] * WINDOW_SHARE)), '-1': Math.max(1, Math.round(count[-1] * WINDOW_SHARE)) };
      this.base = Object.assign({}, this.target);
      // The segment's jams with their s spans (RoadMap.jamsOn's shape); game.js sets them.
      this.jams = [];
      this.time = 0;
      // Only the start segment begins with cars on it, around the start line; respawn fills the others.
      for (const dir of [1, -1]) {
        const t = this.target[dir];
        const s0 = dir > 0 ? 1250 : 1400, span = TR.ROAD.START_S + WIN_AHEAD - s0;
        for (let k = 0; k < Math.round(count[dir] * POOL); k++) {
          const c = this.makeCar(dir), placed = road.isStart && k < t;
          if (placed) {
            this.setS(c, Math.min(L, s0 + ((k + 0.5 * this.rnd()) * span) / t));
            if (!this.laneFree(c, c.d, 120, 120)) { c.lane = 1 - c.lane; this.setS(c, c.s); }
          }
          if (!placed || !events.spawnOk(c)) { c.dormant = this.rnd.range(0.2, 1.5); c.x = 1e9; c.y = 1e9; }
          this.cars.push(c);
        }
      }
    }

    countNear(s, dir, except) {
      let n = 0;
      for (const o of this.cars) {
        if (o === except || o.dir !== dir || o.dormant > 0 || o.wreck) continue;
        const rel = o.s - s;
        if (rel > -WIN_BACK && rel < WIN_AHEAD) n++;
      }
      return n;
    }

    makeCar(dir) {
      const r = this.rnd;
      let pick = r() * KIND_TOTAL, kd = KINDS[0];
      for (const k of KINDS) { pick -= k.w; if (pick <= 0) { kd = k; break; } }
      const lane = r() < 0.5 ? 0 : 1;
      const slow = kd.kind === 'bus' ? 0.75 : 1;
      const vBase = dir > 0 ? r.range(85, 150) * slow : r.range(130, 200) * slow * this.onSpeed;
      return {
        dir, lane, kind: kd.kind, len: kd.len, wid: kd.wid,
        color: kd.kind === 'bus' ? r.pick(['#f2b705', '#e9eef2', '#2a6fdb']) : r.pick(COLORS),
        d: dir * (lane === 0 ? LANE / 2 : LANE * 1.5), dTarget: 0,
        s: 0, v: vBase, vBase, x: 0, y: 0, h: 0,
        laneT: r.range(3, 9), wreck: null, honked: false, hornBy: null, flash: 0, brake: false, dormant: 0,
        near: [Infinity, Infinity], nearDone: [false, false],
      };
    }

    setS(c, s) {
      c.s = s;
      c.d = c.dir * (c.lane === 0 ? LANE / 2 : LANE * 1.5);
      c.dTarget = c.d;
      c.v = c.vBase;
      c.wreck = null;
      c.honked = false;
      c.dormant = 0;
      this.place(c);
    }

    place(c) {
      const p = this.road.lanePos(c.s, c.d);
      c.x = p.x; c.y = p.y;
      const yaw = U.clamp((c.dTarget - c.d) * 0.012, -0.25, 0.25) * c.dir;
      c.h = p.h + (c.dir < 0 ? Math.PI : 0) + yaw;
    }

    // Whether lane d has no car of c's direction from behindGap behind c to aheadGap ahead, counting the
    // junctions' ghosts (Junctions.ghosts). The gaps are world lengths, so they take more s on the inside of a
    // bend (Road.stretchAt); each grows by the s the faster of the two needs to brake to the other's speed at
    // FOLLOW.DECEL.
    laneFree(c, d, aheadGap, behindGap) {
      for (const o of this.cars.concat(this.ghosts)) {
        if (o === c || o.wreck || o.dormant > 0 || o.dir !== c.dir || !inLaneOf(o, c, d)) continue;
        const k = Math.min(this.road.stretchAt(c.s, d), this.road.stretchAt(o.s, d));
        const rel = (o.s - c.s) * c.dir, close = (c.v * c.v - o.v * o.v) / (2 * FOLLOW.DECEL);
        if (rel > -behindGap / k + Math.min(0, close) && rel < aheadGap / k + Math.max(0, close)) return false;
      }
      return true;
    }

    // Whether lane d ahead of a car has no roadworks closing it.
    open(c, d) {
      return this.events.shutAhead(c.dir, d, c.s, c.len / 2) === Infinity;
    }

    // The fastest a same-direction car may go for the jams on at time: JAM.V inside one, braking to it before.
    jamLimit(c, time) {
      let v = Infinity;
      if (c.dir < 0) return v;
      for (const j of this.jams) {
        if (!TR.RoadMap.jamOn(j, time) || c.s > j.s1) continue;
        v = Math.min(v, c.s >= j.s0 ? JAM.V : Math.sqrt(JAM.V * JAM.V + 2 * JAM.DECEL * (j.s0 - c.s)));
      }
      return v;
    }

    update(dt, players, views, onHonk, junctions, time) {
      this.time = time;
      this.target[1] = this.jams.some((j) => TR.RoadMap.jamOn(j, time)) ? Math.round(this.base[1] * JAM.FILL) : this.base[1];
      const racers = players.filter((p) => p.phase === 'race');
      const minS = racers.length ? Math.min(...racers.map((p) => p.s)) : Infinity;
      const tail = this.road.length - NO_TRAFFIC_TAIL;
      this.ghosts = junctions.ghosts().concat(this.nodeGhosts());
      const ahead = this.cars.concat(this.ghosts);
      for (const c of this.cars) {
        if (c.dormant > 0) {
          c.dormant -= dt;
          if (c.dormant <= 0) this.respawn(c, racers, views);
          continue;
        }
        if (c.wreck) {
          if (moveWreck(c, dt)) this.respawn(c, racers, views);
          continue;
        }
        let target = Math.min(c.vBase * (this.road.dirtAt(c.s) ? DIRT_SLOW : 1), junctions.carLimit(c), this.events.carLimit(c), this.jamLimit(c, time));
        c.brake = false;
        const shut = this.events.shutAhead(c.dir, c.dTarget, c.s, c.len / 2);
        if (shut < Infinity) {
          const other = c.lane === 0 ? 1 : 0;
          const nd = c.dir * (other === 0 ? LANE / 2 : LANE * 1.5);
          const truckThere = players.some((p) => Math.abs(p.d - nd) < 45 && Math.abs(p.s - c.s) < 260);
          if (c.dTarget === c.d && !truckThere && this.laneFree(c, nd, 140, 100)) {
            c.lane = other;
            c.dTarget = nd;
          } else target = Math.min(target, Math.sqrt(2 * TR.Events.DECEL * Math.max(0, shut)));
        }
        // A car moving into c's lane counts from when it commits to it (dTarget), not from when it gets there.
        // Gaps are in s; car lengths are world lengths, so they take more s on the inside of a bend.
        const kc = this.road.stretchAt(c.s, c.d);
        for (const o of ahead) {
          if (o === c || o.dir !== c.dir || o.dormant > 0 || !inLaneOf(o, c, c.d)) continue;
          const k = Math.min(kc, this.road.stretchAt(o.s, c.d));
          const gap = (o.s - c.s) * c.dir - (o.len + c.len) / (2 * k);
          // Where two streams meet at a node with cars side by side, the car behind stops for the other to clear;
          // between siblings, whose frames may disagree on that, a dead heat goes to the lower segment id.
          if (gap <= -5) {
            const rel = (o.s - c.s) * c.dir, side = o.node && gap > -(o.len + c.len) / k;
            if (side && (o.sib === undefined ? rel > 0 : rel > FOLLOW.SKEW || (rel > -FOLLOW.SKEW && o.sib < this.road.seg.id))) target = 0;
            continue;
          }
          target = Math.min(target, followV(o, gap));
          if (gap < 110) target = Math.min(target, o.wreck ? 0 : gap < 30 ? o.v * 0.6 : o.v);
        }
        for (const p of players) {
          const t = p.truck;
          const rel = (p.s - c.s) * c.dir;
          const inLane = Math.abs(p.d - c.d) < 42;
          if (c.dir > 0 && inLane && rel > 0 && rel < 210) {
            const tv = Math.max(0, t.v * Math.cos(U.wrap(t.th - c.h)));
            target = Math.min(target, rel < 150 ? tv * 0.7 : tv);
          }
          if (c.dir < 0 && inLane && rel > 0 && rel < 650) {
            if (!c.honked) { c.honked = true; c.flash = 1.4; if (onHonk) onHonk(p.idx); }
            target = Math.min(target, c.vBase * 0.7);
            if (rel < 320) {
              const other = c.lane === 0 ? 1 : 0;
              const nd = c.dir * (other === 0 ? LANE / 2 : LANE * 1.5);
              const truckThere = players.some((q) => Math.abs(q.d - nd) < 45 && Math.abs(q.s - c.s) < 400);
              if (c.dTarget === c.d && !truckThere && this.laneFree(c, nd, 140, 100) && this.open(c, nd)) {
                c.lane = other;
                c.dTarget = nd;
              } else {
                target = Math.min(target, rel < 170 ? 0 : c.vBase * 0.3);
              }
            }
          }
        }
        if (target < c.v - 1) c.brake = true;
        c.v = U.approach(c.v, target, (target < c.v ? 220 : 60) * dt);
        c.s += c.v * c.dir * dt;
        if (c.flash > 0) c.flash -= dt;

        // Like the horn itself (game.js), only this segment's trucks count: racersNear's trucks on a sibling
        // branch keep their own road's d.
        if (c.dir > 0 && c.hornBy && c.dTarget === c.d) {
          const own = players.filter((q) => q.seg === this.road.seg.id), p = own.find((q) => q.idx === c.hornBy.idx);
          if (!p || hornedBy(c, p, c.hornBy.range) === null) c.hornBy = null;
          else this.giveWay(c, own);
        }
        if (c.dir > 0) {
          c.laneT -= dt;
          if (c.laneT <= 0) {
            c.laneT = this.rnd.range(4, 10);
            const other = c.lane === 0 ? 1 : 0;
            const nd = c.dir * (other === 0 ? LANE / 2 : LANE * 1.5);
            const truckNear = players.some((p) => Math.abs(p.s - c.s) < 260 && Math.abs(p.d - nd) < 50);
            if (this.rnd() < 0.45 && !truckNear && this.laneFree(c, nd, 160, 120) && this.open(c, nd)) {
              c.lane = other;
              c.dTarget = nd;
            }
          }
        }
        c.d = U.approach(c.d, c.dTarget, 38 * dt);
        this.place(c);

        // Cars leave the network at the lot and the start; at any other node they run on into a linked segment.
        const road = this.road;
        if (c.dir > 0 && !road.atLot && c.s > road.length && this.handOff(c, this.links.next, () => c.s - road.length)) continue;
        if (c.dir < 0 && !road.isStart && c.s < 0 && this.handOff(c, this.links.prev, (o) => o.road.length + c.s)) continue;
        const behind = c.s < minS - 750;
        const out = c.dir > 0 ? c.s > (road.atLot ? tail : road.length) : c.s < (road.isStart ? 300 : 0);
        if (behind || out) this.respawn(c, racers, views);
      }
    }

    // Moves c into one of the traffics in list, picked by flow, at the s at(traffic) gives; false when the
    // picked one has no sleeper to take it.
    handOff(c, list, at) {
      if (!list.length) return false;
      let pick = this.rnd() * list.reduce((a, l) => a + l.k, 0), to = list[list.length - 1];
      for (const l of list) { pick -= l.k; if (pick <= 0) { to = l; break; } }
      if (!to.traffic.adopt(c.dir, at(to.traffic), c, c.lane)) return false;
      // It keeps its place for the rest of this update, so a respawn does not land on it.
      this.ghosts.push({ s: c.s, d: c.d, dTarget: c.dTarget, dir: c.dir, v: c.v, len: c.len, wid: c.wid, wreck: null, node: true });
      this.retire(c);
      return true;
    }

    // The awake cars of linked segments within LINK_R of the node shared with this one, with s in this
    // segment's frame, as ghosts like Junctions.ghosts; node and sib (a sibling's id) feed the side-by-side
    // rule in update.
    // A sibling's car counts twice: in its own lane, which past the node is this segment's lane of the same
    // offset, and where it is, since siblings drift over each other's lanes as they part or meet. There its
    // width is its footprint across this road, and its dTarget where it will be AHEAD_T on.
    nodeGhosts() {
      const out = [], road = this.road, len = road.length, R = MAP.LINK_R;
      const add = (list, near, at, sib) => {
        for (const { traffic } of list) {
          const L = traffic.road.length;
          for (const o of traffic.cars) {
            if (o.dormant > 0 || !near(o.s, L)) continue;
            const g = { s: at(o.s, L), d: o.d, dTarget: o.dTarget, dir: o.dir, v: o.v, len: o.len, wid: o.wid, wreck: o.wreck, node: true };
            if (sib) g.sib = traffic.road.seg.id;
            out.push(g);
            if (!sib) continue;
            const c = road.locate(o.x, o.y, -1), sin = Math.abs(Math.sin(o.h - c.h)), cos = Math.sqrt(1 - sin * sin);
            const q = traffic.road.posAt(o.s + o.dir * o.v * FOLLOW.AHEAD_T, o.dTarget), f = road.locate(q.x, q.y, -1);
            out.push(Object.assign({}, g, {
              s: c.s, d: road.laneD(c.s, c.d), dTarget: road.laneD(f.s, f.d), len: o.len * cos + o.wid * sin, wid: o.wid * cos + o.len * sin,
            }));
          }
        }
      };
      add(this.links.next, (s) => s < R, (s) => len + s, false);
      add(this.links.prev, (s, L) => L - s < R, (s, L) => s - L, false);
      add(this.links.endSibs, (s, L) => L - s < R, (s, L) => len - (L - s), true);
      add(this.links.startSibs, (s) => s < R, (s) => s, true);
      return out;
    }

    respawn(c, racers, views) {
      const tail = this.road.atLot ? this.road.length - NO_TRAFFIC_TAIL : this.road.length;
      const short = racers
        .map((p) => ({ p, deficit: this.target[c.dir] - this.countNear(p.s, c.dir, c) }))
        .filter((w) => w.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);
      const dir = c.dir;
      const queued = (j) => this.cars.filter((o) => o !== c && o.dir > 0 && o.dormant <= 0 && !o.wreck && o.s >= j.s0 && o.s <= j.s1).length;
      for (const { p } of short) {
        const lo = p.s - WIN_BACK, hi = p.s + WIN_AHEAD;
        const jam = dir > 0 && this.jams.find((j) => TR.RoadMap.jamOn(j, this.time) && j.s1 > lo && j.s0 < hi && queued(j) < (JAM.MIN_CARS * (j.s1 - j.s0)) / JAM.KM);
        for (let tries = 0; tries < 8; tries++) {
          const s = jam && tries < 4 ? this.rnd.range(Math.max(jam.s0, lo), Math.min(jam.s1, hi)) : p.s + (dir > 0 ? this.rnd.range(950, 2300) : this.rnd.range(1100, 2800));
          if (s < 0 || s > tail) continue;
          Object.assign(c, this.makeCar(dir));
          c.s = s;
          c.d = dir * (c.lane === 0 ? LANE / 2 : LANE * 1.5);
          c.dTarget = c.d;
          c.v = Math.min(c.v, this.jamLimit(c, this.time));
          this.place(c);
          if (!seen(views, c, 120) && this.laneFree(c, c.d, 220, 220) && this.events.spawnOk(c)) return;
        }
      }
      c.dormant = 0.8;
      c.x = 1e9; c.y = 1e9;
    }

    // A truck in turbo (p.ghost) drives through cars of its own direction, and keeps doing so after the turbo
    // while holds(p), so a turbo that ends inside a car is not a crash.
    collide(players) {
      return collideCars(this.cars, players, (c, p) => c.dir > 0 && p.ghost);
    }

    holds(p) {
      return this.cars.some((c) => c.dir > 0 && c.dormant <= 0 && !c.wreck && touch(c, p.truck));
    }

    // Puts a sleeping car of direction dir in lane (the outer one unless given) at s, looking and moving like
    // `from`, a car that leaves a side road or a linked segment. Returns null when every car of that direction
    // is awake.
    adopt(dir, s, from, lane = 1) {
      const c = this.cars.find((o) => o.dir === dir && o.dormant > 0);
      if (!c) return null;
      Object.assign(c, this.makeCar(dir), { kind: from.kind, len: from.len, wid: from.wid, color: from.color, lane });
      this.setS(c, s);
      c.v = from.v;
      return c;
    }

    hasSleeper(dir) {
      return this.cars.some((o) => o.dir === dir && o.dormant > 0);
    }

    // Takes a car off the road, for one that turned into a side road; it respawns like any other.
    retire(c) {
      c.dormant = this.rnd.range(0.5, 1.5);
      c.x = 1e9; c.y = 1e9;
    }

    // An oncoming car that ran alongside a truck doing over NEAR.MIN_V within NEAR.GAP is a near miss
    // for that player once it clears the trailer unhurt; a car that hits the truck turns into a wreck
    // first and is skipped. Returns the players to credit, at most once per car each.
    nearMisses(players) {
      const T = TR.TRUCK, hw = Math.max(T.CAB_HW, T.TR_HW), tail = T.LT + T.TR_REAR;
      const out = [];
      for (const c of this.cars) {
        if (c.dir > 0 || c.dormant > 0 || c.wreck) continue;
        for (const p of players) {
          if (p.phase !== 'race' || c.nearDone[p.idx]) continue;
          const rel = c.s - p.s;
          if (rel > T.CAB_FRONT + c.len / 2) continue;
          if (rel > -tail - c.len / 2) {
            if (p.truck.v > NEAR.MIN_V) c.near[p.idx] = Math.min(c.near[p.idx], Math.abs(c.d - p.d) - c.wid / 2 - hw);
            continue;
          }
          c.nearDone[p.idx] = true;
          if (c.near[p.idx] < NEAR.GAP) out.push(p);
        }
      }
      return out;
    }

    // The first car ahead of the truck in its lane and direction within range moves over at the first
    // chance it gets, which update keeps looking for while the truck stays within range behind it in its
    // lane on this segment; a car handed off to another segment forgets the horn. Returns whether it moved
    // over at once.
    yieldTo(p, players, range) {
      let best = null, bestRel = range;
      for (const c of this.cars) {
        if (c.dir < 0 || c.dormant > 0 || c.wreck || c.dTarget !== c.d) continue;
        const rel = hornedBy(c, p, range);
        if (rel !== null && rel < bestRel) { best = c; bestRel = rel; }
      }
      if (!best) return false;
      best.hornBy = { idx: p.idx, range };
      return this.giveWay(best, players);
    }

    giveWay(c, players) {
      const other = c.lane === 0 ? 1 : 0;
      const nd = other === 0 ? LANE / 2 : LANE * 1.5;
      const truckThere = players.some((q) => Math.abs(q.s - c.s) < 260 && Math.abs(q.d - nd) < 50);
      if (truckThere || !this.laneFree(c, nd, 160, 120) || !this.open(c, nd)) return false;
      c.lane = other;
      c.dTarget = nd;
      c.laneT = this.rnd.range(4, 10);
      c.hornBy = null;
      return true;
    }

    draw(ctx, view) {
      for (const c of this.cars) {
        if (c.dormant > 0) continue;
        if (c.x < view.x0 - 100 || c.x > view.x1 + 100 || c.y < view.y0 - 100 || c.y > view.y1 + 100) continue;
        drawCar(ctx, c);
      }
    }
  }

  // How far car c is ahead of truck p's cab in p's lane, or null when it is not within range there.
  function hornedBy(c, p, range) {
    const rel = c.s - p.s - TR.TRUCK.CAB_FRONT;
    return Math.abs(c.d - p.d) <= 30 && rel > 0 && rel < range ? rel : null;
  }

  // The first overlap of car c with truck t, or null.
  function touch(c, t) {
    if (Math.abs(c.x - t.x) > 260 || Math.abs(c.y - t.y) > 260) return null;
    const cb = U.obb(c.x, c.y, c.len / 2, c.wid / 2, c.h);
    for (const tb of t.boxes()) {
      const m = U.sat(tb, cb);
      if (m) return m;
    }
    return null;
  }

  // Returns hits as {player, car, headOn}. A car that hits a truck turns into a wreck; pass(car, player)
  // names the pairs that drive through each other.
  function collideCars(cars, players, pass) {
    const hits = [];
    for (const c of cars) {
      if (c.dormant > 0 || c.wreck) continue;
      for (const p of players) {
        if (p.phase !== 'race' || (pass && pass(c, p))) continue;
        const t = p.truck, m = touch(c, t);
        if (!m) continue;
        const tvx = Math.cos(t.th) * t.v, tvy = Math.sin(t.th) * t.v;
        const cvx = Math.cos(c.h) * c.v, cvy = Math.sin(c.h) * c.v;
        c.wreck = {
          vx: tvx * 0.6 + cvx * 0.2 + m.nx * 140,
          vy: tvy * 0.6 + cvy * 0.2 + m.ny * 140,
          spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4),
          t: 3.5,
        };
        c.v = 0;
        hits.push({ player: p, car: c, headOn: Math.cos(U.wrap(c.h - t.th)) < -0.5 });
        break;
      }
    }
    return hits;
  }

  // Slides and spins a wreck to a stop; true once it has lain long enough to be cleared away.
  function moveWreck(c, dt) {
    const w = c.wreck;
    c.x += w.vx * dt; c.y += w.vy * dt; c.h += w.spin * dt;
    const f = Math.exp(-dt * 2.2);
    w.vx *= f; w.vy *= f; w.spin *= f;
    w.t -= dt;
    return w.t <= 0;
  }

  function drawCar(ctx, c) {
    const L = c.len, W = c.wid;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.h);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    U.roundRect(ctx, -L / 2 + 4, -W / 2 + 5, L, W, 5);
    ctx.fill();
    ctx.fillStyle = c.wreck ? U.shade(c.color, -0.45) : c.color;
    U.roundRect(ctx, -L / 2, -W / 2, L, W, c.kind === 'car' ? 6 : 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (c.kind === 'bus') {
      ctx.fillStyle = '#9fd3f0';
      ctx.fillRect(L / 2 - 8, -W / 2 + 3, 5, W - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-L / 2 + 6, -W / 2 + 4, L - 18, W - 8);
    } else if (c.kind === 'van') {
      ctx.fillStyle = '#1f2a33';
      ctx.fillRect(L / 2 - 16, -W / 2 + 3, 8, W - 6);
      ctx.fillStyle = U.shade(c.color, 0.2);
      ctx.fillRect(-L / 2 + 4, -W / 2 + 4, L - 24, W - 8);
    } else {
      ctx.fillStyle = '#1f2a33';
      ctx.fillRect(L * 0.08, -W / 2 + 3, L * 0.2, W - 6);
      ctx.fillRect(-L * 0.38, -W / 2 + 3, L * 0.14, W - 6);
      ctx.fillStyle = U.shade(c.color, 0.18);
      ctx.fillRect(-L * 0.24, -W / 2 + 4, L * 0.32, W - 8);
    }
    ctx.fillStyle = c.brake ? '#ff3b30' : '#8e1d18';
    ctx.fillRect(-L / 2, -W / 2 + 2, 2, 4);
    ctx.fillRect(-L / 2, W / 2 - 6, 2, 4);
    ctx.fillStyle = '#fff4c2';
    ctx.fillRect(L / 2 - 2, -W / 2 + 2, 2, 4);
    ctx.fillRect(L / 2 - 2, W / 2 - 6, 2, 4);
    if (c.flash > 0 && Math.floor(c.flash * 8) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,248,200,0.55)';
      ctx.beginPath();
      ctx.moveTo(L / 2, -W / 2);
      ctx.lineTo(L / 2 + 70, -W / 2 - 22);
      ctx.lineTo(L / 2 + 70, W / 2 + 22);
      ctx.lineTo(L / 2, W / 2);
      ctx.closePath();
      ctx.fill();
    }
    if (c.wreck) {
      ctx.fillStyle = 'rgba(80,80,80,0.6)';
      ctx.beginPath();
      ctx.arc(L * 0.3, 0, 9 + Math.sin(c.wreck.t * 9) * 2, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  // Side-road traffic (junctions.js) moves its own cars and shares how they follow, crash, wreck and look.
  Object.assign(Traffic, { followV, inLaneOf, collideCars, moveWreck, drawCar, NO_TRAFFIC_TAIL });
  TR.Traffic = Traffic;
})();
