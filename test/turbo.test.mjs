// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

const FRAME_MS = 1000 / 60;

function round(ri = 0) {
  const clock = { t: 1000 };
  const w = makeWorld('solo', { clock });
  w.TR.Settings.set({ shake: false, weather: 'gunduz', traffic: 'normal' });
  w.TR.FX.draw = () => {};
  const G = w.TR.Game;
  G.newSeries(['A', 'B'], ['kapali', 'kapali']);
  G.startRound(ri, { seed: 99 });
  w.step = () => {
    clock.t += FRAME_MS;
    w.frame();
    w.log.length = 0;
  };
  while (G.state === 'countdown') w.step();
  return w;
}

// Puts an awake car of direction dir on top of player p's cab.
function carOn(w, p, dir) {
  const G = w.TR.Game, c = G.traffic.cars.find((o) => o.dir === dir);
  G.traffic.setS(c, p.s + w.TR.TRUCK.CAB_FRONT / 2);
  c.d = c.dTarget = p.d;
  G.traffic.place(c);
  return c;
}

test('a truck in turbo drives through a car of its own direction, not through an oncoming one', () => {
  const w = round(), G = w.TR.Game, p = G.players[0];
  const hits = (dir, turbo) => {
    for (const c of G.traffic.cars) { c.dormant = 1; c.x = c.y = 1e9; }
    const c = carOn(w, p, dir);
    p.turbo = turbo;
    p.ghost = turbo > 0;
    return G.traffic.collide([p]).filter((h) => h.car === c).length;
  };
  assert.equal(hits(1, 0), 1, 'the overlap set up here is not a hit without turbo');
  assert.equal(hits(1, 5), 0);
  assert.equal(hits(-1, 5), 1);
});

test('a turbo that ends inside a car of its own direction is not a crash, and the next car after it is', () => {
  const w = round(), G = w.TR.Game, p = G.players[0];
  for (const c of G.traffic.cars) { c.dormant = 1; c.x = c.y = 1e9; }
  const c = carOn(w, p, 1);
  p.turbo = 0;
  p.ghost = true;
  assert.equal(G.traffic.collide([p]).length, 0, 'hit by the car the turbo ended inside');
  assert.equal(p.ghost, true, 'stopped passing through while still inside the car');
  // Neither a sleeping car nor a wreck of its own direction keeps the truck passing through.
  c.dormant = 1;
  const wreck = G.traffic.cars.find((o) => o.dir > 0 && o !== c);
  G.traffic.setS(wreck, c.s);
  wreck.d = wreck.dTarget = p.d;
  G.traffic.place(wreck);
  wreck.wreck = { vx: 0, vy: 0, spin: 0, t: 1 };
  assert.equal(G.traffic.collide([p]).length, 0);
  assert.equal(p.ghost, false, 'still passing through once clear of every awake car of its own direction');
  wreck.dormant = 1; wreck.x = wreck.y = 1e9;
  p.ghost = true;
  const n = carOn(w, p, -1);
  assert.equal(G.traffic.collide([p]).filter((h) => h.car === n).length, 1);
  assert.equal(p.ghost, false, 'kept passing through for an oncoming car');
  n.dormant = 1; n.x = n.y = 1e9;
  const d = carOn(w, p, 1);
  assert.equal(G.traffic.collide([p]).filter((h) => h.car === d).length, 1);
});

test('the turbo banner shows on the HUD, and the turbo goes to an online guest in the snapshot', () => {
  const w = round(), G = w.TR.Game, p = G.players[0];
  p.turboS = Infinity;
  // frame() runs without moving the clock, so the turbo does not tick down between setting and drawing it.
  p.turbo = 5.5;
  w.frame();
  assert.ok(w.log.some((l) => l.includes('"TURBO · 6 sn"')), 'no turbo banner in the draw log');
  p.turbo = 0;
  w.frame();
  assert.ok(!w.log.some((l) => l.includes('TURBO')), 'turbo banner drawn with no turbo');
  p.turbo = 4;
  const snap = w.TR.Online.dec(w.TR.Online.enc(w.TR.Online.snapshot()));
  assert.equal(snap.p[0].turbo, 4);
});

test('turbo starts once at its point, lasts its length and lifts the top speed', () => {
  const w = round(), G = w.TR.Game, T = w.TR.TRUCK, R = w.TR.ROAD;
  const p = G.players[0], o = G.players[1];
  assert.ok(p.turboS > R.START_S && p.turboS < G.road.length, 'turbo point ' + p.turboS);
  assert.ok(p.turboLen >= 5 && p.turboLen <= 10, 'turbo length ' + p.turboLen);
  // The straightest stretch of the route that is clear of junctions, tolls and radars: the truck sits just
  // short of its turbo point there at top speed, holding the throttle without steering.
  const road = G.road, span = 4500, DS = R.DS;
  let best = Infinity;
  for (let s = R.START_S + 1000; s + span < road.length - 2000; s += 200) {
    if (road.points.some((j) => j.s > s - 500 && j.s < s + span)) continue;
    const i0 = Math.round(s / DS);
    let turn = 0;
    for (let i = i0; i < i0 + span / DS; i++) turn = Math.max(turn, Math.abs(road.hs[i] - road.hs[i0]));
    if (turn < best) { best = turn; p.turboS = s + 40; }
  }
  const q = G.road.lanePos(p.turboS - 40, R.LANE / 2);
  p.truck.place(q.x, q.y, q.h);
  p.truck.v = T.MAX_FWD;
  p.hint = -1;
  o.turboS = Infinity;
  for (const c of G.traffic.cars) { c.dormant = 99; c.x = c.y = 1e9; }
  w.down('KeyW');
  let starts = 0, on = 0, top = 0;
  for (let f = 0; f < 60 * 12; f++) {
    const was = p.turbo;
    w.step();
    if (p.turbo > 0 && was === 0) starts++;
    if (p.turbo > 0) { on++; top = Math.max(top, p.truck.v); }
    if (p.turbo > 0 && !p.ghost) assert.fail('in turbo but not passing through cars');
  }
  assert.equal(starts, 1);
  assert.ok(Math.abs(on / 60 - p.turboLen) < 0.1, 'on for ' + on / 60 + ' s of ' + p.turboLen);
  assert.ok(top > T.MAX_FWD * 1.4, 'top speed in turbo ' + top);
  assert.equal(p.turbo, 0);
  assert.ok(p.truck.v <= T.MAX_FWD + 1, 'still above the normal top speed after turbo: ' + p.truck.v);
  assert.equal(o.turbo, 0);
});
