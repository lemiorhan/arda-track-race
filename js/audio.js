'use strict';
(function file() {
  window.TR.files.push(file);
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

  // One persistent voice per player: an engine note and an engine-brake rattle, panned to that
  // player's half of the screen.
  const voices = [];
  function voice(i) {
    if (voices[i]) return voices[i];
    const pan = ac.createStereoPanner();
    pan.pan.value = i === 0 ? -0.7 : 0.7;
    pan.connect(master);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(pan);
    const make = (type, freq) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = 0;
      o.connect(g).connect(lp);
      o.start();
      return { o, g };
    };
    voices[i] = { engine: make('sawtooth', 50), jake: make('square', 34) };
    return voices[i];
  }

  TR.Audio = {
    // Called every frame; it never creates the AudioContext, so nothing sounds before the first unlock.
    engine(i, st) {
      if (!ac) return;
      const vc = voice(i), now = ac.currentTime, on = st.on && !muted;
      const r = Math.min(1, Math.abs(st.v) / TR.TRUCK.MAX_FWD);
      vc.engine.o.frequency.setTargetAtTime(48 + r * 70 + (st.thr > 0 ? 8 : 0), now, 0.08);
      vc.engine.g.gain.setTargetAtTime(on ? 0.05 + (st.thr > 0 ? 0.05 : 0) : 0, now, 0.06);
      vc.jake.o.frequency.setTargetAtTime(30 + r * 16, now, 0.08);
      vc.jake.g.gain.setTargetAtTime(on && st.brake && Math.abs(st.v) > 5 ? 0.1 : 0, now, 0.04);
    },
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
    truckHorn: () => { tone(185, 0.6, 'sawtooth', 0.16); tone(147, 0.6, 'sawtooth', 0.16); tone(220, 0.6, 'square', 0.06); },
    nearMiss: () => tone(1200, 0.25, 'triangle', 0.18, 500),
    sheep: () => { tone(520, 0.35, 'sawtooth', 0.1, 460); setTimeout(() => tone(480, 0.45, 'sawtooth', 0.1, 420), 180); },
    fine: () => { tone(440, 0.16, 'square', 0.18); setTimeout(() => tone(311, 0.3, 'square', 0.18), 150); },
    pick: () => tone(660, 0.08, 'triangle', 0.3, 880),
    drop: () => tone(330, 0.1, 'triangle', 0.35, 220),
    good: () => { tone(660, 0.12, 'square', 0.2); setTimeout(() => tone(990, 0.2, 'square', 0.2), 110); },
    jack: () => tone(200, 0.3, 'sawtooth', 0.2, 120),
    park: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'square', 0.22), i * 120)),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'square', 0.25), i * 150)),
  };
})();
