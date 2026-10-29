// Run: node --test test/assist.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

const FRAME_MS = 1000 / 60;

// start (0,0) → fork (0,-8000) → { 1 straight with an 80 km/h radar 1000 in, 2 east with a toll whose cap
// starts at the fork } → merge (0,-18000) → lot (0,-24000).
function fixtureSpec() {
  const seg = (id, a, b, role, detour, features) => ({
    id, a, b, role, flow: 1, detour, curvy: 0, tight: 1, wseed: 11 + id, features, events: { flock: false, work: false },
  });
  return {
    ri: 0, seed: 1, attempt: 0, jams: [],
    nodes: [
      { id: 0, x: 0, y: 0, kind: 'start' },
      { id: 1, x: 0, y: -8000, kind: 'fork' },
      { id: 2, x: 0, y: -18000, kind: 'merge' },
      { id: 3, x: 0, y: -24000, kind: 'lot' },
    ],
    segs: [
      seg(0, 0, 1, 'trunk', 0, []),
      seg(1, 1, 2, 'shortcut', 0, [{ type: 'radar', rise: 1000, kmh: 80 }]),
      seg(2, 1, 2, 'busy', 2000, [{ type: 'toll', rise: 220 }]),
      seg(3, 2, 3, 'trunk', 0, []),
    ],
  };
}
const FORK = 0, RADAR = 1, TOLL = 2, LOT = 3;

// A round in play with no traffic, junction cars or events and no world drawn, so the HUD is the only
// thing in the draw log.
function world(assist) {
  const clock = { t: 1000 };
  const w = makeWorld('assist', { clock });
  const TR = w.TR, G = TR.Game;
  TR.Settings.set({ traffic: 'normal', weather: 'gunduz' });
  G.newSeries(['A', 'B'], [assist, 'kapali']);
  G.startRound(0, { seed: 1, mapSpec: fixtureSpec() });
  for (const sg of G.map.segs) {
    sg.traffic.cars.length = 0;
    sg.traffic.update = () => {};
    sg.junctions.cars.length = 0;
    sg.junctions.update = () => [];
    sg.events.update = () => [];
  }
  G.map.draw = () => {};
  TR.Light.draw = () => {};
  w.step = () => {
    clock.t += FRAME_MS;
    w.frame();
  };
  while (G.state === 'countdown') w.step();
  return w;
}

const NONE = { thr: 0, steer: 0, mx: 0, my: 0, action: false, reset: false, brake: false, horn: false, left: false, right: false };

// Player 0 at top speed in the right lane of the fork segment, from 2500 before the fork, full throttle
// and steering onto the radar branch; player 1 waits far off to the side.
function approach(w) {
  const TR = w.TR, U = TR.U, G = TR.Game, segs = G.map.segs, [p, o] = G.players, lane = TR.ROAD.LANE / 2;
  o.truck.place(-6000, 2000, -Math.PI / 2);
  o.truck.v = 0;
  const road = segs[FORK].road, s = road.length - 2500, q = road.lanePos(s, lane);
  p.truck.place(q.x, q.y, q.h);
  p.truck.v = TR.TRUCK.MAX_FWD;
  Object.assign(p, { seg: FORK, s, hint: -1 });
  TR.Input.sources[p.idx] = () => {
    const t = p.truck;
    let r = segs[FORK].road;
    if (r.locate(t.x, t.y, -1).s >= r.length) r = segs[RADAR].road;
    const a = r.lanePos(r.locate(t.x, t.y, -1).s + 300, lane);
    return Object.assign({}, NONE, { thr: 1, steer: U.clamp(U.wrap(Math.atan2(a.y - t.y, a.x - t.x) - t.th) * 4, -1, 1) });
  };
  return p;
}

// Steps until the truck is past the fork onto a branch, one row per frame.
function run(w, p) {
  const TR = w.TR, rows = [];
  for (let f = 0; f < 900 && !(p.seg !== FORK && p.s > 200); f++) {
    w.step();
    rows.push({ seg: p.seg, front: p.s + TR.TRUCK.CAB_FRONT, v: p.truck.v, text: w.log.filter((l) => l.includes('.fillText(')).join('\n') });
  }
  return rows;
}

test('exit seeds the pass', () => {
  const w = world('kapali'), TR = w.TR, segs = TR.Game.map.segs, A = TR.ASSIST, T = TR.TRUCK, DS = TR.ROAD.DS;
  const a = segs[FORK].road.assist, n = segs[FORK].road.n, cap = segs[TOLL].road.assist.limit[0];
  assert.ok(cap < T.MAX_FWD, 'the toll branch starts uncapped: ' + cap);
  assert.equal(a.limit[n - 1], cap);
  const decel = A.BRAKE_SHARE * T.BRAKE * (TR.ROUTES[0].grip || 1);
  for (let i = n - 1; (n - 1 - i) * DS <= 600; i--) {
    const want = Math.sqrt(cap * cap + 2 * decel * DS * (n - 1 - i));
    assert.ok(Math.abs(a.limit[i] - want) < 1e-6 * want, 'sample ' + i + ': ' + a.limit[i] + ' against ' + want);
  }
});

test('min over exits', () => {
  const w = world('kapali'), segs = w.TR.Game.map.segs, exit = segs[FORK].road.assist.exit;
  const toll = segs[TOLL].road.assist.limit[0], radar = segs[RADAR].road.assist.limit[0];
  assert.ok(toll < radar, 'toll ' + toll + ' is not below radar ' + radar);
  assert.equal(exit.limit, toll);
  assert.equal(exit.label, 'GİŞE');
});

test('limitAt past end', () => {
  const w = world('kapali'), TR = w.TR, segs = TR.Game.map.segs;
  const fork = segs[FORK].road, lot = segs[LOT].road;
  for (const ds of [0, 10, TR.TRUCK.CAB_FRONT]) {
    assert.equal(TR.Assist.limitAt(fork, fork.length + ds), segs[TOLL].road.assist.limit[0], 'fork +' + ds);
    assert.equal(TR.Assist.limitAt(lot, lot.length + ds), Infinity, 'lot +' + ds);
  }
});

test('bindAt for an exit cap', () => {
  const w = world('kapali'), TR = w.TR, segs = TR.Game.map.segs, fork = segs[FORK].road;
  const want = { v: 40 / 0.36, label: 'GİŞE' };
  for (const s of [fork.length - 300, fork.length - 20, fork.length + 20]) {
    const b = TR.Assist.bindAt(fork, s);
    assert.equal(b.label, want.label, 's ' + s);
    assert.ok(Math.abs(b.v - want.v) < 1e-9, 's ' + s + ': v ' + b.v);
  }
});

test('game prepares in reverse order', () => {
  const w = world('kapali'), G = w.TR.Game, segs = G.map.segs;
  const exit = segs[FORK].road.assist.exit;
  assert.ok(Number.isFinite(exit.limit), 'fork exit ' + exit.limit);
  assert.equal(exit.limit, segs[TOLL].road.assist.limit[0]);
  const ends = segs.filter((sg) => sg.out.length);
  assert.ok(ends.length >= 3, 'only ' + ends.length + ' segments lead on');
  for (const sg of ends) assert.ok(sg.road.assist.exit, 'segment ' + sg.id + ' has no exit');
  assert.equal(segs[G.map.lotSeg].road.assist.exit, null);
});

test('banner before the node', () => {
  const w = world('hafif'), TR = w.TR, G = TR.Game, fork = G.map.segs[FORK].road;
  const rows = run(w, approach(w));
  // In the last 60 before the fork the profile is far below top speed, so a truck still at full
  // throttle there must be warned.
  const near = rows.filter((r) => r.seg === FORK && r.front >= fork.length - 60 && r.front < fork.length);
  assert.ok(near.length >= 3, 'only ' + near.length + ' frames near the fork');
  near.forEach((r, f) => {
    assert.ok(r.v > 200, 'frame ' + f + ': slowed to ' + r.v.toFixed(0));
    assert.ok(r.text.includes('"GİŞE! YAVAŞLA'), 'frame ' + f + ': no toll banner in\n' + r.text);
  });
});

// A straight road of n samples north with a bend whose heading turns 0.08 a sample over the 10 samples
// from each of at, sharp enough for a warning sign.
function bendRoad(isStart, at, n = 800) {
  const hs = new Float64Array(n).fill(-Math.PI / 2);
  for (const b of at) for (let i = b; i < n; i++) hs[i] += 0.08 * Math.min(10, i - b + 1);
  return { n, hs, isStart, route: { grip: 1 }, gripAt: () => 1, signList: [], points: [] };
}

// A bend sign stands SIGN_LEAD (420) before its bend, but on the start segment never before 1000, past the
// start line, and elsewhere never before the segment's start.
test('bend signs stand past the start line and inside their segment', () => {
  const TR = world('kapali').TR, DS = TR.ROAD.DS;
  const near = 30, close = 80, far = 500;
  const signs = (road) => road.signList.map((g) => g.s);
  const start = bendRoad(true, [close, far]);
  TR.Assist.prepare(start, null);
  const other = bendRoad(false, [near, far]);
  TR.Assist.prepare(other, null);
  const leadOf = (b) => [(b - 6) * DS - 420, b * DS - 420];
  for (const [what, ss] of [['start', signs(start)], ['other', signs(other)]]) {
    assert.equal(ss.length, 2, what + ': signs at ' + ss);
    const [lo, hi] = leadOf(far);
    assert.ok(ss[1] >= lo && ss[1] <= hi, what + ': far sign at ' + ss[1]);
  }
  assert.ok(leadOf(close)[1] < 1000, 'the close bend is not close');
  assert.equal(signs(start)[0], 1000, 'start segment');
  assert.ok(leadOf(near)[1] < 0, 'the near bend is not near');
  assert.equal(signs(other)[0], 0, 'other segment');
});

test('auto brake across node', () => {
  const w = world('tam'), TR = w.TR, G = TR.Game, fork = G.map.segs[FORK].road;
  const cap = G.map.segs[TOLL].road.assist.limit[0], tol = TR.TRUCK.BRAKE / 60;
  const rows = run(w, approach(w));
  assert.ok(rows.some((r) => r.seg === RADAR), 'never reached the radar branch');
  const at = rows.filter((r) => r.seg === FORK && r.front >= fork.length);
  assert.ok(at.length >= 3, 'only ' + at.length + ' frames with the cab past the fork');
  at.forEach((r, f) => assert.ok(r.v <= cap + tol, 'frame ' + f + ' past the fork: ' + r.v.toFixed(1) + ' over ' + cap.toFixed(1)));
});
