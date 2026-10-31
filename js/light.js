'use strict';
(function file() {
  window.TR.files.push(file);
  const TR = window.TR, T = TR.TRUCK, DS = TR.ROAD.DS;
  // NIGHT and TUNNEL are how dark the layer gets. A tunnel darkens over RAMP centred on each portal.
  // Ceiling lamps sit every LAMP_STEP with radius LAMP_R; street lamps light JUNCTION_R around a junction or a
  // toll. BEAM and CAR_BEAM are headlight reach, FOG how thick the fog is beyond FOG_R of the player's own truck;
  // the warehouse is indoors, so it has no fog.
  const L = {
    NIGHT: 0.86, TUNNEL: 0.8, RAMP: 240, LAMP_STEP: 150, LAMP_R: 85, JUNCTION_R: 300, BEAM: 300, CAR_BEAM: 170, FOG: 0.9, FOG_R: 260,
  };
  const DARK = '4,6,14';
  const canvases = [];

  // One offscreen canvas per viewport and layer kind, resized only when the viewport changes.
  function layer(key, w, h) {
    let c = canvases[key];
    if (!c) c = canvases[key] = document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const lc = c.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, w, h);
    return { c, lc };
  }

  function quadBand(lc, road, s0, s1, w) {
    const pts = [];
    for (let s = s0; s < s1; s += DS) pts.push(road.posAt(s, -w));
    pts.push(road.posAt(s1, -w));
    for (let s = s1; s > s0; s -= DS) pts.push(road.posAt(s, w));
    pts.push(road.posAt(s0, w));
    lc.beginPath();
    lc.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) lc.lineTo(p.x, p.y);
    lc.closePath();
    lc.fill();
  }

  // The darkness inside a tunnel, with a gradient across each portal so the light changes softly.
  function tunnelDark(lc, road, sec) {
    const w = TR.SECTIONS.tunnel.rail + 10, h = L.RAMP / 2;
    const ramp = (sa, sb) => {
      const a = road.posAt(sa, 0), b = road.posAt(sb, 0);
      const g = lc.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, 'rgba(' + DARK + ',0)');
      g.addColorStop(1, 'rgba(' + DARK + ',' + L.TUNNEL + ')');
      lc.fillStyle = g;
      quadBand(lc, road, Math.min(sa, sb), Math.max(sa, sb), w);
    };
    ramp(sec.s0 - h, sec.s0 + h);
    ramp(sec.s1 + h, sec.s1 - h);
    lc.fillStyle = 'rgba(' + DARK + ',' + L.TUNNEL + ')';
    quadBand(lc, road, sec.s0 + h, sec.s1 - h, w);
  }

  function glow(lc, x, y, r, a) {
    const g = lc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.arc(x, y, r, 0, Math.PI * 2);
    lc.fill();
  }

  function beam(lc, x, y, h, len, a) {
    const g = lc.createRadialGradient(x, y, 0, x, y, len);
    g.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(x, y);
    lc.arc(x, y, len, h - 0.42, h + 0.42);
    lc.closePath();
    lc.fill();
  }

  function inView(view, x, y, m) {
    return x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;
  }

  // world is the viewport's world transform (device pixels, shake included), so the layer lines up with
  // what renderView drew. Signs and signal heads are drawn again on top: they must read in the dark.
  function draw(ctx, vp, view, p, G, world, dpr) {
    const night = G.weather === 'gece', fog = G.weather === 'sis';
    const shown = G.map.visible(view).map((k) => {
      const sg = G.map.segs[k], { i0, i1 } = sg.road.sampleList(view);
      return { sg, road: sg.road, i0, i1 };
    });
    const tunnels = shown.flatMap(({ road, i0, i1 }) => road.sections
      .filter((t) => t.type === 'tunnel' && t.s1 > i0 * DS - L.RAMP && t.s0 < i1 * DS + L.RAMP)
      .map((sec) => ({ road, sec })));
    if (!night && !fog && !tunnels.length) return;
    const W = Math.ceil(vp.w * dpr), H = Math.ceil(vp.h * dpr);
    const cars = G.map.segs.flatMap((sg) => sg.traffic.cars.concat(sg.junctions.cars));
    const toLayer = (lc) => lc.setTransform(world.a, world.b, world.c, world.d, world.e - vp.x * dpr, world.f - vp.y * dpr);

    if (night || tunnels.length) {
      const { c, lc } = layer('dark' + p.idx, W, H);
      toLayer(lc);
      if (night) {
        lc.fillStyle = 'rgba(' + DARK + ',' + L.NIGHT + ')';
        lc.fillRect(view.x0 - 50, view.y0 - 50, view.x1 - view.x0 + 100, view.y1 - view.y0 + 100);
      }
      for (const { road, sec } of tunnels) tunnelDark(lc, road, sec);
      lc.globalCompositeOperation = 'destination-out';
      for (const { road, sec } of tunnels) {
        for (let s = sec.s0 + L.LAMP_STEP / 2; s < sec.s1; s += L.LAMP_STEP) {
          const q = road.posAt(s, 0);
          if (inView(view, q.x, q.y, L.LAMP_R)) glow(lc, q.x, q.y, L.LAMP_R, 0.7);
        }
      }
      if (night) {
        for (const { road } of shown) {
          for (const j of road.points) {
            if (TR.POINTS[j.type].flat && inView(view, j.x, j.y, L.JUNCTION_R)) glow(lc, j.x, j.y, L.JUNCTION_R, 0.8);
          }
        }
        const b = G.lot.bounds;
        lc.fillStyle = 'rgba(0,0,0,0.85)';
        lc.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
      for (const q of G.players) {
        const t = q.truck, c2 = t.center();
        glow(lc, c2.x, c2.y, 110, 0.55);
        if (q.phase === 'race' || q.phase === 'park') {
          beam(lc, t.x + Math.cos(t.th) * T.CAB_FRONT, t.y + Math.sin(t.th) * T.CAB_FRONT, t.th, L.BEAM, 0.95);
        }
      }
      for (const car of cars) {
        if (car.dormant > 0 || !inView(view, car.x, car.y, L.CAR_BEAM)) continue;
        glow(lc, car.x, car.y, 34, 0.5);
        if (!car.wreck) beam(lc, car.x + Math.cos(car.h) * car.len / 2, car.y + Math.sin(car.h) * car.len / 2, car.h, L.CAR_BEAM, 0.85);
      }
      lc.globalCompositeOperation = 'source-over';
      ctx.drawImage(c, vp.x, vp.y, vp.w, vp.h);
    }

    if (fog) {
      const { c, lc } = layer('fog' + p.idx, W, H);
      toLayer(lc);
      lc.fillStyle = 'rgba(206,211,216,' + L.FOG + ')';
      lc.fillRect(view.x0 - 50, view.y0 - 50, view.x1 - view.x0 + 100, view.y1 - view.y0 + 100);
      lc.globalCompositeOperation = 'destination-out';
      const c2 = p.truck.center();
      const g = lc.createRadialGradient(c2.x, c2.y, L.FOG_R * 0.35, c2.x, c2.y, L.FOG_R);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(c2.x - L.FOG_R, c2.y - L.FOG_R, L.FOG_R * 2, L.FOG_R * 2);
      const wh = G.lot.warehouse;
      lc.fillStyle = '#000';
      lc.fillRect(wh.x0, wh.y0, wh.x1 - wh.x0, wh.y1 - wh.y0);
      lc.globalCompositeOperation = 'source-over';
      ctx.drawImage(c, vp.x, vp.y, vp.w, vp.h);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    ctx.setTransform(world);
    if (night || tunnels.length) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,240,190,0.9)';
      for (const car of cars) {
        if (car.dormant > 0 || car.wreck || !inView(view, car.x, car.y, 20)) continue;
        for (const k of [-1, 1]) {
          const fx = car.x + Math.cos(car.h) * car.len / 2 - Math.sin(car.h) * k * (car.wid / 2 - 3);
          const fy = car.y + Math.sin(car.h) * car.len / 2 + Math.cos(car.h) * k * (car.wid / 2 - 3);
          ctx.beginPath();
          ctx.arc(fx, fy, 3.5, 0, 6.283);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const { road, i0, i1 } of shown) road.drawSigns(ctx, i0, i1, G.map);
    for (const { sg } of shown) sg.junctions.drawLights(ctx, view);
    ctx.restore();
  }

  TR.Light = { draw, WEATHERS: { gunduz: 'Gündüz', gece: 'Gece', sis: 'Sis' } };
})();
