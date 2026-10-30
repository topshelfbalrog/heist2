// Puzzle panels for field players and the manual pages for Overwatch.
import { wireRuleText, WIRE_COLORS } from '../shared/gen.js';
import { sound } from './audio.js';
import { TRAITS, PASSWORDS, MORSE, PHASE_RULES } from '../shared/data.js';
import { morseOn } from './world.js';

export function drawGlyph(g, prims, x, y, size, color = '#f2e8d0', lw = 0) {
  const P = (p) => [x + size * (0.17 + p[0] * 0.33), y + size * (0.17 + p[1] * 0.33)];
  g.save();
  g.strokeStyle = color; g.fillStyle = color;
  g.lineWidth = lw || Math.max(2, size * 0.07);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pr of prims) {
    g.beginPath();
    if (pr.t === 'l') { const a = P(pr.a), b = P(pr.b); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
    else if (pr.t === 'c') { const c = P(pr.c); g.arc(c[0], c[1], pr.r * size * 0.33 * 0.6, 0, Math.PI * 2); g.stroke(); }
    else if (pr.t === 'a') { const c = P(pr.c); g.arc(c[0], c[1], pr.r * size * 0.33 * 0.7, pr.a0, pr.a1); g.stroke(); }
    else if (pr.t === 'd') { const c = P(pr.c); g.arc(c[0], c[1], size * 0.055, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}

export function glyphCanvas(prims, size, color, bg) {
  const c = document.createElement('canvas');
  c.width = size * 2; c.height = size * 2;
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  drawGlyph(g, prims, 0, 0, size * 2, color);
  return c;
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const WIRE_HEX = { red: '#e0283a', blue: '#2d6cdf', yellow: '#f2c230', white: '#f4f1e8', black: '#1a1a1a', green: '#2fae5a' };

export class PuzzleUI {
  constructor(root, send) {
    this.root = root;
    this.send = send;
    this.kind = null;
  }

  isOpen() { return !!this.kind; }

  close(silent) {
    if (this.kind === 'con' && !silent) this.send({ type: 'conCancel' });
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.kind = null;
    this.root.innerHTML = '';
    this.root.classList.remove('show');
    if (this.onClose) this.onClose();
  }

  frame(title, sub) {
    this.root.innerHTML = '';
    this.root.classList.add('show');
    const box = el('div', 'device');
    const head = el('div', 'device-head');
    head.append(el('div', 'device-title', title), el('div', 'device-sub', sub));
    const body = el('div', 'device-body');
    const foot = el('div', 'device-foot', 'Esc to step away. Guards notice someone fiddling with a panel.');
    box.append(head, body, foot);
    this.root.append(box);
    return body;
  }

  // ----- Glyph keypad -----
  openGlyph(level, step) {
    this.kind = 'glyph';
    const body = this.frame('Staff door keypad', 'Four symbols. Press them in the right order. Overwatch has the manual.');
    const leds = el('div', 'leds');
    this.leds = [];
    for (let i = 0; i < 4; i++) { const l = el('span', 'led'); leds.append(l); this.leds.push(l); }
    body.append(leds);
    const grid = el('div', 'glyph-grid');
    level.glyph.shown.forEach((gid) => {
      const b = el('button', 'glyph-btn');
      b.append(glyphCanvas(level.glyph.glyphs[gid], 96, '#1b130b'));
      b.onclick = () => { sound.key(); this.send({ type: 'glyph', g: gid }); b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 150); };
      grid.append(b);
    });
    body.append(grid);
    this.status = el('div', 'device-status', 'Describe the symbols to Overwatch. They have no official names.');
    body.append(this.status);
    this.setGlyphStep(step);
  }

  setGlyphStep(step) {
    if (this.kind !== 'glyph') return;
    this.leds.forEach((l, i) => l.classList.toggle('on', i < step));
  }

  glyphFeedback(ok, strikes) {
    if (this.kind !== 'glyph') return;
    if (ok) { sound.beep(true); return; }
    sound.fail();
    this.status.textContent = `Wrong order. Keypad reset (${strikes}/3 before lockout alarm).`;
    this.root.querySelector('.device').classList.add('shake');
    setTimeout(() => this.root.querySelector('.device')?.classList.remove('shake'), 400);
  }

  // ----- Junction panel -----
  openWires(puzzle) {
    this.kind = 'wire';
    const body = this.frame('Junction panel', 'Cut exactly one wire. Overwatch has the rulebook.');
    this.wireBody = body;
    this.renderWires(puzzle);
  }

  renderWires(puzzle) {
    if (this.kind !== 'wire') return;
    const body = this.wireBody;
    body.innerHTML = '';
    const plate = el('div', 'serial', `Serial <b>${puzzle.wire.serial}</b>`);
    body.append(plate);
    if (puzzle.wireLocked) { body.append(el('div', 'device-status warn', 'Tamper alarm. Panel is resetting with new wiring...')); return; }
    if (puzzle.wireSolved) { body.append(el('div', 'device-status ok', 'Panel solved. Vault controller rebooted.')); if (this.prefix) body.append(this.prefixBox()); return; }
    const ns = 'http://www.w3.org/2000/svg';
    const n = puzzle.wire.wires.length;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 440 ${40 + n * 46}`);
    svg.classList.add('wires');
    puzzle.wire.wires.forEach((c, i) => {
      const y = 36 + i * 46;
      const g = document.createElementNS(ns, 'g');
      g.classList.add('wire');
      const term = (x) => { const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y - 10); r.setAttribute('width', 18); r.setAttribute('height', 20); r.setAttribute('fill', '#b9b2a2'); return r; };
      const path = document.createElementNS(ns, 'path');
      const wob = (i % 2 ? 1 : -1) * 10;
      path.setAttribute('d', `M 40 ${y} C 140 ${y + wob}, 300 ${y - wob}, 400 ${y}`);
      path.setAttribute('stroke', WIRE_HEX[c]); path.setAttribute('stroke-width', 11); path.setAttribute('fill', 'none');
      const outline = path.cloneNode(); outline.setAttribute('stroke', '#000'); outline.setAttribute('stroke-width', 15); outline.setAttribute('opacity', c === 'black' ? 0.0 : 0.5);
      const hit = path.cloneNode(); hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', 34);
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', 12); label.setAttribute('y', y + 5); label.textContent = i + 1;
      label.setAttribute('fill', '#cfc6b0'); label.setAttribute('font-size', 16);
      g.append(outline, path, term(22), term(400), label, hit);
      g.onclick = () => {
        if (g.classList.contains('cut')) return;
        sound.snip();
        g.classList.add('cut');
        path.setAttribute('stroke-dasharray', '160 40 400');
        this.send({ type: 'wire', i });
      };
      svg.append(g);
    });
    body.append(svg);
    body.append(el('div', 'device-status', `${n} wires. Read Overwatch the colors top to bottom, and the serial.`));
  }

  prefixBox() {
    const b = el('div', 'code-reveal');
    b.innerHTML = `<div class="code-label">Vault code, first two digits</div><div class="code-digits">${this.prefix.join(' ')}</div><div class="code-note">Overwatch has the last two. Say them before the vault: radios die in there.</div>`;
    return b;
  }

  wireResult(ok, prefix) {
    if (ok) { this.prefix = prefix; sound.success(); }
    else { sound.fail(); }
  }

  // ----- Vault keypad -----
  openVault(puzzle) {
    this.kind = 'vault';
    const body = this.frame('Vault keypad', puzzle.wireSolved ? 'Four digits: the first two from the junction panel, the last two from Overwatch.' : 'Dead. The vault controller in Security needs a reboot first.');
    this.code = [];
    const disp = el('div', 'vault-display', '_ _ _ _');
    this.vdisp = disp;
    body.append(disp);
    const pad = el('div', 'vault-pad');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
    for (const k of keys) {
      const b = el('button', 'vkey' + (k === 'OK' ? ' ok' : k === 'C' ? ' clr' : ''), k);
      b.onclick = () => this.vaultKey(k);
      pad.append(b);
    }
    body.append(pad);
    this.status = el('div', 'device-status', puzzle.wireSolved ? 'Type the code, then OK.' : 'Nothing happens. The screen is dark.');
    body.append(this.status);
  }

  vaultKey(k) {
    if (this.kind !== 'vault') return;
    sound.key();
    if (k === 'C') this.code = [];
    else if (k === 'OK') { if (this.code.length === 4) this.send({ type: 'vault', code: this.code.slice() }); }
    else if (this.code.length < 4) this.code.push(+k);
    this.vdisp.textContent = [0, 1, 2, 3].map((i) => (this.code[i] ?? '_')).join(' ');
  }

  vaultBad(strikes) {
    if (this.kind !== 'vault') return;
    sound.fail();
    this.code = [];
    this.vdisp.textContent = '_ _ _ _';
    this.status.textContent = `Wrong code (${strikes}/3 before the alarm).`;
  }

  // ----- The Con -----
  openCon(msg) {
    this.kind = 'con';
    const body = this.frame(`${msg.name}`, `${msg.title}. Pick the line that fits their dossier. Ask Overwatch.`);
    body.classList.add('con');
    msg.lines.forEach((line, i) => {
      const b = el('button', 'con-line', `<span class="con-n">${i + 1}</span><span>${line}</span>`);
      b.onclick = () => { sound.ui(); this.send({ type: 'conPick', i }); this.close(true); };
      body.append(b);
    });
    const bar = el('div', 'con-timer'); const fill = el('div', 'con-fill'); bar.append(fill); body.append(bar);
    fill.style.animation = 'conTimer 20s linear forwards';
  }

  // ----- Lift terminal: password dials -----
  openPassword(level) {
    this.kind = 'password';
    const body = this.frame('Lift authorization', 'Five dials. Each holds six letters. One combination is a word on Overwatch\'s list.');
    const P = level.password;
    this.passIdx = [0, 0, 0, 0, 0];
    this.passLetters = P.cols;
    const row = el('div', 'dials');
    this.dialEls = P.cols.map((col, k) => {
      const d = el('div', 'dial');
      const up = el('button', 'dial-btn', '▲'), dn = el('button', 'dial-btn', '▼');
      const ch = el('div', 'dial-ch', col[0]);
      up.onclick = () => this.turnDial(k, -1); dn.onclick = () => this.turnDial(k, 1);
      d.append(up, ch, dn);
      row.append(d);
      return ch;
    });
    body.append(row);
    const go = el('button', 'btn primary', 'Submit');
    go.onclick = () => { sound.key(); this.send({ type: 'pass', word: this.passIdx.map((i, k) => P.cols[k][i]).join('') }); };
    body.append(go);
    this.status = el('div', 'device-status', 'Cycle each dial and read Overwatch what it can show. Wrong submits count as strikes.');
    body.append(this.status);
  }

  turnDial(k, dir) {
    const cols = this.passCols || null;
    void cols;
    const n = 6;
    this.passIdx[k] = (this.passIdx[k] + dir + n) % n;
    sound.key();
    const letters = this.root.querySelectorAll('.dial-ch');
    const level = this._level;
    void level;
    letters[k].textContent = this.passLetters[k][this.passIdx[k]];
  }

  passBad(strikes) {
    if (this.kind !== 'password') return;
    sound.fail();
    this.status.textContent = `ACCESS DENIED (${strikes}/3 before the terminal alarm).`;
    this.root.querySelector('.device')?.classList.add('shake');
    setTimeout(() => this.root.querySelector('.device')?.classList.remove('shake'), 400);
  }

  // ----- Camera server: signal sequence -----
  openSimon(level, puzzle) {
    this.kind = 'simon';
    const S = level.simon;
    const body = this.frame('Camera server handshake', 'Watch the lamps. Press the color the manual says each flash maps to.');
    body.append(el('div', 'serial', `Serial <b>${S.serial}</b>`));
    this.simonInfo = el('div', 'simon-info');
    body.append(this.simonInfo);
    const grid = el('div', 'simon-grid');
    const names = ['red', 'blue', 'green', 'yellow'];
    this.simonBtns = names.map((n, i) => {
      const b = el('button', 'simon-btn ' + n);
      b.onclick = () => { sound.tone(320 + i * 110, 0.18, { type: 'triangle', gain: 0.12 }); b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 160); this.send({ type: 'simon', c: i }); this.simonT0 = performance.now(); };
      grid.append(b);
      return b;
    });
    body.append(grid);
    this.status = el('div', 'device-status', 'Tell Overwatch the serial, how many strikes you have, and every color that flashes.');
    body.append(this.status);
    this.simonStage = puzzle.simonStage; this.simonStrikes = puzzle.simonStrikes;
    this.simonSeq = S.seq;
    this.simonT0 = performance.now();
    const tick = () => {
      if (this.kind !== 'simon') return;
      const u = ((performance.now() - this.simonT0) / 1000) - 1.2;
      const k = Math.floor(u / 0.75);
      const cycleLen = this.simonStage * 0.75 + 2.4;
      const uu = u >= 0 ? u % cycleLen : -1;
      const kk = Math.floor(uu / 0.75);
      this.simonBtns.forEach((b, i) => b.classList.toggle('flash', uu >= 0 && kk < this.simonStage && this.simonSeq[kk] === i && (uu % 0.75) < 0.45));
      if (uu >= 0 && kk < this.simonStage && (uu % 0.75) < 0.03 && this._lastBeep !== kk + ':' + Math.floor(u / cycleLen)) {
        this._lastBeep = kk + ':' + Math.floor(u / cycleLen);
        sound.tone(320 + this.simonSeq[kk] * 110, 0.2, { type: 'sine', gain: 0.08 });
      }
      void k;
      this.simonInfo.textContent = `Stage ${Math.min(5, this.simonStage)} of 5  ·  Strikes ${this.simonStrikes}`;
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  simonUpdate(stage, strikes, bad) {
    if (this.kind !== 'simon') return;
    if (stage != null) this.simonStage = stage;
    if (strikes != null) this.simonStrikes = strikes;
    this.simonT0 = performance.now();
    if (bad) { sound.fail(); this.status.textContent = `Wrong color. Strike ${strikes}. The color table changes with strikes.`; }
    else { sound.beep(true); this.status.textContent = `Stage ${stage - 1} cleared.`; }
  }

  // ----- Count room safe: Morse receiver -----
  openMorse(level, simT) {
    this.kind = 'morse';
    const M = level.morse;
    const body = this.frame('Safe receiver', 'The lamp on the safe blinks a word in Morse. Overwatch knows which frequency opens it.');
    const lamp = el('div', 'morse-lamp');
    body.append(lamp);
    const freqs = M.table.map((r) => r.freq).sort();
    this.morseIdx = 0;
    const disp = el('div', 'freq', `${freqs[0]} MHz`);
    const row = el('div', 'freq-row');
    const prev = el('button', 'vkey', '◀'), next = el('button', 'vkey', '▶'), tx = el('button', 'vkey ok', 'TX');
    prev.onclick = () => { this.morseIdx = (this.morseIdx + freqs.length - 1) % freqs.length; disp.textContent = `${freqs[this.morseIdx]} MHz`; sound.key(); };
    next.onclick = () => { this.morseIdx = (this.morseIdx + 1) % freqs.length; disp.textContent = `${freqs[this.morseIdx]} MHz`; sound.key(); };
    tx.onclick = () => { sound.key(); this.send({ type: 'tx', freq: freqs[this.morseIdx] }); };
    row.append(prev, disp, next, tx);
    body.append(row);
    this.status = el('div', 'device-status', 'Short blink is a dot, long blink is a dash. A long dark gap means the word starts over.');
    body.append(this.status);
    const tick = () => {
      if (this.kind !== 'morse') return;
      lamp.classList.toggle('on', morseOn(M.word, this.simTime ? this.simTime() : performance.now() / 1000));
      this.raf = requestAnimationFrame(tick);
    };
    tick();
    void simT;
  }

  morseBad(strikes) {
    if (this.kind !== 'morse') return;
    sound.fail();
    this.status.textContent = `Wrong frequency (${strikes}/3 before the alarm).`;
  }

  // ----- Hatch lock: invisible maze -----
  openMaze(level, puzzle) {
    this.kind = 'maze';
    const body = this.frame('Hatch lock', 'Steer the light to the red triangle. You cannot see the walls. Overwatch can.');
    const c = document.createElement('canvas');
    c.width = 360; c.height = 360; c.className = 'maze-canvas';
    body.append(c);
    this.mazeCanvas = c;
    this.mazeLevel = level;
    this.mazePos = puzzle.mazePos.slice();
    const pad = el('div', 'maze-pad');
    for (const [d, label] of [['U', '▲'], ['L', '◀'], ['D', '▼'], ['R', '▶']]) {
      const b = el('button', 'vkey m' + d, label);
      b.onclick = () => this.mazeMove(d);
      pad.append(b);
    }
    body.append(pad);
    this.status = el('div', 'device-status', 'Tell Overwatch where the two green rings are. Arrow keys work too. Bumping a wall is a strike.');
    body.append(this.status);
    this.drawMaze();
  }

  mazeMove(d) {
    sound.key();
    this.send({ type: 'maze', dir: d });
    this.pendingMove = d;
  }

  mazeSync(pos) {
    if (this.kind !== 'maze' || !pos) return;
    if (pos[0] !== this.mazePos[0] || pos[1] !== this.mazePos[1]) { this.mazePos = pos.slice(); this.drawMaze(); }
  }

  mazeBump(strikes) {
    if (this.kind !== 'maze') return;
    sound.fail();
    this.status.textContent = `Bumped a wall (${strikes}/3 before the alarm).`;
    this.root.querySelector('.device')?.classList.add('shake');
    setTimeout(() => this.root.querySelector('.device')?.classList.remove('shake'), 400);
  }

  drawMaze() {
    const g = this.mazeCanvas.getContext('2d'), M = this.mazeLevel.maze, mz = M.mazes[M.which];
    const N = M.size, cs = 360 / N;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, 360, 360);
    g.fillStyle = 'rgba(125,255,176,0.25)';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { g.beginPath(); g.arc((x + 0.5) * cs, (y + 0.5) * cs, 3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#3dff8a'; g.lineWidth = 4;
    for (const [mx, my] of mz.markers) { g.beginPath(); g.arc((mx + 0.5) * cs, (my + 0.5) * cs, cs * 0.32, 0, Math.PI * 2); g.stroke(); }
    const [tx, ty] = M.target;
    g.fillStyle = '#ff3048'; g.beginPath();
    g.moveTo((tx + 0.5) * cs, (ty + 0.22) * cs); g.lineTo((tx + 0.78) * cs, (ty + 0.75) * cs); g.lineTo((tx + 0.22) * cs, (ty + 0.75) * cs); g.closePath(); g.fill();
    const [px, py] = this.mazePos;
    g.fillStyle = '#ffffff'; g.fillRect((px + 0.32) * cs, (py + 0.32) * cs, cs * 0.36, cs * 0.36);
  }

  key(e) {
    if (!this.kind) return false;
    if (this.kind === 'maze') {
      const d = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R' }[e.code];
      if (d && !e.repeat) { this.mazeMove(d); return true; }
    }
    if (e.code === 'Escape') { this.close(); return true; }
    if (this.kind === 'vault') {
      if (/^Digit[0-9]$/.test(e.code)) { this.vaultKey(e.code.slice(5)); return true; }
      if (e.code === 'Backspace') { this.vaultKey('C'); return true; }
      if (e.code === 'Enter') { this.vaultKey('OK'); return true; }
    }
    if (this.kind === 'con' && /^Digit[1-3]$/.test(e.code)) {
      const i = +e.code.slice(5) - 1;
      this.root.querySelectorAll('.con-line')[i]?.click();
      return true;
    }
    return false;
  }
}

// ---------- Overwatch manual ----------
export function buildManual(root, level, state) {
  root.innerHTML = '';
  const tabs = el('div', 'manual-tabs');
  const page = el('div', 'manual-page');
  const pages = {
    'Staff keypad': () => {
      const p = el('div');
      p.append(el('h3', null, 'Staff door keypad'));
      p.append(el('p', null, 'The keypad shows four symbols. Exactly one column below contains all four. Your crew presses them in the order they appear in that column, top to bottom.'));
      const cols = el('div', 'glyph-cols');
      level.glyph.columns.forEach((col, ci) => {
        const c = el('div', 'glyph-col');
        c.append(el('div', 'col-head', String.fromCharCode(65 + ci)));
        col.forEach((gid) => c.append(glyphCanvas(level.glyph.glyphs[gid], 44, '#1b130b')));
        cols.append(c);
      });
      p.append(cols);
      return p;
    },
    'Junction panel': () => {
      const p = el('div');
      p.append(el('h3', null, 'Junction panel'));
      p.append(el('p', null, 'Count the wires and get the last digit of the serial number. Under that wire count, check the rules in order. The first one that applies says which wire to cut. Wires are counted top to bottom.'));
      for (let n = 3; n <= 6; n++) {
        const b = level.wireBook[n];
        const sec = el('div', 'rule-sec');
        sec.append(el('h4', null, `${n} wires`));
        const ol = el('ol');
        for (const r of b.rules) ol.append(el('li', null, wireRuleText(r)));
        ol.append(el('li', null, `Otherwise, cut the ${b.otherwise} wire.`));
        sec.append(ol);
        p.append(sec);
      }
      p.append(el('p', 'small', `Colors you may hear: ${WIRE_COLORS.join(', ')}.`));
      return p;
    },
    'Lift password': () => {
      const p = el('div');
      p.append(el('h3', null, 'Service lift authorization'));
      p.append(el('p', null, 'The terminal in Security has five letter dials. Each dial can show six letters. Exactly one word below can be spelled with the letters on the dials. Have your crew read out every letter each dial can show, then narrow it down.'));
      const grid = el('div', 'word-grid');
      for (const w of PASSWORDS) grid.append(el('span', null, w));
      p.append(grid);
      return p;
    },
    'Camera server': () => {
      const p = el('div');
      p.append(el('h3', null, 'Camera server handshake'));
      p.append(el('p', null, 'Syncing the server gives you the B1 and B2 cameras. The server flashes colors, one more each stage, five stages. For each flash, your crew presses the color in this table. Which table depends on the serial number; which row depends on how many strikes they have made on this server.'));
      const names = ['Red', 'Blue', 'Green', 'Yellow'];
      for (const [label, tables] of [['Serial number contains a vowel (A, E, U)', level.simon.tables.vowel], ['Serial number has no vowel', level.simon.tables.none]]) {
        p.append(el('h4', null, label));
        const tb = el('table', 'map-table');
        tb.innerHTML = `<tr><th>Flash →</th>${names.map((n) => `<th>${n}</th>`).join('')}</tr>` + tables.map((row, k) => `<tr><td>${k === 2 ? '2+ strikes' : k + ' strike' + (k === 1 ? '' : 's')}</td>${row.map((v) => `<td>${names[v]}</td>`).join('')}</tr>`).join('');
        p.append(tb);
      }
      return p;
    },
    'Pressure gallery': () => {
      const p = el('div');
      p.append(el('h3', null, 'B1 pressure gallery'));
      p.append(el('p', null, 'The gallery floor is 30 steel plates. Armed plates show hot on the THERMAL camera, and on your map once the camera server is synced. The armed pattern swaps between two layouts every 16 seconds. Standing on an armed plate trips an alarm; a crew member in the air (jumping) is safe.'));
      p.append(el('p', null, 'Call plates by column (1-6 from the left, looking from the lobby) and row (1-5 from the lobby side).'));
      return p;
    },
    'Safe receiver': () => {
      const p = el('div');
      p.append(el('h3', null, 'Count room safe'));
      p.append(el('p', null, 'The lamp on the safe blinks one of these words in Morse code, over and over. Find the word, and your crew transmits on its frequency. The safe holds the vault override key.'));
      const wrap = el('div', 'morse-wrap');
      const alpha = el('table', 'morse-table');
      alpha.innerHTML = Object.entries(MORSE).map(([k, v]) => `<tr><td>${k}</td><td>${v.replace(/\./g, '•').replace(/-/g, '—')}</td></tr>`).join('');
      const words = el('table', 'map-table');
      words.innerHTML = '<tr><th>Word</th><th>Frequency</th></tr>' + level.morse.table.slice().sort((a, b) => a.word.localeCompare(b.word)).map((r) => `<tr><td>${r.word}</td><td>${r.freq} MHz</td></tr>`).join('');
      wrap.append(alpha, words);
      p.append(wrap);
      return p;
    },
    'Hatch mazes': () => {
      const p = el('div');
      p.append(el('h3', null, 'Annex hatch lock'));
      p.append(el('p', null, 'The lock shows a 6 by 6 grid, two green rings, a white light and a red triangle, but no walls. Find the maze whose rings sit in the same two cells, then guide the light to the triangle. Walls are the dark lines. Hitting one is a strike.'));
      const grid = el('div', 'maze-grid');
      level.maze.mazes.forEach((mz, i) => {
        const c = document.createElement('canvas'); c.width = 240; c.height = 240;
        const g = c.getContext('2d'), N = 6, cs = 240 / N;
        g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 240, 240);
        g.strokeStyle = '#17110c'; g.lineWidth = 4; g.lineCap = 'square';
        g.strokeRect(2, 2, 236, 236);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          if (x < N - 1 && mz.right[y][x]) { g.beginPath(); g.moveTo((x + 1) * cs, y * cs); g.lineTo((x + 1) * cs, (y + 1) * cs); g.stroke(); }
          if (y < N - 1 && mz.down[y][x]) { g.beginPath(); g.moveTo(x * cs, (y + 1) * cs); g.lineTo((x + 1) * cs, (y + 1) * cs); g.stroke(); }
        }
        g.strokeStyle = '#1d7a4a'; g.lineWidth = 4;
        for (const [mx, my] of mz.markers) { g.beginPath(); g.arc((mx + 0.5) * cs, (my + 0.5) * cs, cs * 0.3, 0, Math.PI * 2); g.stroke(); }
        const box = el('div', 'maze-card'); box.append(el('b', null, `Maze ${i + 1}`), c);
        grid.append(box);
      });
      p.append(grid);
      return p;
    },
    'IR corridor': () => {
      const p = el('div');
      p.append(el('h3', null, 'B2 IR corridor'));
      p.append(el('p', null, 'The corridor to the vault is crossed by infrared beams your crew can barely see. You can see them on the IR GRID camera. Call the timing.'));
      const ul = el('ol');
      const name = { high: 'Fixed high beam: crouch under it.', low: 'Fixed low beam: jump over it.', sweep: 'Sweeping beam: rises and falls. Cross crouched while it is high.', curtain: 'Pulsing curtain: blocks the full height. Cross while it is off.', slide: 'Sliding post: a vertical beam that slides side to side. Hug the wall it just left.' };
      level.lasers.forEach((g, i) => ul.append(el('li', null, `Gate ${i + 1}: ${g.beams.map((b) => name[b.type]).join(' Plus: ')}`)));
      p.append(ul);
      p.append(el('p', 'small', 'Touching a beam trips an alarm. During a lockdown the whole grid locks on solid: nobody comes back this way.'));
      return p;
    },
    'Vault protocol': () => {
      const p = el('div');
      p.append(el('h3', null, 'Vault protocol'));
      const ol = el('ol');
      [
        'Keypad: stays dead until the junction panel in Security is solved. The panel shows the solver the first two digits. The last two arrive here, on your security radio.',
        'Override key: insert it at key console A. It is in the count room safe on B1.',
        'Two keys: consoles A and B are too far apart for one person. Both keys must turn within a second and a half of each other. Count them in.',
        'Time lock: 45 seconds. Security sends a response team down the IR corridor while it runs. Hold the antechamber.',
        'Taking the score triggers the Stanley Protocol: lockdown, response teams on every floor, lifts frozen, the IR grid locked solid. Fire stairs release. See Lockdown override.',
      ].forEach((t) => ol.append(el('li', null, t)));
      p.append(ol);
      const box = el('div', 'suffix-box', state.suffix ? `Vault code, last two digits: <b>${state.suffix.join(' ')}</b>` : 'Waiting for the junction panel...');
      p.append(box);
      p.append(el('p', null, 'The vault itself is a jammer zone. Radios cut out inside.'));
      return p;
    },
    'Lockdown override': () => {
      const p = el('div');
      p.append(el('h3', null, 'Lockdown override'));
      p.append(el('p', null, 'In a lockdown the loading bay shutter seals. Three emergency breakers (one per floor: B2 antechamber, B1 lobby, ground back hall) each show a color, a phase and a four-digit code once flipped. Your console (O) asks for them in its own color order. Convert each code by its phase before you enter it:'));
      const ul = el('ul');
      for (const k of ['I', 'II', 'III']) ul.append(el('li', null, PHASE_RULES[k]));
      p.append(ul);
      p.append(el('p', null, 'A wrong entry costs 12 seconds off the lockdown clock. When all three are in, the shutter opens. Get everyone to the van.'));
      return p;
    },
    'Getting made': () => {
      const p = el('div');
      p.append(el('h3', null, 'When someone gets made'));
      p.append(el('p', null, "Security doesn't arrest anyone. When a guard or camera makes one of your crew, every guard who sees them opens fire, and the nearest guards on that floor are sent after them. It's on the crew, and on you, to shake them."));
      const ul = el('ul');
      [
        'Break contact: no guard and no live camera can see them for 14 seconds. Your map shows how close they are.',
        'Change clothes: four lockers (coat check by the entrance, staff lockers in Storage, uniforms in the B1 lobby, spare kit on the B2 landing). Two outfits each. Only works with nobody watching. It wipes their description completely.',
        'Seal a door (Q): one normal door slams shut for 12 seconds. Guards chasing your crew pile up behind it. Recharges in 30s.',
        'Cut power (C): one lighting zone goes dark for 7 seconds. Cameras there go blind, guards can barely see, and they miss more. Recharges in 45s.',
        'Loop a camera on them (the Hacker), or burn a Strike on Kill the Lights (15s, whole zone).',
        'After they shake security, guards still have their description and spot them faster until they change clothes.',
        'Bodies: dead guards get found, and that brings heat. Your crew can stash a body anywhere off the public floor.',
        'Downed crew bleed out in 30 seconds unless someone reaches them.',
      ].forEach((t) => ul.append(el('li', null, t)));
      p.append(ul);
      return p;
    },
    'Floor guide': () => {
      const p = el('div');
      p.append(el('h3', null, "Stanley's Palace: floor guide"));
      const ul = el('ul');
      [
        `The score: ${level.prize.name}, about $${(level.prize.value / 1e6).toFixed(1)}M, in the B2 vault.`,
        'Ground: staff keypad, then Security (keycard door) with three systems: junction panel (vault code), lift terminal (password) and camera server (your eyes below ground).',
        'The Floor Manager carries the keycard. The Face can con it off him, or anyone can take him out and lift it off the body. The Infiltrator can vent from Storage into Security.',
        'B1 count level: pressure gallery (thermal camera), count room safe (Morse, holds the override key), annex hatch (maze) down to B2.',
        'B2 vault level: IR corridor, vault keypad, two key consoles, a 45-second time lock.',
        'Fire stairs link every floor. Using them before a lockdown sets off an alarm.',
        'Security radio: flag chatter that warns of an upcoming event for +1 Intel.',
        'Click a guard on a zoomed camera feed to tag them (+1 Intel). Your crew then sees tagged guards through walls.',
        `Strikes cost 4 Intel. You get 2 per run, or 3 if you earn 16 Intel.`,
        'Exit: the van in the loading dock, west end of the back hallway. In a lockdown, the shutter needs the breaker override. Then you drive.',
      ].forEach((t) => ul.append(el('li', null, t)));
      p.append(ul);
      return p;
    },
  };
  const names = Object.keys(pages);
  const show = (n) => {
    page.innerHTML = '';
    page.append(pages[n]());
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === n));
    state.manualPage = n;
  };
  for (const n of names) { const b = el('button', null, n); b.onclick = () => { sound.ui(); show(n); }; tabs.append(b); }
  root.append(tabs, page);
  show(state.manualPage || names[0]);
}

export function traitDossier(id) { return TRAITS.find((t) => t.id === id)?.dossier || ''; }
