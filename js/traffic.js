'use strict';
(function () {
  const TR = window.TR, U = TR.U;
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
  // Each racer keeps its own target of cars per direction in [s - WIN_BACK, s + WIN_AHEAD].
  // A shared pool spawned ahead of one truck crowds or thins the other's road, and floods
  // the last racer once the other has left the road.
  const WIN_BACK = 200, WIN_AHEAD = 2800, WINDOW_SHARE = 0.45, POOL = 1.6;

  class Traffic {
    constructor(road, route, seed, density) {
      this.road = road;
      this.rnd = U.rng(seed);
      this.onSpeed = route.onSpeed || 1;
      this.cars = [];
      const L = road.length - NO_TRAFFIC_TAIL;
      const count = { 1: Math.round(route.same * density), '-1': Math.round(route.oncoming * density) };
      this.target = { 1: Math.max(1, Math.round(count[1] * WINDOW_SHARE)), '-1': Math.max(1, Math.round(count[-1] * WINDOW_SHARE)) };
      for (const dir of [1, -1]) {
        const t = this.target[dir];
        const s0 = dir > 0 ? 1250 : 1400, span = TR.ROAD.START_S + WIN_AHEAD - s0;
        for (let k = 0; k < Math.round(count[dir] * POOL); k++) {
          const c = this.makeCar(dir);
          if (k < t) this.setS(c, Math.min(L, s0 + ((k + this.rnd()) * span) / t));
          else { c.dormant = this.rnd.range(0.2, 1.5); c.x = 1e9; c.y = 1e9; }
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
        laneT: r.range(3, 9), wreck: null, honked: false, flash: 0, brake: false, dormant: 0,
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
      const p = this.road.posAt(c.s, c.d);
      c.x = p.x; c.y = p.y;
      const yaw = U.clamp((c.dTarget - c.d) * 0.012, -0.25, 0.25) * c.dir;
      c.h = p.h + (c.dir < 0 ? Math.PI : 0) + yaw;
    }

    box(c) {
      return U.obb(c.x, c.y, c.len / 2, c.wid / 2, c.h);
    }

    laneFree(c, d, aheadGap, behindGap) {
      for (const o of this.cars) {
        if (o === c || o.wreck || o.dormant > 0 || o.dir !== c.dir) continue;
        if (Math.abs(o.d - d) > 30 && Math.abs(o.dTarget - d) > 30) continue;
        const rel = (o.s - c.s) * c.dir;
        if (rel > -behindGap && rel < aheadGap) return false;
      }
      return true;
    }

    update(dt, players, views, onHonk) {
      const racers = players.filter((p) => p.phase === 'race');
      const minS = racers.length ? Math.min(...racers.map((p) => p.s)) : Infinity;
      const tail = this.road.length - NO_TRAFFIC_TAIL;
      for (const c of this.cars) {
        if (c.dormant > 0) {
          c.dormant -= dt;
          if (c.dormant <= 0) this.respawn(c, racers, views);
          continue;
        }
        if (c.wreck) {
          const w = c.wreck;
          c.x += w.vx * dt; c.y += w.vy * dt; c.h += w.spin * dt;
          const f = Math.exp(-dt * 2.2);
          w.vx *= f; w.vy *= f; w.spin *= f;
          w.t -= dt;
          if (w.t <= 0) this.respawn(c, racers, views);
          continue;
        }
        let target = c.vBase;
        c.brake = false;
        for (const o of this.cars) {
          if (o === c || o.dir !== c.dir || o.dormant > 0) continue;
          if (Math.abs(o.d - c.d) > 30) continue;
          const gap = (o.s - c.s) * c.dir - (o.len + c.len) / 2;
          if (gap > -5 && gap < 110) target = Math.min(target, o.wreck ? 0 : gap < 30 ? o.v * 0.6 : o.v);
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
              if (c.dTarget === c.d && !truckThere && this.laneFree(c, nd, 140, 100)) {
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

        if (c.dir > 0) {
          c.laneT -= dt;
          if (c.laneT <= 0) {
            c.laneT = this.rnd.range(4, 10);
            const other = c.lane === 0 ? 1 : 0;
            const nd = c.dir * (other === 0 ? LANE / 2 : LANE * 1.5);
            const truckNear = players.some((p) => Math.abs(p.s - c.s) < 260 && Math.abs(p.d - nd) < 50);
            if (this.rnd() < 0.45 && !truckNear && this.laneFree(c, nd, 160, 120)) {
              c.lane = other;
              c.dTarget = nd;
            }
          }
        }
        c.d = U.approach(c.d, c.dTarget, 38 * dt);
        this.place(c);

        const behind = c.s < minS - 750;
        const out = c.dir > 0 ? c.s > tail : c.s < 300;
        if (behind || out) this.respawn(c, racers, views);
      }
    }

    respawn(c, racers, views) {
      const tail = this.road.length - NO_TRAFFIC_TAIL;
      const short = racers
        .map((p) => ({ p, deficit: this.target[c.dir] - this.countNear(p.s, c.dir, c) }))
        .filter((w) => w.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);
      const dir = c.dir;
      for (const { p } of short) {
        for (let tries = 0; tries < 4; tries++) {
          const s = p.s + (dir > 0 ? this.rnd.range(950, 2300) : this.rnd.range(1100, 2800));
          if (s > tail) continue;
          Object.assign(c, this.makeCar(dir));
          c.s = s;
          c.d = dir * (c.lane === 0 ? LANE / 2 : LANE * 1.5);
          c.dTarget = c.d;
          this.place(c);
          const seen = views.some((v) => c.x > v.x0 - 120 && c.x < v.x1 + 120 && c.y > v.y0 - 120 && c.y < v.y1 + 120);
          if (!seen && this.laneFree(c, c.d, 220, 220)) return;
        }
      }
      c.dormant = 0.8;
      c.x = 1e9; c.y = 1e9;
    }

    // Returns hits as {player, car, headOn}.
    collide(players) {
      const hits = [];
      for (const c of this.cars) {
        if (c.dormant > 0 || c.wreck) continue;
        const cb = this.box(c);
        for (const p of players) {
          if (p.phase !== 'race') continue;
          const t = p.truck;
          if (Math.abs(c.x - t.x) > 260 || Math.abs(c.y - t.y) > 260) continue;
          for (const tb of t.boxes()) {
            const m = U.sat(tb, cb);
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
            hits.push({ player: p, car: c, headOn: c.dir < 0 });
            break;
          }
          if (c.wreck) break;
        }
      }
      return hits;
    }

    draw(ctx, view) {
      for (const c of this.cars) {
        if (c.dormant > 0) continue;
        if (c.x < view.x0 - 100 || c.x > view.x1 + 100 || c.y < view.y0 - 100 || c.y > view.y1 + 100) continue;
        drawCar(ctx, c);
      }
    }
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

  TR.Traffic = Traffic;
})();
