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

The live panel shows physical held keys, drawn coordinates, grid reference, move progress and queued intentions with remaining lifetimes. Both result cards show movement starts, reversals, discarded intentions, and last / mean / p95 timing samples. Deliberately queued taps naturally have a longer start delay than an idle keydown; this is not scheduling latency alone.

- **Browser delivery** is handler time minus `KeyboardEvent.timeStamp`. It measures a browser dispatch gap, not keyboard hardware latency.
- **Start** is the movement-start timestamp minus the input-handler timestamp (or scheduled input timestamp during replay). Samples are recorded for discrete intentions that start movement or reverse; continuous held steps have no new keydown and do not add samples.
- **First drawn** is the timestamp of a changed canvas submission minus the corresponding intention's timestamp. It includes input buffering, simulation and frame scheduling. It is not a physical display scan-out or input-to-photon measurement. Both modes are drawn into the lab canvas so the ghost can be compared even when it is hidden.
- A movement superseded or resolved before it can be drawn is logged as `not-drawn`, rather than attributing a later movement to it.

The compact recent log stays beside the board. The detailed log is chronological and distinguishes raw keyboard events from each controller's `buffer`, `overwritten`, `move`, `reverse`, `arrive`, `blocked`, `expired`, `superseded`, `cancelled`, and `drawn` decisions. **Both modes** filters the full and compact logs, **Follow** controls scrolling, and **Clear log** clears events without resetting movement statistics. DOM log rows are reused so instrumentation does not rebuild a large table every frame.

JSON export includes layout, buffer duration, mode, timestamped inputs, chronological events and both controller snapshots. The on-screen log retains the latest 350 rows, and export retains up to 1,200 events. Export and replay are local; no data is sent to a service.

## Validation

`tests/controls-playground.test.ts` covers lost double taps in the current engine, preserved corner taps, zero-delay starts, continuous mid-segment reversals, releases exactly at a centre, waiting for a blocked turn, bounded/expiring queues, OS-repeat suppression, physical-key aliases, blur clearing, wall collision and independence from render cadence. The existing gameplay suite remains applicable because the main game's movement is not changed.
