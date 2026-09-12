import "./style.css";
import { Engine } from "./game/engine";
import { ARENAS, arenaInfo, makeArena, type ArenaId } from "./game/arenas";
import { predictHazards, nextHazard } from "./game/hazards";
import { Bot } from "./game/bot";
import { Renderer } from "./game/renderer";
import { GameAudio } from "./ui/audio";
import { FeedbackTracker } from "./game/feedback";
import { Session, type NetworkEvent } from "./network/session";
import {
  YEARS,
  BRAINS_PER_UPGRADE,
  MAX_RANGE,
  yearLabel,
  type Action,
  type Direction,
  type PlayerId,
  type Profile,
  type View,
} from "./game/types";

const asset = (name: string) =>
  `${import.meta.env.BASE_URL}sprites/${name}.webp`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icons: Record<string, string> = {
  sound:
    '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  music:
    '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  muted: '<path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.5.9-1.7 1.2-1.7 2.7m0 3h.01"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

$("#app").innerHTML = `
<main class="game-frame" id="game-frame">
  <header class="topbar">
    <button class="brand" id="brand" aria-label="Brain Bombs 2 menu"><img src="${asset("bomb")}" alt=""/><span>BRAIN BOMBS <b>2</b></span></button>
    <div class="topbar-middle"><span class="mode-dot"></span><span id="mode-label">THE THINK-FAST ARENA</span></div>
    <nav class="toolbar" aria-label="Game controls">
      <button class="icon-button" id="sound" aria-label="Turn sound on" title="Turn sound on">${icon("muted")}</button>
      <button class="icon-button" id="music" aria-label="Mute music" title="Mute music">${icon("music")}</button>
      <button class="icon-button" id="help" aria-label="How to play" title="How to play">${icon("help")}</button>
      <button class="icon-button" id="fullscreen" aria-label="Full screen" title="Full screen">${icon("fullscreen")}</button>
      <button class="icon-button" id="pause" aria-label="Pause or leave game" title="Pause or leave game" hidden>${icon("pause")}</button>
    </nav>
  </header>
  <section class="scoreboard" aria-label="Match status">
    <div class="player-stat teal"><img src="${asset("player-teal")}" alt="Teal player"/><div><span class="eyebrow" id="player0-role">PLAYER 1</span><strong id="player0-name">You</strong><span class="player-details"><span><img src="${asset("bomb")}" alt="Bombs"/><b id="player0-bombs">0</b></span><span><img src="${asset("fire")}" alt="Flame reach"/><b id="player0-range">2</b></span><span class="life-count" id="player0-lives" aria-label="3 lives">♥♥♥</span></span></div><div class="round-dots" id="wins0" aria-label="0 rounds won"></div></div>
    <div class="timer"><span id="round-label">READY TO RUMBLE?</span><strong id="time">00<span>:</span>00</strong><small id="timer-caption">FIRST TO 3 WINS</small></div>
    <div class="player-stat coral"><div class="round-dots" id="wins1" aria-label="0 rounds won"></div><div><span class="eyebrow" id="player1-role">PLAYER 2</span><strong id="player1-name">Professor Byte</strong><span class="player-details"><span class="life-count" id="player1-lives" aria-label="3 lives">♥♥♥</span><span><img src="${asset("bomb")}" alt="Bombs"/><b id="player1-bombs">0</b></span><span><img src="${asset("fire")}" alt="Flame reach"/><b id="player1-range">2</b></span></span></div><img src="${asset("player-coral")}" alt="Coral player"/></div>
  </section>
  <div class="play-layout">
    <section class="arena-section" aria-label="Game arena">
      <div class="arena-heading"><span><b class="arena-light"></b> <span id="arena-name">CIRCUIT GARDEN</span></span><span id="arena-status">15 × 11 ARENA</span></div>
      <div class="canvas-wrap"><canvas id="arena" tabindex="0" aria-label="Brain Bombs arena. Move with arrow keys or W A S D. Walk into a brain to answer its question. Space places a bomb."></canvas><div class="arena-banner" id="arena-banner" hidden></div><div class="danger-banner" id="danger-banner" role="status" hidden>Blast incoming — move now!</div></div>
      <div class="arena-bottom"><span><i class="private-dot"></i> Only you can see your brains</span><span id="arena-tip">A little maths. A lot of mayhem.</span></div>
      <div class="touch-controls" aria-label="Touch game controls"><div class="dpad"><button data-dir="up" aria-label="Move up">↑</button><button data-dir="left" aria-label="Move left">←</button><button data-dir="down" aria-label="Move down">↓</button><button data-dir="right" aria-label="Move right">→</button></div><button class="touch-bomb" id="touch-bomb"><img src="${asset("bomb")}" alt=""/> Drop bomb</button></div>
    </section>
    <aside class="side-panel" id="side-panel"></aside>
  </div>
  <footer class="control-bar"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><i> / </i><span class="arrow-keys">↑ ← ↓ →</span> <b>Move</b></span><span><kbd class="wide">SPACE</kbd> <b>Drop bomb</b></span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> <b>Answer</b></span><span class="footer-note">THINK. DROP. DODGE.</span></footer>
  <div class="modal-backdrop" id="modal" hidden></div>
</main>`;

let engine: Engine | undefined;
let view: View;
let bot: Bot | undefined;
let local: PlayerId = 0;
let mode: "menu" | "cpu" | "online" = "menu";
let screen: "menu" | "lobby" | "game" = "menu";
let paused = false;
let lost = false;
let round = 1;
let wins = [0, 0];
let countedEnd = false;
let awaitingRematch = false;
let resultTimer: ReturnType<typeof setTimeout> | undefined;
let lastActive: number | null = null;
let currentPanel = "";
let modalKind = "";
let previousFocus: HTMLElement | null = null;
let profiles: [Profile, Profile];
let held: Direction[] = [];
let lastSent = 0;
let lastDirection: Direction | null = null;
let lastCountdown = "";
let awaitingView = false;
const audio = new GameAudio();
const feedbackTracker = new FeedbackTracker();
const renderer = new Renderer($("#arena"));
const session = new Session(onNetwork);

function loadPreference(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`bb2:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePreference(key: string, value: string): void {
  try {
    localStorage.setItem(`bb2:${key}`, value);
  } catch {
    /* Restricted storage does not block play. */
  }
}
let profile: Profile = {
  name: loadPreference("name", "Brainiac").slice(0, 20),
  year: YEARS.includes(loadPreference("year", "year3") as Profile["year"])
    ? (loadPreference("year", "year3") as Profile["year"])
    : "year3",
};
let botPace = loadPreference("bot", "chill") === "clever" ? "clever" : "chill";
let selectedArena: ArenaId = arenaInfo(
  loadPreference("arena", "garden") as ArenaId,
).id;
let rotateArenas = loadPreference("rotate", "true") === "true";
audio.muted = loadPreference("muted", "false") === "true";
audio.musicEnabled = loadPreference("music", "true") === "true";
updateSound();
let preview = new Engine(
  [
    { name: profile.name, year: profile.year },
    { name: "Professor Byte", year: profile.year },
  ],
  8146,
  undefined,
  selectedArena,
);
// The menu shows the actual board renderer, without running a hidden match.
preview.players[0].x = 3;
preview.players[0].y = 3;
preview.players[1].x = 11;
preview.players[1].y = 7;
view = preview.view(0);
showMenu();
void renderer.ready.catch((error) =>
  showError(
    error instanceof Error
      ? error.message
      : "Artwork could not load. Refresh to try again.",
  ),
);

function readProfile(): void {
  profile = {
    name: $("#player-name").isConnected
      ? $<HTMLInputElement>("#player-name").value.trim().slice(0, 20) ||
        "Brainiac"
      : profile.name,
    year: $<HTMLSelectElement>("#year-level").value as Profile["year"],
  };
  botPace = $<HTMLSelectElement>("#bot-level").value;
  savePreference("name", profile.name);
  savePreference("year", profile.year);
  savePreference("bot", botPace);
}

function showMenu(): void {
  clearTimeout(resultTimer);
  audio.setActive(false);
  feedbackTracker.reset();
  session.close();
  mode = "menu";
  screen = "menu";
  engine = undefined;
  bot = undefined;
  paused = false;
  lost = false;
  held = [];
  local = 0;
  wins = [0, 0];
  round = 1;
  countedEnd = false;
  awaitingRematch = false;
  awaitingView = false;
  currentPanel = "";
  closeModal();
  renderer.reset();
  view = preview.view(0);
  $("#pause").hidden = true;
  $("#mode-label").textContent = "THE THINK-FAST ARENA";
  $("#game-frame").classList.add("in-menu");
  $("#arena-status").textContent = "15 × 11 ARENA";
  $("#arena-tip").textContent = "A little maths. A lot of mayhem.";
  $("#arena-banner").hidden = true;
  $("#danger-banner").hidden = true;
  $(".canvas-wrap").classList.remove("in-danger");
  $("#side-panel").innerHTML = `
    <div class="menu-intro"><span class="eyebrow">TWO PLAYERS. ONE SURVIVOR.</span><h1>BRAIN<br/><span>BOMBS</span><b>2</b></h1><p>Solve maths. Earn bombs.<br/>Outsmart your opponent.</p></div>
    <div class="setup-fields"><label for="player-name">YOUR NAME</label><input id="player-name" maxlength="20" value="${escapeHtml(profile.name)}" autocomplete="nickname"/>
    <div class="field-pair"><div><label for="year-level">YOUR MATHS LEVEL</label><select id="year-level">${YEARS.map((y) => `<option value="${y}" ${y === profile.year ? "selected" : ""}>${yearLabel(y)}</option>`).join("")}</select></div><div><label for="bot-level">COMPUTER</label><select id="bot-level"><option value="chill" ${botPace === "chill" ? "selected" : ""}>Chill</option><option value="clever" ${botPace === "clever" ? "selected" : ""}>Clever</option></select></div></div>
    <div class="arena-choice"><label>YOUR FIRST ARENA</label><div class="arena-options" role="group" aria-label="Starting arena">${ARENAS.map((a) => `<button type="button" data-arena="${a.id}" aria-label="${a.name}: ${a.description}" aria-pressed="${a.id === selectedArena}" style="--arena-accent:${a.accent}">${arenaThumbnail(a.id)}<span>${a.name.split(" ").at(-1) === "Garden" ? "Garden" : a.id === "ember" ? "Ember" : "Neon"}</span></button>`).join("")}</div><label class="rotate-option"><input type="checkbox" id="rotate-arenas" ${rotateArenas ? "checked" : ""}/> New arena each round</label></div></div>
    <div class="mode-actions"><button class="primary" id="play-cpu">Play the computer ${icon("arrow")}</button><div class="friend-actions"><button class="secondary" id="create-room">Create room</button><button class="secondary" id="join-room">Join a friend</button></div></div>
    <p class="menu-note">Play a friend on another computer.<br/>Each player chooses their own maths level.</p>
    <div class="inline-status" id="menu-status" role="status"></div>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-arena]")
    .forEach((button) => {
      button.onclick = () => {
        selectedArena = button.dataset.arena as ArenaId;
        savePreference("arena", selectedArena);
        document
          .querySelectorAll("[data-arena]")
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              String((b as HTMLElement).dataset.arena === selectedArena),
            ),
          );
        updatePreview();
        audio.play("click");
      };
    });
  $("#rotate-arenas").onchange = () => {
    rotateArenas = $<HTMLInputElement>("#rotate-arenas").checked;
    savePreference("rotate", String(rotateArenas));
  };
  updatePreview();
  $("#play-cpu").onclick = () => {
    readProfile();
    audio.unlock();
    startCpu();
  };
  $("#create-room").onclick = () => {
    readProfile();
    mode = "online";
    local = 0;
    showLobby(true);
    session.open("host", profile);
  };
  $("#join-room").onclick = () => {
    readProfile();
    showModal(
      "join",
      `<span class="eyebrow">BETTER WITH A FRIEND</span><h2>Join their arena</h2><p>Ask your friend to create a room, then enter their four-character code.</p><form id="join-form"><label for="room-code">ROOM CODE</label><input id="room-code" class="code-input" maxlength="4" minlength="4" pattern="[A-Za-z2-9]{4}" placeholder="ABCD" autocomplete="off" required/><button class="primary" type="submit">Join room ${icon("arrow")}</button></form><button class="text-button" id="join-back">Back</button>`,
    );
    $("#join-back").onclick = closeModal;
    $("#join-form").onsubmit = (e) => {
      e.preventDefault();
      const code = $<HTMLInputElement>("#room-code").value.trim().toUpperCase();
      closeModal();
      mode = "online";
      local = 1;
      showLobby(false);
      session.open("guest", profile, code);
    };
    $("#room-code").focus();
  };
  renderHud();
}

function arenaThumbnail(id: ArenaId): string {
  const theme = arenaInfo(id);
  const cells = makeArena(id, () => 0.45)
    .flatMap((row, y) =>
      row.map(
        (tile, x) =>
          `<rect x="${x * 3}" y="${y * 3}" width="2.5" height="2.5" rx=".4" fill="${tile === 1 ? theme.accent : tile === 2 ? "#c39571" : theme.floor[0]}"/>`,
      ),
    )
    .join("");
  return `<svg viewBox="0 0 45 33" aria-hidden="true">${cells}</svg>`;
}

function updatePreview(): void {
  preview = new Engine(
    [profile, { name: "Professor Byte", year: profile.year }],
    8146,
    undefined,
    selectedArena,
  );
  Object.assign(preview.players[0], { x: 3, y: 3 });
  Object.assign(preview.players[1], { x: 11, y: 7 });
  view = preview.view(0);
  renderer.reset();
  renderArena();
}

function renderArena(): void {
  const theme = arenaInfo(view.arena);
  $("#arena-name").textContent = theme.name.toUpperCase();
  $(".arena-light").style.background = theme.accent;
  $(".canvas-wrap").style.setProperty("--arena-accent", theme.accent);
  if (screen === "menu") $("#arena-status").textContent = theme.tag;
  if (screen === "menu") $("#arena-tip").textContent = theme.description;
}

function showLobby(host: boolean): void {
  screen = "lobby";
  $("#game-frame").classList.add("in-menu");
  $("#side-panel").innerHTML =
    `<div class="lobby-head"><img src="${asset(host ? "player-teal" : "player-coral")}" alt="Your robot"/><span class="eyebrow">YOU ARE ${host ? "TEAL" : "CORAL"}</span><h2>${host ? "Invite a brain" : "Joining the arena"}</h2><p>Share this code with your friend.</p></div>
    <button class="room-code" id="copy-code" title="Copy room code" disabled><span id="invite-code">····</span><small id="copy-label">COPY CODE</small></button>
    <div class="lobby-players" id="lobby-players"><span>${escapeHtml(profile.name)} <small>${yearLabel(profile.year)}</small></span><span class="waiting-player">Waiting for a friend…</span></div>
    <p class="connection-status" id="connection-status" role="status">Connecting…</p><button class="primary" id="start-online" ${host ? "" : "hidden"} disabled>Start battle ${icon("arrow")}</button><button class="text-button" id="lobby-back">${icon("back")} Back to menu</button>`;
  $("#lobby-back").onclick = showMenu;
  $("#start-online").onclick = () => {
    audio.unlock();
    session.start();
  };
  $("#copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText(session.code);
      $("#copy-label").textContent = "COPIED!";
    } catch {
      $("#copy-label").textContent = "SELECT THE CODE TO COPY";
    }
  };
}

function startCpu(): void {
  profiles = [profile, { name: "Professor Byte", year: profile.year }];
  mode = "cpu";
  local = 0;
  wins = [0, 0];
  round = 1;
  startRound();
}

function startRound(): void {
  clearTimeout(resultTimer);
  closeModal();
  held = [];
  lastDirection = null;
  lastSent = 0;
  if (mode === "cpu" || session.role === "host") {
    const first = ARENAS.findIndex((arena) => arena.id === selectedArena);
    const arena =
      ARENAS[(first + (rotateArenas ? round - 1 : 0)) % ARENAS.length].id;
    engine = new Engine(profiles, Date.now(), undefined, arena, 3);
  }
  bot = mode === "cpu" ? new Bot(botPace as "chill" | "clever") : undefined;
  if (engine) view = engine.view(local);
  awaitingView = !engine;
  screen = "game";
  paused = false;
  lost = false;
  countedEnd = false;
  awaitingRematch = false;
  currentPanel = "";
  lastActive = null;
  feedbackTracker.reset(engine ? view : undefined);
  renderer.reset();
  lastCountdown = "";
  $("#game-frame").classList.remove("in-menu");
  $("#pause").hidden = false;
  $("#arena-banner").hidden = true;
  $("#mode-label").textContent =
    mode === "cpu"
      ? `VS COMPUTER · ${botPace.toUpperCase()}`
      : `ONLINE · ROOM ${session.code}`;
  $("#arena-tip").textContent = "Watch the fuse. Plan your escape.";
  $("#arena-status").textContent =
    mode === "online" ? "CONNECTED" : "LOCAL MATCH";
  audio.unlock();
  $("#arena").focus();
  renderHud();
  renderSide();
}

function onNetwork(event: NetworkEvent): void {
  if (event.kind === "status") {
    const status = document.querySelector("#connection-status");
    if (status) status.textContent = event.text;
  }
  if (event.kind === "ready") {
    $("#invite-code").textContent = event.code;
    $<HTMLButtonElement>("#copy-code").disabled = false;
  }
  if (event.kind === "joined") {
    profiles = event.profiles;
    $("#invite-code").textContent = session.code;
    $<HTMLButtonElement>("#copy-code").disabled = false;
    $("#lobby-players").innerHTML = profiles
      .map(
        (p, i) =>
          `<span class="${i ? "coral-text" : "teal-text"}">${escapeHtml(p.name)} ${i === local ? "<b>YOU</b>" : ""}<small>${yearLabel(p.year)}</small></span>`,
      )
      .join("");
    $("#connection-status").textContent =
      session.role === "host"
        ? "Both brains are here. Ready when you are."
        : "Connected. Your friend will start the battle.";
    $<HTMLButtonElement>("#start-online").disabled = false;
    renderHud();
  }
  if (event.kind === "start") {
    if (screen === "game") {
      if (Math.max(...wins) >= 3) {
        wins = [0, 0];
        round = 1;
      } else round++;
    } else {
      wins = [0, 0];
      round = 1;
    }
    profiles = event.profiles;
    startRound();
  }
  if (event.kind === "view") {
    if (!lost && screen === "game") {
      awaitingView = false;
      view = event.view;
      afterView();
    }
  }
  if (event.kind === "action" && !lost) engine?.act(1, event.action);
  if (event.kind === "rematch" && view.phase === "ended") {
    awaitingRematch = true;
    const note = document.querySelector("#rematch-status");
    if (note) note.textContent = "Your friend is ready for the next round.";
  }
  if (event.kind === "lost") {
    lost = true;
    clearTimeout(resultTimer);
    audio.setActive(false);
    held = [];
    $("#arena-status").textContent = "DISCONNECTED";
    engine?.act(0, { type: "move", direction: null });
    if (screen === "game") {
      showModal(
        "lost",
        `<span class="eyebrow">CONNECTION LOST</span><h2>Battle interrupted</h2><p>${escapeHtml(event.text)}</p><button class="primary" id="lost-menu">Back to menu</button>`,
      );
      $("#lost-menu").onclick = showMenu;
    } else {
      showMenu();
      $("#menu-status").textContent = event.text;
    }
  }
}

function act(action: Action): void {
  if (screen !== "game" || paused || lost || view.phase === "ended") return;
  if (mode === "online" && session.role === "guest") session.sendAction(action);
  else engine?.act(local, action);
}

function renderHud(): void {
  renderArena();
  renderCountdown();
  for (const p of view.players) {
    $(`#player${p.id}-name`).textContent =
      screen === "menu"
        ? p.id
          ? "Professor Byte"
          : profile.name
        : profiles?.[p.id].name || p.name;
    $(`#player${p.id}-role`).textContent =
      screen === "menu"
        ? p.id
          ? "OPPONENT"
          : "YOU · TEAL"
        : `${p.id === local ? "YOU" : mode === "cpu" ? "COMPUTER" : "OPPONENT"} · ${p.id ? "CORAL" : "TEAL"}`;
    $(`#player${p.id}-bombs`).textContent = String(p.bombs);
    $(`#player${p.id}-range`).textContent = String(p.range);
    const lives = $(`#player${p.id}-lives`);
    lives.textContent = "♥".repeat(p.lives) + "♡".repeat(3 - p.lives);
    lives.setAttribute(
      "aria-label",
      `${p.lives} ${p.lives === 1 ? "life" : "lives"} remaining`,
    );
    $(`#wins${p.id}`).innerHTML = Array.from(
      { length: 3 },
      (_, i) => `<i class="${i < wins[p.id] ? "won" : ""}"></i>`,
    ).join("");
    $(`#wins${p.id}`).setAttribute("aria-label", `${wins[p.id]} rounds won`);
  }
  const sec = Math.floor(view.time);
  $("#time").innerHTML =
    `${String(Math.floor(sec / 60)).padStart(2, "0")}<span>:</span>${String(sec % 60).padStart(2, "0")}`;
  $("#round-label").textContent =
    screen === "game"
      ? `ROUND ${String(round).padStart(2, "0")}`
      : "READY TO RUMBLE?";
  $("#timer-caption").textContent = "FIRST TO 3 WINS";
}

function renderCountdown(): void {
  const banner = $("#arena-banner");
  if (screen === "game" && awaitingView && !lost) {
    banner.hidden = false;
    banner.innerHTML =
      '<div class="round-intro"><small>GET READY</small><p>Loading your friend’s arena…</p></div>';
    return;
  }
  const visible =
    screen === "game" &&
    !lost &&
    view.phase === "playing" &&
    (view.readyIn > 0 || view.time < 0.6);
  banner.hidden = !visible;
  if (!visible) return;
  const count = view.readyIn > 0 ? String(Math.ceil(view.readyIn)) : "GO!";
  if (count === lastCountdown) return;
  lastCountdown = count;
  const theme = arenaInfo(view.arena);
  banner.innerHTML = `<div class="round-intro"><span>ROUND ${String(round).padStart(2, "0")} · ${theme.name.toUpperCase()}</span><strong>${count}</strong><small class="${local ? "coral-text" : "teal-text"}">YOU ARE ${local ? "CORAL" : "TEAL"}</small><p>${count === "GO!" ? "THINK. DROP. DODGE." : "Find a brain. Earn your first bomb."}</p></div>`;
  audio.play(count === "GO!" ? "start" : "click");
}

function powerProgress(): string {
  return `<div class="brain-power"><div class="power-heading"><span>BRAIN POWER</span><strong id="power-label"></strong></div><div class="power-track" id="power-progress" role="progressbar" aria-label="Brains toward next flame upgrade" aria-valuemin="0" aria-valuemax="${BRAINS_PER_UPGRADE}">${Array.from({ length: BRAINS_PER_UPGRADE }, () => "<i></i>").join("")}</div><p id="power-note"></p></div>`;
}

function renderSide(): void {
  if (screen !== "game") return;
  const p = view.players[local],
    brain = view.brains.find((b) => b.id === view.activeBrain);
  const panelKey = brain
    ? `brain:${brain.id}:${brain.rejected.join(",")}`
    : "idle";
  if (currentPanel !== panelKey) {
    currentPanel = panelKey;
    if (brain) {
      $("#side-panel").innerHTML =
        `<div class="question-top"><span class="eyebrow pink-text">BRAIN FOUND</span><span class="reward">+1 <img src="${asset("bomb")}" alt="bomb"/></span></div>
        <div class="question-art"><img src="${asset("brain")}" alt="Pink brain"/></div><span class="question-level">${yearLabel(p.year)} · YOUR QUESTION</span>
        <h2 class="question-expression">${escapeHtml(brain.expression)}</h2><p class="question-instruction">Choose the correct answer</p>
        <div class="answer-options">${brain.choices.map((choice, i) => `<button class="answer ${brain.rejected.includes(i) ? "rejected" : ""}" data-answer="${i}" ${brain.rejected.includes(i) ? "disabled" : ""}><kbd>${i + 1}</kbd><span>${escapeHtml(choice)}</span>${brain.rejected.includes(i) ? "<i>×</i>" : ""}</button>`).join("")}</div>
        <p class="live-note" id="question-live"><span></span> The arena is still live!</p><button class="text-button" id="dismiss-question">Move away or press <kbd>ESC</kbd></button>
        ${powerProgress()}<div class="feedback" id="feedback" role="status"></div>`;
      document.querySelectorAll<HTMLButtonElement>("[data-answer]").forEach(
        (button) =>
          (button.onclick = () => {
            act({
              type: "answer",
              brain: brain.id,
              choice: Number(button.dataset.answer),
            });
            $("#arena").focus();
          }),
      );
      $("#dismiss-question").onclick = () => {
        act({ type: "dismiss" });
        $("#arena").focus();
      };
    } else {
      $("#side-panel").innerHTML =
        `<div class="loadout-title"><span class="eyebrow">YOUR LOADOUT</span><span class="player-chip ${local ? "coral-chip" : ""}">${local ? "CORAL" : "TEAL"}</span></div>
        <div class="arsenal"><img src="${asset("bomb")}" alt=""/><div><strong id="arsenal-count">${p.bombs}</strong><span>BOMBS READY</span></div></div>
        <button class="primary drop-button" id="drop-bomb">Drop a bomb <kbd>SPACE</kbd></button>
        <div class="loadout-stats"><div><img src="${asset("fire")}" alt=""/><span>Flame reach<strong id="flame-stat">${p.range} tiles</strong></span></div><div><img src="${asset("speed")}" alt=""/><span>Speed<strong id="speed-stat">${p.speed ? `+${p.speed}` : "Normal"}</strong></span></div></div>
        <div class="brain-prompt"><img src="${asset("brain")}" alt=""/><h2>Feed your firepower.</h2><p>Walk into a pink brain.<br/>Solve its question. Earn a bomb.</p><span class="solved-count" id="solved-count">${p.solved} brains solved</span></div>
        ${powerProgress()}<div class="feedback" id="feedback" role="status"></div>
        <div class="pickup-tip"><img src="${asset("crate")}" alt=""/><span>Blast crates to find flame<br/>and speed power-ups.</span></div>`;
      $("#drop-bomb").onclick = () => {
        act({ type: "bomb" });
        $("#arena").focus();
      };
    }
  }
  if (!brain) {
    $("#arsenal-count").textContent = String(p.bombs);
    $("#flame-stat").textContent = `${p.range} tiles`;
    $("#speed-stat").textContent = p.speed ? `+${p.speed}` : "Normal";
    $("#solved-count").textContent =
      `${p.solved} brain${p.solved === 1 ? "" : "s"} solved`;
    $("#drop-bomb").classList.toggle("empty", p.bombs === 0);
  }
  const maxed = p.range >= MAX_RANGE;
  const progress = maxed ? BRAINS_PER_UPGRADE : p.solved % BRAINS_PER_UPGRADE;
  $("#power-label").textContent = maxed
    ? "MAX REACH"
    : `${progress} / ${BRAINS_PER_UPGRADE}`;
  $("#power-progress").setAttribute("aria-valuenow", String(progress));
  const toGo = BRAINS_PER_UPGRADE - progress;
  $("#power-progress").setAttribute(
    "aria-valuetext",
    maxed ? "Maximum flame reach" : `${toGo} more brains for a flame upgrade`,
  );
  $("#power-progress")
    .querySelectorAll("i")
    .forEach((pip, i) => pip.classList.toggle("filled", i < progress));
  $("#power-note").textContent = maxed
    ? "Keep solving. Every brain still earns a bomb."
    : toGo === 1
      ? "Next brain = bigger blasts!"
      : `${toGo} more brains → +1 tile of flame reach`;
  const danger = nextHazard(predictHazards(view), p, view.time);
  const threatened = !!danger && p.alive && view.phase === "playing";
  $("#danger-banner").hidden = !threatened;
  $("#danger-banner").textContent = "Blast incoming — move now!";
  $(".canvas-wrap").classList.toggle("in-danger", threatened);
  const live = document.querySelector("#question-live");
  if (live) {
    live.textContent = threatened
      ? "Move now! Your question will wait."
      : "The arena is still live!";
    live.classList.toggle("danger", threatened);
  }
  const feedback = $("#feedback");
  const text = view.time - view.feedback.at < 5 ? view.feedback.text : "";
  if (feedback.textContent !== text) feedback.textContent = text;
  feedback.className = `feedback ${view.feedback.kind}`;
}

function afterView(): void {
  if (view.activeBrain !== lastActive) {
    if (view.activeBrain !== null) {
      held = [];
      lastDirection = null;
      act({ type: "move", direction: null });
    }
    lastActive = view.activeBrain;
  }
  const events = feedbackTracker.consume(view, local);
  if (!document.hidden) renderer.react(events, view, local);
  audio.react(events, view, local);
  renderHud();
  renderSide();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (events.solved || events.upgraded) {
      document
        .querySelector(local ? ".player-stat.coral" : ".player-stat.teal")
        ?.animate(
          [
            { filter: "brightness(1)" },
            { filter: "brightness(1.8)", transform: "scale(1.035)" },
            { filter: "brightness(1)" },
          ],
          { duration: 420, easing: "ease-out" },
        );
    }
    if (events.wrong)
      document
        .querySelector(".answer-options")
        ?.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(4px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 220 },
        );
  }
  if (view.phase === "ended" && !countedEnd) {
    countedEnd = true;
    held = [];
    if (view.winner !== null) wins[view.winner]++;
    audio.setActive(false);
    audio.play(view.winner === local ? "win" : "lose");
    renderHud();
    resultTimer = setTimeout(() => {
      if (screen === "game" && view.phase === "ended" && !lost) showResult();
    }, 900);
  }
}

function showResult(): void {
  if (view.winner === null) return;
  const winner = view.winner,
    won = winner === local;
  const matchOver = Math.max(...wins) >= 3;
  const title = won
    ? matchOver
      ? "You won the match!"
      : "Brilliant bombing!"
    : matchOver
      ? "They won this match."
      : "Outsmarted this time.";
  const subtitle = `${escapeHtml(profiles[winner].name)} wins ${matchOver ? "the match" : "the round"}.`;
  showModal(
    "result",
    `<div class="result-art"><img src="${asset(winner ? "player-coral" : "player-teal")}" alt="Winning player"/></div><span class="eyebrow">${matchOver ? "MATCH COMPLETE" : `ROUND ${round} COMPLETE`}</span><h2>${title}</h2><p>${subtitle}</p><div class="result-score"><span class="teal-text">${wins[0]}</span><i>—</i><span class="coral-text">${wins[1]}</span></div><div class="result-stats"><span><b>${view.players[local].solved}</b> brains solved</span><span><b>${view.players[local].range}</b> tile flame reach</span></div><button class="primary" id="next-round">${mode === "online" && session.role === "guest" ? "Ready for another?" : matchOver ? "Play a new match" : "Next round"} ${icon("arrow")}</button><p class="rematch-status" id="rematch-status"></p><button class="text-button" id="result-menu">Back to menu</button>`,
  );
  $("#result-menu").onclick = showMenu;
  $("#next-round").onclick = () => {
    if (mode === "online") {
      if (session.role === "host") session.start();
      else {
        session.rematch();
        $<HTMLButtonElement>("#next-round").disabled = true;
        $("#rematch-status").textContent =
          "Your friend will start the next round.";
      }
    } else {
      if (matchOver) {
        wins = [0, 0];
        round = 1;
      } else round++;
      startRound();
    }
  };
  if (awaitingRematch)
    $("#rematch-status").textContent =
      "Your friend is ready for the next round.";
}

function showModal(kind: string, content: string): void {
  if ($("#modal").hidden)
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  modalKind = kind;
  $("#modal").innerHTML =
    `<section class="modal-card ${kind === "help" ? "help-card" : ""}" role="dialog" aria-modal="true" aria-label="${kind === "result" ? "Round result" : kind === "help" ? "How to play" : kind === "pause" ? "Game menu" : kind === "join" ? "Join room" : "Connection status"}">${content}</section>`;
  $("#modal").hidden = false;
  $("#modal").querySelector<HTMLElement>("button, input")?.focus();
}
function closeModal(): void {
  $("#modal").hidden = true;
  $("#modal").innerHTML = "";
  modalKind = "";
  if (previousFocus?.isConnected) previousFocus.focus();
  previousFocus = null;
}
function showError(message: string): void {
  const status = document.querySelector("#menu-status");
  if (status) status.textContent = message;
}

function openPause(): void {
  if (screen !== "game" || view.phase === "ended" || lost) return;
  held = [];
  act({ type: "move", direction: null });
  paused = mode === "cpu";
  if (paused) audio.setActive(false);
  showModal(
    "pause",
    `<span class="eyebrow">${paused ? "TAKE A BREATHER" : "ONLINE MATCH"}</span><h2>${paused ? "Brain break." : "The battle is still live."}</h2><p>${paused ? "The arena is paused. Ready when you are." : "Online games keep running while this menu is open."}</p><button class="primary" id="resume">Back to battle ${icon("arrow")}</button><button class="text-button" id="leave-match">Leave match</button>`,
  );
  $("#resume").onclick = () => {
    paused = false;
    closeModal();
    $("#arena").focus();
  };
  $("#leave-match").onclick = showMenu;
}

$("#pause").onclick = openPause;
$("#brand").onclick = () => {
  if (screen === "game") openPause();
  else showMenu();
};
$("#help").onclick = () => {
  if (modalKind === "result" || modalKind === "lost") return;
  held = [];
  act({ type: "move", direction: null });
  const wasPaused = paused;
  if (mode === "cpu" && screen === "game") {
    paused = true;
    audio.setActive(false);
  }
  showModal(
    "help",
    `<span class="eyebrow">A QUICK FIELD GUIDE</span><h2>A good brain is your best weapon.</h2><div class="how-steps"><div><img src="${asset("brain")}" alt=""/><span><b>01 · Think</b>Walk into one of your pink brains. Click the answer or press 1–4. A correct answer earns one bomb. Wrong answers earn nothing; try again.</span></div><div><img src="${asset("bomb")}" alt=""/><span><b>02 · Drop</b>Use arrows or WASD to move. Press Space to place a bomb. Every bomb costs one from your arsenal and has a 3.6-second fuse.</span></div><div><img src="${asset("fire")}" alt=""/><span><b>03 · Dodge</b>You have three lives. A blast only hurts at the instant it explodes, through the centre of its lane. The fire afterward is safe. Steel and crates stop blasts.</span></div></div><p class="help-detail">Every 3 solved brains earns +1 tile of flame reach, up to 6. Crates can also reveal flame pickups or shoes for more speed. Amber floor outlines warn where a bomb is about to explode. The host chooses the arenas in online matches. Questions stay private; bomb counts and bombs are shared. First to 3 round wins takes the match.</p><p class="help-live">While answering, the arena keeps running. Move away or press Escape to close a question.${mode === "online" && screen === "game" ? " Your online match is live now." : ""}</p><button class="primary" id="help-close">Got it. Let's play ${icon("arrow")}</button>`,
  );
  $("#help-close").onclick = () => {
    paused = wasPaused;
    closeModal();
    if (screen === "game") $("#arena").focus();
  };
};
function updateSound(): void {
  $("#sound").innerHTML = icon(audio.muted ? "muted" : "sound");
  $("#sound").setAttribute(
    "aria-label",
    audio.muted ? "Turn sound on" : "Mute sound",
  );
  $("#sound").title = audio.muted ? "Turn sound on" : "Mute all audio";
  $("#sound").setAttribute("aria-pressed", String(!audio.muted));
  $("#music").setAttribute(
    "aria-label",
    audio.musicEnabled ? "Mute music" : "Turn music on",
  );
  $("#music").title = audio.musicEnabled ? "Mute music" : "Turn music on";
  $("#music").setAttribute("aria-pressed", String(audio.musicEnabled));
  $("#music").classList.toggle("audio-off", !audio.musicEnabled);
}
$("#sound").onclick = () => {
  audio.unlock();
  audio.muted = !audio.muted;
  savePreference("muted", String(audio.muted));
  updateSound();
  if (!audio.muted) audio.play("good");
};
$("#music").onclick = () => {
  audio.unlock();
  audio.musicEnabled = !audio.musicEnabled;
  savePreference("music", String(audio.musicEnabled));
  updateSound();
};
// Unlock in the local gesture, including on a guest joining before the host starts.
document.addEventListener("pointerdown", () => audio.unlock(), {
  passive: true,
});
document.addEventListener("keydown", () => audio.unlock(), { passive: true });
document.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest("button");
  if (
    button &&
    !button.hasAttribute("data-answer") &&
    !button.hasAttribute("data-dir") &&
    !button.classList.contains("drop-button") &&
    button.id !== "touch-bomb"
  )
    audio.play("click");
});
window.addEventListener("pagehide", () => audio.setActive(false));
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#game-frame").requestFullscreen();
  } catch {
    $("#fullscreen").title = "Full screen is unavailable in this browser";
  }
};

const directionKeys: Record<string, Direction> = {
  ArrowUp: "up",
  w: "up",
  ArrowDown: "down",
  s: "down",
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
};
window.addEventListener("keydown", (e) => {
  if (!$("#modal").hidden) {
    if (e.key === "Tab") {
      const controls = [
        ...$("#modal").querySelectorAll<HTMLElement>(
          "button:not([disabled]),input,select",
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    if (e.key === "Escape") {
      if (modalKind === "pause") {
        paused = false;
        closeModal();
      } else if (modalKind === "help") $("#help-close").click();
      else if (modalKind === "join") closeModal();
    }
    return;
  }
  if (
    screen !== "game" ||
    ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
  )
    return;
  if (e.code === "Space" && (e.target as HTMLElement).closest("button")) return;
  const dir = directionKeys[e.key] || directionKeys[e.key.toLowerCase()];
  if (dir) {
    e.preventDefault();
    if (!e.repeat) {
      held = held.filter((d) => d !== dir);
      held.push(dir);
      act({ type: "move", direction: dir });
    }
  } else if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) act({ type: "bomb" });
  } else if (/^[1-4]$/.test(e.key) && view.activeBrain !== null) {
    e.preventDefault();
    if (!e.repeat)
      act({
        type: "answer",
        brain: view.activeBrain,
        choice: Number(e.key) - 1,
      });
  } else if (e.key === "Escape") {
    if (view.activeBrain !== null) act({ type: "dismiss" });
    else openPause();
  }
});
window.addEventListener("keyup", (e) => {
  const dir = directionKeys[e.key] || directionKeys[e.key.toLowerCase()];
  if (dir) {
    held = held.filter((d) => d !== dir);
    act({ type: "move", direction: held.at(-1) ?? null });
  }
});
window.addEventListener("blur", () => {
  held = [];
  act({ type: "move", direction: null });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    audio.setActive(false);
    held = [];
    act({ type: "move", direction: null });
    if (
      mode === "cpu" &&
      screen === "game" &&
      view.phase === "playing" &&
      !modalKind
    )
      openPause();
  }
});
$("#arena").addEventListener("pointerdown", () => $("#arena").focus());
$("#touch-bomb").onclick = () => act({ type: "bomb" });
document.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((button) => {
  button.onpointerdown = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    held = [button.dataset.dir as Direction];
    act({ type: "move", direction: held[0] });
  };
  const release = () => {
    held = [];
    act({ type: "move", direction: null });
  };
  button.onpointerup = release;
  button.onpointercancel = release;
  button.onlostpointercapture = release;
});

let lastStep = performance.now(),
  accumulator = 0;
setInterval(() => {
  const now = performance.now(),
    elapsed = Math.min(0.25, (now - lastStep) / 1000);
  lastStep = now;
  if (
    screen !== "game" ||
    paused ||
    lost ||
    !engine ||
    (mode === "online" && session.role !== "host")
  ) {
    accumulator = 0;
    return;
  }
  accumulator += elapsed;
  let changed = false;
  while (accumulator >= 0.05) {
    bot?.update(engine);
    engine.step();
    accumulator -= 0.05;
    changed = true;
  }
  if (changed) {
    view = engine.view(local);
    afterView();
    if (mode === "online") session.sendView(engine.view(1));
  }
}, 25);

function frame(now: number): void {
  audio.setActive(
    screen === "game" &&
      !paused &&
      !lost &&
      !awaitingView &&
      view.phase === "playing" &&
      view.readyIn === 0 &&
      !document.hidden,
  );
  if (screen === "game" && !paused && !lost && view.phase === "playing") {
    const direction = held.at(-1) ?? null;
    if (direction !== lastDirection || now - lastSent > 150) {
      act({ type: "move", direction });
      lastDirection = direction;
      lastSent = now;
    }
  }
  renderer.draw(view, local, now, screen !== "game");
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function fitFrame(): void {
  const fitting = window.innerWidth > 780 && !document.fullscreenElement;
  document.documentElement.classList.toggle("desktop-fit", fitting);
  const frame = $("#game-frame"),
    app = $("#app");
  if (!fitting) {
    frame.style.width = "";
    frame.style.transform = "";
    app.style.width = "";
    app.style.height = "";
    return;
  }
  frame.style.width = "1180px";
  const padding = window.innerWidth > 1090 ? 56 : 32;
  const scale = Math.min(
    1,
    (innerWidth - padding) / 1180,
    (innerHeight - padding) / frame.offsetHeight,
  );
  frame.style.transform = `scale(${scale})`;
  app.style.width = `${1180 * scale}px`;
  app.style.height = `${frame.offsetHeight * scale}px`;
}
new ResizeObserver(fitFrame).observe($("#game-frame"));
window.addEventListener("resize", fitFrame);
document.addEventListener("fullscreenchange", fitFrame);
void document.fonts.ready.then(fitFrame);
fitFrame();
