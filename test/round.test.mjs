// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, linkPair } from './harness.mjs';

const FRAME_MS = 1000 / 60;

function local(ri, opts) {
  const clock = { t: 1000 };
  const w = makeWorld('local', { clock });
  w.TR.Settings.set({ traffic: 'normal', weather: 'gunduz' });
  w.TR.Game.newSeries(['A', 'B'], ['tam', 'hafif']);
  w.TR.Game.startRound(ri, Object.assign({ seed: 4242 + ri }, opts));
  w.step = (n = 1) => {
    for (let f = 0; f < n; f++) {
      clock.t += FRAME_MS;
      w.frame();
    }
  };
  w.race = () => {
    while (w.TR.Game.state === 'countdown') w.step();
  };
  return w;
}

// A host and a guest world linked in memory, before any round.
function online() {
  const clock = { t: 1000 }, pair = linkPair();
  const world = (name) => {
    const w = makeWorld(name, { clock });
    pair.net(w);
    w.TR.Settings.set({ onlineView: 'bolunmus', shake: false, weather: 'gunduz', traffic: 'normal' });
    return w;
  };
  const m = { host: world('host'), guest: world('guest'), pair };
  m.host.TR.Online.host();
  pair.flush();
  m.guest.TR.Online.join(m.host.TR.Online.code);
  pair.flush();
  m.start = (ri) => {
    m.host.TR.Game.newSeries(['Ev', 'Misafir'], ['tam', 'hafif']);
    m.host.TR.Game.startRound(ri, { seed: 4242 + ri });
    pair.flush();
  };
  m.sync = () => {
    const O = m.host.TR.Online;
    m.guest.TR.Online.snaps = [];
    m.guest.TR.Online.applySnap(O.dec(O.enc(O.snapshot())), null, 1);
  };
  m.step = () => {
    clock.t += FRAME_MS;
    m.host.frame();
    m.sync();
    m.guest.frame();
    pair.flush();
  };
  return m;
}

// Puts player p on segment seg at s in its own lane, standing.
function drop(TR, p, seg, s) {
  const R = TR.ROAD, q = TR.Game.map.segs[seg].road.lanePos(s, p.idx === 0 ? R.LANE / 2 : R.LANE * 1.5);
  p.truck.place(q.x, q.y, q.h);
  p.truck.v = 0;
  p.seg = seg;
  p.hint = -1;
}

const firstBranch = (G) => G.map.segs[G.map.start].out[0];
const awake = (traffic) => traffic.cars.filter((c) => c.dormant <= 0);

// start (0,0) → fork (0,-8000) → { shortcut straight, busy detoured } → merge (0,-18000) → lot (0,-24000),
// the two siblings' flows far enough apart to survive Traffic's two roundings.
function fixtureSpec() {
  const seg = (id, a, b, role, flow, detour) => ({
    id, a, b, role, flow, detour, curvy: 0, tight: 1, wseed: 11 + id, features: [], events: { flock: false, work: false },
  });
  return {
    ri: 0, seed: 1, attempt: 0, jams: [],
    nodes: [
      { id: 0, x: 0, y: 0, kind: 'start' },
      { id: 1, x: 0, y: -8000, kind: 'fork' },
      { id: 2, x: 0, y: -18000, kind: 'merge' },
      { id: 3, x: 0, y: -24000, kind: 'lot' },
    ],
    segs: [seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, 'shortcut', 0.6, 0), seg(2, 1, 2, 'busy', 1.5, 2000), seg(3, 2, 3, 'trunk', 1, 0)],
  };
}

test('every segment is wired', () => {
  for (let ri = 0; ri < 5; ri++) {
    const { TR } = local(ri), G = TR.Game;
    const visited = [];
    G.map.segs.forEach((sg, k) => {
      const at = 'route ' + ri + ' segment ' + k;
      assert.equal(sg.road.seg.id, sg.spec.id, at + ' road');
      assert.ok(sg.traffic instanceof TR.Traffic, at + ' has no traffic');
      assert.ok(sg.junctions instanceof TR.Junctions, at + ' has no junctions');
      assert.ok(sg.events instanceof TR.Events, at + ' has no events');
      assert.equal(sg.traffic.road, sg.road, at + ' traffic road');
      assert.equal(sg.junctions.road, sg.road, at + ' junctions road');
      assert.equal(sg.events.road, sg.road, at + ' events road');
      assert.equal(sg.traffic.events, sg.events, at + ' traffic events');
      assert.equal(sg.junctions.traffic, sg.traffic, at + ' junctions traffic');
      visited.push(sg.id);
    });
    assert.deepEqual(visited, [...G.roundOpts.mapSpec.segs].map((s) => s.id), 'route ' + ri + ' walk');
    assert.ok(visited.length > 1, 'route ' + ri + ' has one segment');
  }
});

test("a player's segment simulates", () => {
  const w = local(0), G = w.TR.Game, k = firstBranch(G);
  drop(w.TR, G.players[1], k, w.TR.ROAD.START_S);
  w.race();
  // A segment past the start begins with every car asleep; respawn wakes them once a racer is on it.
  w.step(120);
  const before = new Map(awake(G.map.segs[k].traffic).map((c) => [c, c.s]));
  assert.ok(before.size > 0, 'no car awake on segment ' + k);
  w.step(120);
  assert.ok([...before].some(([c, s]) => c.s !== s), 'no car on segment ' + k + ' moved');
});

test('per-segment density', () => {
  const spec = fixtureSpec();
  const { TR } = local(0, { mapSpec: spec, traffic: 'normal' }), G = TR.Game;
  assert.equal(JSON.stringify(G.map.spec), JSON.stringify(fixtureSpec()), 'the fixture spec was not used as given');
  // Sahil's 22 same-direction cars: 22 × 0.6 → 13 → 4, 22 × 1.5 → 33 → 10.
  assert.deepEqual([G.map.segs[1].traffic.target[1], G.map.segs[2].traffic.target[1]], [4, 10]);
});

test('par from shortest path', () => {
  const { TR } = local(0, { mapSpec: fixtureSpec() }), G = TR.Game, p = G.players[0];
  // Straight trunks of 8000 and 6000 and the straight 10000 shortcut, against Sahil's 48000 span.
  assert.equal(G.map.shortest, 24000);
  assert.notEqual(G.route.length, G.map.shortest);
  G.winner = p;
  p.times.unload = 300;
  // par 24000 / 120 + 120 = 320 s, so 20 s spare at 2 points each.
  const bonus = TR.roundScore(p, G, false).items.filter((it) => it.label.startsWith('Hız bonusu'));
  assert.deepEqual([...bonus].map((it) => [it.label, it.pts]), [['Hız bonusu (20 sn)', 40]]);
});

test('guest builds from host spec', () => {
  const m = online();
  m.guest.TR.MapGen.generate = () => {
    throw new Error('the guest generated its own map');
  };
  m.start(1);
  const g = m.guest.TR.Game, h = m.host.TR.Game;
  assert.ok(g.map, 'the guest built no map');
  assert.ok(h.map.segs.length > 1);
  assert.equal(JSON.stringify(g.map.spec), JSON.stringify(h.map.spec));
});

test('snapshot groups per segment', () => {
  const m = online();
  m.start(0);
  const H = m.host.TR.Game, k = firstBranch(H);
  drop(m.host.TR, H.players[1], k, m.host.TR.ROAD.START_S);
  while (H.state === 'countdown') m.step();
  for (let f = 0; f < 60; f++) m.step();
  const xy = (cars) => [...cars].map((c) => [c.x, c.y]);
  const host = xy(awake(H.map.segs[k].traffic));
  assert.ok(host.length > 0, 'no car awake on segment ' + k + ' of the host');
  assert.deepEqual(xy(m.guest.TR.Game.map.segs[k].traffic.cars), host);
});

test('guest render and update guards', () => {
  const m = online();
  m.start(0);
  m.host.down('KeyW');
  while (m.host.TR.Game.state === 'countdown') m.step();
  for (let f = 0; f < 30; f++) m.step();
  const cam = m.guest.TR.Game.players[0].cam, was = [cam.x, cam.y];
  for (let f = 0; f < 30; f++) m.step();
  assert.equal(m.guest.TR.Game.state, 'play');
  assert.ok(m.guest.log.some((l) => l.includes('"tur puan')), 'the guest frame did not draw the round');
  assert.notDeepEqual([cam.x, cam.y], was, "the guest's camera did not move");
});
