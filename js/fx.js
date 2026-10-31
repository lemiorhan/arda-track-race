'use strict';
(function file() {
  window.TR.files.push(file);
  const TR = window.TR;
  // Particles live in world coordinates in a fixed ring: once FX_MAX are alive the oldest is reused,
  // so a burst never allocates and never grows the per-frame cost past FX_MAX.
  const FX_MAX = 700;
  const KINDS = {
    dust: { life: 0.9, size: 8, grow: 28, drag: 2.5, alpha: 0.4, round: true },
    exhaust: { life: 0.7, size: 4, grow: 14, drag: 1.5, alpha: 0.35, round: true, color: '#5f6368' },
    skid: { life: 3, size: 5, grow: 0, drag: 0, alpha: 0.35, color: '#1e2024' },
    spark: { life: 0.5, size: 4, grow: 0, drag: 4, alpha: 1, color: '#ffd740', top: true },
    debris: { life: 1.2, size: 6, grow: 0, drag: 2, alpha: 1, top: true },
  };
  const pool = Array.from({ length: FX_MAX }, () => ({ t: 0 }));
  let next = 0;

  function emit(kind, x, y, vx, vy, color, rot) {
    const q = pool[next];
    next = (next + 1) % FX_MAX;
    const k = KINDS[kind];
    q.k = k; q.x = x; q.y = y; q.vx = vx || 0; q.vy = vy || 0; q.t = k.life;
    q.color = color || k.color;
    q.rot = rot == null ? Math.random() * 6.283 : rot;
  }

  // Goes through FX.emit, so an online host that wraps it sees every particle (online.js).
  function burst(kind, n, x, y, speed, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = speed * (0.3 + Math.random() * 0.7);
      FX.emit(kind, x, y, Math.cos(a) * v, Math.sin(a) * v, color);
    }
  }

  function update(dt) {
    for (const q of pool) {
      if (q.t <= 0) continue;
      q.t -= dt;
      const f = Math.exp(-q.k.drag * dt);
      q.vx *= f; q.vy *= f;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  }

  // Ground particles (dust, exhaust, skid marks) go under the trucks; sparks and debris (top) go over them.
  function draw(ctx, view, top) {
    for (const q of pool) {
      if (q.t <= 0 || !q.k.top !== !top) continue;
      if (q.x < view.x0 - 40 || q.x > view.x1 + 40 || q.y < view.y0 - 40 || q.y > view.y1 + 40) continue;
      const k = q.k, a = q.t / k.life, size = k.size + k.grow * (1 - a);
      ctx.globalAlpha = k.alpha * a;
      ctx.fillStyle = q.color;
      if (k.round) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, size / 2, 0, 6.283);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Screen-space snowfall for one viewport. Flakes drift against the camera so the layer feels
  // anchored to the world rather than to the glass.
  function drawSnow(ctx, vp, cam, t) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 90; k++) {
      const depth = 0.4 + (k % 4) * 0.2;
      const x = (((k * 137.5 + t * 18 * depth - cam.x * depth * 0.5) % vp.w) + vp.w) % vp.w;
      const y = (((k * 91.3 + t * 70 * depth - cam.y * depth * 0.5) % vp.h) + vp.h) % vp.h;
      ctx.fillRect(vp.x + x, vp.y + y, 1.5 + depth * 1.5, 1.5 + depth * 1.5);
    }
  }

  const FX = (TR.FX = {
    reset: () => pool.forEach((q) => (q.t = 0)),
    alive: () => pool.filter((q) => q.t > 0).length,
    emit, burst, update, draw, drawSnow,
  });
})();
