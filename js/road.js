'use strict';
(function () {
  const TR = window.TR, U = TR.U;
  const DS = 8;
  const LANE = 54, HALF = 108, RAIL = 150;
  TR.ROAD = { DS, LANE, HALF, RAIL, START_S: 700, START_LINE: 800 };

  // tight scales the bend wavelength (lower is sharper), grip scales the truck's cornering
  // and braking, onSpeed scales oncoming car speed. level is the 1-5 shown on the route card.
  TR.ROUTES = [
    {
      id: 'sahil', name: 'Sahil Yolu', tag: 'Yoğun trafik', level: 3,
      desc: 'Deniz kenarında kıvrımlı yol. İki yönde de araç dolu, sollamak için boşluk kollayın.',
      length: 24000, curvy: 0.8, tight: 0.75, same: 22, oncoming: 18, seed: 1907,
      theme: { grass: '#8db650', patch: '#7fa647', decor: 'palm', density: 0.55, sea: true },
    },
    {
      id: 'ova', name: 'Ova Yolu', tag: 'Uzun ve kalabalık', level: 3,
      desc: 'Uzun bir yol. Yavaş kamyon ve otobüs kuyrukları, sık sık karşı şeride çıkmanız gerekecek.',
      length: 34000, curvy: 0.6, tight: 0.8, same: 30, oncoming: 22, seed: 777,
      theme: { grass: '#a8c45c', patch: '#99b553', decor: 'field', density: 0.5 },
    },
    {
      id: 'col', name: 'Çöl Yolu', tag: 'Hızlı karşı trafik', level: 4,
      desc: 'Karşıdan gelenler çok hızlı. Virajın ardını görmeden sollamaya kalkmayın.',
      length: 30000, curvy: 0.9, tight: 0.5, same: 14, oncoming: 22, onSpeed: 1.3, seed: 3131,
      theme: { grass: '#d8c08c', patch: '#ccb27a', shoulder: '#c2a878', decor: 'cactus', density: 0.4 },
    },
    {
      id: 'kar', name: 'Karlı Geçit', tag: 'Buzlu yol', level: 5,
      desc: 'Yol buzlu: tır virajda daha az döner, fren daha geç tutar. Virajdan önce yavaşlayın.',
      length: 24000, curvy: 1.0, tight: 0.5, grip: 0.6, same: 12, oncoming: 16, seed: 1212,
      theme: { grass: '#e9eff3', patch: '#dbe4ea', shoulder: '#c9d2d8', asphalt: '#4d545b', decor: 'snowpine', density: 0.75 },
    },
    {
      id: 'dag', name: 'Dağ Geçidi', tag: 'Keskin virajlar', level: 5,
      desc: 'Arka arkaya dar virajlar. Bazılarını tam gazla dönemezsiniz, karşı trafik de yoğun.',
      length: 26000, curvy: 1.2, tight: 0.35, same: 12, oncoming: 20, seed: 4242,
      theme: { grass: '#6f8a43', patch: '#62793b', decor: 'pine', density: 0.8 },
    },
  ];

  class Road {
    constructor(route) {
      this.route = route;
      this.theme = route.theme;
      const rnd = U.rng(route.seed);
      const waves = [];
      for (let k = 0; k < 4; k++) {
        waves.push({ amp: route.curvy * rnd.range(0.14, 0.34), len: rnd.range(1600, 5200) * (route.tight || 1), ph: rnd.range(0, 6.283) });
      }
      const L = route.length;
      const n = (this.n = Math.floor(L / DS) + 1);
      const xs = (this.xs = new Float64Array(n));
      const ys = (this.ys = new Float64Array(n));
      const hs = (this.hs = new Float64Array(n));
      const nx = (this.nx = new Float64Array(n));
      const ny = (this.ny = new Float64Array(n));
      let x = 0, y = 0;
      for (let i = 0; i < n; i++) {
        const s = i * DS;
        const ramp = U.smooth((s - 1000) / 900) * U.smooth((L - 1500 - s) / 900);
        let dev = 0;
        for (const w of waves) dev += w.amp * Math.sin((s / w.len) * 6.283 + w.ph);
        // tanh keeps the road heading north, so y falls monotonically with s.
        dev = 1.1 * Math.tanh(dev / 1.1) * ramp;
        const h = -Math.PI / 2 + dev;
        xs[i] = x; ys[i] = y; hs[i] = h;
        nx[i] = -Math.sin(h); ny[i] = Math.cos(h);
        x += Math.cos(h) * DS;
        y += Math.sin(h) * DS;
      }
      this.length = (n - 1) * DS;
      this.endX = xs[n - 1];
      this.endY = ys[n - 1];
    }

    indexForY(y) {
      let lo = 0, hi = this.n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.ys[mid] <= y) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    }

    locate(x, y, hint) {
      const { xs, ys, n } = this;
      const useHint = hint != null && hint >= 0;
      const c = useHint ? hint : this.indexForY(y);
      const w = useHint ? 24 : 110;
      const a = Math.max(0, c - w), b = Math.min(n - 1, c + w);
      let best = Infinity, bi = c;
      for (let i = a; i <= b; i++) {
        const dx = x - xs[i], dy = y - ys[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; bi = i; }
      }
      if (useHint && ((bi === a && a > 0) || (bi === b && b < n - 1))) return this.locate(x, y, -1);
      const h = this.hs[bi];
      const dx = x - xs[bi], dy = y - ys[bi];
      const t = dx * Math.cos(h) + dy * Math.sin(h);
      return { i: bi, s: bi * DS + t, d: dx * this.nx[bi] + dy * this.ny[bi], h };
    }

    headingAt(s) {
      if (s <= 0) return this.hs[0];
      if (s >= this.length) return this.hs[this.n - 1];
      const f = s / DS, i = Math.floor(f);
      return U.lerp(this.hs[i], this.hs[i + 1], f - i);
    }

    posAt(s, d) {
      const { xs, ys, n } = this;
      let x, y, h;
      if (s <= 0) {
        h = this.hs[0];
        x = xs[0] + Math.cos(h) * s;
        y = ys[0] + Math.sin(h) * s;
      } else if (s >= this.length) {
        h = this.hs[n - 1];
        x = this.endX + Math.cos(h) * (s - this.length);
        y = this.endY + Math.sin(h) * (s - this.length);
      } else {
        const f = s / DS, i = Math.floor(f), t = f - i;
        x = U.lerp(xs[i], xs[i + 1], t);
        y = U.lerp(ys[i], ys[i + 1], t);
        h = U.lerp(this.hs[i], this.hs[i + 1], t);
      }
      return { x: x - Math.sin(h) * d, y: y + Math.cos(h) * d, h };
    }

    // ---------- drawing ----------
    sampleList(view) {
      const i0 = Math.max(0, this.indexForY(view.y1 + 500) - 2);
      const i1 = Math.min(this.n - 1, this.indexForY(view.y0 - 500) + 2);
      const list = [];
      if (i0 === 0) list.push(-1600, -800);
      for (let i = i0; i <= i1; i++) list.push(i * DS);
      return { list, i0, i1 };
    }

    edge(list, d, out, reverse) {
      const pts = reverse ? list.slice().reverse() : list;
      for (const s of pts) {
        const p = this.posAt(s, d);
        out.push(p.x, p.y);
      }
      return out;
    }

    band(ctx, list, d0, d1, color) {
      const pts = this.edge(list, d0, [], false);
      this.edge(list, d1, pts, true);
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    line(ctx, list, d, color, width, dash) {
      ctx.beginPath();
      let first = true;
      for (const s of list) {
        const p = this.posAt(s, d);
        if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash) {
        ctx.setLineDash(dash);
        ctx.lineDashOffset = list[0];
      }
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    }

    draw(ctx, view) {
      const { list, i0, i1 } = this.sampleList(view);
      if (list.length < 2) return;
      const th = this.theme;
      if (th.sea) this.drawSea(ctx, list, view);
      this.band(ctx, list, -RAIL - 8, RAIL + 8, th.shoulder || '#a89a7c');
      this.band(ctx, list, -HALF - 6, HALF + 6, th.asphalt || '#44474c');
      this.line(ctx, list, -HALF + 2, '#f2f2f2', 3);
      this.line(ctx, list, HALF - 2, '#f2f2f2', 3);
      this.line(ctx, list, -LANE, '#e8e8e8', 2.5, [26, 34]);
      this.line(ctx, list, LANE, '#e8e8e8', 2.5, [26, 34]);
      this.line(ctx, list, -2.5, '#f0c419', 2.5, [40, 20]);
      this.line(ctx, list, 2.5, '#f0c419', 2.5, [40, 20]);
      this.line(ctx, list, -RAIL, '#9aa3ab', 4);
      this.line(ctx, list, RAIL, '#9aa3ab', 4);
      this.drawPosts(ctx, i0, i1);
      this.drawStart(ctx);
      this.drawSigns(ctx, i0, i1);
      this.drawDecor(ctx, i0, i1);
    }

    drawSea(ctx, list, view) {
      const pts = this.edge(list, -470, [], false);
      const yTop = pts[pts.length - 1], yBot = pts[1];
      const xFar = view.x0 - 3000;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
      ctx.lineTo(xFar, yTop);
      ctx.lineTo(xFar, yBot);
      ctx.closePath();
      ctx.fillStyle = '#2b86c5';
      ctx.fill();
      this.band(ctx, list, -470, -330, '#e6d59a');
      this.line(ctx, list, -500, 'rgba(255,255,255,0.55)', 3, [60, 90]);
      this.line(ctx, list, -560, 'rgba(255,255,255,0.3)', 2, [40, 120]);
    }

    drawPosts(ctx, i0, i1) {
      ctx.fillStyle = '#6b737a';
      for (let i = i0 - (i0 % 6); i <= i1; i += 6) {
        for (const side of [-1, 1]) {
          const x = this.xs[i] + this.nx[i] * RAIL * side;
          const y = this.ys[i] + this.ny[i] * RAIL * side;
          ctx.fillRect(x - 3, y - 3, 6, 6);
        }
      }
    }

    drawStart(ctx) {
      const s = TR.ROAD.START_LINE;
      const h = this.headingAt(s);
      const p = this.posAt(s, 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(h + Math.PI / 2);
      const cell = 12;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 18; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#111' : '#fafafa';
          ctx.fillRect(-HALF + c * cell, -cell + r * cell, cell, cell);
        }
      }
      ctx.restore();
      const banner = this.posAt(s, -RAIL - 40);
      this.sign(ctx, banner.x, banner.y, 'BAŞLANGIÇ', '#c62828');
    }

    sign(ctx, x, y, text, bg) {
      ctx.save();
      ctx.font = 'bold 18px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 20;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - w / 2 + 4, y - 14 + 4, w, 28);
      ctx.fillStyle = bg;
      U.roundRect(ctx, x - w / 2, y - 14, w, 28, 4);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 1);
      ctx.restore();
    }

    drawSigns(ctx, i0, i1) {
      const step = 3000 / DS;
      const startK = Math.max(1, Math.floor(i0 / step));
      for (let k = startK; k * step <= i1 + step; k++) {
        const s = k * 3000;
        if (s > this.length - 600) break;
        const p = this.posAt(s, RAIL + 70);
        const km = ((this.length - s) / 10000).toFixed(1).replace('.', ',');
        this.sign(ctx, p.x, p.y, 'PARK ALANI ↑ ' + km + ' km', '#2e7d32');
      }
      const e = this.posAt(this.length - 500, RAIL + 90);
      this.sign(ctx, e.x, e.y, 'TIR PARKI ↑', '#1565c0');
    }

    drawDecor(ctx, i0, i1) {
      const th = this.theme, seed = this.route.seed;
      const step = 9;
      for (let k = Math.floor(i0 / step); k * step <= i1; k++) {
        for (let m = 0; m < 2; m++) {
          const key = k * 2 + m;
          if (U.hash(key * 1.37 + seed) > th.density) continue;
          const i = k * step;
          let side = U.hash(key * 2.11 + seed) < 0.5 ? -1 : 1;
          let dd = side * (RAIL + 45 + U.hash(key * 3.7 + seed) * 460);
          if (th.sea && side < 0) {
            if (U.hash(key * 5.3) > 0.4) continue;
            dd = -(360 + U.hash(key * 4.1) * 80);
          }
          const x = this.xs[i] + this.nx[i] * dd;
          const y = this.ys[i] + this.ny[i] * dd;
          const r = 14 + U.hash(key * 9.1 + seed) * 16;
          drawProp(ctx, x, y, r, th.sea && side < 0 ? 'palm' : th.decor, key);
        }
      }
    }
  }

  function drawProp(ctx, x, y, r, type, key) {
    if (type === 'pine') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(x + 6, y + 8, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2f4f2a';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#3d6634';
      ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.62, 0, 6.283); ctx.fill();
      if (U.hash(key * 7.7) < 0.3) {
        ctx.fillStyle = '#8a8d8f';
        ctx.beginPath(); ctx.arc(x + r * 1.6, y + r * 0.6, r * 0.5, 0, 6.283); ctx.fill();
      }
    } else if (type === 'palm') {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.arc(x + 6, y + 7, r * 0.9, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#3f8f3a';
      ctx.lineWidth = r * 0.32;
      ctx.lineCap = 'round';
      for (let a = 0; a < 6; a++) {
        const ang = a * 1.047 + key;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#7a5a33';
      ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, 6.283); ctx.fill();
    } else if (type === 'snowpine') {
      ctx.fillStyle = 'rgba(40,60,80,0.18)';
      ctx.beginPath(); ctx.arc(x + 6, y + 8, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2c4a3a';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#f4f8fb';
      ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x + r * 0.35, y + r * 0.2, r * 0.3, 0, 6.283); ctx.fill();
    } else if (type === 'cactus') {
      if (U.hash(key * 6.1) < 0.45) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.ellipse(x + 5, y + 6, r * 0.9, r * 0.6, key, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#a07850';
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.9, r * 0.6, key, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#b98f64';
        ctx.beginPath(); ctx.ellipse(x - r * 0.2, y - r * 0.15, r * 0.45, r * 0.3, key, 0, 6.283); ctx.fill();
        return;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.arc(x + 5, y + 6, r * 0.5, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#3f7a3a';
      ctx.lineWidth = r * 0.34;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.8, y); ctx.lineTo(x + r * 0.8, y);
      ctx.moveTo(x - r * 0.8, y); ctx.lineTo(x - r * 0.8, y - r * 0.6);
      ctx.moveTo(x + r * 0.8, y); ctx.lineTo(x + r * 0.8, y + r * 0.5);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#4f9447';
      ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 6.283); ctx.fill();
    } else if (U.hash(key * 3.3) < 0.25) {
      const w = r * 2.2, h = r * 1.6;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x - w / 2 + 6, y - h / 2 + 6, w, h);
      ctx.fillStyle = '#e9dfcf';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#b5452f';
      ctx.fillRect(x - w / 2, y - h / 2, w, h / 2);
      ctx.fillStyle = '#9c3b28';
      ctx.fillRect(x - w / 2, y, w, h / 2);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(x + 6, y + 7, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#4e7d2f';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#62953a';
      ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, 6.283); ctx.fill();
    }
  }

  TR.Road = Road;
})();
