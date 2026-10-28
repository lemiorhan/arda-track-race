// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, linkPair, scriptList } from './harness.mjs';

const FRAME_MS = 1000 / 60;

// A host and a guest world joined by an in-memory link, in a round of route ri on split screens, so that
// both draw both trucks.
function match(ri = 0, guestOpts = {}) {
  const clock = { t: 1000 };
  const pair = linkPair();
  const world = (name, size, view = 'bolunmus') => {
    const w = makeWorld(name, Object.assign({ clock }, size));
    pair.net(w);
    w.TR.Settings.set({ onlineView: view, shake: false, weather: 'karisik', traffic: 'yogun' });
    // Particles are replayed on the guest with its own frame timing, so they are left out of the draw log.
    w.TR.FX.draw = () => {};
    return w;
  };
  const m = { host: world('host'), clock, pair };
  m.host.TR.Online.host();
  pair.flush();
  // A guest joining, the first time or as a reloaded tab. Its own events are built from another seed, as
  // a browser whose floats round differently could build them, so it shows only what the host sent.
  m.join = () => {
    m.guest = world('guest', guestOpts.size, guestOpts.view);
    const E = m.guest.TR.Events;
    m.guest.TR.Events = class extends E {
      constructor(road, seed) {
        super(road, seed + 1);
      }
    };
    m.guest.TR.Online.join(m.host.TR.Online.code);
    pair.flush();
  };
  m.join();
  m.host.TR.Game.newSeries(['Ev', 'Misafir'], ['tam', 'hafif']);
  m.host.TR.Game.startRound(ri, { seed: 4242 + ri });
  pair.flush();
  m.step = () => {
    clock.t += FRAME_MS;
    m.host.frame();
    const snap = m.host.TR.Online.snapshot();
    pair.flush();
    m.guest.TR.Online.snaps = [];
    m.guest.TR.Online.applySnap(m.guest.TR.Online.dec(m.host.TR.Online.enc(snap)), null, 1);
    m.guest.frame();
    pair.flush();
  };
  // Past the countdown, when presses start to act.
  m.race = () => {
    while (m.host.TR.Game.state === 'countdown') m.step();
  };
  return m;
}

const tap = (w, code) => {
  w.down(code);
  w.up(code);
};

test('the scripts the harness loads include the online modules', () => {
  const list = scriptList();
  assert.ok(list.length >= 15, 'only ' + list.length + ' scripts found in index.html');
  for (const s of ['js/net.js', 'js/online.js', 'js/game.js', 'js/ui.js']) assert.ok(list.includes(s), s);
  assert.ok(list.indexOf('js/online.js') < list.indexOf('js/game.js'));
});

function sameFrame(m, f) {
  const h = m.host.log, g = m.guest.log;
  assert.equal(g.length, h.length, 'frame ' + f + ' draw call count');
  for (let i = 0; i < h.length; i++) if (g[i] !== h[i]) assert.fail('frame ' + f + ' call ' + i + ': host ' + h[i] + ' · guest ' + g[i]);
}

// Puts both trucks in their lanes LEAD before s, going V: a fast way to every junction, radar and toll.
function dropAt(m, s, LEAD = 900, V = 230) {
  const { R, G } = { R: m.host.TR.ROAD, G: m.host.TR.Game };
  for (const p of G.players) {
    const q = G.road.lanePos(s - LEAD, p.idx === 0 ? R.LANE / 2 : R.LANE * 1.5);
    p.truck.place(q.x, q.y, q.h);
    p.truck.v = V;
    p.hint = -1;
  }
}

// The oracle is the host's own rendering: whatever the guest is shown must draw the same canvas calls.
for (const ri of [0, 2, 4]) {
  test('a guest draws the same frames as its host, route ' + ri, () => {
    const m = match(ri), { host, guest, step } = m;
    host.down('KeyW');
    guest.down('ArrowUp');
    let compared = 0, carsSeen = 0;
    for (let f = 0; f < 60 * 20; f++) {
      if (f === 400) guest.down('ArrowLeft');
      if (f === 440) guest.up('ArrowLeft');
      if (f === 700) host.down('KeyD');
      if (f === 760) host.up('KeyD');
      step();
      if (f % 15) continue;
      sameFrame(m, f);
      compared++;
      carsSeen += host.TR.Game.traffic.cars.filter((c) => c.dormant <= 0).length;
    }
    // Floors: the comparison ran over a real round, with traffic and both trucks moving.
    assert.ok(compared >= 70, 'compared ' + compared);
    assert.ok(host.log.length > 500, 'host drew only ' + host.log.length + ' calls');
    assert.ok(carsSeen > 0, 'no traffic was ever awake');
    assert.equal(host.TR.Game.state, 'play');
    // Driving with no steering, both trucks grind along the rail in the bends, so the bar is low.
    for (const p of host.TR.Game.players) assert.ok(p.s > host.TR.ROAD.START_S + 300, p.name + ' only reached s=' + p.s);
    assert.notEqual(Math.round(host.TR.Game.players[1].truck.x), Math.round(host.TR.Game.players[0].truck.x));
  });
}

// Every route's junctions, radars and tolls, met at speed: side traffic, flashes and broken gates.
test('a guest draws the same frames as its host at every roadside point', () => {
  const seen = { cross: 0, radar: 0, toll: 0, ring: 0 }, met = { cross: 0, radar: 0, toll: 0, ring: 0 };
  for (let ri = 0; ri < 5; ri++) {
    const m = match(ri), { host, guest } = m, G = host.TR.Game;
    host.down('KeyW');
    guest.down('ArrowUp');
    m.race();
    for (const j of G.road.points) {
      met[j.type]++;
      const side = j.type === 'cross' || j.type === 'ring';
      // Traffic and bends slow a truck down over a long run-up, so radars and tolls are met from close
      // and fast enough to flash the camera and break the gate. Side cars spawn out of sight and are on
      // screen only once they reach the junction, so there the trucks wait for them.
      if (side) {
        host.up('KeyW');
        guest.up('ArrowUp');
        dropAt(m, j.s, 200, 0);
      } else {
        host.down('KeyW');
        guest.down('ArrowUp');
        dropAt(m, j.s, 300, 280);
      }
      const st = G.junctions.states.find((x) => x.j === j);
      const onScreen = () => G.junctions.cars.some((c) => G.players.some((p) => Math.abs(c.x - p.cam.x) < 500 && Math.abs(c.y - p.cam.y) < 450));
      for (let f = 0; f < 60 * (side ? 12 : 6); f++) {
        m.step();
        if (f % 10 === 0) sameFrame(m, 'route ' + ri + ' ' + j.type + '@' + j.s + ' +' + f);
        if (side && f % 10 === 0 && onScreen()) seen[j.type]++;
        if (j.type === 'radar' && st.flash > 0) seen.radar++;
        if (j.type === 'toll' && st.gates.some((q) => q.broken)) seen.toll++;
      }
    }
  }
  // Floors: each kind on the routes was met, and did the thing the guest has to be shown.
  for (const k of Object.keys(met)) {
    assert.ok(met[k] > 0, 'no route has a ' + k);
    assert.ok(seen[k] > 0, k + ' was met ' + met[k] + ' times and never showed its state');
  }
});

// A guest showing only its own truck on a smaller screen sees less than the host's halves do; cars must
// still not pop up inside what it sees.
test('the host spawns traffic out of sight of the guest screen too', () => {
  const m = match(0, { size: { width: 900, height: 560 }, view: 'tek' });
  const views = [];
  const update = m.host.TR.Game.traffic.update.bind(m.host.TR.Game.traffic);
  m.host.TR.Game.traffic.update = (dt, players, vs, ...rest) => (views.push(vs), update(dt, players, vs, ...rest));
  m.race();
  for (let f = 0; f < 30; f++) m.step();
  const last = views[views.length - 1];
  assert.ok(views.length > 0, 'traffic.update never ran');
  assert.equal(last.length, 3, 'host halves plus the guest screen');
  const g = last[2];
  assert.ok(Math.abs((g.x1 - g.x0) * g.z - 900) < 1e-6 && Math.abs((g.y1 - g.y0) * g.z - 560) < 1e-6, 'the third view is not the guest screen');
});

// Q (reset) counts in p.resets, so every press the host acts on is on record.
test('each guest press acts on the host once', () => {
  const m = match();
  m.race();
  const p1 = m.host.TR.Game.players[1];
  for (let k = 1; k <= 3; k++) {
    tap(m.guest, 'KeyQ');
    for (let f = 0; f < 20; f++) m.step();
    assert.equal(p1.resets, k, 'after press ' + k);
  }
  assert.equal(m.host.TR.Game.players[0].resets, 0, 'the guest press moved the host truck');
});

// A reloaded tab counts its presses from zero again, below what the host has already seen.
test('a reloaded guest is heard from its first press', () => {
  const m = match();
  m.race();
  const p1 = m.host.TR.Game.players[1];
  for (let k = 0; k < 3; k++) {
    tap(m.guest, 'KeyQ');
    for (let f = 0; f < 20; f++) m.step();
  }
  assert.equal(p1.resets, 3);
  m.join();
  for (let f = 0; f < 5; f++) m.step();
  assert.equal(p1.resets, 3, 'the rejoin replayed old presses');
  tap(m.guest, 'KeyQ');
  for (let f = 0; f < 20; f++) m.step();
  assert.equal(p1.resets, 4, 'the first press after the rejoin was lost');
});

function until(m, ok, what, frames = 60 * 20) {
  for (let f = 0; f < frames && !ok(); f++) m.step();
  assert.ok(ok(), what);
}

function finishPlayer(m, p) {
  const G = m.host.TR.Game, T = m.host.TR.TRUCK, bay = G.lot.bays[p.idx];
  m.race();
  p.truck.place(bay.cx, bay.y0 + T.LT + T.TR_REAR + 2, Math.PI / 2);
  until(m, () => p.phase === 'unload', p.name + ' never started unloading');
  p.unloader.cells = p.unloader.target.map((c) => c.slice());
  p.unloader.trailer = [];
  until(m, () => p.phase !== 'unload', p.name + ' never finished unloading');
}

// Parks each truck in its bay and empties its trailer, the way a player ends a round, until the host is on
// its round result.
function finishRound(m) {
  const G = m.host.TR.Game;
  for (const p of G.players) finishPlayer(m, p);
  until(m, () => G.state === 'roundover', 'the round never ended');
}

const screen = (w) => w.TR.UI.current;

test('a guest back mid-round is put in the round, not on the screen before it', () => {
  const m = match();
  m.host.TR.Online.share('wait', { text: 'ayarlar' });
  m.host.TR.Game.startRound(0, { seed: 4242 });
  m.pair.flush();
  m.race();
  m.join();
  for (let f = 0; f < 10; f++) m.step();
  assert.equal(screen(m.guest), null, 'after a rejoin over the pre-round screen');
  assert.equal(m.guest.TR.Game.state, 'play');
  m.host.TR.Game.pause();
  m.pair.flush();
  m.join();
  assert.equal(screen(m.guest), 'pause', 'after a rejoin into a paused round');
  m.host.TR.Game.resume();
  m.pair.flush();
  m.join();
  for (let f = 0; f < 10; f++) m.step();
  assert.equal(screen(m.guest), null, 'after a rejoin over a pause that has ended');
  assert.equal(m.guest.TR.Game.state, 'play');
});

test('a guest back on a result screen sees it and keeps one record of it', () => {
  const m = match();
  m.host.TR.Game.series.rounds = 1;
  finishRound(m);
  m.pair.flush();
  assert.equal(screen(m.guest), 'roundResult');
  const rounds = m.guest.TR.Scores.rounds().length;
  assert.ok(rounds > 0, 'the guest recorded no round to keep');
  m.guest.TR.Online.join(m.host.TR.Online.code);
  m.pair.flush();
  assert.equal(screen(m.guest), 'roundResult', 'after a rejoin on the round result');
  assert.equal(m.guest.TR.Game.winner.idx, m.host.TR.Game.winner.idx);
  assert.equal(m.guest.TR.Scores.rounds().length, rounds, 'the replayed round result was recorded again');
  // A guest world of its own has its own records: it missed the result, and keeps it the first time.
  const before = m.guest;
  m.join();
  assert.equal(screen(m.guest), 'roundResult');
  assert.equal(m.guest.TR.Scores.rounds().length, rounds, 'a guest that missed the round result never recorded it');
  m.guest = before;
  m.guest.TR.Online.join(m.host.TR.Online.code);
  m.pair.flush();
  m.host.TR.UI.lockT = 0;
  m.host.down('Enter');
  m.step();
  m.host.up('Enter');
  assert.equal(screen(m.host), 'matchResult', 'host Enter did not open the match result');
  m.pair.flush();
  assert.equal(screen(m.guest), 'matchResult');
  assert.equal(m.guest.TR.Scores.matches().length, 1);
  m.guest.TR.Online.join(m.host.TR.Online.code);
  m.pair.flush();
  assert.equal(screen(m.guest), 'matchResult', 'after a rejoin on the match result');
  assert.equal(m.guest.TR.Scores.matches().length, 1, 'the replayed match result was recorded again');
  m.join();
  assert.equal(screen(m.guest), 'matchResult');
  assert.equal(m.guest.TR.Scores.matches().length, 1, 'a guest that missed the match result never recorded it');
});

// A guest's link closes; its retries open nothing until the host is reachable again.
function cutGuest(m) {
  const join = m.guest.TR.Net.join;
  let tries = 0;
  m.guest.TR.Net.join = () => (tries++, { send() {}, close() {}, drop() {} });
  m.pair.sides.guest.onClose();
  return { tries: () => tries, heal: () => (m.guest.TR.Net.join = join) };
}

test('a guest that loses the link retries until it is back in the round', () => {
  const m = match(), O = m.guest.TR.Online;
  m.race();
  const cut = cutGuest(m);
  assert.ok(O.lost, 'the guest does not count the link as lost');
  m.clock.t += 3100;
  m.guest.frame();
  assert.equal(cut.tries(), 1, 'no retry after the retry time');
  assert.equal(screen(m.guest), null);
  cut.heal();
  m.clock.t += 3100;
  m.guest.frame();
  m.pair.flush();
  assert.equal(O.lost, null, 'the guest did not get back in');
  for (let f = 0; f < 30; f++) m.step();
  assert.equal(m.guest.TR.Game.state, 'play');
});

test('a guest that cannot get back gives up after the rejoin window', () => {
  const m = match(), O = m.guest.TR.Online;
  m.race();
  const cut = cutGuest(m);
  for (let s = 0; s < 29; s++) {
    m.clock.t += 1000;
    m.guest.frame();
  }
  assert.equal(O.role, 'guest', 'the guest gave up before the rejoin window ended');
  assert.ok(cut.tries() >= 9, 'only ' + cut.tries() + ' retries in 29 s');
  m.clock.t += 2000;
  m.guest.frame();
  assert.equal(O.role, null, 'the guest is still trying after the rejoin window');
  assert.equal(screen(m.guest), 'online');
});

// A first connection can close before the host has said who it is; the guest then retries like any lost
// link, and a broker that does not know the room yet does not end that.
test('a guest that loses its link before the welcome keeps retrying through broker errors', () => {
  const clock = { t: 1000 }, w = makeWorld('guest', { clock });
  let h = null;
  w.TR.Net.join = (code, handlers) => ((h = handlers), { send() {}, close() {}, drop() {} });
  w.TR.Online.join('ABCDE');
  h.onClose();
  assert.ok(w.TR.Online.lost, 'the closed first link was not taken as lost');
  h.onError('missing');
  assert.equal(w.TR.Online.role, 'guest', 'a broker error ended the retries');
});

test('a guest whose first connection never opens gives up', () => {
  const clock = { t: 1000 }, w = makeWorld('guest', { clock });
  w.TR.Net.join = () => ({ send() {}, close() {}, drop() {} });
  w.TR.Online.join('ABCDE');
  clock.t += 19 * 1000;
  w.frame();
  assert.equal(w.TR.Online.role, 'guest', 'gave up before the join time');
  clock.t += 2 * 1000;
  w.frame();
  assert.equal(w.TR.Online.role, null, 'still waiting after the join time');
  assert.equal(screen(w), 'online');
});

test('either side leaving takes the other out of the room', () => {
  let m = match();
  m.race();
  m.host.TR.Online.leave(null);
  m.pair.flush();
  assert.equal(m.guest.TR.Online.role, null, 'the guest stayed in a closed room');
  assert.equal(screen(m.guest), 'online');
  m = match();
  m.race();
  m.guest.TR.Online.leave(null);
  m.pair.flush();
  assert.equal(m.host.TR.Online.role, null, 'the host stayed in a room its guest left');
  assert.equal(screen(m.host), 'online');
});

test('the guest shows host text on its result screen as text', () => {
  const m = match();
  const score = m.host.TR.roundScore;
  m.host.TR.roundScore = (...a) => {
    const sc = score(...a);
    sc.items.push({ label: '<img src=x onerror=alert(1)>', pts: '<i>1</i>' });
    sc.total = '<u>9</u>';
    return sc;
  };
  m.host.TR.Game.series.rounds = 1;
  finishRound(m);
  m.host.TR.Game.series.history[0].scores = ['<s>1</s>', 2];
  m.host.TR.Game.series.wins = ['<q>1</q>', 0];
  m.host.TR.Online.share('matchResult');
  m.pair.flush();
  const doc = m.guest.ctx.document, html = doc.getElementById('rrBody').innerHTML;
  assert.ok(html.includes('&lt;img src=x'), 'the label is not on the guest screen');
  for (const tag of ['<img', '<i>', '<u>']) assert.ok(!html.includes(tag), tag + ' went into the round result as markup');
  const mr = doc.getElementById('mrBody').innerHTML + doc.getElementById('mrTotals').innerHTML;
  assert.ok(mr.length > 0, 'the guest drew no match result');
  for (const tag of ['<s>', '<q>']) assert.ok(!mr.includes(tag), tag + ' went into the match result as markup');
});

test('a lost link pauses the host, and a guest that never comes back ends the match', () => {
  const m = match(), { host } = m, O = host.TR.Online;
  m.race();
  m.pair.sides.host.onClose();
  m.pair.flush();
  assert.equal(host.TR.Game.state, 'paused');
  assert.ok(O.lost, 'the host does not count the guest as lost');
  m.clock.t += 29 * 1000;
  host.frame();
  assert.equal(O.role, 'host', 'the host gave up before the rejoin window ended');
  m.clock.t += 2 * 1000;
  host.frame();
  assert.equal(O.role, null, 'the host is still waiting after the rejoin window');
  assert.equal(screen(host), 'online');
});

test('a guest that stops being heard is lost on the host after the dead time', () => {
  const m = match(), { host } = m, O = host.TR.Online;
  m.race();
  m.clock.t += 3 * 1000;
  host.frame();
  assert.equal(O.lost, null, 'lost before the dead time');
  m.clock.t += 2 * 1000;
  host.frame();
  assert.ok(O.lost, 'not lost after the dead time');
  assert.equal(host.TR.Game.state, 'paused');
});

test('a host records nothing to replay while its guest is away', () => {
  const m = match(), { host } = m, O = host.TR.Online;
  m.race();
  const played = () => {
    host.TR.Audio.beep();
    host.TR.FX.emit('spark', 0, 0, 0, 0, '#fff');
    const s = O.snapshot();
    return s.audio.length + s.fx.length;
  };
  assert.ok(played() >= 2, 'a beep and a particle in a round were not recorded');
  // In the last seconds of a round a lost link does not pause it, so no snapshot empties the queues.
  finishPlayer(m, host.TR.Game.players[0]);
  assert.equal(host.TR.Game.state, 'finishing');
  host.TR.Audio.beep();
  m.pair.sides.host.onClose();
  assert.equal(host.TR.Game.state, 'finishing');
  assert.equal(played(), 0, 'sounds and particles were kept for a guest that is away');
});

test('the host takes guest messages only in the shape a guest sends', () => {
  const m = match(), { host } = m, O = host.TR.Online;
  m.race();
  const send = (msg) => m.pair.sides.host.onData(O.enc(msg));
  send({ t: 'in', h: { thr: 50, steer: 'x', mx: -9, brake: 1 }, e: { action: '9', reset: 2 } });
  const inp = host.TR.Input.player(1);
  assert.deepEqual([inp.thr, inp.steer, inp.mx, inp.my, inp.brake], [1, 0, -1, 0, true]);
  assert.deepEqual([inp.action, inp.reset], [false, true], 'a press counted from a string, or a real press lost');
  send({ t: 'in' });
  assert.equal(host.TR.Input.player(1).thr, 0, 'an input with no keys');
  const view = (idx, w, h) => ({ idx, w, h });
  send({ t: 'vps', vps: [view(7, 10, 10), view(1, 1e9, 5), 'x', null, view(1, 0, 400), view(1, 640, -1), Object.assign(view(1, 640, 400), { extra: '<' }), view(0, 300, 200), view(1, 200, 100)] });
  assert.equal(JSON.stringify(O.remoteViewports()), JSON.stringify([view(1, 640, 400), view(0, 300, 200)]));
  send({ t: 'vps', vps: 'none' });
  assert.equal(JSON.stringify(O.remoteViewports()), '[]');
  for (let f = 0; f < 5; f++) host.frame();
  const UI = host.TR.UI;
  UI.current = 'routes';
  UI.picks = [0, 0];
  for (const i of [99, -1, 1.5, '2']) send({ t: 'pick', i });
  assert.equal(UI.picks[1], 0, 'a route that does not exist was picked');
  send({ t: 'pick', i: 2 });
  assert.equal(UI.picks[1], 2, 'a real pick was not taken');
});

test('a broker error ends a room nobody joined, but not a running match', () => {
  const m = match();
  m.race();
  for (const kind of ['network', 'taken', 'missing']) {
    m.pair.sides.host.onError(kind);
    m.pair.sides.guest.onError(kind);
  }
  assert.equal(m.host.TR.Online.role, 'host', 'the host left the match');
  assert.equal(m.guest.TR.Online.role, 'guest', 'the guest left the match');
  for (let f = 0; f < 10; f++) m.step();
  assert.equal(m.host.TR.Game.state, 'play');
  const alone = makeWorld('alone', { clock: m.clock }), pair = linkPair();
  pair.net(alone);
  alone.TR.Online.host();
  pair.flush();
  pair.sides.host.onError('network');
  assert.equal(alone.TR.Online.role, null, 'a room with no guest stayed open with no broker');
});

test('a guest pauses and resumes both machines', () => {
  const m = match();
  m.race();
  m.guest.TR.Game.pause();
  m.pair.flush();
  assert.equal(m.host.TR.Game.state, 'paused');
  assert.equal(screen(m.guest), 'pause');
  m.guest.TR.Game.resume();
  m.pair.flush();
  assert.equal(m.host.TR.Game.state, 'play');
  assert.equal(screen(m.guest), null);
});

test('off line, each player drives with its own keys only', () => {
  const w = makeWorld('local', { clock: { t: 1000 } }), I = w.TR.Input;
  w.down('KeyW');
  assert.deepEqual([I.player(0).thr, I.player(1).thr], [1, 0], 'W');
  w.up('KeyW');
  w.down('ArrowUp');
  assert.deepEqual([I.player(0).thr, I.player(1).thr], [0, 1], 'ArrowUp');
});

test('the guest takes the host round layout over its own', () => {
  const { host, guest } = match(1);
  const h = host.TR.Game, g = guest.TR.Game;
  assert.equal(g.roundOpts.seed, h.roundOpts.seed);
  assert.equal(JSON.stringify(g.road.signList), JSON.stringify(h.road.signList));
  assert.equal(JSON.stringify(g.events.works), JSON.stringify(h.events.works));
  assert.ok(h.road.signList.length > 0 && h.events.works.length + h.events.flocks.length > 0);
});
