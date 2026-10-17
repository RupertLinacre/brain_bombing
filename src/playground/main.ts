import "./style.css";
import {
  CurrentControls,
  PrecisionControls,
  arrows,
  keyDirections,
  makeMap,
  type Controller,
  type Mode,
  type MovementEvent,
  type Layout,
  type Snapshot,
} from "./movement";
import { scenarios, type RecordedInput } from "./scenarios";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const symbols: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
const label = (code: string) => symbols[code] ?? code.replace("Key", "");
const names: Record<Mode, string> = {
  current: "Current",
  precision: "Timing-focused",
};
const fixed = (n: number) => n.toFixed(2);
const point = (p: { x: number; y: number }) => `${fixed(p.x)}, ${fixed(p.y)}`;

$("#app").innerHTML = `
<main>
  <header><div><p class="eyebrow">BRAIN BOMBS 2 · INPUT LAB</p><h1>Controls playground</h1></div><a href="./">Back to game ↗</a></header>
  <section class="settings" aria-label="Control settings">
    <fieldset class="mode-switch"><legend>Controls to watch</legend><label><input type="radio" name="mode" value="current" checked> Current</label><label><input type="radio" name="mode" value="precision"> Timing-focused</label></fieldset>
    <label class="setting">Board<select id="layout"><option value="open">Open 5 × 5</option><option value="pillars">5 × 5 with pillars</option></select></label>
    <label class="setting">Tap buffer <span><output id="buffer-label">220</output> ms</span><input id="buffer" type="range" min="80" max="400" step="10" value="220"></label>
    <label class="ghost-toggle"><input type="checkbox" id="ghost" checked> Show other mode as a ghost</label>
    <button id="reset">Reset <kbd>R</kbd></button>
  </section>
  <div class="workspace">
    <section class="play-card">
      <div class="board-heading"><strong id="mode-title">Current</strong><span id="input-status">Click the board, then use arrows or WASD</span><span id="recording" class="badge">LIVE INPUT</span></div>
      <canvas id="board" width="650" height="650" tabindex="0" aria-label="5 by 5 movement playground. Arrow keys or WASD to move. R resets."></canvas>
      <div class="board-footer"><span><i class="dot solid"></i> Selected mode</span><span><i class="dot ghost"></i> Other mode</span><span>Coordinates 0–4 · 170 ms / tile</span></div>
      <div class="trials"><div class="trials-heading"><h2>Repeatable inputs</h2><button id="replay" disabled>Replay my inputs</button></div><div class="demo-buttons">${Object.entries(
        scenarios,
      )
        .map(([id, s]) => `<button data-demo="${id}">${s.label}</button>`)
        .join(
          "",
        )}</div><p id="scenario-description">Try two quick taps, press left then right, or hold one key while tapping another. Both modes always receive the same inputs.</p></div>
      <details class="explanation" open><summary>What changes between modes?</summary><dl><dt>Current</dt><dd>The actual game engine: 50 ms simulation steps, one pending direction, 170 ms tile animation, then the game’s extra render smoothing. Held keys are refreshed every 150 ms.</dd><dt>Timing-focused</dt><dd>Movement starts on keydown and animates directly from timestamps. Two pending taps, each expiring after the buffer time. Opposite input reverses immediately along the same lane; perpendicular input turns at a tile centre. The newest held key wins; a blocked turn can wait while an older held direction continues.</dd></dl><p>Released taps remain intentional steps. Holding a key repeats movement without relying on operating-system key repeat. Reversing replaces older buffered turns. Blur and hidden tabs clear keys and queues; switching the watched mode preserves the same input history.</p><p>This page isolates local movement. It does not apply the prototype to the game or measure network delay. “First drawn” is a JavaScript canvas submission measurement, not hardware display latency.</p></details>
    </section>
    <aside class="instrumentation">
      <section class="panel"><h2>Keys down</h2><div class="keys" id="keys">${["KeyW", "ArrowUp", "KeyA", "ArrowLeft", "KeyS", "ArrowDown", "KeyD", "ArrowRight"].map((code) => `<kbd data-key="${code}">${label(code)}</kbd>`).join("")}</div><p class="subtle" id="held-text">None</p><div class="clock-row"><span id="clock">0 ms</span><span id="fps">— fps</span><span id="delivery">Browser delivery: —</span></div><h3>Recent events</h3><div id="recent-events" class="recent-events"></div></section>
      <section class="panel"><h2>Live movement <span id="state-mode">Current</span></h2><dl class="telemetry"><dt>Grid reference</dt><dd id="cell">2, 2</dd><dt>Drawn position</dt><dd id="visual">2, 2</dd><dt>Direction / phase</dt><dd id="phase">Idle</dd><dt>Tile progress</dt><dd><progress id="progress" max="1" value="1"></progress> <span id="progress-text">100%</span></dd></dl><h3>Pending inputs</h3><div id="queue" class="queue">Empty</div><p class="subtle" id="grid-note">Current reports its grid destination immediately. Timing-focused reports its segment origin until arrival.</p></section>
      <section class="panel"><h2>Same input, two results</h2><div class="comparison" id="comparison"></div><p class="subtle">Start delay includes intentional buffering. First drawn includes scheduling and rendering. Samples are reset with the board.</p></section>
    </aside>
  </div>
  <section class="panel event-panel"><div class="log-heading"><div><h2>Event log</h2><p>Input order, buffer decisions, starts, reversals, arrivals and dropped intentions.</p></div><div><label><input type="checkbox" id="all-events" checked> Both modes</label><label><input type="checkbox" id="follow" checked> Follow</label><button id="export">Export JSON</button><button id="clear-log">Clear log</button></div></div><div id="log-scroll"><table><thead><tr><th>Time (ms)</th><th>Source</th><th>Event</th><th>Key</th><th>Detail</th></tr></thead><tbody id="log"></tbody></table></div></section>
</main>`;

type LogEntry = MovementEvent & {
  source: Mode | "input" | "system";
  code?: string;
};
type Stats = {
  moves: number;
  reversals: number;
  dropped: number;
  latencies: number[];
  drawn: number[];
  pendingDraw?: {
    at: number;
    intentAt: number;
    visual: { x: number; y: number };
  };
};
const freshStats = (): Stats => ({
  moves: 0,
  reversals: 0,
  dropped: 0,
  latencies: [],
  drawn: [],
});
let mode: Mode = "current",
  layout: Layout = "open",
  bufferMs = 220;
let map = makeMap(layout),
  controllers: Record<Mode, Controller>;
let stats: Record<Mode, Stats> = {
  current: freshStats(),
  precision: freshStats(),
};
let history: RecordedInput[] = [],
  logs: LogEntry[] = [],
  trace: RecordedInput[] = [];
let clock = 0,
  anchor = performance.now(),
  lastFrame = anchor,
  suspended = document.hidden;
let replay: { inputs: RecordedInput[]; index: number; until: number } | null =
  null;
let dirtyLog = false,
  lastHud = 0,
  frameAverage = 16.7,
  delivery = "—";
const physical = new Set<string>();
const canvas = $<HTMLCanvasElement>("#board"),
  ctx = canvas.getContext("2d")!;
const sprite = new Image();
sprite.src = `${import.meta.env.BASE_URL}sprites/player-teal.webp`;
const time = () => (suspended ? clock : clock + performance.now() - anchor);

function log(entry: LogEntry): void {
  logs.push(entry);
  if (logs.length > 1200) logs.shift();
  dirtyLog = true;
}
function emit(source: Mode, event: MovementEvent): void {
  log({ ...event, source });
  const s = stats[source];
  if (event.kind === "move") s.moves++;
  if (event.kind === "reverse") s.reversals++;
  if (
    ["overwritten", "expired", "superseded", "cancelled"].includes(event.kind)
  )
    s.dropped++;
  if (event.latency !== undefined) {
    s.latencies.push(event.latency);
    if (s.pendingDraw)
      log({
        source,
        at: event.at,
        kind: "not-drawn",
        note: "Previous movement intention changed before the next canvas frame",
      });
    s.pendingDraw = {
      at: event.at,
      intentAt: event.at - event.latency,
      visual: controllers[source].snapshot().visual,
    };
  }
}
function reset(reason = "Board reset", keepTrace = false): void {
  clock = 0;
  anchor = lastFrame = performance.now();
  lastHud = -Infinity;
  suspended = document.hidden;
  stats = { current: freshStats(), precision: freshStats() };
  physical.clear();
  history = [];
  logs = [];
  replay = null;
  if (!keepTrace) trace = [];
  map = makeMap(layout);
  controllers = {
    current: new CurrentControls(map, (e) => emit("current", e)),
    precision: new PrecisionControls(
      map,
      (e) => emit("precision", e),
      bufferMs,
    ),
  };
  log({ at: 0, source: "system", kind: "reset", note: reason });
  $("#replay").toggleAttribute("disabled", !trace.length);
  updateHud(0);
}

function dispatch(input: RecordedInput, synthetic = false): void {
  const { code, at, down, repeat } = input;
  if (down) physical.add(code);
  else physical.delete(code);
  updateKeys();
  history.push({ ...input });
  log({
    at,
    source: "input",
    kind: down ? (repeat ? "repeat" : "keydown") : "keyup",
    code,
    note: `${synthetic ? "Replay" : "Live"}${repeat ? " · ignored by both controllers" : ""}`,
  });
  for (const c of Object.values(controllers)) {
    if (down) c.down(code, at, repeat);
    else c.up(code, at);
  }
  if (!synthetic) {
    trace = history.map((i) => ({ ...i }));
    $("#replay").removeAttribute("disabled");
  }
}

function run(
  inputs: RecordedInput[],
  duration: number,
  description: string,
): void {
  reset("Identical timestamped input is replayed into both modes", true);
  replay = { inputs: inputs.map((i) => ({ ...i })), index: 0, until: duration };
  $("#scenario-description").textContent = description;
  canvas.focus({ preventScroll: true });
}
function clearInput(reason: string): void {
  const at = time();
  for (const code of [...physical]) dispatch({ at, code, down: false }, true);
  Object.values(controllers).forEach((c) => c.release(at));
  replay = null;
  log({ at, source: "system", kind: "release", note: reason });
}

document
  .querySelectorAll<HTMLInputElement>('input[name="mode"]')
  .forEach((input) => {
    input.onchange = () => {
      mode = input.value as Mode;
      log({
        at: time(),
        source: "system",
        kind: "watch",
        note: `Watching ${names[mode]}; both simulations continue`,
      });
      updateHud(time());
      canvas.focus();
    };
  });
$("#layout").onchange = () => {
  layout = $<HTMLSelectElement>("#layout").value as Layout;
  reset("Board layout changed");
  canvas.focus();
};
$("#buffer").oninput = () => {
  bufferMs = Number($<HTMLInputElement>("#buffer").value);
  $("#buffer-label").textContent = String(bufferMs);
  reset("Tap buffer changed; both modes reset");
};
$("#reset").onclick = () => {
  reset();
  canvas.focus();
};
document.querySelectorAll<HTMLButtonElement>("[data-demo]").forEach(
  (button) =>
    (button.onclick = () => {
      const s = scenarios[button.dataset.demo!];
      run(s.inputs, s.duration, s.description);
    }),
);
$("#replay").onclick = () => {
  const first = trace[0]?.at ?? 0;
  const inputs = trace.map((i) => ({ ...i, at: i.at - first + 100 }));
  const held = new Set<string>();
  for (const i of inputs)
    if (i.down) held.add(i.code);
    else held.delete(i.code);
  let end = inputs.at(-1)?.at ?? 100;
  for (const code of held) inputs.push({ at: end + 1, code, down: false });
  run(
    inputs,
    end + 650,
    "Your recorded key sequence, with its original time gaps, replayed into both controllers.",
  );
};
$("#clear-log").onclick = () => {
  logs = [];
  dirtyLog = true;
};
$("#all-events").onchange = () => {
  dirtyLog = true;
};
$("#export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          version: 1,
          layout,
          bufferMs,
          tileMs: 170,
          watchedMode: mode,
          inputs: history,
          events: [...logs].sort((a, b) => a.at - b.at),
          snapshots: {
            current: controllers.current.snapshot(),
            precision: controllers.precision.snapshot(),
          },
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "brain-bombs-controls.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if ((event.target as HTMLElement).closest("input, select, textarea")) return;
  if (event.code === "KeyR") {
    event.preventDefault();
    if (!event.repeat) reset();
    canvas.focus();
    return;
  }
  if (!keyDirections[event.code]) return;
  event.preventDefault();
  if (replay) clearInput("Manual input interrupted replay");
  delivery = `${Math.max(0, performance.now() - event.timeStamp).toFixed(1)} ms`;
  dispatch({
    at: time(),
    code: event.code,
    down: true,
    repeat: event.repeat || physical.has(event.code),
  });
});
window.addEventListener("keyup", (event) => {
  if (!keyDirections[event.code] || !physical.has(event.code)) return;
  event.preventDefault();
  dispatch({ at: time(), code: event.code, down: false });
});
canvas.onpointerdown = () => canvas.focus({ preventScroll: true });
window.addEventListener("blur", () =>
  clearInput("Window lost focus; all held keys and pending taps cleared"),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInput("Tab hidden; clocks suspended");
    clock = time();
    suspended = true;
  } else {
    suspended = false;
    anchor = lastFrame = performance.now();
    log({
      at: clock,
      source: "system",
      kind: "resume",
      note: "Tab visible; no catch-up movement",
    });
  }
});

function drawPlayer(s: Snapshot, ghost: boolean, colour: string): void {
  const size = 114,
    x = 40 + (s.visual.x + 0.5) * size,
    y = 40 + (s.visual.y + 0.5) * size;
  ctx.save();
  ctx.translate(x, y);
  if (ghost) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(-30, -30, 60, 60);
  } else {
    ctx.fillStyle = `${colour}24`;
    ctx.beginPath();
    ctx.ellipse(0, 22, 33, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sprite.complete && sprite.naturalWidth)
      ctx.drawImage(sprite, -38, -42, 76, 80);
    else {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 3, 38, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
function draw(at: number): void {
  ctx.clearRect(0, 0, 650, 650);
  ctx.fillStyle = "#0b171d";
  ctx.fillRect(0, 0, 650, 650);
  const selected = controllers[mode].snapshot(),
    otherMode = mode === "current" ? "precision" : "current";
  ctx.font = "13px system-ui";
  ctx.textAlign = "center";
  for (let n = 0; n < 5; n++) {
    ctx.fillStyle = "#79939b";
    ctx.fillText(String(n), 97 + n * 114, 25);
    ctx.fillText(String(n), 20, 103 + n * 114);
  }
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 5; x++) {
      ctx.fillStyle = map[y][x]
        ? "#51636f"
        : (x + y) % 2
          ? "#152c34"
          : "#19323a";
      ctx.beginPath();
      ctx.roundRect(43 + x * 114, 43 + y * 114, 108, 108, 8);
      ctx.fill();
      ctx.fillStyle = map[y][x] ? "#8da1ad" : "#38555b";
      ctx.beginPath();
      ctx.arc(97 + x * 114, 97 + y * 114, map[y][x] ? 6 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.strokeStyle = "#69e2c3";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(
    48 + selected.cell.x * 114,
    48 + selected.cell.y * 114,
    98,
    98,
  );
  ctx.setLineDash([]);
  if ($<HTMLInputElement>("#ghost").checked)
    drawPlayer(controllers[otherMode].snapshot(), true, "#edb278");
  drawPlayer(selected, false, "#69e2c3");
  for (const source of ["current", "precision"] as Mode[]) {
    const pending = stats[source].pendingDraw,
      visual = controllers[source].snapshot().visual;
    if (
      pending &&
      Math.hypot(visual.x - pending.visual.x, visual.y - pending.visual.y) >
        0.001
    ) {
      stats[source].drawn.push(at - pending.intentAt);
      log({
        source,
        at,
        kind: "drawn",
        note: `${(at - pending.intentAt).toFixed(1)} ms from input to first changed canvas frame`,
      });
      stats[source].pendingDraw = undefined;
    } else if (
      pending &&
      !controllers[source].snapshot().moving &&
      at > pending.at
    ) {
      log({
        source,
        at,
        kind: "not-drawn",
        note: "Movement resolved between frames without a visible displacement",
      });
      stats[source].pendingDraw = undefined;
    }
  }
}

const logRows = new Map<LogEntry, HTMLTableRowElement>();
function renderLog(): void {
  if (!dirtyLog) return;
  dirtyLog = false;
  const body = $("#log");
  const both = $<HTMLInputElement>("#all-events").checked;
  const entries = logs
    .filter(
      (e) =>
        both ||
        e.source === mode ||
        e.source === "input" ||
        e.source === "system",
    )
    .sort((a, b) => a.at - b.at)
    .slice(-350);
  const wanted = new Set(entries);
  for (const [entry, row] of logRows)
    if (!wanted.has(entry)) {
      row.remove();
      logRows.delete(entry);
    }
  entries.forEach((entry, index) => {
    const existing = logRows.get(entry);
    if (existing) {
      if (body.children[index] !== existing)
        body.insertBefore(existing, body.children[index] ?? null);
      return;
    }
    const row = document.createElement("tr");
    row.dataset.source = entry.source;
    const values = [
      entry.at.toFixed(1),
      entry.source === "input"
        ? "Keyboard"
        : entry.source === "system"
          ? "Lab"
          : names[entry.source],
      entry.kind,
      entry.code
        ? label(entry.code)
        : entry.direction
          ? arrows[entry.direction]
          : "—",
      entry.note,
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    logRows.set(entry, row);
    body.insertBefore(row, body.children[index] ?? null);
  });
  $("#recent-events").replaceChildren(
    ...entries.slice(-7).map((entry) => {
      const row = document.createElement("div");
      row.dataset.source = entry.source;
      row.title = entry.note;
      for (const value of [
        entry.at.toFixed(0),
        entry.source === "input"
          ? "Key"
          : entry.source === "system"
            ? "Lab"
            : names[entry.source],
        `${entry.kind} ${entry.code ? label(entry.code) : entry.direction ? arrows[entry.direction] : ""}`,
      ]) {
        const span = document.createElement("span");
        span.textContent = value;
        row.append(span);
      }
      return row;
    }),
  );
  if ($<HTMLInputElement>("#follow").checked)
    $("#log-scroll").scrollTop = $("#log-scroll").scrollHeight;
}
function summary(values: number[]): string {
  if (!values.length) return "—";
  const sorted = [...values].sort((a, b) => a - b);
  return `${values.at(-1)!.toFixed(1)} / ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} / ${sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1)} ms`;
}
function updateKeys(): void {
  document
    .querySelectorAll<HTMLElement>("[data-key]")
    .forEach((k) => k.classList.toggle("down", physical.has(k.dataset.key!)));
  $("#held-text").textContent = [...physical].map(label).join(" + ") || "None";
}
function updateHud(at: number): void {
  const s = controllers[mode].snapshot();
  $("#mode-title").textContent = $("#state-mode").textContent = names[mode];
  $("#clock").textContent = `${at.toFixed(0)} ms`;
  $("#fps").textContent = `${(1000 / frameAverage).toFixed(0)} fps`;
  $("#delivery").textContent = `Browser delivery: ${delivery}`;
  $("#recording").textContent = replay ? "REPLAYING" : "LIVE INPUT";
  $("#input-status").textContent = replay
    ? "Exact same timestamped inputs → both modes"
    : document.activeElement === canvas
      ? "Listening · arrows / WASD · R to reset"
      : "Click the board, then use arrows or WASD";
  updateKeys();
  $("#cell").textContent = point(s.cell);
  $("#visual").textContent = point(s.visual);
  $("#phase").textContent =
    `${s.direction ? arrows[s.direction] : "—"} · ${s.moving ? "Moving" : "At centre"}`;
  $<HTMLProgressElement>("#progress").value = s.progress;
  $("#progress-text").textContent = `${Math.round(s.progress * 100)}%`;
  $("#queue").replaceChildren(
    ...s.queue.map((i) => {
      const chip = document.createElement("span");
      chip.textContent = `${arrows[i.direction]} #${i.id} · ${Math.max(0, i.expires - at).toFixed(0)} ms left`;
      return chip;
    }),
  );
  if (!s.queue.length) $("#queue").textContent = "Empty";
  $("#comparison").innerHTML = (["current", "precision"] as Mode[])
    .map((source) => {
      const st = stats[source],
        snap = controllers[source].snapshot();
      return `<article class="${source === mode ? "selected" : ""}" data-comparison="${source}"><h3>${names[source]}</h3><strong>(${point(snap.visual)})</strong><p>${st.moves} starts · ${st.reversals} reversals · ${st.dropped} discarded</p><dl><dt>Start: last / avg / p95</dt><dd>${summary(st.latencies)}</dd><dt>First drawn: last / avg / p95</dt><dd>${summary(st.drawn)}</dd></dl></article>`;
    })
    .join("");
  renderLog();
}

function frame(_rafTimestamp: number): void {
  const now = performance.now();
  if (!suspended) {
    const at = clock + now - anchor;
    if (replay) {
      while (
        replay.index < replay.inputs.length &&
        replay.inputs[replay.index].at <= at
      )
        dispatch(replay.inputs[replay.index++], true);
      if (at >= replay.until) {
        log({
          at,
          source: "system",
          kind: "replay-end",
          note: "Replay complete. Switch modes to inspect the same result.",
        });
        replay = null;
      }
    }
    Object.values(controllers).forEach((c) => c.frame(at));
    frameAverage = frameAverage * 0.9 + (now - lastFrame) * 0.1;
    draw(at);
    if (at - lastHud > 65) {
      updateHud(at);
      lastHud = at;
    }
    clock = at;
    anchor = now;
  }
  lastFrame = now;
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
