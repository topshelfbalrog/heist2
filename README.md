# In Broad Daylight

A co-op, first-person heist game that runs in the browser. Three or four players rob Stanley's Palace, a packed high-tech casino, in the middle of the afternoon. Overwatch sits in the van with the cameras and the manuals; the field crew sees the locks, lasers and guards. The heist is won by talking.

## Put it online (Render, free)

You only need a web browser.

1. Create a free GitHub account if you don't have one, then make a new repository called `in-broad-daylight`.
2. On the new repository page, click **uploading an existing file**, and drag in everything from this folder (the `public` and `server` folders, `package.json`, `render.yaml`, `README.md`, `.gitignore`). Leave out `node_modules` if it's there. Click **Commit changes**.
3. In Render, click **New** then **Blueprint**, connect your GitHub account, and pick the `in-broad-daylight` repository. Render reads `render.yaml` and sets everything up. Click **Apply**.
4. After a few minutes you get a link like `https://in-broad-daylight.onrender.com`. Share it with your crew.

Things to know about the free plan:

- The server sleeps after 15 minutes with nobody connected. The first visit after that takes about a minute to wake up.
- Crew saves live in a file on the server, and Render's free plan wipes files on each redeploy or restart. For saves that last, add a Render disk (paid) mounted at `/data` and set the environment variable `DATA_DIR=/data`.
- Voice is peer-to-peer. It works for most home networks. If one player can't hear the others, they're probably behind a strict network, and a TURN relay would be needed (ask and it can be added).

## Playing

1. The host clicks **Start a crew room** and uses **Copy invite link**.
2. Everyone takes a role card. The host can also **Deal roles at random**. Roles are unique, and someone must be Overwatch. Three players means Overwatch plus two field roles.
3. The host can save progress under a crew name and passcode. Payouts go to the crew bankroll.
4. The host starts the heist. Allow the microphone when asked.

### Controls

Field crew: WASD move, Shift sprint, Ctrl or C crouch (slide while sprinting), Space jump, Mouse aim, Left click fire, Right click aim down sights, R reload, E interact (hold for revive, stash a body, change clothes, grab), F role ability.

Overwatch: Mouse look around the van, Click a monitor to zoom, 1-6 zoom a feed, arrows switch cameras while zoomed, M tactical map and Strikes (1-3 switch floors), Q seal a door, C cut power, B manuals, G guard roster, O lockdown override console, Tab or Esc back to the van.

Getaway driver: W/S throttle and brake, A/D steer, Space handbrake. Navigators: H flips the scanner between north-up and heading-up.

Everyone: hold V for radio, hold X to whisper, T mutes your mic, Esc pauses.

### Voice rules

- Radio (hold V) reaches the whole crew, including Overwatch.
- Field players also hear each other by proximity (open mic). Guards hear open-mic talking in restricted areas. Whisper or use the radio near them.
- The vault is a jammer zone: no radio in or out.

### The job at Stanley's Palace (about an hour)

Three floors, eleven locks, a lockdown and a car chase. Nearly every lock needs Overwatch's manuals (B) or cameras.

**Ground floor**
1. **Staff door keypad.** The field player describes four symbols with no names. Overwatch finds the one manual column that holds all four and reads back the order.
2. **Security hub.** It's behind a keycard door. The Floor Manager carries the keycard: the Face can con it off him (Overwatch reads his dossier), anyone can knock him out and lift it, or the Infiltrator crawls through the vents from Storage.
3. **Three systems in Security:**
   - *Junction panel*: cut the right wire by Overwatch's rulebook. The solver sees the first two vault digits; Overwatch gets the last two on the security radio.
   - *Lift terminal*: five letter dials, one hidden word from Overwatch's list.
   - *Camera server*: a growing color sequence. Overwatch's table maps each flash to the button to press, and the table changes with every strike. Until it's solved, Overwatch has no cameras below ground.

**B1: count level** (service lift)
4. **Pressure gallery.** 30 floor plates; the armed ones only show on Overwatch's THERMAL camera, and the pattern swaps every 16 seconds.
5. **Count room safe.** A lamp blinks a word in Morse. Overwatch matches it to a frequency. The safe holds the vault override key.
6. **Annex hatch.** An invisible 6x6 maze. Two green rings identify which of Overwatch's six mazes it is.

**B2: vault level** (through the hatch)
7. **IR corridor.** Seven gates of near-invisible beams, including sliding posts. Overwatch calls the timing from the IR GRID camera.
8. **Vault.** Four-digit code, then the override key in console A, then two players turn keys A and B within a second and a half of each other.
9. **Time lock.** 45 seconds while a response team comes down the corridor. Hold the antechamber.

**The climax: the Stanley Protocol**
10. Taking the score locks the building down: seven minutes, red lights, response teams on every floor, the lift frozen and the IR grid locked solid. The fire stairs release. Climb B2 to B1 to the ground, flipping an emergency breaker on each floor. Each shows a color, a phase and a code; Overwatch converts the codes by phase and enters them in the console's order (O). Wrong entries cost 12 seconds. Then the loading bay shutter opens.
11. **The getaway.** Everyone piles into the van. Overwatch drives with only the windshield. The crew has the police scanner (roadblocks, cruisers, the safehouse) and calls every turn. Four hits and the van is done.

**Everything is live fire.** The crew carries real guns (suppressed pistol, SMG, revolver) and so does security. Takedowns from behind are silent kills. Dead guards get found and bring Heat, so stash bodies off the public floor (hold E). A downed player bleeds out in 30 seconds unless a teammate patches them up (hold E). The dead stay down for the rest of the run.

**Getting made.** Nobody gets arrested. When suspicion maxes out, or a guard sees you do something hostile, you're *made*: every guard who sees you opens fire and the nearest guards on your floor come hunting. Shaking them is up to the crew:
- **Break contact.** No guard and no live camera sees you for 14 seconds. Vents count.
- **Change clothes.** Four lockers: the coat check by the entrance, staff lockers in Storage, uniforms in the B1 lobby, spare kit on the B2 landing. Two outfits each, and only with nobody watching. It wipes your description and gives you a new look.
- **Overwatch gets you out.** *Seal a door* (Q, 12 seconds, 30s recharge) slams one door shut so pursuers pile up behind it. *Cut power* (C, 7 seconds, 45s recharge) blacks out a lighting zone: cameras there go blind, guards can barely see, and they miss more. Both are free; the Strikes still cost Intel.
- After you shake them, security keeps your description and clocks you faster until you change clothes.

Too much Heat before the vault triggers the Stanley Protocol early, without the score.

Suspicion builds per player when guards or cameras see something odd: restricted areas, a drawn weapon, sprinting, fiddling with panels. Overwatch watches every meter and hears a rising beep. Max suspicion means you're made (see above). Alarms add crew-wide Heat.

Overwatch earns Intel by tagging guards on camera, decoding manuals, flagging useful radio chatter and quiet progress. 4 Intel buys a Strike: Jackpot Siren, Kill the Lights (a whole zone for 15s), or Override. You get 2 per run, 3 at 16 Intel and 4 at 26.

Each run is generated from a random seed: layout, crowd, guard routes, cameras, glyphs, wiring rules, the password, the color tables, the plate patterns, the Morse word, the mazes, the codes, the breakers, the city and its roadblocks, plus three random events.

### Music

Three looping tracks live in `public/audio`: `heist-jazz.mp3` plays everywhere (menus, lobby, the heist, the getaway), `made.mp3` takes over while you've been made (Overwatch hears it while anyone on the crew is made), and `pause.mp3` plays only in the pause menu. Music starts on your first click, because browsers block sound before that. The pause menu has a separate Music slider. To swap a song, replace the file and keep the same name.

## Running it on your own computer (optional)

Install Node.js 18 or newer, then in this folder run `npm install` and `npm start`, and open `http://localhost:8080`. Friends on other computers need the Render link instead (browsers only allow microphones on HTTPS sites).

## Project layout

- `server/index.js`: web server, crew rooms, the authoritative heist simulation tick, voice signaling.
- `server/crews.js`: crew name and passcode saves.
- `public/shared/`: code shared by server and browser: the procedural generator (`gen.js`), the simulation (`sim.js`), geometry and game data.
- `public/js/`: the browser game: 3D world, field and Overwatch modes, puzzles, voice, audio, menus.
- `public/audio/`: the soundtrack.
