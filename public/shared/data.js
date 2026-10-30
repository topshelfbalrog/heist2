// Static game data: roles, dossiers, names, radio chatter, events.

export const ROLE_ORDER = ['overwatch', 'hacker', 'infiltrator', 'face'];

export const ROLES = {
  overwatch: {
    name: 'Overwatch',
    tag: 'THE EYES',
    color: '#46e0ff',
    ability: 'Intel Strikes',
    text: 'You see everything from the van. When someone gets made, you get them out: seal a door behind them (Q) or cut the power (C). Earn Intel by watching closely, then spend it on Strikes 2-3 times a run.',
    loadout: 'None (in the van)',
    focus: 'Manuals, cameras, patrol reading',
    keys: [['Mouse', 'Look around the van'], ['Click', 'Use a monitor or prop'], ['1-6', 'Zoom a camera'], ['M', 'Tactical map'], ['B', 'Manual binder'], ['G', 'Guard roster'], ['Q / C', 'Seal a door / cut power'], ['Hold V', 'Radio']],
  },
  hacker: {
    name: 'Hacker',
    tag: 'THE GHOST IN THE WIRES',
    color: '#b07bff',
    ability: 'Loop',
    text: 'Freeze one camera for 20 seconds so security sees nothing. Overwatch loses that feed too, so plan it together.',
    loadout: 'Compact SMG. Fast and loud: every burst brings the floor down on you.',
    focus: 'Terminals, wiring, ciphers',
    weapon: 'smg',
    keys: [['F', 'Loop the camera you aim at'], ['E', 'Interact / takedown'], ['RMB / LMB', 'Aim / fire']],
  },
  infiltrator: {
    name: 'Infiltrator',
    tag: 'THE SHADOW',
    color: '#4dffa6',
    ability: 'Crawlspace + Silent Sprint',
    text: 'Only you fit in vents and ducts. Sprint silently for 6 seconds on a cooldown.',
    loadout: 'Suppressed pistol. Quiet, and one round drops an unaware guard.',
    focus: 'Locks, lasers, movement',
    weapon: 'tranq',
    keys: [['F', 'Silent Sprint'], ['E', 'Enter vents / takedown'], ['RMB / LMB', 'Aim / fire']],
  },
  face: {
    name: 'Face',
    tag: 'THE SILVER TONGUE',
    color: '#ffb347',
    ability: 'The Con',
    text: 'Talk a guard or staff member into looking away, escorting you, or handing over access. Overwatch reads you their dossier; get it right and they fold.',
    loadout: 'Revolver. Six rounds, one-shot kills, and very loud.',
    focus: 'Social, biometrics, pattern reading',
    weapon: 'revolver',
    keys: [['F', 'Con the person you face'], ['E', 'Interact / takedown'], ['RMB / LMB', 'Aim / fire']],
  },
};

// Every gun is real. koUnaware / koAlert: hits to kill a guard who hasn't / has spotted you.
export const WEAPONS = {
  tranq: { name: 'Suppressed Pistol', mag: 12, rate: 0.32, reload: 1.6, koUnaware: 1, koAlert: 2, loud: 6, spread: 0.004 },
  smg: { name: 'SMG', mag: 30, rate: 0.075, reload: 1.9, koUnaware: 3, koAlert: 3, loud: 22, spread: 0.022 },
  revolver: { name: 'Revolver', mag: 6, rate: 0.5, reload: 2.2, koUnaware: 1, koAlert: 1, loud: 28, spread: 0.004 },
};
export const WEAPONS_LETHAL = WEAPONS;

// Each trait: the dossier Overwatch reads, and the one line that works on that person.
export const TRAITS = [
  { id: 'gambler', dossier: 'Bets on every game. Down big this month and hiding it.', line: "Word is the over on tonight's game is a lock. Want in before the line moves?" },
  { id: 'parent', dossier: 'New parent. Pulling double shifts, barely sleeping.', line: "You look wiped. Go grab a coffee, I'll stand right here. Promise." },
  { id: 'grudge', dossier: 'Hates the pit boss. Passed over for promotion twice.', line: "Pit boss is hunting for you. Something about write-ups. I'd make yourself scarce." },
  { id: 'rules', dossier: 'Follows the chain of command to the letter.', line: 'Security director wants eyes on the east exit, right now. His orders, not mine.' },
  { id: 'starstruck', dossier: 'Celebrity-obsessed. Collects autographs.', line: "Is that Danny Rourke at the high-roller table? He's signing anything right now." },
  { id: 'foodie', dossier: 'Never misses a meal. Lunch break is sacred.', line: "Kitchen's tossing a whole tray of prime rib. First come, first served." },
  { id: 'crush', dossier: 'Has a crush on Mel, the bartender.', line: 'Mel at the bar was asking about you. Like, specifically you.' },
  { id: 'paranoid', dossier: 'Convinced management watches staff through the cameras.', line: "Heads up, internal affairs is pulling this hallway's footage today." },
];

export const FIRST_NAMES = ['Vince', 'Rocco', 'Dale', 'Marty', 'Gus', 'Lou', 'Earl', 'Benny', 'Frank', 'Sal', 'Tina', 'Dolores', 'Rita', 'Joanne', 'Carla', 'Pat', 'Hank', 'Ray', 'Ida', 'Nora', 'Walt', 'Cy', 'Mo', 'Bev'];
export const LAST_NAMES = ['Kowalski', 'Mancuso', 'Pruitt', 'Delgado', 'Haskins', 'Ferraro', 'Biggs', 'Oyelaran', 'Lindqvist', 'Tran', 'Barlow', 'Novak', 'Castellano', 'Whitlock', 'Okafor', 'Reyes', 'Dunmore', 'Pike'];

export const PRIZES = [
  { id: 'diamond', name: 'The Duchess Diamond', value: [3.2, 4.6] },
  { id: 'gold', name: "Stanley's Gold Reserve", value: [2.6, 3.8] },
  { id: 'ledger', name: 'The Black Ledger', value: [2.9, 4.2] },
];

export const CHATTER = [
  'Floor two, the bar is out of lemons again.',
  'Table six is asking for a fresh deck.',
  'Who parked the golf cart in the loading bay?',
  'Reminder, staff meeting moved to Thursday.',
  "Stanley's in the building. Look sharp, people.",
  'Slot row C, machine fourteen is jammed.',
  'Can someone get a mop to the fountain?',
  'Unit four, your radio is hot. Unit four.',
  'High roller at poker three wants a comped suite.',
  'Bartender says the ice machine is singing again.',
  'Count room, confirm the afternoon drop.',
  'Whoever is humming on channel two, please stop.',
];

export const EVENTS = {
  shift: {
    name: 'Shift Change',
    warn: 'Heads up, next shift is badging in early. New faces on the floor in thirty.',
    toast: 'Shift change: a fresh guard just clocked in.',
  },
  vip: {
    name: 'VIP Arrival',
    warn: 'VIP motorcade pulling up out front in thirty. Clear a path, extra detail coming in.',
    toast: 'VIP arrival: the floor is packed and a bodyguard is on patrol.',
  },
  surge: {
    name: 'Power Surge',
    warn: 'Engineering says the grid is unstable. Expect a flicker in about thirty.',
    toast: 'Power surge: cameras are down for a few seconds.',
  },
  pitboss: {
    name: 'Pit Boss Audit',
    warn: "Pit boss is starting a floor audit in thirty. He's in a mood.",
    toast: 'Pit boss audit: a supervisor is roaming. He sees through cons.',
  },
};

// ---------- Deep-run puzzle data ----------
// Elevator terminal: the answer is always one of these words.
export const PASSWORDS = ['BLUFF', 'BRASS', 'CARDS', 'CHAIN', 'CHIPS', 'CLUBS', 'CRAPS', 'DEALT', 'DREAM', 'FLUSH', 'GHOST', 'GUARD',
  'HEART', 'HEIST', 'JOKER', 'LASER', 'LIGHT', 'LUCKY', 'MAGIC', 'MONEY', 'NIGHT', 'OCEAN', 'PLANT', 'QUEEN', 'RAISE', 'ROYAL',
  'SEVEN', 'SHADE', 'SHIFT', 'SPADE', 'STACK', 'STEAL', 'TABLE', 'TOKEN', 'TRICK', 'WHEEL'];

export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};

// Count room safe: the beacon spells one of these; each opens on its own frequency.
export const MORSE_WORDS = ['STING', 'STEAK', 'STORM', 'SPARK', 'SHARK', 'SHORE', 'STARK', 'SCORE', 'SHOAL', 'SLATE', 'SKATE', 'STAKE'];

export const SIMON_COLORS = ['red', 'blue', 'green', 'yellow'];

export const BREAKER_COLORS = ['RED', 'BLUE', 'YELLOW'];
export const PHASE_RULES = {
  I: 'Phase I: read the four digits in reverse order.',
  II: 'Phase II: add 1 to every digit (9 becomes 0).',
  III: 'Phase III: swap the first and last digits.',
};

export const PROTOCOL_LINES = [
  'STANLEY PROTOCOL ENGAGED. All exits sealed. Response team deploying.',
  'Response team, sweep the vault level. Lethal force authorized.',
  'Elevators locked. Fire stairs released by code. Cover the stairwells.',
  'Loading dock shutter is on emergency lock. Nobody leaves with that score.',
];

export const BLEED_OUT = 30;

// Getting made: break line of sight with every guard and camera for this long to shake them.
export const LOSE_T = 14;
// Overwatch escape tools (free, on a recharge)
export const SEAL_T = 12, SEAL_CD = 30;
export const CUT_T = 7, CUT_CD = 45;
export const OUTFITS_PER_LOCKER = 2;
