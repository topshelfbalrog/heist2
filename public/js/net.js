// Networking: a WebSocket client for crew games, and a local in-browser server for solo practice.
import { generateHeist } from '../shared/gen.js';
import { HeistSim } from '../shared/sim.js';
import { ROLE_ORDER } from '../shared/data.js';

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  fire(msg) { for (const fn of this.handlers[msg.type] || []) fn(msg); for (const fn of this.handlers['*'] || []) fn(msg); }
}

export class WsNet extends Emitter {
  constructor() {
    super();
    this.id = null;
    this.ready = new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hello') { this.id = m.id; resolve(this); }
        this.fire(m);
      };
      this.ws.onerror = () => reject(new Error('Could not reach the game server.'));
      this.ws.onclose = () => this.fire({ type: 'disconnected' });
    });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// Solo practice: the whole server runs in the page.
export class LocalNet extends Emitter {
  constructor() {
    super();
    this.id = 'solo';
    this.local = true;
    this.room = { code: 'SOLO', host: 'solo', state: 'lobby', practice: true, crew: null, players: [{ id: 'solo', name: 'You', role: null }] };
    this.ready = Promise.resolve(this);
    setTimeout(() => this.fire({ type: 'hello', id: 'solo' }), 0);
  }
  lobby() {
    const r = this.room;
    this.fire({ type: 'lobby', code: r.code, host: r.host, state: r.state, practice: true, crew: r.crew, players: r.players.map((p) => ({ ...p })) });
  }
  send(m) {
    const r = this.room;
    const me = r.players[0];
    switch (m.type) {
      case 'create': me.name = m.name || 'You'; this.lobby(); return;
      case 'join': this.fire({ type: 'error', text: 'Solo practice has no room code. Start the server to play with your crew.' }); return;
      case 'role': me.role = ROLE_ORDER.includes(m.role) ? m.role : null; this.lobby(); return;
      case 'randomize': me.role = ROLE_ORDER[1 + Math.floor(Math.random() * 3)]; this.lobby(); return;
      case 'practice': this.lobby(); return;
      case 'crew': {
        if (!m.name || m.name.length < 2) { this.fire({ type: 'error', text: 'Crew name needs at least 2 characters.' }); return; }
        let store = {};
        try { store = JSON.parse(localStorage.getItem('ibd-crews') || '{}'); } catch { /* storage unavailable */ }
        const k = m.name.toLowerCase();
        if (store[k] && store[k].pass !== m.pass) { this.fire({ type: 'error', text: 'Wrong passcode for that crew.' }); return; }
        store[k] ||= { name: m.name, pass: m.pass, bankroll: 0, heists: 0, escapes: 0, best: 0, rep: 0, history: [] };
        try { localStorage.setItem('ibd-crews', JSON.stringify(store)); } catch { /* storage unavailable */ }
        r.crew = { ...store[k] }; delete r.crew.pass;
        this.lobby();
        return;
      }
      case 'start': {
        if (!me.role) { this.fire({ type: 'error', text: 'Pick a role first.' }); return; }
        const seed = 1 + Math.floor(Math.random() * 2 ** 30);
        const level = generateHeist(seed, { playerCount: 3 });
        const roster = [{ id: me.id, name: me.name, role: me.role }];
        this.sim = new HeistSim(level, roster, { practice: true });
        r.state = 'game';
        this.fire({ type: 'start', seed, playerCount: 3, roster, practice: true });
        clearInterval(this.timer);
        this.timer = setInterval(() => this.tick(), 50);
        return;
      }
      case 'again': r.state = 'lobby'; clearInterval(this.timer); this.sim = null; this.lobby(); return;
      case 'abort': if (this.sim && !this.sim.over) this.sim.finish('caught', 'You called off the job.'); return;
      case 'leave': clearInterval(this.timer); return;
      case 'rtc': return;
    }
    if (this.sim) this.sim.input(me.id, m);
  }
  tick() {
    const sim = this.sim;
    if (!sim) return;
    sim.step(0.05);
    for (const ev of sim.drain()) {
      this.fire({ type: 'ev', ev });
      if (ev.type === 'over') {
        this.room.state = 'results';
        if (this.room.crew) {
          try {
            const store = JSON.parse(localStorage.getItem('ibd-crews') || '{}');
            const c = store[this.room.crew.name.toLowerCase()];
            if (c) {
              c.heists++;
              if (ev.over.result === 'escaped') { c.escapes++; c.bankroll += ev.over.payout; c.best = Math.max(c.best, ev.over.payout); c.rep += 10; }
              localStorage.setItem('ibd-crews', JSON.stringify(store));
              this.room.crew = { ...c }; delete this.room.crew.pass;
              this.fire({ type: 'crew', crew: this.room.crew });
            }
          } catch { /* storage unavailable */ }
        }
      }
    }
    this.fire({ type: 'snap', s: sim.snapshot() });
    if (sim.over) { clearInterval(this.timer); this.timer = null; }
  }
  close() { clearInterval(this.timer); }
}
