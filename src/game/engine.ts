import { makeQuestion } from "./questions";
import { makeArena, type ArenaId } from "./arenas";
import { blastCells } from "./hazards";
import {
  COLS,
  ROWS,
  DIRECTIONS,
  FUSE_SECONDS,
  FLAME_SECONDS,
  ROUND_SECONDS,
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
  type Direction,
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

type Control = {
  pending: Direction | null;
  direction: Direction | null;
  until: number;
  nextMove: number;
  dismissed: number | null;
  fromX: number;
  fromY: number;
  moveStarted: number;
  moveDuration: number;
};
type QuestionFactory = (year: YearLevel) => Question;
export class Engine {
  readyIn: number;
  time = 0;
  tick = 0;
  phase: "playing" | "ended" = "playing";
  winner: PlayerId | "draw" | null = null;
  map: number[][];
  players: Player[];
  bombs: Bomb[] = [];
  flames: Flame[] = [];
  explosions: Explosion[] = [];
  pickups: Pickup[] = [];
  brains: Brain[] = [];
  controls: Control[] = [0, 1].map((id) => ({
    pending: null,
    direction: null,
    until: 0,
    nextMove: 0,
    dismissed: null,
    fromX: id ? COLS - 2 : 1,
    fromY: id ? ROWS - 2 : 1,
    moveStarted: 0,
    moveDuration: 0,
  }));
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
    return this.brains.find(
      (b) =>
        b.owner === id &&
        same(b, this.players[id]) &&
        b.id !== this.controls[id].dismissed,
    );
  }

  act(id: PlayerId, action: Action): void {
    const p = this.players[id],
      c = this.controls[id];
    if (this.phase !== "playing" || this.readyIn > 0 || !p.alive) return;
    if (action.type === "move") {
      // Remember a short tap even if keyup arrives before the next simulation tick.
      if (action.direction && c.direction !== action.direction)
        c.pending = action.direction;
      c.direction = action.direction;
      c.until = this.time + 0.5;
    } else if (action.type === "dismiss") {
      c.dismissed = this.activeBrain(id)?.id ?? null;
    } else if (action.type === "bomb") {
      if (this.activeBrain(id)) return;
      if (p.bombs < 1) {
        this.tell(id, "Solve a brain to earn a bomb first.", "info");
        return;
      }
      if (this.bombs.some((b) => same(b, p))) return;
      p.bombs--;
      this.bombs.push({
        id: this.nextId++,
        x: p.x,
        y: p.y,
        owner: id,
        range: p.range,
        explodesAt: this.time + FUSE_SECONDS,
        pass: this.players
          .filter((other) => same(other, p))
          .map((other) => other.id),
      });
      this.tell(id, "Bomb down. Find a corner!", "info");
    } else if (action.type === "answer") {
      const b = this.activeBrain(id);
      if (
        !b ||
        b.id !== action.brain ||
        !Number.isInteger(action.choice) ||
        action.choice < 0 ||
        action.choice > 3 ||
        b.retryAt > this.time ||
        b.rejected.includes(action.choice)
      )
        return;
      if (b.question.correct === action.choice) {
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
      } else {
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
    this.time += dt;
    this.tick++;
    this.updateVisualPositions();
    this.flames = this.flames.filter((f) => f.expiresAt > this.time);
    this.checkWallDamage();
    for (const p of this.players) {
      const c = this.controls[p.id];
      const direction = c.pending ?? c.direction;
      if (
        !p.alive ||
        !direction ||
        c.until < this.time ||
        c.nextMove > this.time
      )
        continue;
      c.pending = null;
      p.facing = direction;
      const d = DIRECTIONS[direction],
        to = { x: p.x + d.x, y: p.y + d.y };
      if (this.walkable(to, p.id)) {
        const duration = 0.17 - p.speed * 0.018;
        const position = this.playerPosition(p.id);
        c.fromX = position.visualX;
        c.fromY = position.visualY;
        c.moveStarted = this.time;
        c.moveDuration = duration;
        p.x = to.x;
        p.y = to.y;
        c.dismissed = null;
        c.nextMove = this.time + duration;
        for (const b of this.bombs)
          if (!same(b, p)) b.pass = b.pass.filter((id) => id !== p.id);
        const pickup = this.pickups.find((item) => same(item, p));
        if (pickup) {
          if (pickup.kind === "fire")
            p.range = Math.min(MAX_RANGE, p.range + 1);
          else p.speed = Math.min(3, p.speed + 1);
          this.pickups = this.pickups.filter((item) => item !== pickup);
          this.tell(
            p.id,
            pickup.kind === "fire"
              ? `Flame up! Your blast now reaches ${p.range} tiles.`
              : "Speed up! Keep moving.",
            "good",
          );
        }
        // Stop on brains so a held arrow does not immediately skip the question.
        if (this.activeBrain(p.id)) {
          c.direction = null;
          c.pending = null;
          c.until = 0;
        }
      }
    }
    this.explosions = this.explosions.filter((e) => this.time - e.at < 1.5);
    this.explodeDueBombs();
    this.checkWallDamage();
    const alive = this.players.filter((p) => p.alive);
    if (alive.length < 2 || this.time >= ROUND_SECONDS) {
      this.phase = "ended";
      this.winner = alive.length === 1 ? alive[0].id : "draw";
      this.controls.forEach((c) => (c.direction = null));
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
    for (const id of hit) this.damagePlayer(id);
  }

  private updateVisualPositions(): void {
    for (const p of this.players) Object.assign(p, this.playerPosition(p.id));
  }

  private playerPosition(id: PlayerId): { visualX: number; visualY: number } {
    const p = this.players[id],
      c = this.controls[id];
    // Tests and game setup sometimes reposition a player directly.
    if (Math.abs(p.visualX - p.x) > 1.05 || Math.abs(p.visualY - p.y) > 1.05)
      return { visualX: p.x, visualY: p.y };
    if (!c.moveDuration) return { visualX: p.x, visualY: p.y };
    const amount = Math.max(
      0,
      Math.min(1, (this.time - c.moveStarted) / c.moveDuration),
    );
    return {
      visualX: c.fromX + (p.x - c.fromX) * amount,
      visualY: c.fromY + (p.y - c.fromY) * amount,
    };
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
    Object.assign(p, { ...safe, visualX: safe.x, visualY: safe.y });
    p.invulnerableUntil = this.time + RESPAWN_SHIELD_SECONDS;
    const c = this.controls[id];
    Object.assign(c, {
      pending: null,
      direction: null,
      until: 0,
      nextMove: this.time + 0.15,
      dismissed: null,
      fromX: safe.x,
      fromY: safe.y,
      moveStarted: this.time,
      moveDuration: 0,
    });
    this.tell(
      id,
      `${p.lives} ${p.lives === 1 ? "life" : "lives"} left — shield up!`,
      "bad",
    );
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
          !this.players.some((other) => same(other, cell)),
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
    return {
      arena: this.arena,
      readyIn: this.readyIn,
      tick: this.tick,
      time: this.time,
      remaining: Math.max(0, ROUND_SECONDS - this.time),
      phase: this.phase,
      winner: this.winner,
      map: this.map.map((row) => [...row]),
      players: this.players.map((p) => ({ ...p })),
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
