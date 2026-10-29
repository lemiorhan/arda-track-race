// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeWorld } from './harness.mjs';

const FRAME_MS = 1000 / 60;
const SEEDS = Array.from({ length: 12 }, (_, k) => 3 + k * 131);
const TOL = 5;

const w0 = makeWorld('jams', { clock: { t: 1000 } });

test('jams are deterministic and move with the seed', () => {
  const { TR } = w0;
  for (const route of TR.ROUTES) {
    const all = new Set();
    for (const seed of SEEDS) {
      const one = JSON.stringify(TR.MapGen.generate(route, seed).jams);
      assert.equal(JSON.stringify(TR.MapGen.generate(route, seed).jams), one, route.id + ' seed ' + seed);
      assert.notEqual(one, '[]', route.id + ' seed ' + seed + ' has no jam');
      all.add(one);
    }
    assert.ok(all.size >= 2, route.id + ' gives the same jams for every seed');
  }
});

test('a jam is on from t0 up to t1', () => {
  const on = (t) => w0.TR.RoadMap.jamOn({ seg: 0, rise0: 2000, rise1: 3000, t0: 30, t1: 80 }, t);
  assert.equal(on(29.9), false);
  assert.equal(on(30), true);
  assert.equal(on(79.9), true);
  assert.equal(on(80), false);
});

test('jamsOn reads only its arguments', () => {
  const route = w0.TR.ROUTES[1];
  const spec = w0.TR.MapGen.generate(route, 11);
  const first = spec.jams[0];
  const a = makeWorld('a', { clock: { t: (first.t0 + 1) * 1000 } }), b = makeWorld('b', { clock: { t: 1e9 } });
  const ma = new a.TR.RoadMap(JSON.parse(JSON.stringify(spec)), a.TR.ROUTES[1]);
  const mb = new b.TR.RoadMap(JSON.parse(JSON.stringify(spec)), b.TR.ROUTES[1]);
  const times = [0].concat(spec.jams.flatMap((j) => [j.t0 - 0.5, j.t0, j.t0 + 0.5, j.t1 - 0.5, j.t1, j.t1 + 0.5]));
  let active = 0;
  for (let seg = 0; seg < spec.segs.length; seg++) {
    for (const t of times) {
      const got = ma.jamsOn(seg, t);
      assert.equal(JSON.stringify(got), JSON.stringify(mb.jamsOn(seg, t)), 'segment ' + seg + ' at ' + t);
      for (const j of got) assert.ok(j.s0 > 0 && j.s1 > j.s0 && j.s1 < ma.segs[seg].road.length, 'segment ' + seg + ': span ' + j.s0 + '-' + j.s1);
      active += got.length;
    }
  }
  assert.ok(active > 0, 'no jam on at any time swept');
});

const seg = (id, a, b, role, flow, detour) => ({
  id, a, b, role, flow, detour, curvy: 0, tight: 1, wseed: 11 + id, features: [], events: { flock: false, work: false },
});
// A long straight start trunk with one jam on it, then a braid and the lot segment.
const JAM_SPAN = { seg: 0, rise0: 12000, rise1: 14000, t0: 10, t1: 400 };
function jamSpec() {
  return {
    ri: 0, seed: 1, attempt: 0, jams: [Object.assign({}, JAM_SPAN)],
    nodes: [
      { id: 0, x: 0, y: 0, kind: 'start' },
      { id: 1, x: 0, y: -20000, kind: 'fork' },
      { id: 2, x: 0, y: -27000, kind: 'merge' },
      { id: 3, x: 0, y: -36000, kind: 'lot' },
    ],
    segs: [seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, 'shortcut', 0.6, 0), seg(2, 1, 2, 'busy', 1.5, 1500), seg(3, 2, 3, 'trunk', 1, 0)],
  };
}

const NONE = { thr: 0, steer: 0, mx: 0, my: 0, action: false, reset: false, brake: false, horn: false, left: false, right: false };

// A truck creeps up the start trunk to the jam, both trucks stop short of it, then the jam ends. Every frame
// of segment 0's traffic is checked as it happens.
let ran = null;
function run() {
  if (ran) return ran;
  const clock = { t: 1000 };
  const w = makeWorld('round', { clock }), TR = w.TR, G = TR.Game, U = TR.U, JAM = TR.JAM;
  vm.runInContext('(f) => { Math.random = f; }', w.ctx)(U.rng(5));
  TR.Settings.set({ traffic: 'normal', weather: 'gunduz', shake: false });
  G.newSeries(['A', 'B'], ['kapali', 'kapali']);
  G.startRound(0, { seed: 1, mapSpec: jamSpec() });
  const step = () => { clock.t += FRAME_MS; w.frame(); };
  const sg = G.map.segs[0], tr = sg.traffic, road = sg.road;
  for (const s of G.map.segs) { s.traffic.draw = () => {}; s.junctions.draw = () => {}; s.events.draw = () => {}; }
  G.map.draw = () => {};
  TR.Light.draw = () => {};
  TR.HUD.draw = () => {};
  const base = tr.target[1];
  const s0 = road.sAtRise(JAM_SPAN.rise0), s1 = road.sAtRise(JAM_SPAN.rise1);
  const r = { base, s0, s1, fast: [], onTarget: [], density: [], after: null, afterTarget: null, inside: 0 };
  const inside = () => tr.cars.filter((c) => c.dir > 0 && c.dormant <= 0 && !c.wreck && c.s >= s0 && c.s <= s1);
  const update = tr.update.bind(tr);
  tr.update = (...args) => {
    update(...args);
    if (!TR.RoadMap.jamOn(JAM_SPAN, G.time)) return;
    r.onTarget.push(tr.target[1]);
    for (const c of inside()) {
      r.inside++;
      if (c.v > JAM.V + TOL) r.fast.push('t ' + G.time.toFixed(2) + ': car at s ' + c.s.toFixed(0) + ' does ' + c.v.toFixed(1));
    }
  };

  while (G.state === 'countdown') step();
  G.time = JAM_SPAN.t0;
  const [a, b] = G.players, R = TR.ROAD;
  const put = (p, s, d) => {
    const q = road.lanePos(s, d);
    p.truck.place(q.x, q.y, q.h);
    p.truck.v = 100;
    p.seg = 0; p.s = s; p.hint = -1;
    p.cam.x = q.x; p.cam.y = q.y - 250;
  };
  put(a, s0 - 5000, R.LANE / 2);
  put(b, s0 - 5600, R.LANE / 2);
  for (const p of [a, b]) {
    TR.Input.sources[p.idx] = () => {
      const t = p.truck, at = road.locate(t.x, t.y, -1).s;
      const q = road.lanePos(at + 300, R.LANE / 2);
      const err = U.wrap(Math.atan2(q.y - t.y, q.x - t.x) - t.th);
      const c = Math.cos(t.th), s = Math.sin(t.th);
      const blocked = tr.cars.some((o) => {
        if (o.dormant > 0) return false;
        const dx = o.x - t.x, dy = o.y - t.y, along = dx * c + dy * s;
        return along > 0 && along < 260 && Math.abs(-dx * s + dy * c) < 40;
      });
      const stop = blocked || at > s0 - 300 - 600 * p.idx || t.v > 120;
      return Object.assign({}, NONE, { thr: stop ? 0 : 1, brake: stop && t.v > 20, steer: U.clamp(err * 4, -1, 1) });
    };
  }
  let arrived = false;
  for (let f = 0; f < 60 * 70; f++) {
    step();
    if (!arrived && a.s > s0 - 1500) arrived = true;
    if (arrived) r.density.push((inside().length * JAM.KM) / (s1 - s0));
  }
  r.arrived = arrived;
  G.time = JAM_SPAN.t1;
  for (let f = 0; f < 60 * 10; f++) step();
  r.after = inside().map((c) => c.v);
  r.afterTarget = tr.target[1];
  ran = r;
  return r;
}

test('cars crawl in a jam', () => {
  const r = run();
  assert.ok(r.inside > 1000, 'only ' + r.inside + ' car frames inside the jam');
  assert.deepEqual(r.fast.slice(0, 5), []);
});

test('a queue forms once the truck arrives', () => {
  const r = run(), JAM = w0.TR.JAM;
  assert.ok(r.arrived, 'the truck never reached the jam');
  const low = Math.min(...r.density);  assert.ok(low >= JAM.MIN_CARS, 'the jam held ' + low.toFixed(1) + ' cars per km');
  for (const t of r.onTarget) assert.ok(t > r.base, 'target ' + t + ' not above its base ' + r.base);
});

test('a jam ends at t1', () => {
  const r = run(), JAM = w0.TR.JAM;
  assert.ok(r.after.length > 0, 'no car inside the jam after it ended');
  for (const v of r.after) assert.ok(v > JAM.V + TOL, 'a car still crawls at ' + v.toFixed(1));
  assert.equal(r.afterTarget, r.base);
});
