import { answersMatch, overlapFraction } from "./answers";
import { GridMovement } from "./movement";
import { makeQuestion } from "./questions";
import { makeArena, type ArenaId } from "./arenas";
import { blastCells } from "./hazards";
import {
  COLS,
  ROWS,
  DIRECTIONS,
  FUSE_SECONDS,
  FLAME_SECONDS,
  BRAINS_PER_UPGRADE,
  BLAST_HALF_WIDTH,
  MAX_RANGE,
  RESPAWN_SHIELD_SECONDS,
  STARTING_LIVES,
  distance,
  same,
  key,
  type Action,
  type Bomb,
  type Brain,
  type Feedback,
  type Flame,
  type Explosion,
  type Pickup,
  type Player,
  type PlayerId,
  type Point,
  type Profile,
  type Question,
  type View,
  type YearLevel,
} from "./types";

type Control = { until: number; dismissed: number | null; sequence: number };
type QuestionFactory = (year: YearLevel) => Question;
export class Engine {
  readyIn: number;
  time = 0;
  tick = 0;
  phase: "playing" | "ended" = "playing";
  winner: PlayerId | null = null;
  map: number[][];
  players: Player[];
  bombs: Bomb[] = [];
  flames: Flame[] = [];
  explosions: Explosion[] = [];
  pickups: Pickup[] = [];
  brains: Brain[] = [];
  controls: Control[] = [0, 1].map(() => ({
    until: 0,
    dismissed: null,
    sequence: 0,
  }));
  readonly movement: GridMovement[];
  feedback: Feedback[] = [0, 1].map(() => ({
    text: "Find a pink brain to earn your first bomb.",
    kind: "info",
    at: 0,
  }));
  private nextId = 1;
  private randomState: number;
  private brainCooldown = 0;

  constructor(
    profiles: [Profile, Profile],
    seed = Date.now(),
    private questions: QuestionFactory = makeQuestion,
    readonly arena: ArenaId = "garden",
    introSeconds = 0,
  ) {
    this.readyIn = Math.max(0, introSeconds);
    this.randomState = seed >>> 0 || 1;
    this.map = makeArena(arena, () => this.random());
    this.players = profiles.map((p, id) => ({
      ...p,
      id: id as PlayerId,
      x: id ? COLS - 2 : 1,
      y: id ? ROWS - 2 : 1,
      alive: true,
      lives: STARTING_LIVES,
      invulnerableUntil: 0,
      visualX: id ? COLS - 2 : 1,
      visualY: id ? ROWS - 2 : 1,
      bombs: 0,
      range: 2,
      speed: 0,
      solved: 0,
      facing: id ? "left" : "right",
    }));
    this.movement = this.players.map(
      (p) =>
        new GridMovement(
          (point) => this.walkable(point, p.id),
          p,
          () => 170 - p.speed * 18,
          (point) => this.collectPickup(p.id, point),
        ),
    );
    this.refillBrains();
  }

  random(): number {
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    return (this.randomState >>> 0) / 4294967296;
  }

  walkable(p: Point, id?: PlayerId, ignoreBombs = false): boolean {
    return (
      this.map[p.y]?.[p.x] === 0 &&
      (ignoreBombs ||
        !this.bombs.some(
          (b) => same(b, p) && (id === undefined || !b.pass.includes(id)),
        ))
    );
  }

  reachable(start: Point, id?: PlayerId, ignoreBombs = false): Point[] {
    const visited = new Set([key(start)]),
      queue = [{ x: start.x, y: start.y }];
    for (let i = 0; i < queue.length; i++)
      for (const d of Object.values(DIRECTIONS)) {
        const p = { x: queue[i].x + d.x, y: queue[i].y + d.y };
        if (!visited.has(key(p)) && this.walkable(p, id, ignoreBombs)) {
          visited.add(key(p));
          queue.push(p);
        }
      }
    return queue;
  }

  /** Walls stop fire; the first crate is hit but stops propagation. */
  blastCells(bomb: Pick<Bomb, "x" | "y" | "range">): Point[] {
    return blastCells(this.map, bomb);
  }

  activeBrain(id: PlayerId): Brain | undefined {
    const p = this.playerPosition(id);
    if (!this.players[id].alive) return;
    return this.brains
      .filter(
        (b) =>
          b.owner === id &&
          b.id !== this.controls[id].dismissed &&
          overlapFraction({ x: p.visualX, y: p.visualY }, b) > 0,
      )
      .sort(
        (a, b) =>
          overlapFraction({ x: p.visualX, y: p.visualY }, b) -
          overlapFraction({ x: p.visualX, y: p.visualY }, a),
      )[0];
  }

  act(id: PlayerId, action: Action): void {
    const p = this.players[id],
      c = this.controls[id];
    if (this.phase !== "playing" || this.readyIn > 0 || !p.alive) return;
    this.syncMovement(id);
    const movement = this.movement[id],
      at = this.time * 1000;
    if (action.type === "input" || action.type === "release") {
      if (action.sequence <= c.sequence) return;
      c.sequence = action.sequence;
      c.until = this.time + 0.75;
      if (action.type === "release") movement.release(at);
      else if (action.down) movement.down(action.code, at);
      else movement.up(action.code, at);
      this.syncMovement(id, false);
    } else if (action.type === "keepalive") {
      c.until = this.time + 0.75;
    } else if (action.type === "move") {
      movement.steer(action.direction, at);
      c.until = this.time + 0.75;
      this.syncMovement(id, false);
    } else if (action.type === "step") {
      movement.tap(action.direction, at);
      this.syncMovement(id, false);
    } else if (action.type === "dismiss") {
      const b =
        action.brain === undefined
          ? this.activeBrain(id)
          : this.brains.find(
              (b) =>
                b.id === action.brain &&
                b.owner === id &&
                overlapFraction({ x: p.visualX, y: p.visualY }, b) > 0,
            );
      c.dismissed = b?.id ?? null;
    } else if (action.type === "bomb") {
      if (p.bombs < 1) {
        this.tell(id, "Solve a brain to earn a bomb first.", "info");
        return;
      }
      const tile = { x: Math.round(p.visualX), y: Math.round(p.visualY) };
      if (
        this.bombs.some((b) => same(b, tile)) ||
        this.map[tile.y]?.[tile.x] !== 0
      )
        return;
      p.bombs--;
      this.bombs.push({
        id: this.nextId++,
        ...tile,
        owner: id,
        range: p.range,
        explodesAt: this.time + FUSE_SECONDS,
        pass: this.players
          .filter(
            (other) =>
              overlapFraction({ x: other.visualX, y: other.visualY }, tile) > 0,
          )
          .map((other) => other.id),
      });
      this.tell(id, "Bomb down. Find a corner!", "info");
    } else if (action.type === "answer" || action.type === "typed-answer") {
      const b = this.brains.find(
        (b) => b.id === action.brain && b.owner === id,
      );
      const inReach =
        b && overlapFraction({ x: p.visualX, y: p.visualY }, b) > 0;
      if (
        !b ||
        !inReach ||
        b.id === c.dismissed ||
        b.retryAt > this.time ||
        (action.type === "answer"
          ? !Number.isInteger(action.choice) ||
            action.choice < 0 ||
            action.choice > 3 ||
            b.rejected.includes(action.choice)
          : typeof action.answer !== "string" ||
            !action.answer.trim() ||
            action.answer.length > 100)
      )
        return;
      if (
        action.type === "answer"
          ? b.question.correct === action.choice
          : answersMatch(action.answer, b.question.choices[b.question.correct])
      ) {
        p.bombs++;
        p.solved++;
        const upgraded =
          p.solved % BRAINS_PER_UPGRADE === 0 && p.range < MAX_RANGE;
        if (upgraded) p.range++;
        this.brains = this.brains.filter((brain) => brain.id !== b.id);
        this.tell(
          id,
          upgraded
            ? `Brain power! +1 bomb and ${p.range}-tile flames.`
            : "+1 bomb. Brilliant!",
          "good",
        );
        this.refillBrains();
      } else if (action.type === "answer") {
        b.rejected.push(action.choice);
        b.retryAt = this.time + 0.8;
        this.tell(id, "Not quite. Try another answer.", "bad");
      }
    }
  }

  private tell(id: PlayerId, text: string, kind: Feedback["kind"]): void {
    this.feedback[id] = { text, kind, at: this.time };
  }

  step(dt = 0.05): void {
    if (this.phase === "ended") return;
    if (this.readyIn > 0) {
      this.readyIn = Math.max(0, this.readyIn - dt);
      if (this.readyIn < 0.001) this.readyIn = 0;
      this.tick++;
      return;
    }
    const target = this.time + dt;
    // Resolve bombs at their actual fuse instant, even between frame updates.
    while (this.time < target - 1e-9) {
      const nextBomb = Math.min(...this.bombs.map((b) => b.explodesAt));
      const end = Math.min(target, Math.max(this.time, nextBomb));
      this.time = end;
      this.tick++;
      this.updateVisualPositions();
      this.flames = this.flames.filter((f) => f.expiresAt > this.time);
      this.checkWallDamage();
      this.explodeDueBombs();
      if (end === target) break;
    }
    this.explosions = this.explosions.filter((e) => this.time - e.at < 1.5);
    this.explodeDueBombs();
    this.checkWallDamage();
    const alive = this.players.filter((p) => p.alive);
    if (alive.length === 1) {
      this.phase = "ended";
      this.winner = alive[0].id;
      this.movement.forEach((m) => m.release(this.time * 1000));
    }
    if (this.time > this.brainCooldown && this.phase === "playing") {
      this.refillBrains();
      this.brainCooldown = this.time + 1;
    }
  }

  private explodeDueBombs(): void {
    const queue = this.bombs.filter((b) => b.explodesAt <= this.time);
    const detonated = new Set<number>();
    const crates = new Set<string>();
    const hit = new Set<PlayerId>();
    while (queue.length) {
      const bomb = queue.shift()!;
      if (detonated.has(bomb.id)) continue;
      detonated.add(bomb.id);
      const cells = this.blastCells(bomb);
      for (const p of this.players)
        if (this.playerInBlast(p.id, bomb, cells)) hit.add(p.id);
      this.explosions.push({
        id: bomb.id,
        x: bomb.x,
        y: bomb.y,
        owner: bomb.owner,
        at: this.time,
        chain: bomb.explodesAt > this.time,
        cells,
        crates: cells.filter(
          (cell) => this.map[cell.y][cell.x] === 2 && !crates.has(key(cell)),
        ),
      });
      for (const cell of cells) {
        this.flames.push({
          ...cell,
          expiresAt: this.time + FLAME_SECONDS,
          owner: bomb.owner,
        });
        if (this.map[cell.y][cell.x] === 2) crates.add(key(cell));
        for (const other of this.bombs)
          if (same(cell, other) && !detonated.has(other.id)) queue.push(other);
        this.pickups = this.pickups.filter((item) => !same(item, cell));
      }
    }
    // Resolve the whole chain against the same terrain: a crate blocks every blast in this tick.
    this.bombs = this.bombs.filter((b) => !detonated.has(b.id));
    for (const cell of crates) {
      const [x, y] = cell.split(",").map(Number);
      this.map[y][x] = 0;
      const r = this.random();
      if (r < 0.38)
        this.pickups.push({ x, y, kind: r < 0.29 ? "fire" : "speed" });
    }
    const deadHeat =
      hit.size === this.players.length &&
      this.players.every((p) => p.alive && p.lives === 1 && hit.has(p.id));
    if (deadHeat) {
      for (const p of this.players) this.respawnPlayer(p.id);
      for (const p of this.players)
        this.tell(p.id, "Dead heat — keep battling!", "info");
    } else for (const id of hit) this.damagePlayer(id);
  }

  private collectPickup(id: PlayerId, point: Point): void {
    const p = this.players[id],
      pickup = this.pickups.find((item) => same(item, point));
    if (!pickup) return;
    if (pickup.kind === "fire") p.range = Math.min(MAX_RANGE, p.range + 1);
    else p.speed = Math.min(3, p.speed + 1);
    this.pickups = this.pickups.filter((item) => item !== pickup);
    this.tell(
      id,
      pickup.kind === "fire"
        ? `Flame up! Your blast now reaches ${p.range} tiles.`
        : "Speed up! Keep moving.",
      "good",
    );
  }

  private syncMovement(id: PlayerId, checkReposition = true): void {
    const p = this.players[id],
      m = this.movement[id],
      c = this.controls[id];
    // Round setup and deterministic scenarios can reposition a player directly.
    if (checkReposition && !same(p, m.snapshot().destination))
      m.reset(p, this.time * 1000);
    const at = this.time * 1000;
    if (c.until > 0 && c.until < this.time) {
      m.advance(Math.max(m.state().now, c.until * 1000));
      m.release(Math.max(m.state().now, c.until * 1000));
      c.until = 0;
    }
    m.advance(at);
    const state = m.snapshot();
    Object.assign(p, state.destination, {
      visualX: state.visual.x,
      visualY: state.visual.y,
    });
    if (state.direction) p.facing = state.direction;
    if (c.dismissed !== null) {
      const b = this.brains.find((b) => b.id === c.dismissed);
      if (!b || overlapFraction(state.visual, b) === 0) c.dismissed = null;
    }
    for (const b of this.bombs)
      if (overlapFraction(state.visual, b) === 0)
        b.pass = b.pass.filter((pass) => pass !== id);
  }

  private updateVisualPositions(): void {
    for (const p of this.players) this.syncMovement(p.id);
  }

  private playerPosition(id: PlayerId): { visualX: number; visualY: number } {
    this.syncMovement(id);
    const p = this.players[id];
    return { visualX: p.visualX, visualY: p.visualY };
  }

  private playerInBlast(id: PlayerId, bomb: Bomb, cells: Point[]): boolean {
    const p = this.players[id];
    if (!p.alive || p.invulnerableUntil > this.time) return false;
    const position = this.playerPosition(id),
      px = position.visualX,
      py = position.visualY;
    return cells.some((cell) => {
      if (cell.x === bomb.x && cell.y === bomb.y)
        return (
          Math.abs(px - cell.x) <= BLAST_HALF_WIDTH &&
          Math.abs(py - cell.y) <= BLAST_HALF_WIDTH
        );
      if (cell.y === bomb.y)
        return (
          Math.abs(py - cell.y) <= BLAST_HALF_WIDTH &&
          Math.abs(px - cell.x) <= 0.5
        );
      return (
        Math.abs(px - cell.x) <= BLAST_HALF_WIDTH &&
        Math.abs(py - cell.y) <= 0.5
      );
    });
  }

  private checkWallDamage(): void {
    for (const p of this.players)
      if (p.alive && this.map[p.y][p.x] === 1) this.damagePlayer(p.id);
  }

  private damagePlayer(id: PlayerId): void {
    const p = this.players[id];
    if (!p.alive || p.invulnerableUntil > this.time) return;
    p.lives--;
    if (p.lives <= 0) {
      p.alive = false;
      return;
    }
    this.respawnPlayer(id);
    this.tell(
      id,
      `${p.lives} ${p.lives === 1 ? "life" : "lives"} left — shield up!`,
      "bad",
    );
  }

  private respawnPlayer(id: PlayerId): void {
    const p = this.players[id];
    const spawn = { x: id ? COLS - 2 : 1, y: id ? ROWS - 2 : 1 };
    const safe = Array.from({ length: ROWS - 2 }, (_, y) =>
      Array.from({ length: COLS - 2 }, (_, x) => ({ x: x + 1, y: y + 1 })),
    )
      .flat()
      .filter(
        (cell) =>
          this.walkable(cell, id) &&
          !this.bombs.some((bomb) => same(bomb, cell)) &&
          !this.flames.some((f) => same(f, cell)) &&
          !this.brains.some((brain) => same(brain, cell)) &&
          !this.players.some((other) => other.id !== id && same(other, cell)),
      )
      .sort((a, b) => distance(a, spawn) - distance(b, spawn))[0];
    if (!safe) {
      p.lives = 0;
      p.alive = false;
      return;
    }
    p.alive = true;
    Object.assign(p, { ...safe, visualX: safe.x, visualY: safe.y });
    p.invulnerableUntil = this.time + RESPAWN_SHIELD_SECONDS;
    Object.assign(this.controls[id], { until: 0, dismissed: null });
    this.movement[id].reset(safe, this.time * 1000);
  }

  private refillBrains(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      const reachable = this.reachable(p, p.id, true);
      const reachableKeys = new Set(reachable.map(key));
      this.brains = this.brains.filter(
        (b) => b.owner !== p.id || reachableKeys.has(key(b)),
      );
      const candidates = reachable.filter(
        (cell) =>
          distance(cell, p) >= 1 &&
          this.map[cell.y][cell.x] === 0 &&
          !this.brains.some((b) => b.owner === p.id && same(b, cell)) &&
          !this.bombs.some((b) => same(b, cell)) &&
          !this.flames.some((f) => same(f, cell)) &&
          !this.pickups.some((item) => same(item, cell)) &&
          !this.players.some(
            (other) =>
              overlapFraction({ x: other.visualX, y: other.visualY }, cell) > 0,
          ),
      );
      while (
        this.brains.filter((b) => b.owner === p.id).length < 3 &&
        candidates.length
      ) {
        // A nearby brain is always available; later ones encourage exploration.
        candidates.sort((a, b) => distance(a, p) - distance(b, p));
        const candidate = candidates.splice(
          Math.floor(this.random() * Math.min(candidates.length, 10)),
          1,
        )[0];
        this.brains.push({
          ...candidate,
          id: this.nextId++,
          owner: p.id,
          question: this.questions(p.year),
          rejected: [],
          retryAt: 0,
        });
      }
    }
  }

  /** Only this viewer's questions go onto the wire. Answers are never sent. */
  view(id: PlayerId): View {
    this.updateVisualPositions();
    return {
      arena: this.arena,
      readyIn: this.readyIn,
      tick: this.tick,
      time: this.time,
      phase: this.phase,
      winner: this.winner,
      map: this.map.map((row) => [...row]),
      players: this.players.map((p) => ({ ...p })),
      movement: this.movement.map((m) => m.state()),
      inputSequence: this.controls.map((c) => c.sequence),
      bombs: this.bombs.map(({ pass, ...b }) => ({ ...b, pass: [...pass] })),
      flames: this.flames.map((f) => ({ ...f })),
      explosions: this.explosions.map((e) => ({
        ...e,
        cells: e.cells.map((c) => ({ ...c })),
        crates: e.crates.map((c) => ({ ...c })),
      })),
      pickups: this.pickups.map((p) => ({ ...p })),
      brains: this.brains
        .filter((b) => b.owner === id)
        .map((b) => ({
          x: b.x,
          y: b.y,
          id: b.id,
          expression: b.question.expression,
          short: b.question.short,
          choices: [...b.question.choices],
          rejected: [...b.rejected],
          retryAt: b.retryAt,
        })),
      activeBrain: this.activeBrain(id)?.id ?? null,
      feedback: { ...this.feedback[id] },
    };
  }
}
