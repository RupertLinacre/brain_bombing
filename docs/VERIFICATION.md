# Verification

Checked locally on 11 September 2026.

- `npm test`: 30 passing tests. Includes 560 generated questions spanning all seven year levels, private per-player snapshots, answer validation/replay prevention, bomb consumption and blocking, cross-shaped blast geometry, chain reactions, simultaneous deaths, live questions, pickups, sudden death, computer behaviour, and short keyboard taps.
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
