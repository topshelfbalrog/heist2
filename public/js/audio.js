// Sound effects are synthesized with WebAudio. The soundtrack lives in music.js.
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.vol = 0.8;
    this.ambOn = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    this.comp = this.ctx.createDynamicsCompressor();
    this.master.connect(this.comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.amb = this.ctx.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
    // Noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  noise(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.002, at = 0, dest } = {}) {
    if (!this.ctx) return;
    const t = this.now() + at;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, at = 0, slide = 0, attack = 0.005, dest } = {}) {
    if (!this.ctx) return;
    const t = this.now() + at;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- Game sounds ----
  step(soft) { this.noise(0.09, { freq: soft ? 600 : 900, q: 0.8, type: 'lowpass', gain: soft ? 0.05 : 0.11 }); }
  land(k) { this.noise(0.16, { freq: 300, type: 'lowpass', gain: 0.15 + k }); }
  slide() { this.noise(0.6, { freq: 1400, q: 0.6, gain: 0.12, attack: 0.05 }); }
  jump() { this.noise(0.08, { freq: 700, type: 'lowpass', gain: 0.06 }); }
  shot(kind) {
    if (kind === 'guard') { this.noise(0.25, { freq: 1200, q: 0.6, gain: 0.4, type: 'lowpass' }); this.tone(140, 0.18, { type: 'square', gain: 0.08, slide: -90 }); return; }
    if (kind === 'live-tranq') { this.noise(0.12, { freq: 900, q: 1, gain: 0.3 }); this.tone(200, 0.08, { type: 'square', gain: 0.06, slide: -120 }); return; }
    if (kind === 'live-smg') { this.noise(0.12, { freq: 1600, q: 0.5, gain: 0.45, type: 'lowpass' }); this.tone(220, 0.08, { type: 'square', gain: 0.08, slide: -150 }); return; }
    if (kind === 'live-revolver') { this.noise(0.45, { freq: 700, q: 0.4, gain: 0.7, type: 'lowpass' }); this.tone(110, 0.35, { type: 'sawtooth', gain: 0.16, slide: -70 }); return; }
    if (kind === 'tranq') { this.noise(0.12, { freq: 1800, q: 2, gain: 0.25 }); this.tone(320, 0.08, { type: 'square', gain: 0.05, slide: -200 }); }
    else if (kind === 'smg') { this.noise(0.09, { freq: 2600, q: 0.7, gain: 0.32 }); this.tone(1400, 0.07, { type: 'sawtooth', gain: 0.07, slide: -900 }); }
    else { this.noise(0.35, { freq: 900, q: 0.5, gain: 0.55, type: 'lowpass' }); this.tone(180, 0.3, { type: 'sawtooth', gain: 0.12, slide: -120 }); this.tone(2600, 0.15, { type: 'square', gain: 0.04, slide: -2000 }); }
  }
  reload() { this.tone(900, 0.04, { type: 'square', gain: 0.06 }); this.tone(600, 0.05, { type: 'square', gain: 0.06, at: 0.25 }); this.noise(0.06, { freq: 3000, gain: 0.1, at: 0.5 }); }
  zap(hit) {
    this.noise(0.25, { freq: 3500, q: 4, gain: hit ? 0.35 : 0.15 });
    this.tone(90, 0.3, { type: 'sawtooth', gain: hit ? 0.2 : 0.07, slide: 60 });
  }
  hurt() { this.noise(0.2, { freq: 300, type: 'lowpass', gain: 0.35 }); this.tone(180, 0.25, { type: 'sine', gain: 0.1, slide: -80 }); }
  thud() { this.noise(0.25, { freq: 200, type: 'lowpass', gain: 0.4 }); }
  beep(ok = true) { this.tone(ok ? 1320 : 220, ok ? 0.08 : 0.3, { type: ok ? 'sine' : 'square', gain: ok ? 0.15 : 0.12 }); }
  key() { this.tone(980 + Math.random() * 60, 0.05, { type: 'square', gain: 0.05 }); }
  success() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.22, { gain: 0.14, at: i * 0.09 })); }
  fail() { this.tone(160, 0.45, { type: 'sawtooth', gain: 0.15 }); this.tone(120, 0.45, { type: 'square', gain: 0.08, at: 0.05 }); }
  snip() { this.noise(0.05, { freq: 6000, q: 2, gain: 0.3 }); this.tone(2400, 0.04, { type: 'triangle', gain: 0.08 }); }
  ui() { this.tone(1200, 0.04, { type: 'triangle', gain: 0.06 }); }
  toast() { this.tone(880, 0.07, { gain: 0.07 }); this.tone(1175, 0.09, { gain: 0.06, at: 0.06 }); }
  alarm() {
    for (let i = 0; i < 6; i++) { this.tone(i % 2 ? 640 : 880, 0.24, { type: 'square', gain: 0.09, at: i * 0.25 }); }
  }
  jackpot() {
    for (let i = 0; i < 18; i++) this.tone([1046, 1318, 1568, 2093][i % 4], 0.12, { type: 'triangle', gain: 0.07, at: i * 0.07 });
    for (let i = 0; i < 8; i++) this.noise(0.4, { freq: 5000 + i * 300, q: 8, gain: 0.05, at: i * 0.15 });
  }
  radioClick(on) { this.noise(0.06, { freq: 2500, q: 1.5, gain: 0.12 }); this.tone(on ? 1800 : 1200, 0.04, { type: 'square', gain: 0.03 }); }
  static(dur = 0.4) { this.noise(dur, { freq: 2200, q: 0.3, gain: 0.12 }); }
  spotted() { this.tone(520, 0.12, { type: 'square', gain: 0.12 }); this.tone(780, 0.25, { type: 'square', gain: 0.12, at: 0.12 }); }
  vent() { for (let i = 0; i < 6; i++) this.noise(0.18, { freq: 400 + Math.random() * 200, type: 'lowpass', gain: 0.18, at: i * 0.35 }); }
  coin() { this.tone(1568, 0.08, { type: 'square', gain: 0.06 }); this.tone(2093, 0.18, { type: 'square', gain: 0.06, at: 0.07 }); }
  // Overwatch suspicion cue: pitch and rate rise with the meter.
  suspCue(level, pan = 0) {
    if (!this.ctx) return;
    const f = 400 + level * 9;
    const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 + level * 0.0012, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; o.connect(g).connect(p).connect(this.sfx); } else o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + 0.12);
  }

  elevator(stairs) {
    if (stairs) { for (let i = 0; i < 8; i++) this.noise(0.08, { freq: 500, type: 'lowpass', gain: 0.12, at: i * 0.11 }); return; }
    this.tone(523, 0.25, { gain: 0.08 }); this.tone(659, 0.35, { gain: 0.08, at: 0.2 });
    this.noise(1.0, { freq: 180, type: 'lowpass', gain: 0.12, attack: 0.2 });
  }
  crash() { this.noise(0.6, { freq: 400, type: 'lowpass', gain: 0.7 }); this.noise(0.4, { freq: 3000, q: 0.5, gain: 0.25, at: 0.05 }); this.tone(70, 0.5, { type: 'sawtooth', gain: 0.2, slide: -30 }); }
  // Lockdown klaxon loop
  startAlarmLoop() {
    if (!this.ctx || this.alarmOn) return;
    this.alarmOn = true;
    const loop = () => {
      if (!this.alarmOn) return;
      this.tone(740, 0.42, { type: 'sawtooth', gain: 0.05, slide: -260 });
      this.tone(370, 0.42, { type: 'square', gain: 0.025, slide: -120 });
      this.alarmTimer = setTimeout(loop, 1100);
    };
    loop();
  }
  stopAlarmLoop() { this.alarmOn = false; clearTimeout(this.alarmTimer); }
  // Van engine + police sirens for the getaway
  startEngine() {
    if (!this.ctx || this.engine) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 45;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 22.5;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.07;
    o.connect(f); o2.connect(f); f.connect(g).connect(this.sfx);
    o.start(); o2.start();
    const so = ctx.createOscillator(); so.type = 'triangle'; so.frequency.value = 700;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.6;
    const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg).connect(so.frequency);
    const sg = ctx.createGain(); sg.gain.value = 0;
    so.connect(sg).connect(this.sfx); so.start(); lfo.start();
    this.engine = { o, o2, f, g, so, lfo, sg };
  }
  setEngine(k) {
    if (!this.engine) return;
    const t = this.now();
    this.engine.o.frequency.setTargetAtTime(45 + k * 110, t, 0.1);
    this.engine.o2.frequency.setTargetAtTime(22.5 + k * 55, t, 0.1);
    this.engine.f.frequency.setTargetAtTime(380 + k * 900, t, 0.1);
  }
  setSiren(k) { if (this.engine) this.engine.sg.gain.setTargetAtTime(0.06 * k, this.now(), 0.2); }
  stopEngine() {
    if (!this.engine) return;
    for (const n of ['o', 'o2', 'so', 'lfo']) { try { this.engine[n].stop(); } catch { /* stopped */ } }
    this.engine = null;
  }

  // Ambience: casino murmur + lounge chords + distant slot jingles.
  startAmbience() {
    if (!this.ctx || this.ambOn) return;
    this.ambOn = true;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.08;
    src.connect(f).connect(g).connect(this.amb); src.start();
    this.murmur = g; this.ambSrc = src;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
    const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg).connect(g.gain); lfo.start(); this.ambLfo = lfo;
    // Lounge pad
    const chords = [[220, 277.2, 329.6, 415.3], [196, 246.9, 293.7, 370], [174.6, 220, 261.6, 329.6], [196, 246.9, 311.1, 370]];
    let ci = 0;
    const pad = () => {
      if (!this.ambOn) return;
      const t = this.now();
      for (const fr of chords[ci % 4]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
        const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = fr * 2.003;
        const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.018, t + 1.2); gg.gain.linearRampToValueAtTime(0, t + 4.2);
        o.connect(gg); o2.connect(gg); gg.connect(this.amb);
        o.start(t); o2.start(t); o.stop(t + 4.3); o2.stop(t + 4.3);
      }
      // walking bass
      [0, 1, 2, 3].forEach((k) => this.tone(chords[ci % 4][0] / 2 * [1, 1.26, 1.5, 1.68][k], 0.5, { type: 'triangle', gain: 0.045, at: k * 1.0, dest: this.amb }));
      ci++;
      this.padTimer = setTimeout(pad, 4000);
    };
    pad();
    const jingle = () => {
      if (!this.ambOn) return;
      const base = [523, 659, 784, 1046][Math.floor(Math.random() * 4)];
      for (let i = 0; i < 5; i++) this.tone(base * [1, 1.25, 1.5, 2, 1.5][i], 0.09, { type: 'square', gain: 0.012, at: i * 0.08, dest: this.amb });
      this.jingleTimer = setTimeout(jingle, 1500 + Math.random() * 4000);
    };
    jingle();
  }

  setAmbience(level, murmur = 1) {
    if (!this.ctx) return;
    this.amb.gain.setTargetAtTime(level, this.now(), 0.6);
    if (this.murmur) this.murmur.gain.setTargetAtTime(0.08 * murmur, this.now(), 0.6);
  }

  stopAmbience() {
    this.ambOn = false;
    clearTimeout(this.padTimer); clearTimeout(this.jingleTimer);
    try { this.ambSrc?.stop(); this.ambLfo?.stop(); } catch { /* already stopped */ }
    if (this.amb) this.amb.gain.setTargetAtTime(0, this.now(), 0.3);
  }
}

export const sound = new Sound();
