import type { Engine } from "./engine";
import {
  DIRECTIONS,
  FUSE_SECONDS,
  same,
  key,
  type Direction,
  type Point,
  type Bomb,
  MAX_RANGE,
} from "./types";

import {
  predictHazards,
  nextHazard,
  safeDuring,
  type HazardMap,
} from "./hazards";

type Route = { cell: Point; path: Direction[] };
export type BotPace = "starter" | "chill" | "clever";

/** The bot has the same movement, questions, ammunition and hazards as a human. */
export class Bot {
  private nextThink = 0;
  private solving: number | null = null;
  private answerAt = 0;
  private target = "";
  constructor(private pace: BotPace = "chill") {}

  update(game: Engine): void {
    if (
      game.readyIn > 0 ||
      game.time < this.nextThink ||
      game.phase === "ended"
    )
      return;
    this.nextThink = game.time + (this.pace === "starter" ? 0.28 : 0.1);
    const p = game.players[1];
    if (!p.alive) return;
    const danger = predictHazards(game);
    const threatened = nextHazard(danger, p, game.time);
    if (threatened) {
      const escape = this.routes(game, danger).find(
        (node) => node.path.length && !nextHazard(danger, node.cell, game.time),
      );
      game.act(1, { type: "move", direction: escape?.path[0] ?? null });
      this.target = "";
      this.solving = null;
      return;
    }
    const brain = game.activeBrain(1);
    if (brain) {
      game.act(1, { type: "move", direction: null });
      if (this.solving !== brain.id) {
        this.solving = brain.id;
        const answerTime =
          this.pace === "clever" ? 2.8 : this.pace === "chill" ? 5.2 : 8.5;
        this.answerAt =
          game.time +
          answerTime +
          game.random() * (this.pace === "starter" ? 3 : 1.8);
      }
      if (game.time >= this.answerAt)
        game.act(1, {
          type: "answer",
          brain: brain.id,
          choice: brain.question.correct,
        });
      return;
    }
    this.solving = null;
    // Score destinations by what they achieve, not their order in a flood fill.
    const candidates = this.routes(game, danger)
      .flatMap((node) => {
        if (nextHazard(danger, node.cell, game.time)) return [];
        const pickup = game.pickups.find((item) => same(item, node.cell));
        const brain = game.brains.find(
          (b) => b.owner === 1 && same(b, node.cell),
        );
        let value = 0,
          kind = "";
        if (brain) {
          value =
            p.bombs === 0
              ? 40
              : this.pace === "starter"
                ? p.bombs === 1
                  ? 6
                  : 1
                : p.bombs === 1
                  ? 12
                  : 3;
          kind = "brain";
        }
        if (
          pickup &&
          ((pickup.kind === "fire" && p.range < MAX_RANGE) ||
            (pickup.kind === "speed" && p.speed < 3))
        ) {
          value = p.bombs ? 15 : 7;
          kind = "pickup";
        }
        if (p.bombs && !game.bombs.some((b) => same(b, node.cell))) {
          const blast = game.blastCells({ ...node.cell, range: p.range });
          const crates = blast.filter(
            (cell) => game.map[cell.y][cell.x] === 2,
          ).length;
          const attack = blast.some((cell) => same(cell, game.players[0]));
          const placement =
            crates *
              (this.pace === "clever" ? 4 : this.pace === "chill" ? 3 : 2) +
            (attack
              ? this.pace === "clever"
                ? 23
                : this.pace === "chill"
                  ? 13
                  : 0
              : 0);
          if (placement > value) {
            value = placement;
            kind = "bomb";
          }
        }
        if (!value || (!node.path.length && kind !== "bomb")) return [];
        const target = `${kind}:${key(node.cell)}`;
        const score =
          value - node.path.length * 0.85 + (target === this.target ? 1.2 : 0);
        return [{ ...node, kind, score, target }];
      })
      .sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      if (candidate.path.length) {
        this.target = candidate.target;
        game.act(1, { type: "move", direction: candidate.path[0] });
        return;
      }
      const proposed: Bomb = {
        x: p.x,
        y: p.y,
        id: -1,
        owner: 1,
        pass: [1],
        explodesAt: game.time + FUSE_SECONDS,
        range: p.range,
      };
      const future = predictHazards(game, proposed);
      const escape = this.routes(game, future).find(
        (node) => node.path.length && !nextHazard(future, node.cell, game.time),
      );
      if (escape) {
        game.act(1, { type: "bomb" });
        game.act(1, { type: "move", direction: escape.path[0] });
        this.target = "";
        return;
      }
    }
    game.act(1, { type: "move", direction: null });
  }

  private routes(game: Engine, danger: HazardMap): Route[] {
    const start = game.players[1],
      seen = new Set([key(start)]);
    const queue: Route[] = [{ cell: start, path: [] }];
    // Movement is quantized to simulation ticks, with time for the next bot decision.
    const stride = Math.ceil((0.17 - start.speed * 0.018) / 0.05) * 0.05;
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      for (const [dir, delta] of Object.entries(DIRECTIONS)) {
        const cell = { x: node.cell.x + delta.x, y: node.cell.y + delta.y };
        const arrival = game.time + (node.path.length + 1) * stride;
        if (
          seen.has(key(cell)) ||
          !game.walkable(cell, 1) ||
          !safeDuring(danger, cell, arrival - 0.15, arrival + stride + 0.1)
        )
          continue;
        seen.add(key(cell));
        queue.push({ cell, path: [...node.path, dir as Direction] });
      }
    }
    return queue;
  }
}
