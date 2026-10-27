'use strict';
(function () {
  const TR = window.TR;
  let ac = null, master = null, muted = false, volume = 0.7;

  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5 * volume;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur, type, vol, slide) {
    const a = ctx();
    if (!a || muted) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.3, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }

  function noise(dur, vol) {
    const a = ctx();
    if (!a || muted) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(), g = a.createGain();
    src.buffer = buf;
    g.gain.value = vol;
    src.connect(g).connect(master);
    src.start();
  }

  TR.Audio = {
    unlock: () => ctx(),
    setMuted: (m) => (muted = m),
    setVolume(v) {
      volume = v;
      if (master) master.gain.value = 0.5 * volume;
    },
    beep: () => tone(520, 0.18, 'square', 0.25),
    go: () => tone(880, 0.45, 'square', 0.3),
    crash: () => { noise(0.5, 0.7); tone(140, 0.4, 'sawtooth', 0.3, 50); },
    bump: () => tone(90, 0.15, 'triangle', 0.4, 60),
    horn: () => { tone(392, 0.35, 'sawtooth', 0.12); tone(330, 0.35, 'sawtooth', 0.12); },
    pick: () => tone(660, 0.08, 'triangle', 0.3, 880),
    drop: () => tone(330, 0.1, 'triangle', 0.35, 220),
    good: () => { tone(660, 0.12, 'square', 0.2); setTimeout(() => tone(990, 0.2, 'square', 0.2), 110); },
    jack: () => tone(200, 0.3, 'sawtooth', 0.2, 120),
    park: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'square', 0.22), i * 120)),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'square', 0.25), i * 150)),
  };
})();
