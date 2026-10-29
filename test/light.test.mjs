// Run: node --test test/light.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

// start (0,0) → fork (0,-8000) → { shortcut straight, busy 2000 east with a tunnel, quiet 2000 west with a
// toll } → merge (0,-18000) → lot (0,-24000). The player drives the shortcut, so the tunnel and the toll are
// on segments that are not the player's.
function fixtureSpec() {
  const seg = (id, a, b, role, flow, detour, features) => ({
    id, a, b, role, flow, detour, curvy: 0, tight: 1, wseed: 11 + id, features, events: { flock: false, work: false },
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
      seg(0, 0, 1, 'trunk', 1, 0, []),
      seg(1, 1, 2, 'shortcut', 0.6, 0, []),
      seg(2, 1, 2, 'busy', 1.5, 2000, [{ type: 'tunnel', rise0: 3000, rise1: 4600 }]),
      seg(3, 1, 2, 'quiet', 0.4, -2000, [{ type: 'toll', rise: 3800 }]),
      seg(4, 2, 3, 'trunk', 1, 0, []),
    ],
  };
}

const w = makeWorld('light', { clock: { t: 1000 } }), TR = w.TR, G = TR.Game;
TR.Settings.set({ traffic: 'normal', weather: 'gunduz', shake: false });
G.newSeries(['A', 'B'], ['tam', 'hafif']);
G.startRound(0, { seed: 4242, mapSpec: fixtureSpec() });
const p = G.players[0];
p.seg = 1;

const vp = { x: 0, y: 0, w: 1280, h: 760 };
const world = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
// Rise 3000..4600 north of the fork: the tunnel's stretch, the toll and the shortcut beside them; the trunks
// lie outside it.
const NEAR = { z: 1, x0: -3000, x1: 3000, y0: -12600, y1: -11000 };
const FAR = { z: 1, x0: -3000, x1: 3000, y0: -17400, y1: -16000 };
const main = w.ctx.document.getElementById('light-main').getContext('2d');

function draw(weather, view) {
  G.weather = weather;
  w.log.length = 0;
  TR.Light.draw(main, vp, view, p, G, world, 1);
  return w.log.slice();
}
const num = (v) => Number(v).toFixed(3);
const at = (x, y) => num(x) + ',' + num(y);
const radials = (log) => log.map((l) => l.match(/^layer\d+\.radial\(([^)]*)\)$/)).filter(Boolean).map((m) => m[1].split(',').map(Number));

test('the near view shows the three branches and not the trunks', () => {
  assert.deepEqual([...G.map.visible(NEAR)], [1, 2, 3]);
  assert.equal(p.seg, 1);
  assert.equal(G.map.segs[2].road.sections.filter((s) => s.type === 'tunnel').length, 1);
  assert.equal(G.map.segs[3].road.points.filter((j) => j.type === 'toll').length, 1);
});

test('a tunnel on another segment darkens the day along that segment', () => {
  const road = G.map.segs[2].road, sec = road.sections.find((s) => s.type === 'tunnel'), h = 240 / 2;
  const log = draw('gunduz', NEAR);
  const linear = log.map((l) => l.match(/^layer\d+\.linear\(([^)]*)\)$/)).filter(Boolean).map((m) => m[1].split(',').map(Number));
  const ends = linear.map(([ax, ay, bx, by]) => at(ax, ay) + ' ' + at(bx, by));
  const a = road.posAt(sec.s0 - h, 0), b = road.posAt(sec.s0 + h, 0);
  assert.ok(ends.includes(at(a.x, a.y) + ' ' + at(b.x, b.y)), 'no portal ramp along the busy segment: ' + ends.join(' | '));
  assert.ok(log.some((l) => l.startsWith('light-main.drawImage(')), 'the dark layer was not drawn');
});

test('a day view with no tunnel draws nothing', () => {
  assert.deepEqual(draw('gunduz', FAR), []);
});

test('at night a toll on another segment is lit', () => {
  const j = G.map.segs[3].road.points.find((q) => q.type === 'toll');
  const lit = radials(draw('gece', NEAR)).filter(([x, y, , , , r]) => at(x, y) === at(j.x, j.y) && r === 300);
  assert.equal(lit.length, 1, 'the toll of the quiet segment has no street lamp');
});

test('at night a car on another segment shows its lights', () => {
  const road = G.map.segs[2].road, q = road.lanePos(road.sAtRise(3800), TR.ROAD.LANE / 2);
  const car = { x: q.x, y: q.y, h: q.h, len: 40, wid: 18, dormant: 0, wreck: false };
  const cars = G.map.segs[2].traffic.cars;
  cars.push(car);
  try {
    const log = draw('gece', NEAR);
    assert.ok(radials(log).some(([x, y, , , , r]) => at(x, y) === at(car.x, car.y) && r === 34), 'the car has no glow');
    const arcs = log.filter((l) => l.startsWith('light-main.arc(')).map((l) => l.slice(15).split(',').map(Number));
    for (const k of [-1, 1]) {
      const fx = car.x + Math.cos(car.h) * car.len / 2 - Math.sin(car.h) * k * (car.wid / 2 - 3);
      const fy = car.y + Math.sin(car.h) * car.len / 2 + Math.cos(car.h) * k * (car.wid / 2 - 3);
      assert.ok(arcs.some(([x, y]) => at(x, y) === at(fx, fy)), 'the car has no headlight on side ' + k);
    }
  } finally {
    cars.splice(cars.indexOf(car), 1);
  }
});

test('signs and signal heads of every shown segment are drawn over the dark', () => {
  const signs = [], heads = [], ds = TR.Road.prototype.drawSigns, dl = TR.Junctions.prototype.drawLights;
  TR.Road.prototype.drawSigns = function () { signs.push(this); };
  TR.Junctions.prototype.drawLights = function () { heads.push(this); };
  try {
    draw('gece', NEAR);
  } finally {
    TR.Road.prototype.drawSigns = ds;
    TR.Junctions.prototype.drawLights = dl;
  }
  const shown = [...G.map.visible(NEAR)];
  assert.ok(shown.length > 1, 'the view shows one segment');
  assert.deepEqual(signs.map((r) => G.map.segs.findIndex((sg) => sg.road === r)), shown);
  assert.deepEqual(heads.map((j) => G.map.segs.findIndex((sg) => sg.junctions === j)), shown);
});
