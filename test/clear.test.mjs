// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

// Things placed on a segment (sheep, cones, the flagman, jammed cars, warning signs) stand outside every
// other segment's barrier, and every sign a signList holds is drawn.
const SEEDS = Array.from({ length: 8 }, (_, k) => 5 + k * 211);
const w = makeWorld('clear', { clock: { t: 1000 } });
const TR = w.TR, G = TR.Game, R = TR.ROAD;
TR.Settings.set({ traffic: 'normal', weather: 'gunduz' });
G.newSeries(['A', 'B'], ['tam', 'tam']);

// |d| of (x, y) off B's centre line, between B's two ends; Infinity beyond them.
function offB(B, x, y) {
  const c = B.road.locate(x, y, -1);
  return c.s >= 0 && c.s <= B.road.length ? Math.abs(c.d) : Infinity;
}

// The nearest any segment but A comes to (x, y), with that segment's id.
function nearestOther(map, A, x, y) {
  let d = Infinity, id = -1;
  for (const B of map.segs) {
    if (B === A) continue;
    const e = offB(B, x, y);
    if (e < d) { d = e; id = B.id; }
  }
  return { d, id };
}

const sharesNode = (map, A) => map.segs.some((B) => B !== A && (B.spec.a === A.spec.a || B.spec.b === A.spec.b));

let rounds = null;
function allRounds() {
  if (rounds) return rounds;
  rounds = [];
  for (let ri = 0; ri < TR.ROUTES.length; ri++) {
    for (const seed of SEEDS) {
      G.startRound(ri, { seed });
      rounds.push({ at: TR.ROUTES[ri].id + ' seed ' + seed, map: G.map });
    }
  }
  return rounds;
}

function assertClear(map, A, pts, what) {
  for (const [x, y] of pts) {
    const n = nearestOther(map, A, x, y);
    assert.ok(n.d >= R.RAIL, what + ' at (' + x.toFixed(0) + ', ' + y.toFixed(0) + ') is ' + n.d.toFixed(1) + ' from segment ' + n.id);
  }
}

test('flocks and road works stand clear of every other segment', () => {
  let flocks = 0, works = 0, flocksBeside = 0, worksBeside = 0;
  for (const { at, map } of allRounds()) {
    for (const A of map.segs) {
      const road = A.road;
      for (const f of A.events.flocks) {
        const pts = [];
        for (const q of f.sheep) {
          pts.push([q.x, q.y]);
          for (const d of [-q.d, -R.HALF, 0, R.HALF]) {
            const p = road.posAt(f.s + q.u, d);
            pts.push([p.x, p.y]);
          }
        }
        assertClear(map, A, pts, at + ': the flock of segment ' + A.id);
        flocks++;
        if (sharesNode(map, A)) flocksBeside++;
      }
      for (const wk of A.events.works) {
        assertClear(map, A, wk.cones.map((c) => [c.x, c.y]).concat([[wk.flag.x, wk.flag.y]]), at + ': the road works of segment ' + A.id);
        works++;
        if (sharesNode(map, A)) worksBeside++;
      }
    }
  }
  const n = allRounds().length;
  assert.ok(n >= TR.ROUTES.length * SEEDS.length && SEEDS.length > 0);
  assert.ok(flocks >= n, flocks + ' flocks over ' + n + ' rounds');
  assert.ok(works >= n, works + ' road works over ' + n + ' rounds');
  assert.equal(flocksBeside, flocks, 'a flock off the shortcuts');
  assert.ok(worksBeside > 0, 'no road works on a branch');
});

test('jams stand clear of every other segment', () => {
  let jams = 0, beside = 0, maps = 0;
  for (const route of TR.ROUTES) {
    for (const seed of Array.from({ length: 24 }, (_, k) => 2 + k * 89)) {
      const map = new TR.RoadMap(TR.MapGen.generate(route, seed), route);
      maps++;
      for (const j of map.spec.jams) {
        const A = map.segs[j.seg], road = A.road, pts = [];
        for (let s = road.sAtRise(j.rise0); s <= road.sAtRise(j.rise1); s += 50) {
          for (const d of [-R.HALF, R.HALF]) {
            const p = road.posAt(s, d);
            pts.push([p.x, p.y]);
          }
        }
        assert.ok(pts.length > 0);
        assertClear(map, A, pts, route.id + ' seed ' + seed + ': the jam on segment ' + A.id);
        jams++;
        if (sharesNode(map, A)) beside++;
      }
    }
  }
  assert.ok(jams >= maps, jams + ' jams over ' + maps + ' maps');
  assert.ok(beside > 0, 'no jam on a branch');
});

// A drawn sign's box: its body (13 px a glyph at most, 10 px padding each side) 28 high round (x, y), and
// its shadow 4 to the south-east.
function rim({ x, y, text }) {
  const hw = (13 * text.length + 20) / 2, b = { x0: x - hw, x1: x + hw + 4, y0: y - 14, y1: y + 18 }, out = [];
  for (let px = b.x0; px <= b.x1; px += 4) out.push([px, b.y0], [px, b.y1]);
  for (let py = b.y0; py <= b.y1; py += 4) out.push([b.x0, py], [b.x1, py]);
  return out;
}

// The asphalt with its edge line, as the road draws it.
const ASPHALT = R.HALF + 6;

test('every listed sign is drawn, off every asphalt', () => {
  let listed = 0, moved = 0;
  const kinds = { flock: 0, work: 0, bend: 0 };
  for (const { at, map } of allRounds()) {
    for (const A of map.segs) {
      const shown = map.signs(A.id);
      for (const e of A.road.signList) {
        const g = shown.find((q) => q.src === e);
        assert.ok(g, at + ': the sign "' + e.text + '" at ' + e.s.toFixed(0) + ' on segment ' + A.id + ' is not drawn');
        for (const [x, y] of rim(g)) {
          for (const B of map.segs) {
            const d = offB(B, x, y);
            assert.ok(d >= ASPHALT, at + ': the sign "' + g.text + '" of segment ' + A.id + ' reaches ' + d.toFixed(1) + ' from segment ' + B.id);
          }
        }
        listed++;
        if (g.s !== e.s) moved++;
        if (e.text === '⚠ KOYUN SÜRÜSÜ') kinds.flock++;
        else if (e.text === '⚠ YOL ÇALIŞMASI') kinds.work++;
        else if (/^⚠ \d+ km\/s$/.test(e.text)) kinds.bend++;
      }
    }
  }
  const n = allRounds().length;
  assert.ok(kinds.flock >= n && kinds.work >= n, 'flock and road works signs: ' + JSON.stringify(kinds) + ' over ' + n + ' rounds');
  assert.ok(kinds.bend > 0, 'no bend sign checked');
  assert.ok(moved > 0, 'no sign had to move off its own spot');
  assert.ok(listed > moved);
});
