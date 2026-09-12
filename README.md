# Brain Bombs 2

A small Bomberman-inspired maths arena game. Everything lives inside one game frame, with an animated canvas arena and accessible HTML menus and answer buttons.

Play the published game at [rupertlinacre.com/brain_bombing](https://rupertlinacre.com/brain_bombing/).

## Run it

Requires Node.js 22.12+ (or a newer supported Node release).

```sh
npm install
npm run dev
```

Open the URL printed by Vite. To use a different port, run `npm run dev -- --port 5182`.

```sh
npm test          # Simulation, maths library, privacy, and input validation
npm run build    # TypeScript check and production build
npm run preview  # Serve the production build
```

The production `dist/` folder can be served by any static web host. Relative asset paths support deployment in a subdirectory. No application server is required.

## Deploy to GitHub Pages

The `origin` remote points to `RupertLinacre/brain_bombing`. To test the game, build it with the `/brain_bombing/` base path, and publish `dist/` to the repository's `gh-pages` branch, run:

```sh
npm run deploy
```

GitHub Pages serves that project branch at `https://rupertlinacre.com/brain_bombing/`. The custom domain belongs to the account-level Pages site, so this project does not publish a separate `CNAME` file.

## How to play

- Choose **Circuit Garden** (winding paths), **Ember Works** (open cross lanes), or **Neon Arcade** (a roomy central plaza). Enable **New arena each round** to rotate through all three. The host chooses for online matches.
- A shared **3-second countdown** introduces the arena and your colour. The round clock and all actions wait until it ends.
- Move with **WASD** or **arrow keys**. Touch controls are also available on narrow screens.
- Each player starts with **zero bombs**. Walk into one of your pink brains and answer its question by clicking a choice or pressing **1–4**. A correct answer earns exactly **one consumable bomb**.
- Questions use `maths-game-problem-generator` **1.1.0**, including its `expression_short`, four answer choices, and correct answer. Reception through Year 6 are supported. Each player chooses their own year.
- Wrong answers earn nothing and briefly lock further attempts. Move away or press **Escape** to dismiss a question. **The arena keeps running while you answer.**
- Press **Space** or the bomb button to place a bomb. Its fuse lasts **3.6 seconds**. You can step off a new bomb, but cannot walk back through it.
- Each player has **three lives**. A hit removes one life, moves the player to a safe open tile near their starting corner, and gives them a 1.2-second respawn shield. The round ends when a player loses their final life.
- Blasts travel in a **cross**, stop at steel blocks, destroy the first crate in their path, and trigger other bombs. The damaging part is a narrow strip through the centre of each lane, checked only at the instant of explosion. If your centre has mostly cleared the lane, you survive. The animated flame and smoke that remain afterward are visual effects and are safe to walk through.
- Every **3 solved brains** also earns **+1 tile of flame reach**, up to 6. The brain-power meter shows your progress, including while answering. Each correct answer still earns exactly one bomb; wrong answers do not advance progress.
- Amber dashed tiles warn of a blast in its final **1.1 seconds**. A **move now** banner appears whenever your tile is threatened, including while answering. Warnings account for chain reactions and later blasts through already destroyed crates.
- Crates sometimes reveal **flame** pickups (+1 tile of reach, from 2 to a maximum of 6) or **speed** pickups (up to 3 upgrades). Reach is captured when a bomb is placed.
- Rounds have **no time limit**. The clock counts upward and the arena stays open until one player wins. If both players take their final hit in the same explosion, they respawn on one life and keep battling.
- The first player to win **3 rounds** wins the match. Equipment and the arena reset each round.

## Sound and effects

Sound is on by default, after your first click or key press. The speaker button mutes all audio; the music-note button independently toggles the quiet original arcade soundtrack. Both preferences are saved. Music fades out during a computer-game pause, after the round ends, and while the tab is hidden.

Bombs have animated fuses and accelerating crackles, followed by a layered bass thump, crack, and rumble. Blasts add connected fire trails, sparks, smoke, rings, fragments cut from the original crate artwork, and brief comic captions. Correct answers and upgrades get their own bursts and jingles. A lost life produces a respawn cue and visible shield; the final knockout plays before the result screen appears.

The effects respect the browser's reduced-motion preference. Particle counts and audio layers are bounded, and a compressor controls overlapping sound levels. Everything is synthesized locally with Web Audio; no sound downloads or music service are needed.

## Two computers

One player chooses **Create room** and shares the four-character code. The other chooses **Join a friend** and enters it. The host starts the match. Both computers must open this game, either from the same deployed URL or from the development server's printed LAN address.

Like Arithmetic Annihilation, transport uses **PeerJS** signalling and a **WebRTC data connection**. The host runs the authoritative simulation at 20 ticks/second, validates guest inputs, and sends a separate view to each player. A view contains both players and all public combat state, but **only that viewer's brains and questions**; it never contains correct-answer indices. Each device displays only its own questions. This is a friendly peer-hosted game, not a server-backed anti-cheat system.

Rematches stay in the same room. The guest can signal readiness; the host starts the next round. Disconnects stop the local match and show a return-to-menu message instead of leaving a frozen game without explanation. Online matches continue while menus are open. Computer matches can be paused.

PeerJS's public signalling service needs internet access. Some school, corporate, or restrictive NAT networks require a TURN relay. Optional `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` settings can be added in `.env.local` before building. These are **browser-visible** settings; use credentials intended for browser clients. Computer play needs no connection after the app and assets have loaded.

## Computer opponent

Professor Byte walks to its own brains, spends time answering, and earns the same one bomb per correct answer. It looks for useful crate-clearing or attacking placements and checks for an escape route. It scores reachable destinations for useful upgrades, efficient crate clearing, and attack lanes, and keeps a target to avoid unnecessary wandering. Escape planning accounts for movement timing, chain reactions, fire expiry, and crates destroyed by earlier bombs. **Chill** takes longer to answer and favours gentler attacks; **Clever** answers faster and prioritizes stronger attacking positions. Neither receives free ammunition or immunity.

## Project layout

- `src/game/engine.ts` — authoritative grid simulation, bombs, power-ups, private brains, and filtered snapshots.
- `src/game/arenas.ts` — three symmetric arena layouts and their visual themes.
- `src/game/hazards.ts` — shared blast geometry and public hazard forecasting.
- `src/game/bot.ts` — computer pathfinding and bomb escape planning.
- `src/game/questions.ts` — the shared maths library adapter.
- `src/game/renderer.ts` / `src/game/effects.ts` — canvas drawing, sprite animation, and cosmetic explosion effects.
- `src/game/feedback.ts` — one-time presentation cues from authoritative snapshots.
- `src/ui/audio.ts` — original synthesized effects and the arcade music loop.
- `src/network/session.ts` — room creation/joining, PeerJS transport, validation, and disconnect handling.
- `src/main.ts` / `src/style.css` — menus, keyboard/touch input, HUD, questions, and viewport fitting.
- `public/sprites/` — optimized original generated artwork.
- `assets/source/` / `docs/ARTWORK.md` — source atlas and exact generation prompt.
- `tests/` — rule, privacy, feedback, arena, progression, and tactical scenario tests.

The cloned `arithmetic_annihilation/` and `maths_vs_monsters/` folders are reference projects, ignored by this repository and excluded from test discovery. They are not runtime dependencies.
