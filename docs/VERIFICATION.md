# Verification

Checked locally on 12 September 2026.

- `npm test`: 48 passing tests. Includes 560 generated questions spanning all seven year levels, private per-player snapshots, answer validation/replay prevention, bomb consumption and blocking, cross-shaped blast geometry, chain reactions, three-life rounds, simultaneous knockout recovery, instant-only damage, narrow-lane collision, live questions, pickups, unlimited round time, computer behaviour, and short keyboard taps.
- `npm run build`: TypeScript checks and Vite production build pass.
- `npm audit`: no known vulnerabilities in the installed dependency tree.
- Browser checks: start screen, computer game, four-choice question presentation, wrong-answer feedback, keyboard answer selection, generated sprite loading, full desktop frame fitting, and mobile layout without horizontal overflow at 390px.
- Real PeerJS/WebRTC connection between two independent browser sessions: four-character room creation/joining, different player names/year levels, distinct private questions, guest movement, successful answers on both peers, synchronized arsenal counts, placed bombs, synchronized win/loss result, guest rematch readiness, second round in the same room, and connection-loss messaging.
- Browser consoles for both online sessions reported no errors.

The networking check used separate browser processes on this machine through PeerJS's public signalling service. It does not certify every cross-network NAT/firewall combination; optional TURN relay configuration is described in the README.

## Arcade effects and audio update

- Checked a three-bomb chain reaction with four destroyed crates, a knockout, and a simultaneous brain reward in the actual canvas renderer.
- Rendered all 13 procedural sounds through an OfflineAudioContext and compressor: every signal was finite, audible, and below clipping (largest measured peak approximately 0.33).
- Browser audio checks verified that a play-button gesture starts a running AudioContext and the music scheduler, pausing fades the music to zero, music-only mute reaches zero, and master mute reaches zero.
- Additional automated coverage verifies explosion cues when bomb counts stay unchanged, event retention across missed snapshots, exactly-once feedback, chain metadata, snapshot copying, private answer sounds, and rematch resets.

## Arenas and tactics update

- All three layouts checked over 40 seeds each for symmetric terrain and three reachable private brains per player.
- Progression scenarios verify exactly one bomb per answer, one reach upgrade every third solved brain, the six-tile cap, equal rules for both players, wrong-answer handling, and unchanged reach on bombs already placed.
- Hazard scenarios cover early chain detonation, later blasts passing through destroyed crates, simultaneous blasts still stopped by crates, and fire expiry. Bot scenarios check choosing an attack lane, escaping its own blast, and refusing a placement without an escape.
- Countdown scenarios verify that movement, answers, bombs, the bot, and the match clock wait for the shared start.
- Actual browser play at desktop and 390px phone widths: select Ember Works, walk to three brains, use both keyboard and clicked answers, earn exactly three bombs and the reach upgrade, place a bomb, see its floor warning, escape, and use the rematch button to reach Neon Arcade. No horizontal overflow on the phone layout.
- Two browser contexts connected through the real PeerJS service: the guest sees the host-selected Ember Works, the shared countdown and correct Coral identity; rematch readiness and the second countdown switch both screens to Neon Arcade. Guest page reported no errors.
- Additional live WebRTC check verifies the arena ID, countdown, private Year 6 questions, and a guest's three-answer reach upgrade on the host. Room protocol prefix updated to keep older game builds out of the new rule set.
- Audio lifecycle rechecked with the countdown: music stays silent until play begins, then plays normally; pause, music mute, and master mute reach zero. A tiny diagnostic input keeps the test audio graph processing so Chromium does not report stale gain values after notes have ended. Pause and help apply their fade directly.

## Forgiving combat update

- Unit scenarios verify the 3.6-second fuse, three starting lives, one life lost for overlapping simultaneous blasts, safe respawn with a temporary shield, and final-life round resolution.
- Collision scenarios exercise a player moving perpendicular to a blast. The player is hit while their centre remains inside the 0.6-tile-wide lane and survives once mostly clear.
- Lingering flames are verified as visual-only: standing or walking in them does not remove a life, and they do not ignite a bomb placed after the explosion instant. Bombs already in the original blast still chain immediately.
- A browser playthrough verifies the three-heart HUD, 3.6-second placed fuse, two-heart update after a hit, safe respawn feedback, visible temporary shield, and safe occupation of a still-animated flame tile. The moving-player collision scenario produces two lives while near the lane centre and all three lives once mostly clear.
- A live PeerJS host/guest check verifies that a guest receives the lost life, surviving state, respawn shield, and continuous arena position used by the narrow collision model. The room protocol prefix is versioned so older open builds cannot join matches using these new rules.
