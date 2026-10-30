// Soundtrack: one looping track per situation, with short crossfades.
//   main  - menus, lobby, briefing, the heist, the getaway, results
//   made  - while you've been made (Overwatch hears it while any of the crew is made)
//   pause - the pause menu only
const TRACKS = {
  main: { src: 'audio/heist-jazz.mp3', level: 0.5, restart: false },
  made: { src: 'audio/made.mp3', level: 0.6, restart: true },
  pause: { src: 'audio/pause.mp3', level: 0.55, restart: true },
};
const FADE = 1.2; // seconds for a full fade

export class Music {
  constructor() {
    this.el = {};
    this.gain = {}; // current fade level 0..1 per track
    this.want = 'main';
    this.vol = 0.8; // master volume
    this.musicVol = 0.7; // music slider
    this.unlocked = false;
    for (const [k, t] of Object.entries(TRACKS)) {
      const a = new Audio();
      a.src = t.src;
      a.loop = true; // every track loops when it reaches the end
      a.preload = k === 'main' ? 'auto' : 'metadata';
      a.volume = 0;
      a.addEventListener('error', () => { a.dataset.broken = '1'; });
      this.el[k] = a;
      this.gain[k] = 0;
    }
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      this.update(Math.min(0.25, (now - last) / 1000));
      last = now;
    };
    setInterval(tick, 50);
  }

  // Browsers only allow audio after the player clicks or presses a key. On that first
  // gesture, every track gets a silent play/pause so later switches aren't blocked.
  // Called on every click/key press, so a blocked track retries on the next one.
  unlock() {
    if (!this.unlocked) {
      this.unlocked = true;
      for (const [k, a] of Object.entries(this.el)) {
        if (k === this.want || a.dataset.broken) continue;
        a.muted = true;
        a.play().then(() => { if (k !== this.want) a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
      }
    }
    const a = this.el[this.want];
    if (this.pending || (a && a.paused)) this.start(this.want);
  }

  setVolume(v) { this.vol = v; }
  setMusicVolume(v) { this.musicVol = v; }

  set(track) {
    if (!TRACKS[track] || track === this.want) return;
    this.want = track;
    if (this.unlocked) this.start(track);
  }

  start(k) {
    const a = this.el[k];
    if (!a || a.dataset.broken) return;
    if (TRACKS[k].restart && this.gain[k] < 0.05) { try { a.currentTime = 0; } catch { /* not loaded yet */ } }
    a.muted = false;
    if (a.paused) a.play().then(() => { this.pending = false; }).catch(() => { this.pending = true; });
  }

  update(dt) {
    for (const k of Object.keys(TRACKS)) {
      const a = this.el[k];
      const target = k === this.want && this.unlocked ? 1 : 0;
      const g = this.gain[k];
      const ng = target > g ? Math.min(target, g + dt / FADE) : Math.max(target, g - dt / (FADE * 0.6));
      this.gain[k] = ng;
      a.volume = Math.max(0, Math.min(1, ng * TRACKS[k].level * this.musicVol * this.vol));
      // Park silent tracks so the main theme picks up where it left off
      if (ng <= 0 && !a.paused) a.pause();
      if (target > 0 && a.paused && !a.dataset.broken && this.unlocked && !this.pending) {
        a.muted = false;
        a.play().catch(() => { this.pending = true; });
      }
    }
  }
}

export const music = new Music();
