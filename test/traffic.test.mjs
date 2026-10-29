// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeWorld } from './harness.mjs';

const FRAME_MS = 1000 / 60;
const LEVELS = ['az', 'normal', 'yogun'];

const seg = (id, a, b, role, flow, detour) => ({
  id, a, b, role, flow, detour, curvy: 0, tight: 1, wseed: 11 + id, features: [], events: { flock: false, work: false },
});

// start (0,0) → fork (0,-7000) → { shortcut straight, busy 1500 east } → merge (0,-14000) → lot (0,-23000).
function soakSpec() {
  return {
    ri: 0, seed: 1, attempt: 0, jams: [],
    nodes: [
      { id: 0, x: 0, y: 0, kind: 'start' },
      { id: 1, x: 0, y: -7000, kind: 'fork' },
      { id: 2, x: 0, y: -14000, kind: 'merge' },
      { id: 3, x: 0, y: -23000, kind: 'lot' },
    ],
    segs: [seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, 'shortcut', 0.6, 0), seg(2, 1, 2, 'busy', 1.5, 1500), seg(3, 2, 3, 'trunk', 1, 0)],
  };
}
const SHORTCUT = 1, BUSY = 2, OUT = 3;

// Segments past the start shorter than the start line's traffic window.
function shortSpec() {
  return {
    ri: 0, seed: 1, attempt: 0, jams: [],
    nodes: [
      { id: 0, x: 0, y: 0, kind: 'start' },
      { id: 1, x: 0, y: -6000, kind: 'fork' },
      { id: 2, x: 0, y: -8500, kind: 'merge' },
      { id: 3, x: 0, y: -11000, kind: 'lot' },
    ],
    segs: [seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, 'shortcut', 1, 0), seg(2, 1, 2, 'busy', 1.5, 300), seg(3, 2, 3, 'trunk', 1, 0)],
  };
}

function world(opts) {
  const clock = { t: 1000 };
  const w = makeWorld('traffic', { clock });
  const TR = w.TR, G = TR.Game;
  // A wreck's spin comes from Math.random; seeded, the soak runs the same every time.
  vm.runInContext('(f) => { Math.random = f; }', w.ctx)(TR.U.rng(5));
  TR.Settings.set({ traffic: 'yogun', weather: 'gunduz', shake: false });
  G.newSeries(['A', 'B'], ['kapali', 'kapali']);
  G.startRound(0, opts);
  w.step = () => {
    clock.t += FRAME_MS;
    w.frame();
  };
  return w;
}

const NONE = { thr: 0, steer: 0, mx: 0, my: 0, action: false, reset: false, brake: false, horn: false, left: false, right: false };

// Drives p along lane of each segment of path in turn, braking for any car in front of the cab, and stops
// once stop() holds.
function drive(w, p, path, lane, stop) {
  const TR = w.TR, U = TR.U, segs = TR.Game.map.segs;
  TR.Input.sources[p.idx] = () => {
    const t = p.truck;
    if (stop()) return Object.assign({}, NONE, { brake: true });
    let road;
    for (const k of path) {
      road = segs[k].road;
      if (road.locate(t.x, t.y, -1).s < road.length) break;
    }
    const q = road.lanePos(road.locate(t.x, t.y, -1).s + 300, lane);
    const err = U.wrap(Math.atan2(q.y - t.y, q.x - t.x) - t.th);
    const c = Math.cos(t.th), s = Math.sin(t.th), reach = 150 + Math.max(0, t.v) * 0.8;
    const blocked = segs.some((sg) => sg.traffic.cars.some((o) => {
      if (o.dormant > 0) return false;
      const dx = o.x - t.x, dy = o.y - t.y, along = dx * c + dy * s;
      return along > 0 && along < reach && Math.abs(-dx * s + dy * c) < 34;
    }));
    return Object.assign({}, NONE, { thr: blocked ? 0 : 1, brake: blocked && t.v > 60, steer: U.clamp(err * 4, -1, 1) });
  };
}

function put(w, p, seg, s, d) {
  const q = w.TR.Game.map.segs[seg].road.lanePos(s, d);
  p.truck.place(q.x, q.y, q.h);
  p.truck.v = 150;
  p.seg = seg;
  p.s = s;
  p.hint = -1;
  p.cam.x = q.x;
  p.cam.y = q.y - 250;
}

// IN keeps a car that is about to cross a view's edge in this frame from counting as seen.
const IN = 20;
const inView = (views, x, y) => views.some((v) => x > v.x0 + IN && x < v.x1 - IN && y > v.y0 + IN && y < v.y1 - IN);

// Both trucks drive from the trunk through the fork, one on each branch, through the merge and onto the lot
// segment, where they stop while the cars ahead run on to the lot. Every frame is checked as it happens.
let soaked = null;
function soak() {
  if (soaked) return soaked;
  const w = world({ seed: 1, mapSpec: soakSpec() }), TR = w.TR, G = TR.Game, U = TR.U, segs = G.map.segs;
  for (const sg of segs) {
    sg.traffic.draw = () => {};
    sg.junctions.draw = () => {};
    sg.events.draw = () => {};
  }
  G.map.draw = () => {};
  TR.Light.draw = () => {};
  TR.HUD.draw = () => {};
  while (G.state === 'countdown') w.step();
  const R = TR.ROAD, [a, b] = G.players, out = segs[OUT].road, tail = out.length - TR.Traffic.NO_TRAFFIC_TAIL;
  put(w, a, 0, segs[0].road.length - 2000, R.LANE / 2);
  put(w, b, 0, segs[0].road.length - 2600, R.LANE / 2);
  const parked = (p) => p.seg === OUT && p.s > TR.MAP.LINK_R + 500;
  drive(w, a, [0, BUSY, OUT], R.LANE / 2, () => parked(a));
  drive(w, b, [0, SHORTCUT, OUT], R.LANE / 2, () => parked(b));

  const r = { vanished: [], seen: 0, handed: [], overlaps: [], pastTail: [], outMax: -Infinity, visited: [new Set(), new Set()], frames: 0 };
  let frame = 0, moved = new Set();
  const segOf = (c) => segs.findIndex((sg) => sg.traffic.cars.includes(c));
  for (const sg of segs) {
    const tr = sg.traffic, update = tr.update.bind(tr), adopt = tr.adopt.bind(tr);
    tr.update = (dt, players, views, ...rest) => {
      const before = tr.cars.filter((c) => c.dormant <= 0 && !c.wreck).map((c) => ({ c, x: c.x, y: c.y, s: c.s, seen: inView(views, c.x, c.y) }));
      update(dt, players, views, ...rest);
      for (const o of before) {
        if (!o.seen) continue;
        r.seen++;
        // A respawn either puts a car to sleep or moves it far off.
        const gone = o.c.dormant > 0 || Math.hypot(o.c.x - o.x, o.c.y - o.y) > 50;
        if (gone && !o.c.wreck && !moved.has(o.c)) r.vanished.push('frame ' + frame + ': a car on segment ' + sg.id + ' at s ' + o.s.toFixed(0) + ', ' + players.length + ' racers');
      }
    };
    tr.adopt = (dir, s, from, lane) => {
      const fromSeg = segOf(from), fromS = from.s, fromLane = from.lane;
      const c = adopt(dir, s, from, lane);
      if (c && fromSeg >= 0) {
        moved.add(from);
        r.handed.push({ frame, from: fromSeg, to: sg.id, dir, fromS, fromLen: segs[fromSeg].road.length, fromLane, lane: c.lane, c });
      }
      return c;
    };
  }

  // Same-direction cars of two segments that share a node, both within LINK_R of it.
  const nearNode = (sg, c, v) => Math.abs((v === sg.spec.a ? 0 : sg.road.length) - c.s) < TR.MAP.LINK_R;
  const box = (c) => U.obb(c.x, c.y, c.len / 2, c.wid / 2, c.h);
  const checkOverlap = () => {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const A = segs[i], B = segs[j];
        for (const v of [A.spec.a, A.spec.b].filter((n) => n === B.spec.a || n === B.spec.b)) {
          for (const c of A.traffic.cars) {
            if (c.dormant > 0 || c.wreck || !nearNode(A, c, v)) continue;
            for (const o of B.traffic.cars) {
              if (o.dormant > 0 || o.wreck || o.dir !== c.dir || !nearNode(B, o, v)) continue;
              if (Math.abs(o.x - c.x) > 120 || Math.abs(o.y - c.y) > 120) continue;
              if (U.sat(box(c), box(o))) r.overlaps.push('frame ' + frame + ': segment ' + A.id + ' s ' + c.s.toFixed(0) + ' and segment ' + B.id + ' s ' + o.s.toFixed(0));
            }
          }
        }
      }
    }
  };

  const holdFrames = 60 * 30;
  let held = 0;
  for (; frame < 60 * 200 && held < holdFrames; frame++) {
    moved = new Set();
    const n = r.handed.length;
    w.step();
    for (const h of r.handed.slice(n)) h.awake = h.c.dormant <= 0;
    checkOverlap();
    for (const c of segs[OUT].traffic.cars) {
      if (c.dormant > 0) continue;
      r.outMax = Math.max(r.outMax, c.s);
      if (c.s > tail) r.pastTail.push('frame ' + frame + ': s ' + c.s.toFixed(0) + ' past ' + tail.toFixed(0));
    }
    [a, b].forEach((p, i) => {
      r.visited[i].add(p.seg);
      if (!parked(p) || p.aside) return;
      // Off the road, so the cars behind it run on to the lot.
      p.aside = true;
      const q = out.lanePos(p.s, 300 + 150 * i);
      p.truck.place(q.x, q.y, q.h);
      p.truck.v = 0;
      p.hint = -1;
    });
    if (a.aside && b.aside) held++;
  }
  r.frames = frame;
  r.held = held;
  r.tail = tail;
  soaked = r;
  return r;
}

test('the soak drives both trucks through a fork and a merge', () => {
  const r = soak();
  for (const k of [0, BUSY, OUT]) assert.ok(r.visited[0].has(k), 'truck A never on segment ' + k);
  for (const k of [0, SHORTCUT, OUT]) assert.ok(r.visited[1].has(k), 'truck B never on segment ' + k);
  assert.ok(r.held > 0, 'the trucks never reached the lot segment, ' + r.frames + ' frames');
});

test('no car vanishes in view', () => {
  const r = soak();
  assert.ok(r.seen > 1000, 'only ' + r.seen + ' car frames in view');
  assert.deepEqual(r.vanished.slice(0, 5), []);
});

test('cars hand off to the next segment', () => {
  const r = soak();
  const ahead = r.handed.filter((h) => h.dir > 0 && h.fromS > h.fromLen && h.awake);
  assert.ok(ahead.length > 0, 'no car ran on into a next segment awake (' + r.handed.length + ' hand-offs)');
  assert.ok(ahead.some((h) => h.from === 0) && ahead.some((h) => h.to === OUT), 'no hand-off at the fork and at the merge');
});

test('no overlap at nodes', () => {
  const r = soak();
  assert.deepEqual(r.overlaps.slice(0, 5), []);
});

test('the lot tail stays clear', () => {
  const r = soak();
  assert.ok(r.outMax > r.tail - 300, 'no car came near the lot tail: furthest at ' + r.outMax.toFixed(0) + ' of ' + r.tail.toFixed(0));
  assert.deepEqual(r.pastTail.slice(0, 5), []);
});

test('an adopted car keeps its lane', () => {
  const r = soak();
  const across = r.handed.filter((h) => h.fromS > h.fromLen || h.fromS < 0);
  assert.ok(across.some((h) => h.fromLane === 0), 'no inner lane car was handed off');
  assert.ok(across.some((h) => h.fromLane === 1), 'no outer lane car was handed off');
  for (const h of across) assert.equal(h.lane, h.fromLane, 'frame ' + h.frame + ': segment ' + h.from + ' to ' + h.to);
});

// On the soak map: the trunk 0 leads to the shortcut 1 and busy 2, which both lead to 3.
test('racersNear gives each nearby racer in the segment\'s own frame', () => {
  const G = world({ seed: 1, mapSpec: soakSpec() }).TR.Game, map = G.map, R = map.segs.map((sg) => sg.road.length);
  const P = (seg, s) => ({ idx: 0, phase: 'race', seg, s, d: 27, truck: { tag: seg + '@' + s } });
  const near = (seg, p) => Array.from(map.racersNear(seg, [p]), (q) => q.s);
  const own = P(SHORTCUT, 3000), got = map.racersNear(SHORTCUT, [own]);
  assert.equal(got.length, 1);
  assert.equal(got[0], own, 'the segment\'s own racer is not passed as it is');
  const cases = [
    ['the trunk before the fork', SHORTCUT, P(0, R[0] - 100), [-100]],
    ['the sibling past the fork', SHORTCUT, P(BUSY, 100), [100]],
    ['the sibling before the merge', SHORTCUT, P(BUSY, R[BUSY] - 100), [R[SHORTCUT] - 100]],
    ['the segment past the merge', SHORTCUT, P(OUT, 100), [R[SHORTCUT] + 100]],
    ['the branch past the fork, seen from the trunk', 0, P(SHORTCUT, 100), [R[0] + 100]],
    ['the sibling halfway', SHORTCUT, P(BUSY, R[BUSY] / 2), []],
    ['the trunk out of reach', SHORTCUT, P(0, R[0] - 3100), []],
    ['a segment that shares no node', 0, P(OUT, 100), []],
  ];
  for (const [what, seg, p, want] of cases) assert.deepEqual(near(seg, p), want, what);
  const q = map.racersNear(SHORTCUT, [P(BUSY, 100)])[0];
  assert.deepEqual([q.idx, q.phase, q.d, q.truck.tag], [0, 'race', 27, BUSY + '@100']);

  // Siblings short enough that a racer is within reach of both nodes count at the nearer one.
  const sw = world({ seed: 1, mapSpec: shortSpec() }), short = sw.TR.Game.map, S = short.segs.map((sg) => sg.road.length);
  assert.ok(S[2] - 100 < sw.TR.MAP.LINK_R, 'the short sibling is not within reach of both nodes');
  assert.deepEqual(Array.from(short.racersNear(1, [P(2, 100)]), (r) => r.s), [100], 'near the fork');
  assert.deepEqual(Array.from(short.racersNear(1, [P(2, S[2] - 100)]), (r) => r.s), [S[1] - 100], 'near the merge');
});

test('busy is busier', () => {
  for (let ri = 0; ri < 5; ri++) {
    let busy = 0;
    for (const traffic of LEVELS) {
      for (const seed of [4242 + ri, 7, 98]) {
        const G = world({ seed, traffic }).TR.Game, at = 'route ' + ri + ' ' + traffic + ' seed ' + seed;
        for (const sg of G.map.segs) {
          if (sg.spec.role !== 'busy') continue;
          busy++;
          for (const o of G.map.segs) {
            if (o === sg || o.spec.a !== sg.spec.a || o.spec.b !== sg.spec.b) continue;
            for (const dir of [1, -1]) assert.ok(sg.traffic.target[dir] > o.traffic.target[dir], at + ': segment ' + sg.id + ' against ' + o.id + ' dir ' + dir);
          }
        }
      }
    }
    assert.ok(busy > 0, 'route ' + ri + ' has no busy segment');
  }
});

test('segments past the start begin empty', () => {
  const G = world({ seed: 1, mapSpec: shortSpec() }).TR.Game;
  assert.ok(G.map.segs[G.map.start].traffic.cars.some((c) => c.dormant <= 0), 'no car on the start segment');
  for (const sg of G.map.segs) {
    if (sg.id === G.map.start) continue;
    const awake = sg.traffic.cars.filter((c) => c.dormant <= 0);
    const ss = awake.map((c) => c.s);
    assert.equal(new Set(ss).size, ss.length, 'segment ' + sg.id + ': two cars at one s');
    for (const s of ss) assert.ok(s >= 0 && s <= sg.road.length, 'segment ' + sg.id + ': a car at s ' + s.toFixed(0));
    assert.equal(awake.length, 0, 'segment ' + sg.id + ' starts with cars');
  }
});
