'use strict';
(function () {
  const TR = window.TR, U = TR.U;

  // Units: 1 unit ≈ 10 cm. The reference point is the tractor's rear axle,
  // which is also where the fifth wheel (hitch) sits.
  const T = (TR.TRUCK = {
    WB: 34, CAB_FRONT: 46, CAB_REAR: -16, CAB_HW: 17,
    LT: 96, TR_FRONT: 12, TR_REAR: 24, TR_HW: 18,
    MAX_FWD: 265, MAX_REV: 55, LOT_CAP: 95, OFFROAD_CAP: 110,
    ACC: 120, BRAKE: 330, HARD_BRAKE: 460, REV_ACC: 75, DRAG: 30,
    LAT: 230, STEER_MAX: 0.62, JACK: 1.35,
  });

  class Truck {
    constructor(idx, color, x, y, th) {
      this.idx = idx;
      this.color = color;
      this.x = x; this.y = y;
      this.th = th; this.phi = th;
      this.v = 0;
      this.steer = 0;
      this.stun = 0;
      this.jack = 0;
      this.braking = false;
      this.wheelRot = 0;
      this.grip = 1;
    }

    update(dt, inp, cap) {
      let thr = inp.thr, st = inp.steer, hard = !!inp.brake;
      if (this.stun > 0) {
        this.stun -= dt;
        thr = 0;
        st = 0;
        hard = false;
      }
      if (this.jack > 0) this.jack -= dt;
      const back = st === 0 || Math.sign(st) !== Math.sign(this.steer);
      this.steer = U.approach(this.steer, st, (back ? 4.5 : 2.6) * dt);

      let v = this.v;
      this.braking = false;
      if (hard) {
        // The engine brake only ever slows the truck down: unlike S it never shifts into reverse.
        v = U.approach(v, 0, T.HARD_BRAKE * this.grip * dt);
        this.braking = true;
      } else if (thr > 0) {
        if (v < -1) { v = Math.min(0, v + T.BRAKE * this.grip * dt); this.braking = true; }
        else v += T.ACC * (1.1 - 0.8 * Math.max(0, v) / T.MAX_FWD) * dt;
      } else if (thr < 0) {
        if (v > 1) { v = Math.max(0, v - T.BRAKE * this.grip * dt); this.braking = true; }
        else v = Math.max(-T.MAX_REV, v - T.REV_ACC * dt);
      } else {
        v = U.approach(v, 0, T.DRAG * dt);
      }
      if (v > cap) v = U.approach(v, cap, 300 * dt);
      this.v = v;

      const tanMax = Math.min(Math.tan(T.STEER_MAX), (T.LAT * this.grip * T.WB) / (v * v + 1));
      const tanD = this.steer * tanMax;
      this.delta = Math.atan(tanD);

      const n = Math.max(1, Math.ceil(dt * 120));
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        this.th += (v / T.WB) * tanD * h;
        this.x += Math.cos(this.th) * v * h;
        this.y += Math.sin(this.th) * v * h;
        this.phi += (v / T.LT) * Math.sin(U.wrap(this.th - this.phi)) * h;
      }
      this.th = U.wrap(this.th);
      this.phi = U.wrap(this.phi);
      const rel = U.wrap(this.th - this.phi);
      if (Math.abs(rel) > T.JACK) {
        this.phi = U.wrap(this.th - Math.sign(rel) * T.JACK);
        if (this.v < 0) {
          this.v = 0;
          this.jack = 1.2;
        }
      }
      this.wheelRot += v * dt;
    }

    get angle() {
      return U.wrap(this.th - this.phi);
    }

    cabBox() {
      const off = (T.CAB_FRONT + T.CAB_REAR) / 2;
      return U.obb(this.x + Math.cos(this.th) * off, this.y + Math.sin(this.th) * off,
        (T.CAB_FRONT - T.CAB_REAR) / 2, T.CAB_HW, this.th);
    }

    trailerBox() {
      const len = T.TR_FRONT + T.LT + T.TR_REAR;
      const off = T.TR_FRONT - len / 2;
      return U.obb(this.x + Math.cos(this.phi) * off, this.y + Math.sin(this.phi) * off, len / 2, T.TR_HW, this.phi);
    }

    boxes() {
      return [this.cabBox(), this.trailerBox()];
    }

    trailerRear() {
      const k = T.LT + T.TR_REAR;
      return { x: this.x - Math.cos(this.phi) * k, y: this.y - Math.sin(this.phi) * k };
    }

    center() {
      const r = this.trailerRear();
      const fx = this.x + Math.cos(this.th) * T.CAB_FRONT, fy = this.y + Math.sin(this.th) * T.CAB_FRONT;
      return { x: (r.x + fx) / 2, y: (r.y + fy) / 2 };
    }

    place(x, y, th) {
      this.x = x; this.y = y;
      this.th = th; this.phi = th;
      this.v = 0;
      this.steer = 0;
    }

    // ---------- drawing ----------
    draw(ctx, opt) {
      opt = opt || {};
      this.drawTractor(ctx);
      this.drawTrailer(ctx, opt);
      if (opt.steer) this.drawSteer(ctx);
      if (opt.label) {
        const c = this.cabBox();
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.cx, c.cy - 46, 15, 0, 6.283);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this.idx + 1), c.cx, c.cy - 45);
        ctx.restore();
      }
    }

    drawTractor(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.th);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(T.CAB_REAR + 5, -T.CAB_HW + 6, T.CAB_FRONT - T.CAB_REAR, T.CAB_HW * 2);
      ctx.fillStyle = '#1b1b1b';
      for (const ax of [0, -11]) {
        ctx.fillRect(ax - 6, -T.CAB_HW - 1, 12, 6);
        ctx.fillRect(ax - 6, T.CAB_HW - 5, 12, 6);
      }
      ctx.save();
      ctx.translate(T.WB, -T.CAB_HW + 2);
      ctx.rotate(this.delta || 0);
      ctx.fillRect(-6, -3, 12, 6);
      ctx.restore();
      ctx.save();
      ctx.translate(T.WB, T.CAB_HW - 2);
      ctx.rotate(this.delta || 0);
      ctx.fillRect(-6, -3, 12, 6);
      ctx.restore();
      ctx.fillStyle = '#33373b';
      ctx.fillRect(T.CAB_REAR, -12, 40, 24);
      ctx.fillStyle = '#5b6066';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, 6.283);
      ctx.fill();
      const cx0 = 20;
      ctx.fillStyle = this.color;
      U.roundRect(ctx, cx0, -T.CAB_HW, T.CAB_FRONT - cx0, T.CAB_HW * 2, 4);
      ctx.fill();
      ctx.fillStyle = U.shade(this.color, 0.25);
      U.roundRect(ctx, cx0 + 3, -T.CAB_HW + 4, 13, T.CAB_HW * 2 - 8, 3);
      ctx.fill();
      ctx.fillStyle = '#9fd3f0';
      ctx.fillRect(T.CAB_FRONT - 8, -T.CAB_HW + 3, 5, T.CAB_HW * 2 - 6);
      ctx.fillStyle = '#222';
      ctx.fillRect(T.CAB_FRONT - 15, -T.CAB_HW - 4, 3, 4);
      ctx.fillRect(T.CAB_FRONT - 15, T.CAB_HW, 3, 4);
      ctx.fillStyle = '#ffe9a6';
      ctx.fillRect(T.CAB_FRONT - 2, -T.CAB_HW + 2, 2, 6);
      ctx.fillRect(T.CAB_FRONT - 2, T.CAB_HW - 8, 2, 6);
      ctx.restore();
    }

    // Shows the steering input, not the wheel angle: at speed the grip limit in update()
    // keeps delta near zero, so the front wheels alone barely move.
    drawSteer(ctx) {
      const a = Math.abs(this.steer);
      if (a < 0.05) return;
      const s = Math.sign(this.steer), r = 40, A = a * 1.4, x0 = T.CAB_FRONT + 8;
      const ex = x0 + r * Math.sin(A), ey = s * r * (1 - Math.cos(A)), h = s * A;
      const ch = Math.cos(h), sh = Math.sin(h);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.th);
      ctx.globalAlpha = Math.min(1, a * 2.5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [lw, color] of [[9, 'rgba(0,0,0,0.5)'], [5, '#fff']]) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(x0, s * r, r, -s * Math.PI / 2, s * (A - Math.PI / 2), s < 0);
        ctx.stroke();
        ctx.lineWidth = lw - 4;
        ctx.beginPath();
        ctx.moveTo(ex + ch * 14, ey + sh * 14);
        ctx.lineTo(ex - sh * 9, ey + ch * 9);
        ctx.lineTo(ex + sh * 9, ey - ch * 9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTrailer(ctx, opt) {
      const len = T.TR_FRONT + T.LT + T.TR_REAR;
      const rear = -(T.LT + T.TR_REAR);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.phi);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(rear + 6, -T.TR_HW + 7, len, T.TR_HW * 2);
      ctx.fillStyle = '#1b1b1b';
      for (const ax of [-T.LT + 8, -T.LT - 6]) {
        ctx.fillRect(ax - 6, -T.TR_HW - 2, 12, 5);
        ctx.fillRect(ax - 6, T.TR_HW - 3, 12, 5);
      }
      if (opt.open) {
        ctx.fillStyle = '#d9dde1';
        U.roundRect(ctx, rear, -T.TR_HW, len, T.TR_HW * 2, 3);
        ctx.fill();
        ctx.fillStyle = '#7b6146';
        ctx.fillRect(rear + 3, -T.TR_HW + 3, len - 6, T.TR_HW * 2 - 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1;
        for (let x = rear + 12; x < T.TR_FRONT - 3; x += 12) {
          ctx.beginPath(); ctx.moveTo(x, -T.TR_HW + 3); ctx.lineTo(x, T.TR_HW - 3); ctx.stroke();
        }
        const cargo = opt.cargo || [];
        for (let k = 0; k < cargo.length; k++) {
          const bx = rear + 5 + k * 21;
          TR.drawBoxFlat(ctx, bx, -12, 19, 24, cargo[k], k === 0 && opt.nextGlow);
        }
        ctx.fillStyle = this.color;
        ctx.fillRect(rear - 3, -T.TR_HW, 3, 7);
        ctx.fillRect(rear - 3, T.TR_HW - 7, 3, 7);
      } else {
        ctx.fillStyle = '#eef0f2';
        U.roundRect(ctx, rear, -T.TR_HW, len, T.TR_HW * 2, 3);
        ctx.fill();
        ctx.strokeStyle = '#a7adb3';
        ctx.lineWidth = 1;
        for (let x = rear + 10; x < T.TR_FRONT; x += 11) {
          ctx.beginPath(); ctx.moveTo(x, -T.TR_HW + 1); ctx.lineTo(x, T.TR_HW - 1); ctx.stroke();
        }
        ctx.fillStyle = this.color;
        ctx.fillRect(rear + 4, -5, len - 8, 10);
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.idx === 0 ? 'MAVİ NAKLİYAT' : 'KIRMIZI LOJİSTİK', rear + len / 2, 0.5);
        ctx.restore();
      }
      const reversing = this.v < -2;
      ctx.fillStyle = this.braking ? '#ff3b30' : reversing ? '#ffffff' : '#a1261f';
      ctx.fillRect(rear - 1, -T.TR_HW + 1, 3, 6);
      ctx.fillRect(rear - 1, T.TR_HW - 7, 3, 6);
      if (this.braking || reversing) {
        ctx.fillStyle = this.braking ? 'rgba(255,40,30,0.25)' : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(rear - 6, 0, 22, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  TR.Truck = Truck;
})();
