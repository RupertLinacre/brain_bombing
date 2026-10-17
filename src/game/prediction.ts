import { GridMovement } from "./movement";
import { overlapFraction } from "./answers";
import {
  same,
  type Action,
  type PlayerId,
  type Point,
  type View,
} from "./types";

type PendingInput = {
  at: number;
  action: Extract<Action, { type: "input" | "release" }>;
};

/** Predict only movement. Bombs, maths rewards, lives and terrain remain authoritative. */
export class MovementPrediction {
  private view?: View;
  private receivedAt = 0;
  private controller?: GridMovement;
  private pending: PendingInput[] = [];
  private epoch = Infinity;
  private player: PlayerId = 0;

  reset(): void {
    this.view = undefined;
    this.controller = undefined;
    this.pending = [];
    this.epoch = Infinity;
  }
  receive(view: View, local: PlayerId, now: number): void {
    const old = this.view;
    const teleported =
      old && old.players[local].lives !== view.players[local].lives;
    if (
      !old ||
      view.time < old.time ||
      teleported ||
      (old.readyIn > 0 && view.readyIn === 0)
    ) {
      this.pending = [];
      this.epoch = now - view.time * 1000;
    }
    this.epoch = Math.min(this.epoch, now - view.time * 1000);
    this.view = view;
    this.receivedAt = now;
    this.player = local;
    this.pending = this.pending.filter(
      (i) => i.action.sequence > view.inputSequence[local],
    );
    const p = view.players[local];
    this.controller = new GridMovement(
      (point) => this.walkable(point, local),
      p,
      () => 170 - p.speed * 18,
    );
    this.controller.restore(view.movement[local]);
    for (const input of this.pending) {
      const at = Math.max(this.controller.state().now, input.at);
      this.apply(input.action, at);
    }
  }
  private walkable(point: Point, id: PlayerId): boolean {
    const v = this.view!;
    return (
      v.map[point.y]?.[point.x] === 0 &&
      !v.bombs.some((b) => same(b, point) && !b.pass.includes(id))
    );
  }
  private apply(action: PendingInput["action"], at: number): void {
    if (action.type === "release") this.controller!.release(at);
    else if (action.down) this.controller!.down(action.code, at);
    else this.controller!.up(action.code, at);
  }
  input(action: Action, now: number): void {
    if (
      !this.controller ||
      !this.view ||
      this.view.readyIn > 0 ||
      this.view.phase !== "playing"
    )
      return;
    if (action.type !== "input" && action.type !== "release") return;
    const at = Math.max(this.controller.state().now, now - this.epoch);
    this.apply(action, at);
    this.pending.push({ action, at });
  }
  present(now: number): View | undefined {
    const view = this.view;
    if (!view || !this.controller) return;
    const players = view.players.map((p) => ({ ...p }));
    if (!view.readyIn && view.phase === "playing") {
      // Cap extrapolation if packets stop; the session handles a full disconnect.
      const at = Math.max(
        this.controller.state().now,
        Math.min(now - this.epoch, view.time * 1000 + 250),
      );
      this.controller.advance(at);
      const state = this.controller.snapshot();
      Object.assign(players[this.player], state.destination, {
        visualX: state.visual.x,
        visualY: state.visual.y,
      });
      if (state.direction) players[this.player].facing = state.direction;
      for (const p of players) {
        if (p.id === this.player || !p.alive) continue;
        const movement = new GridMovement(
          (point) => this.walkable(point, p.id),
          p,
          () => 170 - p.speed * 18,
        );
        movement.restore(view.movement[p.id]);
        movement.advance(
          Math.max(
            view.movement[p.id].now,
            view.time * 1000 + Math.min(100, now - this.receivedAt),
          ),
        );
        const remote = movement.snapshot();
        Object.assign(p, remote.destination, {
          visualX: remote.visual.x,
          visualY: remote.visual.y,
        });
      }
    }
    return { ...view, players };
  }
}

/** Keep a question stable while it overlaps; changing/leaving it clears typing. */
export class DriveByAnswer {
  brain: number | null = null;
  text = "";
  private dismissed: number | null = null;
  update(view: View, local: PlayerId): number | null {
    const p = view.players[local],
      position = { x: p.visualX, y: p.visualY };
    const overlapping =
      p.alive && view.phase === "playing" && view.readyIn === 0
        ? view.brains.filter((b) => overlapFraction(position, b) > 0)
        : [];
    if (!overlapping.some((b) => b.id === this.dismissed))
      this.dismissed = null;
    const available = overlapping.filter((b) => b.id !== this.dismissed);
    const brain =
      available.find((b) => b.id === this.brain) ??
      available.sort(
        (a, b) => overlapFraction(position, b) - overlapFraction(position, a),
      )[0];
    const id = brain?.id ?? null;
    if (id !== this.brain) {
      this.text = "";
      this.brain = id;
    }
    return id;
  }
  dismiss(): void {
    this.dismissed = this.brain;
    this.brain = null;
    this.text = "";
  }
  reset(): void {
    this.dismissed = null;
    this.brain = null;
    this.text = "";
  }
}
