// Two browsers on the real PeerJS public broker, as two machines would play: join, drive, pause from the
// guest. It needs the internet and the broker, so it is not part of npm test.
// Run: npm run test:peer -- [hostBrowser] [guestBrowser]   (chromium | webkit | firefox; default chromium webkit)
import { chromium, webkit, firefox } from 'playwright';
import { serve, checks } from './serve.mjs';

const BROWSERS = { chromium, webkit, firefox };
const [hostName = 'chromium', guestName = 'webkit'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await serve();
const { watch, check, done } = checks();
const hb = await BROWSERS[hostName].launch();
const gb = await BROWSERS[guestName].launch();

try {
  const open = async (browser, label) => {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    watch(p, label);
    await p.goto(server.url);
    await p.click('#btnSkipIntro');
    return p;
  };
  const H = await open(hb, 'host'), Gp = await open(gb, 'guest');
  const state = (p) => p.evaluate(() => TR.Game.state);

  await H.click('[data-go="online"]');
  await H.fill('#onlineName', 'Ev');
  await H.click('#btnHost');
  await H.waitForFunction(() => /Oda kodu: [A-Z0-9]{5}/.test(TR.Online.status), null, { timeout: 20000 });
  const code = await H.evaluate(() => TR.Online.code);
  await Gp.click('[data-go="online"]');
  await Gp.fill('#onlineName', 'Misafir');
  await Gp.fill('#onlineCode', code);
  await Gp.click('#btnJoin');
  await H.waitForFunction(() => TR.UI.current === 'setup', null, { timeout: 30000 });
  check(await H.evaluate(() => TR.Online.peer.name) === 'Misafir', 'host knows the guest by name');

  await H.click('#btnSetupGo');
  await Gp.waitForFunction(() => TR.UI.current === 'routes', null, { timeout: 10000 });
  await sleep(400);
  await H.keyboard.press('Space');
  await Gp.keyboard.press('Space');
  await H.waitForFunction(() => TR.Game.state === 'play', null, { timeout: 15000 });
  await H.keyboard.down('KeyW');
  await Gp.keyboard.down('ArrowUp');
  await sleep(6000);
  const speeds = await H.evaluate(() => TR.Game.players.map((p) => p.truck.v));
  check(speeds.every((v) => v > 50), 'both trucks drive (v=' + speeds.map(Math.round) + ')');
  const ys = await Promise.all([H, Gp].map((p) => p.evaluate(() => TR.Game.players[1].truck.y)));
  check(Math.abs(ys[0] - ys[1]) < 400, 'guest shows its truck where the host has it (dy=' + Math.round(ys[0] - ys[1]) + ')');
  await H.keyboard.up('KeyW');
  await Gp.keyboard.up('ArrowUp');

  await Gp.keyboard.press('Escape');
  await sleep(800);
  check(await state(H) === 'paused', 'guest Escape pauses the host');
  await Gp.keyboard.press('Escape');
  await sleep(800);
  check(await state(H) === 'play', 'guest Escape again resumes the host');
} finally {
  await hb.close();
  await gb.close();
  await server.close();
}
done();
