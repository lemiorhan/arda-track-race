'use strict';
(function file() {
  window.TR.files.push(file);
  const TR = window.TR, U = TR.U;

  TR.BOXES = [
    { color: '#e53935', label: 'A', name: 'Kırmızı' },
    { color: '#1e88e5', label: 'B', name: 'Mavi' },
    { color: '#fdd835', label: 'C', name: 'Sarı' },
    { color: '#43a047', label: 'D', name: 'Yeşil' },
    { color: '#8e24aa', label: 'E', name: 'Mor' },
    { color: '#fb8c00', label: 'F', name: 'Turuncu' },
  ];
  const SIZE = 34, SPACING = 58, MAX_STACK = 3;
  const REACH_CELL = 42, REACH_LOOSE = 34, REACH_DOOR = 48;
  const LAYOUTS = [
    [3, 2, 1], [1, 2, 3], [2, 2, 2], [3, 3], [2, 1, 3], [3, 1, 2], [1, 3, 2], [2, 3, 1],
    [3, 1, 1, 1], [1, 2, 1, 2], [2, 1, 1, 2], [1, 1, 2, 2], [2, 2, 1, 1], [1, 3, 1, 1], [1, 1, 1, 3],
    [1, 1, 1, 1, 2], [2, 1, 1, 1, 1],
  ];

  // Both players get the same plan so the unloading puzzle is equally hard.
  TR.makeCargoPlan = (rnd) => {
    const heights = rnd.pick(LAYOUTS);
    const all = TR.BOXES.map((_, i) => i);
    const ids = rnd.shuffle(all.slice());
    const target = [];
    let k = 0;
    for (const h of heights) target.push(ids.slice(k, (k += h)));
    let order = rnd.shuffle(all.slice());
    // The trailer is unloaded from its door end, so a load order that happens
    // to match the target bottom-up would make the puzzle trivial.
    const easy = target.map((c) => c.slice()).flat();
    while (order.join() === easy.slice().reverse().join()) order = rnd.shuffle(order);
    return { target, trailer: order };
  };

  TR.drawBoxFlat = (ctx, x, y, w, h, id, glow) => {
    const b = TR.BOXES[id];
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold ' + Math.round(Math.min(w, h) * 0.6) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, x + w / 2, y + h / 2 + 1);
    if (glow) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    }
  };

  // A box seen from above at stack level `lvl`; higher boxes lift towards the viewer.
  TR.drawBoxStacked = (ctx, x, y, id, lvl, size) => {
    size = size || SIZE;
    const b = TR.BOXES[id];
    const lift = lvl * 7;
    const s = size + lvl * 2;
    const bx = x - s / 2 - lift * 0.4, by = y - s / 2 - lift;
    ctx.fillStyle = 'rgba(0,0,0,' + (0.18 + lvl * 0.06) + ')';
    ctx.fillRect(bx + 4 + lift * 0.4, by + 5 + lift, s, s);
    ctx.fillStyle = U.shade(b.color, -0.3);
    ctx.fillRect(bx, by + s - 4, s, 6);
    ctx.fillStyle = b.color;
    ctx.fillRect(bx, by, s, s - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx, by, s, 5);
    ctx.fillStyle = 'rgba(120,80,40,0.55)';
    ctx.fillRect(bx + s / 2 - 2, by, 4, s - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, s - 1, s - 2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.round(s * 0.5) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(b.label, bx + s / 2, by + s / 2);
    ctx.fillText(b.label, bx + s / 2, by + s / 2);
  };

  class Unloader {
    constructor(idx, lot, plan, color) {
      this.idx = idx;
      this.color = color;
      this.lot = lot;
      this.target = plan.target;
      this.trailer = plan.trailer.slice();
      this.cells = plan.target.map(() => []);
      const zc = lot.zoneCenters[idx];
      const n = plan.target.length;
      // The two zones mirror each other, so cell 1 sits nearest the door for both players.
      this.mirror = lot.doors[idx].x < zc.x ? 1 : -1;
      this.cellPos = plan.target.map((_, i) => ({ x: zc.x + this.mirror * (i - (n - 1) / 2) * SPACING, y: zc.y }));
      this.loose = [];
      this.door = lot.doors[idx];
      this.floor = lot.floors[idx];
      this.worker = { x: this.door.x, y: this.door.y - 30, fx: 0, fy: -1, carry: null, walk: 0 };
      this.msg = '';
      this.msgT = 0;
      this.focus = null;
    }

    cellState(i) {
      const have = this.cells[i], want = this.target[i];
      if (!have.length) return 'empty';
      for (let k = 0; k < have.length; k++) if (have[k] !== want[k]) return 'wrong';
      return have.length === want.length ? 'ok' : 'partial';
    }

    complete() {
      return this.cells.every((_, i) => this.cellState(i) === 'ok');
    }

    placedCount() {
      let n = 0;
      this.cells.forEach((have, i) => {
        for (let k = 0; k < have.length && have[k] === this.target[i][k]; k++) n++;
      });
      return n;
    }

    say(text) {
      this.msg = text;
      this.msgT = 1.8;
    }

    update(dt, inp) {
      const w = this.worker;
      if (this.msgT > 0) this.msgT -= dt;
      let mx = inp.mx, my = inp.my;
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len; my /= len;
        const sp = w.carry != null ? 125 : 150;
        w.x = U.clamp(w.x + mx * sp * dt, this.floor.x0, this.floor.x1);
        w.y = U.clamp(w.y + my * sp * dt, this.floor.y0, this.floor.y1);
        w.fx = mx; w.fy = my;
        w.walk += dt * 10;
      }
      this.focus = this.findFocus();
      if (inp.action) this.act();
    }

    dropSpot() {
      const w = this.worker;
      return {
        x: U.clamp(w.x + w.fx * 26, this.floor.x0 + 10, this.floor.x1 - 10),
        y: U.clamp(w.y + w.fy * 26, this.floor.y0 + 10, this.floor.y1 - 10),
      };
    }

    findFocus() {
      const w = this.worker;
      let best = null, bd = Infinity;
      const consider = (f, d, reach) => {
        if (d < reach && d < bd) { bd = d; best = f; }
      };
      this.cellPos.forEach((c, i) => {
        const d = Math.hypot(c.x - w.x, c.y - w.y);
        if (w.carry != null || this.cells[i].length) consider({ type: 'cell', i, x: c.x, y: c.y }, d, REACH_CELL);
      });
      if (w.carry == null) {
        this.loose.forEach((b, j) => consider({ type: 'loose', j, x: b.x, y: b.y }, Math.hypot(b.x - w.x, b.y - w.y), REACH_LOOSE));
      }
      const dd = Math.hypot(this.door.x - w.x, this.door.y - w.y);
      if (w.carry != null || this.trailer.length) consider({ type: 'door', x: this.door.x, y: this.door.y }, dd, REACH_DOOR);
      if (!best && w.carry != null) {
        const p = this.dropSpot();
        const blocked = this.loose.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < SIZE * 0.9) ||
          this.cellPos.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < SIZE);
        best = { type: 'drop', x: p.x, y: p.y, blocked };
      }
      return best;
    }

    act() {
      const w = this.worker, f = this.focus;
      if (!f) return;
      const carrying = w.carry != null;
      if (f.type === 'cell') {
        const stack = this.cells[f.i];
        if (carrying) {
          if (stack.length >= MAX_STACK) return this.say('Bu yığın dolu (en fazla ' + MAX_STACK + ' kutu)');
          stack.push(w.carry);
          w.carry = null;
          TR.Audio.drop();
          const st = this.cellState(f.i);
          if (st === 'wrong') this.say('Bu sıra hedefle uyuşmuyor');
          else if (st === 'ok') { this.say('Yığın ' + (f.i + 1) + ' tamam!'); TR.Audio.good(); }
        } else {
          w.carry = stack.pop();
          TR.Audio.pick();
        }
      } else if (f.type === 'loose') {
        w.carry = this.loose.splice(f.j, 1)[0].id;
        TR.Audio.pick();
      } else if (f.type === 'door') {
        if (carrying) {
          this.trailer.push(w.carry);
          w.carry = null;
          TR.Audio.drop();
          this.say('Kutu dorseye geri kondu');
        } else {
          w.carry = this.trailer.pop();
          TR.Audio.pick();
        }
      } else if (f.type === 'drop') {
        if (f.blocked) return this.say('Burada yer yok');
        this.loose.push({ id: w.carry, x: f.x, y: f.y });
        w.carry = null;
        TR.Audio.drop();
      }
      this.focus = this.findFocus();
    }

    // Box ids in the trailer ordered from the door inwards.
    cargoFromDoor() {
      return this.trailer.slice().reverse();
    }

    drawZone(ctx) {
      this.cellPos.forEach((c, i) => {
        const st = this.cellState(i);
        ctx.fillStyle = st === 'ok' ? 'rgba(67,160,71,0.35)' : st === 'wrong' ? 'rgba(229,57,53,0.3)' : 'rgba(255,255,255,0.35)';
        ctx.fillRect(c.x - 24, c.y - 24, 48, 48);
        ctx.strokeStyle = st === 'ok' ? '#2e7d32' : st === 'wrong' ? '#c62828' : this.color;
        ctx.lineWidth = 3;
        ctx.setLineDash(st === 'empty' ? [6, 5] : []);
        ctx.strokeRect(c.x - 24, c.y - 24, 48, 48);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), c.x, c.y + 36);
        const want = this.target[i];
        for (let k = 0; k < want.length; k++) {
          ctx.fillStyle = TR.BOXES[want[k]].color;
          ctx.fillRect(c.x - 12 + k * 9, c.y + 46, 7, 7);
        }
        this.cells[i].forEach((id, lvl) => TR.drawBoxStacked(ctx, c.x, c.y, id, lvl));
        if (st === 'ok' || st === 'wrong') {
          ctx.font = 'bold 18px system-ui, sans-serif';
          ctx.fillStyle = st === 'ok' ? '#1b5e20' : '#b71c1c';
          ctx.fillText(st === 'ok' ? '✔' : '✖', c.x + 26, c.y - 30);
        }
      });
      for (const b of this.loose) TR.drawBoxStacked(ctx, b.x, b.y, b.id, 0, 30);
    }

    drawWorker(ctx, mine) {
      const w = this.worker;
      const f = this.focus;
      if (mine && f) {
        ctx.save();
        ctx.strokeStyle = f.blocked ? 'rgba(229,57,53,0.9)' : 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -performance.now() / 60;
        if (f.type === 'drop') ctx.strokeRect(f.x - 16, f.y - 16, 32, 32);
        else {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.type === 'door' ? 30 : 28, 0, 6.283);
          ctx.stroke();
        }
        ctx.restore();
      }
      const a = Math.atan2(w.fy, w.fx);
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(4, 5, 13, 11, 0, 0, 6.283); ctx.fill();
      ctx.rotate(a);
      const swing = Math.sin(w.walk) * 5;
      ctx.fillStyle = '#263238';
      ctx.fillRect(-4 + swing, -8, 8, 5);
      ctx.fillRect(-4 - swing, 3, 8, 5);
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 12, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#f9a825';
      ctx.beginPath(); ctx.arc(1, 0, 6.5, 0, 6.283); ctx.fill();
      ctx.restore();
      if (w.carry != null) TR.drawBoxStacked(ctx, w.x + w.fx * 16, w.y + w.fy * 16, w.carry, 1, 26);
    }
  }

  TR.Unloader = Unloader;
})();
