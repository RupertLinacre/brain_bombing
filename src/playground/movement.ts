import { Engine } from "../game/engine";
import { DIRECTIONS, type Direction, type Point } from "../game/types";

export const STEP_MS = 170;
export const keyDirections: Record<string, Direction> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowDown: "down",
  KeyS: "down",
  ArrowRight: "right",
  KeyD: "right",
};
export const arrows: Record<Direction, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};
const opposite: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export type Mode = "current" | "precision";
export type Intent = {
  id: number;
  direction: Direction;
  at: number;
  expires: number;
};
export type MovementEvent = {
  at: number;
  kind: string;
  direction?: Direction;
  note: string;
  latency?: number;
};
export type Emit = (event: MovementEvent) => void;
export type Snapshot = {
  cell: Point;
  visual: Point;
  direction: Direction | null;
  progress: number;
  queue: Intent[];
  held: string[];
  tick: number;
  moving: boolean;
};
export type Layout = "open" | "pillars";
export function makeMap(layout: Layout): number[][] {
  return Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) =>
      layout === "pillars" && x % 2 === 1 && y % 2 === 1 ? 1 : 0,
    ),
  );
}
const plus = (p: Point, d: Direction): Point => ({
  x: p.x + DIRECTIONS[d].x,
  y: p.y + DIRECTIONS[d].y,
});
const copy = (p: Point): Point => ({ x: p.x, y: p.y });
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export interface Controller {
  down(code: string, at: number, repeat?: boolean): void;
  up(code: string, at: number): void;
  advance(at: number): void;
  frame(at: number): void;
  release(at: number): void;
  snapshot(): Snapshot;
}

/** The production engine, with its existing held-key policy and render smoothing.
 * Only arena contents are stripped away; movement code is not changed. */
export class CurrentControls implements Controller {
  readonly game: Engine;
  private held: Direction[] = [];
  private codes = new Set<string>();
  private now = 0;
  private nextTick = 50;
  private lastSent = -Infinity;
  private lastDirection: Direction | null = null;
  private lastFrame = 0;
  private visual: Point = { x: 2, y: 2 };
  private intent?: Intent;
  private nextId = 0;
  private wasMoving = false;

  constructor(
    map: number[][],
    private emit: Emit = () => {},
  ) {
    this.game = new Engine(
      [
        { name: "You", year: "year1" },
        { name: "Unused", year: "year1" },
      ],
      42,
      () => ({
        expression: "1+1",
        short: "1+1",
        choices: ["1", "2", "3", "4"],
        correct: 1,
      }),
    );
    this.game.map = map.map((row) => [...row]);
    this.game.brains = [];
    Object.assign(this.game.players[0], { x: 2, y: 2, visualX: 2, visualY: 2 });
    Object.assign(this.game.controls[0], { fromX: 2, fromY: 2 });
    Object.assign(this.game.players[1], { x: 4, y: 4, visualX: 4, visualY: 4 });
  }

  private send(direction: Direction | null, at: number): void {
    const before = this.game.controls[0].pending;
    this.game.act(0, { type: "move", direction });
    const after = this.game.controls[0].pending;
    if (after && before && after !== before)
      this.emit({
        at,
        kind: "overwritten",
        direction: before,
        note: `${arrows[before]} replaced by ${arrows[after]} in the single pending slot`,
      });
  }

  down(code: string, at: number, repeat = false): void {
    this.advance(at);
    if (repeat || this.codes.has(code)) return;
    this.codes.add(code);
    const direction = keyDirections[code];
    this.held = this.held.filter((d) => d !== direction);
    this.held.push(direction);
    if (this.intent && this.game.controls[0].pending === direction)
      this.emit({
        at,
        kind: "overwritten",
        direction,
        note: "Another tap replaced the previous tap in the single pending slot",
      });
    this.intent = { id: ++this.nextId, direction, at, expires: at + 500 };
    this.send(direction, at);
  }

  up(code: string, at: number): void {
    this.advance(at);
    this.codes.delete(code);
    this.held = this.held.filter((d) => d !== keyDirections[code]);
    this.send(this.held.at(-1) ?? null, at);
  }

  advance(at: number): void {
    while (this.nextTick <= at + 0.000001) {
      const p = this.game.players[0],
        from = copy(p),
        pending = this.game.controls[0].pending;
      this.game.brains = [];
      this.game.step();
      this.game.brains = [];
      if (p.x !== from.x || p.y !== from.y) {
        const direction = p.facing;
        this.emit({
          at: this.nextTick,
          kind: "move",
          direction,
          note: `Grid destination (${p.x}, ${p.y}); 170 ms interpolation starts on this tick`,
          latency:
            this.intent?.direction === direction
              ? this.nextTick - this.intent.at
              : undefined,
        });
        this.intent = undefined;
        this.wasMoving = true;
      } else if (pending && !this.game.controls[0].pending) {
        this.emit({
          at: this.nextTick,
          kind: "blocked",
          direction: pending,
          note: "Pending input consumed against a wall",
        });
        this.intent = undefined;
      }
      const c = this.game.controls[0];
      if (this.wasMoving && this.game.time >= c.moveStarted + c.moveDuration) {
        this.emit({
          at: this.nextTick,
          kind: "arrive",
          note: `Simulation reaches (${p.x}, ${p.y})`,
        });
        this.wasMoving = false;
      }
      this.nextTick += 50;
    }
    this.now = at;
  }

  frame(at: number): void {
    this.advance(at);
    const direction = this.held.at(-1) ?? null;
    if (direction !== this.lastDirection || at - this.lastSent > 150) {
      this.send(direction, at);
      this.lastDirection = direction;
      this.lastSent = at;
    }
    const p = this.game.players[0];
    const factor = Math.min(
      1,
      Math.min(0.05, (at - this.lastFrame) / 1000) * 24,
    );
    this.visual = lerp(this.visual, { x: p.visualX, y: p.visualY }, factor);
    this.lastFrame = at;
  }

  release(at: number): void {
    this.advance(at);
    this.held = [];
    this.codes.clear();
    this.game.controls[0].pending = null;
    this.intent = undefined;
    this.send(null, at);
  }

  snapshot(): Snapshot {
    const p = this.game.players[0],
      c = this.game.controls[0];
    const progress = c.moveDuration
      ? Math.min(
          1,
          Math.max(0, (this.game.time - c.moveStarted) / c.moveDuration),
        )
      : 1;
    return {
      cell: copy(p),
      visual: copy(this.visual),
      direction: c.direction,
      progress,
      queue: c.pending
        ? [
            {
              id: this.intent?.id ?? 0,
              direction: c.pending,
              at: this.intent?.at ?? this.now,
              expires: this.intent?.expires ?? this.now + 500,
            },
          ]
        : [],
      held: [...this.codes],
      tick: this.game.tick,
      moving: progress < 1,
    };
  }
}

type Segment = {
  from: Point;
  to: Point;
  direction: Direction;
  start: number;
  end: number;
};

/** Timestamped grid motion: no simulation-tick delay or second smoothing layer.
 * Presses are discrete intentions; held keys are continuous movement requests. */
export class PrecisionControls implements Controller {
  private cell: Point = { x: 2, y: 2 };
  private segment?: Segment;
  private pressed = new Map<string, Direction>();
  private queue: Intent[] = [];
  private now = 0;
  private nextId = 0;
  private tick = 0;
  constructor(
    private map: number[][],
    private emit: Emit = () => {},
    readonly bufferMs = 220,
    readonly capacity = 2,
  ) {}

  private walkable(p: Point): boolean {
    return this.map[p.y]?.[p.x] === 0;
  }
  private held(): Direction[] {
    return [...new Set([...this.pressed.values()].reverse())];
  }
  private expire(at: number): void {
    this.queue = this.queue.filter((intent) => {
      if (at <= intent.expires) return true;
      this.emit({
        at: intent.expires,
        kind: "expired",
        direction: intent.direction,
        note: `Buffered tap expired after ${this.bufferMs} ms`,
      });
      return false;
    });
  }

  private start(direction: Direction, at: number, intent?: Intent): void {
    const to = plus(this.cell, direction);
    this.segment = {
      from: copy(this.cell),
      to,
      direction,
      start: at,
      end: at + STEP_MS,
    };
    this.emit({
      at,
      kind: "move",
      direction,
      note: `Moving to (${to.x}, ${to.y})${intent ? ` · tap #${intent.id}` : " · held key"}`,
      latency: intent ? at - intent.at : undefined,
    });
  }

  private choose(at: number): void {
    this.expire(at);
    // A blocked buffered turn can wait for the next junction; held forward movement continues.
    const index = this.queue.findIndex((intent) =>
      this.walkable(plus(this.cell, intent.direction)),
    );
    if (index >= 0) {
      const [intent] = this.queue.splice(index, 1);
      this.start(intent.direction, at, intent);
      return;
    }
    const direction = this.held().find((d) =>
      this.walkable(plus(this.cell, d)),
    );
    if (direction) this.start(direction, at);
  }

  private reverse(at: number, direction: Direction): void {
    const s = this.segment!;
    const travelled = Math.max(0, at - s.start);
    this.segment = {
      from: s.to,
      to: s.from,
      direction,
      start: at - (STEP_MS - travelled),
      end: at + travelled,
    };
    this.cell = copy(s.to);
    for (const intent of this.queue)
      this.emit({
        at,
        kind: "cancelled",
        direction: intent.direction,
        note: "New reversal replaces older buffered turns",
      });
    this.queue = [];
    this.emit({
      at,
      kind: "reverse",
      direction,
      latency: 0,
      note: "Reverse now, at constant speed and without a position jump",
    });
  }

  down(code: string, at: number, repeat = false): void {
    this.advanceTo(at, true);
    if (repeat || this.pressed.has(code)) {
      if (!this.segment) this.choose(at);
      return;
    }
    const direction = keyDirections[code];
    this.pressed.set(code, direction);
    if (this.segment && opposite[this.segment.direction] === direction) {
      this.reverse(at, direction);
      return;
    }
    if (this.queue.length === this.capacity) {
      const removed = this.queue.shift()!;
      this.emit({
        at,
        kind: "superseded",
        direction: removed.direction,
        note: `Buffer full (${this.capacity}); discard oldest intention`,
      });
    }
    const intent = {
      id: ++this.nextId,
      direction,
      at,
      expires: at + this.bufferMs,
    };
    this.queue.push(intent);
    this.emit({
      at,
      kind: "buffer",
      direction,
      note: `Tap #${intent.id} stored for up to ${this.bufferMs} ms`,
    });
    if (!this.segment) this.choose(at);
  }

  up(code: string, at: number): void {
    this.advanceTo(at, true);
    this.pressed.delete(code);
    const held = this.held()[0];
    if (this.segment && held === opposite[this.segment.direction])
      this.reverse(at, held);
    if (!this.segment) this.choose(at);
  }

  advance(at: number): void {
    this.advanceTo(at);
  }

  private advanceTo(at: number, inputAtBoundary = false): void {
    if (at < this.now) throw new Error("Input timestamps must be monotonic");
    while (this.segment && this.segment.end <= at) {
      const end = this.segment.end;
      this.cell = copy(this.segment.to);
      this.segment = undefined;
      this.tick++;
      this.emit({
        at: end,
        kind: "arrive",
        note: `Reached centre (${this.cell.x}, ${this.cell.y})`,
      });
      // A key release at the exact centre must win over repeating the old hold.
      if (end < at || !inputAtBoundary) this.choose(end);
    }
    this.now = at;
    this.expire(at);
    if (!this.segment && !inputAtBoundary) this.choose(at);
  }
  frame(at: number): void {
    this.advance(at);
  }
  release(at: number): void {
    this.advanceTo(at, true);
    this.pressed.clear();
    for (const intent of this.queue)
      this.emit({
        at,
        kind: "cancelled",
        direction: intent.direction,
        note: "Input cleared on blur/reset",
      });
    this.queue = [];
  }
  snapshot(): Snapshot {
    const s = this.segment;
    const progress = s
      ? Math.max(0, Math.min(1, (this.now - s.start) / STEP_MS))
      : 1;
    return {
      cell: copy(this.cell),
      visual: s ? lerp(s.from, s.to, progress) : copy(this.cell),
      direction: s?.direction ?? this.held()[0] ?? null,
      progress,
      queue: this.queue.map((i) => ({ ...i })),
      held: [...this.pressed.keys()],
      tick: this.tick,
      moving: !!s,
    };
  }
}
