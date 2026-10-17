import { DIRECTIONS, type Direction, type Point } from "./types";

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
  TouchUp: "up",
  TouchDown: "down",
  TouchLeft: "left",
  TouchRight: "right",
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
  destination: Point;
};
const plus = (p: Point, d: Direction): Point => ({
  x: p.x + DIRECTIONS[d].x,
  y: p.y + DIRECTIONS[d].y,
});
const copy = (p: Point): Point => ({ x: p.x, y: p.y });
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export type MovementState = {
  cell: Point;
  segment?: Segment;
  pressed: [string, Direction][];
  queue: Intent[];
  now: number;
  nextId: number;
  tick: number;
};

export type Segment = {
  from: Point;
  to: Point;
  direction: Direction;
  start: number;
  end: number;
  heldStart?: boolean;
};

/** Timestamped grid motion: no simulation-tick delay or second smoothing layer.
 * Presses are discrete intentions; held keys are continuous movement requests. */
export class GridMovement {
  private cell: Point;
  private segment?: Segment;
  private pressed = new Map<string, Direction>();
  private queue: Intent[] = [];
  private now = 0;
  private nextId = 0;
  private tick = 0;
  constructor(
    private canWalk: (point: Point) => boolean,
    position: Point,
    private duration: () => number = () => STEP_MS,
    private onArrive: (point: Point, at: number) => void = () => {},
    private emit: Emit = () => {},
    readonly bufferMs = 220,
    readonly capacity = 2,
  ) {
    this.cell = copy(position);
  }

  private walkable(p: Point): boolean {
    return this.canWalk(p);
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
      end: at + this.duration(),
      heldStart: !intent,
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
    const duration = s.end - s.start;
    this.segment = {
      from: s.to,
      to: s.from,
      direction,
      start: at - (duration - travelled),
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

  down(
    code: string,
    at: number,
    repeat = false,
    direction = keyDirections[code],
  ): void {
    this.advanceTo(at, true);
    if (repeat || this.pressed.has(code)) {
      if (!this.segment) this.choose(at);
      return;
    }
    if (!direction) return;
    this.pressed.set(code, direction);
    if (
      this.segment &&
      opposite[this.segment.direction] === direction &&
      this.walkable(this.segment.from)
    ) {
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
    // Rendering may already have started a repeated hold exactly at this
    // timestamp. A release at the centre still wins before any distance moves.
    if (
      this.segment?.heldStart &&
      this.segment.start === at &&
      !this.held().includes(this.segment.direction)
    ) {
      this.cell = copy(this.segment.from);
      this.segment = undefined;
    }
    const held = this.held()[0];
    if (
      this.segment &&
      held === opposite[this.segment.direction] &&
      this.walkable(this.segment.from)
    )
      this.reverse(at, held);
    if (!this.segment) this.choose(at);
  }

  advance(at: number): void {
    this.advanceTo(at);
  }

  private advanceTo(at: number, inputAtBoundary = false): void {
    if (at < this.now) throw new Error("Input timestamps must be monotonic");
    // A rival may place a bomb after a step began. Retreat continuously if
    // its tile became blocked before this player reached it.
    if (
      this.segment &&
      !this.walkable(this.segment.to) &&
      this.walkable(this.segment.from)
    )
      this.reverse(this.now, opposite[this.segment.direction]);
    while (this.segment && this.segment.end <= at) {
      const end = this.segment.end;
      this.cell = copy(this.segment.to);
      this.segment = undefined;
      this.tick++;
      this.onArrive(copy(this.cell), end);
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
    if (this.segment?.heldStart && this.segment.start === at) {
      this.cell = copy(this.segment.from);
      this.segment = undefined;
    }
    for (const intent of this.queue)
      this.emit({
        at,
        kind: "cancelled",
        direction: intent.direction,
        note: "Input cleared on blur/reset",
      });
    this.queue = [];
  }
  /** Authoritative motion can be restored on a peer, then replayed locally. */
  state(): MovementState {
    return {
      cell: copy(this.cell),
      segment: this.segment && structuredClone(this.segment),
      pressed: [...this.pressed],
      queue: this.queue.map((i) => ({ ...i })),
      now: this.now,
      nextId: this.nextId,
      tick: this.tick,
    };
  }
  restore(state: MovementState): void {
    this.cell = copy(state.cell);
    this.segment = state.segment && structuredClone(state.segment);
    this.pressed = new Map(state.pressed);
    this.queue = state.queue.map((i) => ({ ...i }));
    this.now = state.now;
    this.nextId = state.nextId;
    this.tick = state.tick;
  }
  reset(position: Point, at: number): void {
    this.cell = copy(position);
    this.segment = undefined;
    this.pressed.clear();
    this.queue = [];
    this.now = at;
  }
  /** AI decisions request a held direction, rather than repeated physical taps. */
  steer(direction: Direction | null, at: number): void {
    const previous = this.pressed.get("bot");
    if (previous === direction || (!previous && direction === null)) return;
    if (previous) this.up("bot", at);
    if (direction) this.press("bot", direction, at);
  }
  private press(code: string, direction: Direction, at: number): void {
    this.down(code, at, false, direction);
  }
  tap(direction: Direction | null, at: number): void {
    if (!direction) {
      this.release(at);
      return;
    }
    this.down("bot", at, false, direction);
    this.up("bot", at);
  }
  snapshot(): Snapshot {
    const s = this.segment;
    const progress = s
      ? Math.max(0, Math.min(1, (this.now - s.start) / (s.end - s.start)))
      : 1;
    return {
      cell: copy(this.cell),
      destination: copy(s?.to ?? this.cell),
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
