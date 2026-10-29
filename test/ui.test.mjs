// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './harness.mjs';

const FRAME_MS = 1000 / 60;

function menu() {
  const clock = { t: 1000 };
  const w = makeWorld('ui', { clock });
  w.step = () => {
    clock.t += FRAME_MS;
    w.frame();
  };
  return w;
}

// A preview frame translates to the screen centre, scales, then translates by minus its camera.
function previewCam(log) {
  const i = log.findIndex((l) => l.startsWith('game.scale('));
  assert.ok(log[i + 1].startsWith('game.translate('), log[i + 1]);
  const m = log[i + 1].match(/\(([^,]+),([^)]+)\)/);
  return { x: -Number(m[1]), y: -Number(m[2]) };
}

test('parList', () => {
  const { TR, ctx } = menu();
  const text = ctx.document.getElementById('parList').textContent;
  // Sahil's 48000: 48000 / 120 + 120 = 520 s.
  assert.ok(text.includes('Sahil Yolu ≈ 8:40'), text);
  const named = TR.ROUTES.filter((r) => new RegExp(r.name + ' ≈ \\d+:\\d\\d').test(text));
  assert.equal(named.length, TR.ROUTES.length, text);
  assert.ok(TR.ROUTES.length >= 5);
});

test('preview draws', () => {
  const w = menu(), G = w.TR.Game;
  const visited = [];
  w.TR.ROUTES.forEach((route, i) => {
    G.previewIdx = i;
    w.step();
    assert.equal(G.state, 'menu');
    assert.equal(G.map, null);
    assert.ok(G.preview.route === route, route.name + ' has no preview of its own');
    const asphalt = route.theme.asphalt || '#44474c';
    assert.ok(w.log.includes('game.fillStyle=' + JSON.stringify(asphalt)), route.name + ' drew no asphalt');
    visited.push(route.id);
  });
  assert.deepEqual(visited, ['sahil', 'ova', 'col', 'kar', 'dag']);
});

// start (0,0) → fork (0,-8000) → { 1 shortcut straight, 2 busy detoured by busy } → merge (0,-18000) →
// lot (0,-24000), in MapGen's id order: the shortcut first. roles swaps the two branches' roles.
function forkSpec(busy, roles = ['shortcut', 'busy']) {
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
    segs: [seg(0, 0, 1, 'trunk', 1, 0), seg(1, 1, 2, roles[0], 0.6, 0), seg(2, 1, 2, roles[1], 1.5, busy), seg(3, 2, 3, 'trunk', 1, 0)],
  };
}

// The camera mid-braid on the preview of spec.
function midBraid(spec) {
  const w = menu(), G = w.TR.Game;
  w.TR.MapGen.generate = () => spec;
  G.preview = null;
  G.previewIdx = 0;
  w.step();
  // 1200 + 75 s × 160 = 13200 along the path: 5200 into the branch, mid-braid.
  G.previewT = 75;
  w.step();
  const cam = previewCam(w.log);
  assert.ok(cam.y < -11000 && cam.y > -15000, 'camera at y ' + cam.y);
  return cam;
}

test('preview follows neither ids nor roles', () => {
  for (const roles of [['shortcut', 'busy'], ['busy', 'shortcut']]) {
    const east = midBraid(forkSpec(2000, roles)), west = midBraid(forkSpec(-2000, roles));
    assert.ok(Math.abs(east.x) < 300, roles + ': the busy branch east, camera at x ' + east.x + ', not on the straight branch');
    assert.ok(west.x < -1000, roles + ': the busy branch west, camera at x ' + west.x + ', not on the detoured branch');
  }
});

// previewPath's comment rests on this: MapGen does not keep one role furthest west.
test('no one role runs furthest west at every fork', () => {
  const w = menu(), TR = w.TR, G = TR.Game, roles = {};
  let forks = 0;
  for (let i = 0; i < TR.ROUTES.length; i++) {
    G.preview = null;
    G.previewIdx = i;
    w.step();
    const map = G.preview;
    for (const sg of map.segs) {
      if (sg.out.length < 2) continue;
      forks++;
      const west = sg.out.reduce((b, k) => (map.segs[k].road.xs[map.segs[k].road.n >> 1] < map.segs[b].road.xs[map.segs[b].road.n >> 1] ? k : b));
      roles[map.segs[west].spec.role] = (roles[map.segs[west].spec.role] || 0) + 1;
    }
  }
  assert.ok(forks >= 2 * TR.ROUTES.length, forks + ' forks');
  assert.ok(roles.shortcut > 0 && roles.shortcut < forks, 'the preview takes the shortcut at ' + roles.shortcut + ' of ' + forks + ' forks');
  assert.ok(roles.busy > 0, 'the busy branch is never furthest west: ' + JSON.stringify(roles));
});
