// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

const w = makeWorld('nodes', { clock: { t: 1000 } });
const TR = w.TR, R = TR.ROAD, MAP = TR.MAP;

// start (0,0) → fork (0,-8000) → { shortcut straight, busy 2000 east, quiet 2000 west } → merge (0,-18000)
// → lot (0,-24000).
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
    segs: [
      seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, 'shortcut', 0.6, 0), seg(2, 1, 2, 'busy', 1.5, 2000),
      seg(3, 1, 2, 'quiet', 0.4, -2000), seg(4, 2, 3, 'trunk', 1, 0),
    ],
  };
}

const maps = () => [
  { name: 'fixture', map: new TR.RoadMap(fixtureSpec(), TR.ROUTES[4]) },
  ...TR.ROUTES.map((route, ri) => ({ name: route.id, map: new TR.RoadMap(TR.MapGen.generate(route, 4242 + ri), route) })),
];

// A canvas stand-in that keeps each stroke's vertices, each arc's and fillRect's centre, and each fill's
// style.
function recorder() {
  const st = { fillStyle: null, strokeStyle: null, lineWidth: 1 }, out = { strokes: [], arcs: [], rects: [], fills: [] };
  let path = [];
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k in st) return st[k];
      if (k === 'beginPath') return () => { path = []; };
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => path.push([x, y]);
      if (k === 'stroke') return () => out.strokes.push({ style: st.strokeStyle, width: st.lineWidth, pts: path.slice() });
      if (k === 'fill') return () => out.fills.push(st.fillStyle);
      if (k === 'arc') return (x, y) => out.arcs.push({ style: st.fillStyle, x, y });
      if (k === 'fillRect') return (x, y, rw, rh) => out.rects.push({ style: st.fillStyle, x: x + rw / 2, y: y + rh / 2 });
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      return () => {};
    },
    set: (t, k, v) => ((st[k] = v), true),
  });
  return { ctx, out };
}

// The view around a fork or merge node, NODE_R north and south of it.
const nodeView = (n) => ({ z: 1, x0: n.x - 3000, x1: n.x + 3000, y0: n.y - MAP.NODE_R, y1: n.y + MAP.NODE_R });
const inner = (map) => map.nodes.filter((n) => n.kind === 'fork' || n.kind === 'merge');
const meets = (map, A, B) => A !== B && [A.spec.a, A.spec.b].some((v) => v === B.spec.a || v === B.spec.b);

// B's own locate, restricted to B's extent: |d| of a point on B's centre line between its two ends.
function offB(B, x, y) {
  const c = B.road.locate(x, y, -1);
  return c.s >= 0 && c.s <= B.road.length ? Math.abs(c.d) : Infinity;
}

function drawn(map, view, k, layers) {
  const rec = recorder();
  for (const layer of layers) map.segs[k].road.drawLayer(rec.ctx, view, layer, map);
  return rec.out;
}

test('layer order across segments', () => {
  const clock = { t: 1000 }, g = makeWorld('local', { clock });
  g.TR.Settings.set({ traffic: 'normal', weather: 'gunduz' });
  g.TR.Game.newSeries(['A', 'B'], ['tam', 'hafif']);
  g.TR.Game.startRound(0, { seed: 4242, mapSpec: fixtureSpec() });
  const G = g.TR.Game;
  for (const p of G.players) {
    const q = G.map.segs[1].road.lanePos(600, R.LANE / 2);
    p.truck.place(q.x, q.y, q.h);
    p.truck.v = 0;
    p.seg = 1;
    p.hint = -1;
    p.cam.x = q.x;
    p.cam.y = q.y;
  }
  const lotDraw = G.lot.draw;
  G.lot.draw = function (...a) {
    g.log.push('LOT');
    return lotDraw.apply(this, a);
  };
  clock.t += 1000 / 60;
  g.frame();
  const log = g.log.slice(0, g.log.indexOf('LOT'));
  assert.ok(log.length > 0, 'the frame drew no lot');
  const asphalt = [];
  let style = null;
  log.forEach((l, i) => {
    const m = l.match(/\.fillStyle=(.*)$/);
    if (m) style = m[1];
    else if (l.endsWith('.fill()') && style === '"#44474c"') asphalt.push(i);
  });
  const marks = log.findIndex((l) => /\.strokeStyle="(#f2f2f2|#e8e8e8|#f0c419)"$/.test(l));
  assert.ok(asphalt.length >= 4, 'asphalt fills of the trunk and the three branches: ' + asphalt.length);
  assert.ok(marks >= 0, 'no marking was drawn');
  assert.ok(Math.max(...asphalt) < marks, 'asphalt at log line ' + Math.max(...asphalt) + ' after the first marking at ' + marks);
});

function cutCheck(pick, what) {
  for (const { name, map } of maps()) {
    let near = 0;
    for (const n of inner(map)) {
      const view = nodeView(n);
      for (const k of map.visible(view)) {
        const A = map.segs[k];
        for (const st of drawn(map, view, k, ['marks', 'rails']).strokes.filter(pick)) {
          for (const B of map.segs) {
            if (!meets(map, A, B)) continue;
            for (const [x, y] of st.pts) {
              const d = offB(B, x, y);
              if (d === Infinity) continue;
              near++;
              assert.ok(d >= R.HALF, name + ': ' + what + ' of segment ' + A.id + ' at (' + x.toFixed(1) + ', ' + y.toFixed(1) + ') is ' + d.toFixed(1) + ' from segment ' + B.id);
            }
          }
        }
      }
    }
    assert.ok(near > 0, name + ': no ' + what + ' vertex lay beside a segment sharing its node');
  }
}

test('no rail on another branch', () => {
  cutCheck((st) => (st.style === '#9aa3ab' && st.width === 4) || (st.style === '#cfd8dc' && st.width === 6), 'rail');
});

const ASPHALT = R.HALF + 6;
const isMark = (st) => (st.style === '#f2f2f2' && st.width === 3) || ((st.style === '#e8e8e8' || st.style === '#f0c419') && st.width === 2.5);

// Where siblings overlap only the lowest-id one draws lane markings, so no second set lies on its asphalt.
test('one set of markings where branches overlap', () => {
  for (const { name, map } of maps()) {
    let near = 0;
    for (const n of inner(map)) {
      const view = nodeView(n);
      for (const k of map.visible(view)) {
        const A = map.segs[k];
        for (const st of drawn(map, view, k, ['marks']).strokes.filter(isMark)) {
          for (const B of map.segs) {
            if (B.id >= A.id || !meets(map, A, B)) continue;
            for (const [x, y] of st.pts) {
              const d = offB(B, x, y);
              if (d === Infinity) continue;
              near++;
              assert.ok(d >= ASPHALT, name + ': a marking of segment ' + A.id + ' at (' + x.toFixed(1) + ', ' + y.toFixed(1) + ') is ' + d.toFixed(1) + ' from segment ' + B.id);
            }
          }
        }
      }
    }
    assert.ok(near > 0, name + ': no marking vertex lay beside a lower segment sharing its node');
  }
});

// Siblings run together straight north for END_FLAT out of a node: that stretch keeps both edge lines, both
// lane lines and the centre line.
test('a shared stretch at a node keeps its markings', () => {
  let stretches = 0;
  for (const { name, map } of maps()) {
    for (const n of inner(map)) {
      const sibs = map.segs.filter((s) => s.spec.a === n.id).length > 1 ? 'out' : map.segs.filter((s) => s.spec.b === n.id).length > 1 ? 'in' : null;
      if (!sibs) continue;
      stretches++;
      const view = nodeView(n), pts = [];
      for (const k of map.visible(view)) for (const st of drawn(map, view, k, ['marks']).strokes.filter(isMark)) pts.push(...st.pts);
      const dir = sibs === 'out' ? -1 : 1;
      for (const off of [-(R.HALF - 2), -R.LANE, -2.5, 2.5, R.LANE, R.HALF - 2]) {
        for (let r = 100; r < MAP.END_FLAT - 100; r += 100) {
          const y0 = n.y + dir * r, y1 = n.y + dir * (r + 100);
          const hit = pts.some(([x, y]) => Math.abs(x - n.x - off) < 1 && y >= Math.min(y0, y1) && y <= Math.max(y0, y1));
          assert.ok(hit, name + ': node ' + n.id + ' has no marking at offset ' + off + ' between rise ' + r + ' and ' + (r + 100));
        }
      }
    }
  }
  assert.ok(stretches > 0, 'no fork or merge was checked');
});

test('onRoad floor and ceiling', () => {
  for (const { name, map } of maps()) {
    const seen = map.segs.map(() => 0);
    for (const A of map.segs) {
      const { xs, ys, n } = A.road;
      for (let i = 0; i < n; i++) {
        for (const ex of [-1, ...map.segs.map((o) => o.id)]) {
          if (ex === A.id) continue;
          assert.ok(map.onRoad(xs[i], ys[i], 0, ex), name + ': sample ' + i + ' of segment ' + A.id + ' not on a road with except ' + ex);
        }
        seen[A.id]++;
      }
      for (let i = 0; i < n; i += 25) {
        const clear = map.segs.every((B) => {
          const b = B.road.bbox, r = R.RAIL + 2 * R.DS;
          if (B === A || xs[i] < b.x0 - r || xs[i] > b.x1 + r || ys[i] < b.y0 - r || ys[i] > b.y1 + r) return true;
          for (let j = 0; j < B.road.n; j++) if (Math.hypot(B.road.xs[j] - xs[i], B.road.ys[j] - ys[i]) < R.RAIL + 2 * R.DS) return false;
          return true;
        });
        if (clear) assert.equal(map.onRoad(xs[i], ys[i], 0, A.id), false, name + ': sample ' + i + ' of segment ' + A.id + ' is on another road');
      }
    }
    assert.ok(seen.every((c) => c > 0), name + ': the walk missed a segment');
  }
  const map = new TR.RoadMap(fixtureSpec(), TR.ROUTES[4]), road = map.segs[0].road;
  const i = road.indexForY(-4000), x = road.xs[i], y = road.ys[i];
  for (const m of [0, 20]) {
    assert.equal(map.onRoad(x + R.RAIL + m + 1, y, m, -1), false, 'margin ' + m + ': beside the trunk');
    assert.equal(map.onRoad(x + R.RAIL + m - 1, y, m, -1), true, 'margin ' + m + ': just inside the trunk');
  }
});

test('coast', () => {
  const map = new TR.RoadMap(fixtureSpec(), TR.ROUTES[0]);
  assert.deepEqual(map.segs.map((s) => s.coast), [true, false, false, true, true]);
  const view = { z: 1, x0: -3000, x1: 3000, y0: -14000, y1: -12000 };
  for (const k of [1, 2, 3]) {
    const sea = drawn(map, view, k, ['under']).fills.filter((f) => f === '#2b86c5').length;
    assert.equal(sea > 0, map.segs[k].coast, 'segment ' + k + ' sea fills: ' + sea);
  }
});

test('decor off other roads', () => {
  const map = new TR.RoadMap(fixtureSpec(), TR.ROUTES[4]);
  assert.equal(TR.ROUTES[4].theme.decor, 'pine');
  let props = 0;
  for (const n of inner(map)) {
    const view = nodeView(n);
    for (const k of map.visible(view)) {
      const out = drawn(map, view, k, ['rails', 'props']), A = map.segs[k];
      const posts = out.rects.filter((r) => r.style === '#6b737a');
      assert.ok(posts.length > 0, 'node ' + n.id + ' segment ' + k + ' drew no posts');
      for (const p of out.arcs.filter((a) => a.style === '#2f4f2a')) {
        props++;
        for (const B of map.segs) {
          if (B === A) continue;
          const d = offB(B, p.x, p.y);
          assert.ok(d >= R.RAIL, 'a pine of segment ' + k + ' stands ' + d.toFixed(1) + ' from segment ' + B.id);
        }
      }
    }
  }
  assert.ok(props > 0, 'no decor was drawn');
});

// The widest glyph advance of the signs' texts in bold 18px system-ui, measured in Chromium (KÖPRÜ: 12.4).
const GLYPH = 12.5;
// A drawn sign's box: its body w wide and 28 high round (x, y), and its shadow 4 to the south-east.
const signBox = ({ x, y, text }) => {
  const hw = (GLYPH * text.length + 20) / 2;
  return { x0: x - hw, x1: x + hw + 4, y0: y - 14, y1: y + 18 };
};
function rim(b) {
  const out = [];
  for (let x = b.x0; x <= b.x1; x += 4) out.push([x, b.y0], [x, b.y1]);
  for (let y = b.y0; y <= b.y1; y += 4) out.push([b.x0, y], [b.x1, y]);
  return out;
}

test('signs and props stand off every asphalt, and signs apart', () => {
  const signs = [], sign = TR.Road.prototype.sign;
  TR.Road.prototype.sign = function (ctx, x, y, text) {
    signs.push({ x, y, text });
    return sign.apply(this, arguments);
  };
  let checked = 0, nearNode = 0, pines = 0;
  try {
    for (const { name, map } of maps()) {
      const all = [];
      for (const A of map.segs) {
        const b = A.road.bbox, view = { z: 1, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
        signs.length = 0;
        const out = drawn(map, view, A.id, ['props']);
        for (const g of signs) {
          checked++;
          if (inner(map).some((n) => Math.abs(n.y - g.y) < MAP.NODE_R)) nearNode++;
          for (const [x, y] of rim(signBox(g))) {
            for (const B of map.segs) {
              const d = offB(B, x, y);
              assert.ok(d >= ASPHALT, name + ': sign "' + g.text + '" of segment ' + A.id + ' reaches ' + d.toFixed(1) + ' from segment ' + B.id);
            }
          }
          all.push(Object.assign({ seg: A.id }, g));
        }
        if (map.route.theme.decor !== 'pine') continue;
        for (const p of out.arcs.filter((a) => a.style === '#2f4f2a')) {
          pines++;
          for (const B of map.segs) {
            const d = offB(B, p.x, p.y);
            assert.ok(B === A || d >= ASPHALT, name + ': a pine of segment ' + A.id + ' stands ' + d.toFixed(1) + ' from segment ' + B.id);
          }
        }
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const p = signBox(all[i]), q = signBox(all[j]);
          const hit = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
          assert.ok(!hit, name + ': "' + all[i].text + '" of segment ' + all[i].seg + ' overlaps "' + all[j].text + '" of segment ' + all[j].seg);
        }
      }
    }
  } finally {
    TR.Road.prototype.sign = sign;
  }
  assert.ok(checked >= 100, 'only ' + checked + ' signs checked');
  assert.ok(nearNode > 0, 'no sign checked near a fork or merge');
  assert.ok(pines > 0, 'no pine checked');
});

// A sign another module adds after the map is built, or a list the online layout replaces, is drawn; it
// wins over the distance sign it would cover.
test('signs follow their lists', () => {
  const map = new TR.RoadMap(fixtureSpec(), TR.ROUTES[4]), road = map.segs[0].road;
  const texts = () => map.signs(0).map((g) => g.text);
  assert.ok(!texts().includes('ADDED'));
  assert.ok(map.signs(0).some((g) => g.s === 3000), 'no distance sign at 3000 to cover');
  road.signList.push({ s: 3010, text: 'ADDED', bg: '#000' });
  assert.ok(texts().includes('ADDED'), 'a pushed sign is missing');
  assert.ok(!map.signs(0).some((g) => g.s === 3000), 'the distance sign under the pushed one is still drawn');
  road.signList = [{ s: 4000, text: 'SWAPPED', bg: '#000' }];
  assert.deepEqual([...texts().filter((t) => !t.startsWith('PARK'))], ['SWAPPED']);
});

// A bridge pulls the rail in to its own deck, inside RAIL, so only except keeps its posts.
test('posts stay on bridges', () => {
  let bridges = 0;
  for (const { name, map } of maps()) {
    for (const A of map.segs) {
      const b = A.road.bbox, view = { z: 1, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
      const posts = drawn(map, view, A.id, ['rails']).rects.filter((r) => r.style === '#6b737a').map((p) => A.road.locate(p.x, p.y, -1).s);
      for (const sec of A.road.sections.filter((x) => x.type === 'bridge')) {
        bridges++;
        assert.ok(posts.some((s) => s >= sec.s0 && s < sec.s1), name + ': no post on the bridge of segment ' + A.id);
      }
    }
  }
  assert.ok(bridges > 0, 'no map has a bridge');
});
