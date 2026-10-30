// Crew saves: crew name + passcode, stored in a small JSON file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DIR, 'crews.json');
let crews = {};
try { crews = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { crews = {}; }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(crews, null, 1)); }
    catch (e) { console.error('crew save failed', e.message); }
  }, 300);
}

const hash = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
const keyOf = (name) => name.trim().toLowerCase();

export function publicCrew(c) {
  return c ? { name: c.name, bankroll: c.bankroll, heists: c.heists, escapes: c.escapes, best: c.best, rep: c.rep, history: c.history.slice(-5) } : null;
}

// Logs in to an existing crew, or creates it if the name is free.
export function loginCrew(name, pass) {
  name = String(name || '').trim().slice(0, 24);
  pass = String(pass || '');
  if (name.length < 2) return { error: 'Crew name needs at least 2 characters.' };
  if (pass.length < 3) return { error: 'Passcode needs at least 3 characters.' };
  const k = keyOf(name);
  const c = crews[k];
  if (c) {
    if (hash(pass, c.salt) !== c.hash) return { error: 'Wrong passcode for that crew.' };
    return { crew: c, created: false };
  }
  const salt = crypto.randomBytes(12).toString('hex');
  crews[k] = { name, salt, hash: hash(pass, salt), bankroll: 0, heists: 0, escapes: 0, best: 0, rep: 0, history: [], created: Date.now() };
  save();
  return { crew: crews[k], created: true };
}

export function recordHeist(crewName, over) {
  const c = crews[keyOf(crewName)];
  if (!c) return null;
  c.heists++;
  if (over.result === 'escaped') { c.escapes++; c.bankroll += over.payout; c.best = Math.max(c.best, over.payout); c.rep += 10 + Math.max(0, 10 - Math.floor(over.heat / 10)); }
  else c.rep += 2;
  c.history.push({ at: Date.now(), result: over.result, payout: over.payout, heat: over.heat, time: over.time });
  if (c.history.length > 30) c.history.shift();
  save();
  return c;
}
