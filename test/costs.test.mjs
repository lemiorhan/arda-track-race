// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

const FRAME_MS = 1000 / 60;
const SEEDS = Array.from({ length: 24 }, (_, k) => 1 + k * 97);
const NONE = { thr: 0, steer: 0, mx: 0, my: 0, action: false, reset: false, brake: false, horn: false, left: false, right: false };

const w0 = makeWorld('costs', { clock: { t: 1000 } });
const sibsOf = (spec, sg) => spec.segs.filter((o) => o !== sg && o.a === sg.a && o.b === sg.b);

// What a driver pays on a shortcut, read off the spec: a section or point of each type, a flock, and bends
// curvier than every sibling's.
function paid(spec, sg) {
  const out = ['dirt', 'narrow', 'toll'].filter((t) => sg.features.some((f) => f.type === t));
  if (sg.features.some((f) => f.type === 'radar' && f.kmh > 0)) out.push('radar');
  if (sg.events.flock) out.push('flock');
  if (sibsOf(spec, sg).every((o) => sg.curvy > o.curvy)) out.push('twisty');
  return out;
}

let maps = null;
function allMaps() {
  if (maps) return maps;
  maps = [];
  for (const route of w0.TR.ROUTES) for (const seed of SEEDS) maps.push({ route, seed, spec: w0.TR.MapGen.generate(route, seed) });
  return maps;
}

test('every shortcut costs', () => {
  const MAP = w0.TR.MAP;
  let shortcuts = 0;
  const routes = new Set();
  for (const { route, seed, spec } of allMaps()) {
    for (const sg of spec.segs.filter((s) => s.role === 'shortcut')) {
      const got = paid(spec, sg);
      assert.ok(got.length >= MAP.COSTS_MIN, route.id + ' seed ' + seed + ' shortcut ' + sg.id + ' costs ' + got);
      shortcuts++;
      routes.add(route.id);
    }
  }
  assert.ok(shortcuts >= w0.TR.ROUTES.length * SEEDS.length, 'only ' + shortcuts + ' shortcuts');
  assert.equal(routes.size, w0.TR.ROUTES.length);
});

test('a shortcut stays shorter after its twist', () => {
  const { TR } = w0, MAP = TR.MAP;
  let twisted = 0;
  for (const { route, seed, spec } of allMaps()) {
    const map = new TR.RoadMap(spec, route), len = (sg) => map.segs[sg.id].road.length;
    for (const sg of spec.segs.filter((s) => s.role === 'shortcut')) {
      for (const o of sibsOf(spec, sg)) assert.ok(len(o) - len(sg) >= MAP.SHORT_MIN, route.id + ' seed ' + seed + ': shortcut ' + sg.id + ' ' + len(sg) + ' against ' + o.id + ' ' + len(o));
      if (paid(spec, sg).includes('twisty')) twisted++;
    }
  }
  assert.ok(twisted > 0, 'no twisted shortcut');
});

const seg = (id, a, b, role, flow, detour, extra = {}) => Object.assign({
  id, a, b, role, flow, detour, curvy: 0, tight: 1, wseed: 11 + id, features: [], events: { flock: false, work: false },
}, extra);
// start (0,0) → fork (0,-8000) → { shortcut straight, busy detoured } → merge (0,-18000) → lot (0,-24000).
const NARROW = { rise0: 3000, rise1: 5000 };
function costSpec(shortcut) {
  return {
    ri: 0, seed: 1, attempt: 0, jams: [],
    nodes: [
      { id: 0, x: 0, y: 0, kind: 'start' },
      { id: 1, x: 0, y: -8000, kind: 'fork' },
      { id: 2, x: 0, y: -18000, kind: 'merge' },
      { id: 3, x: 0, y: -24000, kind: 'lot' },
    ],
    segs: [seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, 'shortcut', 0.6, 0, shortcut), seg(2, 1, 2, 'busy', 1.5, 2000), seg(3, 2, 3, 'trunk', 1, 0)],
  };
}

function round(spec) {
  const clock = { t: 1000 };
  const w = makeWorld('round', { clock }), TR = w.TR, G = TR.Game;
  TR.Settings.set({ traffic: 'normal', weather: 'gunduz', shake: false });
  G.newSeries(['A', 'B'], ['kapali', 'kapali']);
  G.startRound(0, { seed: 1, mapSpec: spec });
  for (const sg of G.map.segs) sg.traffic.cars.length = 0;
  TR.Input.sources = [() => NONE, () => NONE];
  w.step = () => { clock.t += FRAME_MS; w.frame(); };
  while (G.state === 'countdown') w.step();
  return w;
}

test('a narrow section brings its rail in and keeps the roadside decor', () => {
  const { TR } = w0, R = TR.ROAD;
  const road = new TR.Road(TR.ROUTES[0], {
    id: 0, a: { x: 0, y: 0 }, b: { x: 0, y: -10000 }, detour: 0, curvy: 0, tight: 1, wseed: 3, isStart: true, atLot: true,
    features: [Object.assign({ type: 'narrow' }, NARROW), { type: 'bridge', rise0: 7000, rise1: 8000 }],
  });
  const mid = road.sAtRise((NARROW.rise0 + NARROW.rise1) / 2);
  assert.equal(road.railAt(mid), TR.SECTIONS.narrow.rail);
  assert.ok(TR.SECTIONS.narrow.rail > R.HALF && TR.SECTIONS.narrow.rail < TR.SECTIONS.bridge.rail);
  assert.equal(road.railAt(road.sAtRise(NARROW.rise0 - 800)), R.RAIL);
  assert.equal(road.railAt(road.sAtRise(NARROW.rise1 + 800)), R.RAIL);
  assert.equal(road.coveredAt(mid), false);
  assert.equal(road.coveredAt(road.sAtRise(7500)), true, 'a bridge no longer covers its roadside');
});

// The truck stands with its east side a little past the narrow rail, inside the usual one: on the narrow
// section the rail pushes it back to the narrow rail, elsewhere nothing moves it.
test('the narrow rail pushes a truck back', () => {
  const w = round(costSpec({ features: [Object.assign({ type: 'narrow' }, NARROW)] })), TR = w.TR, G = TR.Game, U = TR.U;
  const road = G.map.segs[1].road, p = G.players[0], rail = TR.SECTIONS.narrow.rail, over = 10;
  const outer = () => Math.max(...p.truck.boxes().flatMap((b) => U.corners(b)).map((c) => Math.abs(road.locate(c.x, c.y, -1).d)));
  const standAt = (rise) => {
    const s = road.sAtRise(rise), q = road.posAt(s, 0);
    p.truck.place(q.x, q.y, q.h);
    p.truck.v = 0;
    p.seg = 1; p.s = s; p.hint = -1;
    const d = rail + over - outer();
    const e = road.posAt(s, d);
    p.truck.place(e.x, e.y, q.h);
    p.truck.v = 0;
  };
  standAt((NARROW.rise0 + NARROW.rise1) / 2);
  assert.ok(Math.abs(outer() - rail - over) < 1, 'did not stand ' + over + ' past the narrow rail: ' + outer());
  w.log.length = 0;
  w.step();
  assert.equal(p.seg, 1);
  assert.ok(Math.abs(outer() - rail) < 1.5, 'outer corner at ' + outer().toFixed(1) + ', the narrow rail is ' + rail);
  assert.ok(w.log.some((l) => l.includes('"tur puan')), 'no frame was drawn');
  assert.deepEqual(w.log.filter((l) => l.endsWith('fillStyle=undefined')), []);
  standAt(7000);
  w.step();
  assert.ok(Math.abs(outer() - rail - over) < 1, 'pushed off the narrow section: ' + outer().toFixed(1));
});

test('flocks are built on every flocked shortcut and nowhere else', () => {
  const w = makeWorld('flocks', { clock: { t: 1000 } }), TR = w.TR, G = TR.Game;
  TR.Settings.set({ traffic: 'normal', weather: 'gunduz' });
  G.newSeries(['A', 'B'], ['kapali', 'kapali']);
  let flocked = 0;
  for (let ri = 0; ri < TR.ROUTES.length; ri++) {
    for (const seed of SEEDS) {
      G.startRound(ri, { seed });
      G.map.segs.forEach((sg) => {
        const at = TR.ROUTES[ri].id + ' seed ' + seed + ' segment ' + sg.id;
        assert.equal(sg.events.flocks.length, sg.spec.events.flock ? 1 : 0, at);
        if (sg.spec.events.flock) {
          assert.equal(sg.spec.role, 'shortcut', at);
          flocked++;
        }
      });
    }
  }
  assert.ok(flocked >= TR.ROUTES.length * SEEDS.length, 'only ' + flocked + ' flocked shortcuts');
});

// One truck drives the shortcut with the flock, the other the busy sibling beside it, both past the flock.
test('a flock is met only by the shortcut driver', () => {
  const w = round(costSpec({ events: { flock: true, work: false } })), TR = w.TR, G = TR.Game, U = TR.U, R = TR.ROAD;
  const f = G.map.segs[1].events.flocks[0];
  assert.ok(f, 'no flock on the shortcut');
  const plan = [{ seg: 1, lane: R.LANE / 2 }, { seg: 2, lane: R.LANE * 1.5 }];
  plan.forEach(({ seg: k, lane }, i) => {
    const p = G.players[i], road = G.map.segs[k].road, q = road.lanePos(R.END_FLAT / 2, lane);
    p.truck.place(q.x, q.y, q.h);
    p.truck.v = 0;
    p.seg = k; p.s = R.END_FLAT / 2; p.hint = -1;
    TR.Input.sources[i] = () => {
      const t = p.truck, at = road.locate(t.x, t.y, -1).s, aim = road.lanePos(at + 300, lane);
      const err = U.wrap(Math.atan2(aim.y - t.y, aim.x - t.x) - t.th);
      return Object.assign({}, NONE, { thr: t.v > 250 ? 0 : 1, steer: U.clamp(err * 4, -1, 1) });
    };
  });
  const [a, b] = G.players, done = () => a.s > f.s + 400 && b.s > f.s + 400;
  let frames = 0;
  for (; frames < 60 * 120 && !done(); frames++) {
    w.step();
    assert.deepEqual([a.seg, b.seg], [1, 2], 'frame ' + frames);
    assert.equal(f.met[1], false, 'the sibling driver met the flock at frame ' + frames + ', s ' + b.s.toFixed(0));
  }
  assert.ok(done(), 'the trucks did not get past the flock: ' + a.s.toFixed(0) + ', ' + b.s.toFixed(0) + ' against ' + f.s.toFixed(0));
  assert.equal(f.met[0], true, 'the shortcut driver never met the flock');
});
