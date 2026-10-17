# Controls playground

Run `npm run dev -- --port 5182`, then visit `http://localhost:5182/controls.html`.
Work is isolated on the `controls-playground` branch. The production game's controls are unchanged.
Both HTML entry points are included in normal and Pages builds.

## Comparing controls

The board has 5×5 traversable coordinates (0–4), with optional fixed pillars. Both controllers start at (2, 2) and receive every input with the same timestamp. Switching the watched mode changes the display, not the input or simulation history. The dashed ghost shows the other controller. The dashed tile outline is the selected controller's grid reference, which differs from its animated position.

Use arrows or WASD. Key indicators track physical keys, including which key wins when multiple keys are held. Repeated OS keydown events are logged but ignored by movement. R resets. Window blur and hidden tabs clear held keys and buffered intentions. An in-progress step can finish; no other movement is retained. A hidden tab suspends the lab clock, so returning does not produce a catch-up burst.

Buttons replay double taps, a mid-step reversal, an early corner turn, excessive taps, or a held key. The double-tap scenario contains two complete presses before the first 50 ms tick. **Replay my inputs** preserves the time gaps of your own sequence, normalizes its start time, and releases any keys still held at the recording's end. Manual movement interrupts a replay. Reset, changing the board, or changing the buffer clears the recording and both simulations.

## Current controller

`CurrentControls` uses the actual `Engine.act()` and `Engine.step()` implementations. The arena and players are repositioned for the lab, and questions, pickups and combat are omitted. The page reproduces the main game's direction stack, 150 ms direction refresh, 20 Hz simulation, and the renderer's extra `dt * 24` smoothing of `visualX`/`visualY`.

There is only one pending-direction slot. A later press or the resumption of a held direction can replace an earlier tap. Movement starts on a simulation tick. Each animation lasts 170 ms, but repeating steps are quantized to the 50 ms tick, so the usual repeating cadence is 200 ms. The engine commits its grid destination when a step starts, before the sprite has arrived there.

The lab uses a fixed tick phase relative to reset for reproducible comparisons. It does not emulate the main page's browser timer jitter, packet delivery, prediction, or remote rendering. A different tick phase can change which taps get merged.

## Timing-focused prototype

The prototype is independent of the engine so that it can be evaluated before changing combat, collision, or the network protocol.

- A real keydown creates a discrete movement intention. An idle player's movement starts at that input timestamp. Rendering interpolates directly from the segment's timestamps; there is no second smoothing stage or variable speed based on rendering frequency.
- Each tile takes 170 ms, matching the current game's nominal duration. Holding a key starts another step at the next tile centre. Releasing the key lets the current step finish. A release exactly on the centre is handled before repeating the hold.
- Up to two taps can wait in the queue. Released taps remain queued because a tap is an intentional step. Each expires after 220 ms by default; the slider changes this from 80–400 ms. Once the buffer is full, the newest intention replaces the oldest pending one. This limits the tail of unwanted movement after rapid input.
- An opposite input reverses immediately along the current segment. Position and speed remain continuous. Any older queued turns are cancelled. Releasing a newer held key can also expose an older, opposite held key and reverse toward it.
- Perpendicular turns happen at tile centres, preserving grid collision and avoiding diagonal shortcuts. A blocked buffered turn can wait for a later junction until its expiry, while a valid older held direction continues. Released blocked taps never pass through walls.
- The newest physically held key gets priority. Arrow and WASD aliases are tracked independently, so releasing one does not release another physical key in the same direction.

These are deliberate design choices for testing. Queue length, expiry and immediate reversal should be judged by feel before integrating them with bombs, brains and online play. In particular, a long buffer preserves more taps but also keeps the player moving longer after their hands stop.

## Instrumentation

### Drive-by answers

The **Drive-by brain** checkbox enables a repeatable `7 + 5` question at (3, 2). The fixed question makes it easier to isolate timing. It applies the same question rules to both movement controllers; the current controller still uses its existing movement and smoothing, but neither controller stops on this lab brain.

The dashed pink square around the selected player is a 0.6×0.6 tile answer footprint. Any positive intersection with the full brain tile permits answering, including a tiny corner intersection. Edges that only touch do not count. Acceptance uses animated position rather than the controller's grid reference. On a straight horizontal pass, the window runs from a centre position just beyond x=2.2 to just before x=3.8. It therefore includes the approach and departure portions of a step, rather than requiring the centre of the player to occupy the brain's tile.

Keep an arrow or WASD key held and type numbers, a minus sign, a decimal point or a slash. The board retains focus, movement continues, and a correct answer accepts immediately without Enter. Backspace edits; Escape or Delete clears. OS repeated keydowns do not append digits repeatedly. Each movement mode has its own answer buffer and exactly-once reward. A correct answer prepared outside the tile is retained and automatically accepted on a subsequent overlap; completing it after exit never awards a bomb retroactively. R restarts both the movement and brain drill.

The live panel shows typed text, overlap percentage, how long the window has been open (or the last observed window duration), and solved problems / bombs earned. The comparison cards show acceptance time independently for each mode. The event log includes raw character keydown/keyup, `answer-edit`, `brain-enter`, `brain-exit`, `answer-outside`, and `answer-accepted`, including position and overlap at acceptance. The robot and question tile remain marked after solving so that the last window can be inspected; repeat R to rearm the drill.

The timing-focused controller advances its continuous motion to a keyboard event's timestamp before judging an edit. The current controller uses the game's last smoothed visual position. Between inputs the window is sampled each animation frame; entry and exit telemetry is therefore sample-timed, not a claim about hardware pixel timing. Rendering a question never calls the movement controller or moves focus. Recorded character edits replay alongside arrow input, and JSON version 2 includes brain configuration, buffers, overlap, acceptance positions/times, and rewards for both modes.

The **Drive-by answer** scenario holds Right from 10–350 ms and types `1` at 55 ms and `2` at 70 ms. The timing-focused player accepts at x≈2.353 at 70 ms, while still approaching the brain tile's centre, then continues to (4, 2). A fresh traversal and replay can be compared with **Current**, whose visual position reaches the overlap window later.

The live panel shows physical held keys, drawn coordinates, grid reference, move progress and queued intentions with remaining lifetimes. Both result cards show movement starts, reversals, discarded intentions, and last / mean / p95 timing samples. Deliberately queued taps naturally have a longer start delay than an idle keydown; this is not scheduling latency alone.

- **Browser delivery** is handler time minus `KeyboardEvent.timeStamp`. It measures a browser dispatch gap, not keyboard hardware latency.
- **Start** is the movement-start timestamp minus the input-handler timestamp (or scheduled input timestamp during replay). Samples are recorded for discrete intentions that start movement or reverse; continuous held steps have no new keydown and do not add samples.
- **First drawn** is the timestamp of a changed canvas submission minus the corresponding intention's timestamp. It includes input buffering, simulation and frame scheduling. It is not a physical display scan-out or input-to-photon measurement. Both modes are drawn into the lab canvas so the ghost can be compared even when it is hidden.
- A movement superseded or resolved before it can be drawn is logged as `not-drawn`, rather than attributing a later movement to it.

The compact recent log stays beside the board. The detailed log is chronological and distinguishes raw keyboard events from each controller's `buffer`, `overwritten`, `move`, `reverse`, `arrive`, `blocked`, `expired`, `superseded`, `cancelled`, and `drawn` decisions. **Both modes** filters the full and compact logs, **Follow** controls scrolling, and **Clear log** clears events without resetting movement statistics. DOM log rows are reused so instrumentation does not rebuild a large table every frame.

JSON export includes layout, buffer duration, mode, timestamped inputs, chronological events and both controller snapshots. The on-screen log retains the latest 350 rows, and export retains up to 1,200 events. Export and replay are local; no data is sent to a service.

## Validation

`tests/controls-playground.test.ts` covers lost double taps in the current engine, preserved corner taps, zero-delay starts, continuous mid-segment reversals, releases exactly at a centre, waiting for a blocked turn, bounded/expiring queues, OS-repeat suppression, physical-key aliases, blur clearing, wall collision and independence from render cadence. The existing gameplay suite remains applicable because the main game's movement is not changed.

`tests/drive-by.test.ts` covers entry/exit boundaries, corner overlaps, approaches and departures before/after the tile centre, late completion, answer preparation before entry, corrections, exactly-once rewards, and movement continuing while answer edits share its timeline. The current controller's committed grid destination cannot prematurely trigger acceptance.
