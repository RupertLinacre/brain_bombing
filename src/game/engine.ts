import { makeQuestion } from "./questions";
import {
  COLS,
  ROWS,
  DIRECTIONS,
  FUSE_SECONDS,
  FLAME_SECONDS,
  ROUND_SECONDS,
  distance,
  same,
  key,
  type Action,
  type Bomb,
  type Brain,
  type Direction,
  type Feedback,
  type Flame,
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
};
type QuestionFactory = (year: YearLevel) => Question;
export class Engine {
  time = 0;
  tick = 0;
  phase: "playing" | "ended" = "playing";
  winner: PlayerId | "draw" | null = null;
  map: number[][];
  players: Player[];
  bombs: Bomb[] = [];
  flames: Flame[] = [];
  pickups: Pickup[] = [];
  brains: Brain[] = [];
  closing: (Point & { at: number }) | null = null;
  controls: Control[] = [0, 1].map(() => ({
    pending: null,
    direction: null,
    until: 0,
    nextMove: 0,
    dismissed: null,
  }));
  feedback: Feedback[] = [0, 1].map(() => ({
    text: "Find a pink brain to earn your first bomb.",
    kind: "info",
    at: 0,
  }));
  private nextId = 1;
  private storm: Point[] = [];
  private randomState: number;
  private brainCooldown = 0;

  constructor(
    profiles: [Profile, Profile],
    seed = Date.now(),
    private questions: QuestionFactory = makeQuestion,
  ) {
    this.randomState = seed >>> 0 || 1;
    this.map = this.makeMap();
    this.players = profiles.map((p, id) => ({
      ...p,
      id: id as PlayerId,
      x: id ? COLS - 2 : 1,
      y: id ? ROWS - 2 : 1,
      alive: true,
      bombs: 0,
      range: 2,
      speed: 0,
      solved: 0,
      facing: id ? "left" : "right",
    }));
    for (let ring = 1; ring <= Math.floor(ROWS / 2); ring++) {
      for (let x = ring; x < COLS - ring; x++) this.storm.push({ x, y: ring });
      for (let y = ring + 1; y < ROWS - ring; y++)
        this.storm.push({ x: COLS - ring - 1, y });
      for (let x = COLS - ring - 2; x >= ring; x--)
        this.storm.push({ x, y: ROWS - ring - 1 });
      for (let y = ROWS - ring - 2; y > ring; y--)
        this.storm.push({ x: ring, y });
    }
    this.refillBrains();
  }

  random(): number {
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    return (this.randomState >>> 0) / 4294967296;
  }

  private makeMap(): number[][] {
    const map: number[][] = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) =>
        x === 0 ||
        y === 0 ||
        x === COLS - 1 ||
        y === ROWS - 1 ||
        (x % 2 === 0 && y % 2 === 0)
          ? 1
          : 0,
      ),
    );
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++) {
        if (map[y][x] || x + y <= 6 || COLS - 1 - x + ROWS - 1 - y <= 6)
          continue;
        if (y * COLS + x > (ROWS - 1 - y) * COLS + COLS - 1 - x) continue;
        if (this.random() < 0.53)
          map[y][x] = map[ROWS - 1 - y][COLS - 1 - x] = 2;
      }
    return map;
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
    const cells = [{ x: bomb.x, y: bomb.y }];
    for (const d of Object.values(DIRECTIONS))
      for (let n = 1; n <= bomb.range; n++) {
        const p = { x: bomb.x + d.x * n, y: bomb.y + d.y * n };
        const tile = this.map[p.y]?.[p.x];
        if (tile === undefined || tile === 1) break;
        cells.push(p);
        if (tile === 2) break;
      }
    return cells;
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
    if (this.phase !== "playing" || !p.alive) return;
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
        this.brains = this.brains.filter((brain) => brain.id !== b.id);
        this.tell(id, "+1 bomb. Brilliant!", "good");
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
    this.time += dt;
    this.tick++;
    this.flames = this.flames.filter((f) => f.expiresAt > this.time);
    // Fire is checked before movement too: a player cannot step out after being hit.
    this.checkDeaths();
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
        p.x = to.x;
        p.y = to.y;
        c.dismissed = null;
        c.nextMove = this.time + 0.17 - p.speed * 0.018;
        for (const b of this.bombs)
          if (!same(b, p)) b.pass = b.pass.filter((id) => id !== p.id);
        const pickup = this.pickups.find((item) => same(item, p));
        if (pickup) {
          if (pickup.kind === "fire") p.range = Math.min(6, p.range + 1);
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
    this.explodeDueBombs();
    this.updateStorm();
    this.checkDeaths();
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
    const queue = this.bombs.filter(
      (b) => b.explodesAt <= this.time || this.flames.some((f) => same(f, b)),
    );
    const detonated = new Set<number>();
    const crates = new Set<string>();
    while (queue.length) {
      const bomb = queue.shift()!;
      if (detonated.has(bomb.id)) continue;
      detonated.add(bomb.id);
      for (const cell of this.blastCells(bomb)) {
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
  }

  private checkDeaths(): void {
    for (const p of this.players)
      if (
        p.alive &&
        (this.map[p.y][p.x] === 1 || this.flames.some((f) => same(f, p)))
      )
        p.alive = false;
  }

  private updateStorm(): void {
    if (this.time < ROUND_SECONDS - 45) return;
    if (this.closing && this.time >= this.closing.at) {
      const cell = this.closing;
      this.map[cell.y][cell.x] = 1;
      this.bombs = this.bombs.filter((b) => !same(b, cell));
      this.pickups = this.pickups.filter((b) => !same(b, cell));
      this.brains = this.brains.filter((b) => !same(b, cell));
      this.closing = null;
    }
    if (!this.closing) {
      let next = this.storm.shift();
      while (next && this.map[next.y][next.x] === 1) next = this.storm.shift();
      if (next) this.closing = { ...next, at: this.time + 0.8 };
    }
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
          !this.players.some((other) => same(other, cell)) &&
          (!this.closing || !same(this.closing, cell)),
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
      tick: this.tick,
      time: this.time,
      remaining: Math.max(0, ROUND_SECONDS - this.time),
      phase: this.phase,
      winner: this.winner,
      map: this.map.map((row) => [...row]),
      players: this.players.map((p) => ({ ...p })),
      bombs: this.bombs.map(({ pass, ...b }) => ({ ...b, pass: [...pass] })),
      flames: this.flames.map((f) => ({ ...f })),
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
      closing: this.closing && { ...this.closing },
    };
  }
}
