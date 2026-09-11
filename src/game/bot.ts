import type { Engine } from "./engine";
import {
  DIRECTIONS,
  FUSE_SECONDS,
  same,
  key,
  distance,
  type Direction,
  type Point,
  type Bomb,
} from "./types";

/** The bot has the same movement, questions, ammunition and hazards as a human. */
export class Bot {
  private nextThink = 0;
  private solving: number | null = null;
  private answerAt = 0;
  constructor(private pace: "chill" | "clever" = "chill") {}

  update(game: Engine): void {
    if (game.time < this.nextThink || game.phase === "ended") return;
    this.nextThink = game.time + 0.1;
    const p = game.players[1];
    if (!p.alive) return;
    const danger = this.danger(game);
    const threatened =
      danger.has(key(p)) || (game.closing && same(game.closing, p));
    if (threatened) {
      const escape = this.route(
        game,
        (cell) =>
          !danger.has(key(cell)) &&
          (!game.closing || !same(game.closing, cell)),
        danger,
      );
      game.act(1, { type: "move", direction: escape?.[0] ?? null });
      this.solving = null;
      return;
    }
    const brain = game.activeBrain(1);
    if (brain) {
      game.act(1, { type: "move", direction: null });
      if (this.solving !== brain.id) {
        this.solving = brain.id;
        this.answerAt =
          game.time +
          (this.pace === "clever" ? 2.8 : 5.2) +
          game.random() * 1.8;
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
    const blast = game.blastCells({ ...p, range: p.range });
    const usefulBomb = blast.some(
      (cell) => game.map[cell.y][cell.x] === 2 || same(cell, game.players[0]),
    );
    if (p.bombs > 0 && usefulBomb && !game.bombs.some((b) => same(b, p))) {
      const proposed: Bomb = {
        ...p,
        id: -1,
        owner: 1,
        pass: [1],
        explodesAt: game.time + FUSE_SECONDS,
        range: p.range,
      };
      const futureDanger = this.danger(game, proposed);
      const escape = this.route(
        game,
        (cell) => !futureDanger.has(key(cell)),
        futureDanger,
      );
      if (escape?.length) {
        game.act(1, { type: "bomb" });
        game.act(1, { type: "move", direction: escape[0] });
        return;
      }
    }
    const targets: Point[] =
      p.bombs < 2
        ? game.brains.filter((b) => b.owner === 1)
        : [
            ...game.pickups,
            ...game
              .reachable(p, 1)
              .filter(
                (cell) =>
                  distance(cell, game.players[0]) < 3 ||
                  Object.values(DIRECTIONS).some(
                    (d) => game.map[cell.y + d.y]?.[cell.x + d.x] === 2,
                  ),
              ),
          ];
    const route = this.route(
      game,
      (cell) => targets.some((t) => same(t, cell)) && !same(cell, p),
      danger,
    );
    game.act(1, { type: "move", direction: route?.[0] ?? null });
  }

  private danger(game: Engine, extra?: Bomb): Map<string, number> {
    const bombs = [...game.bombs, ...(extra ? [extra] : [])];
    const deadlines = new Map(
      bombs.map((b) => [b.id, b.explodesAt - game.time]),
    );
    // Propagate fuse shortening through chain reactions before planning a route.
    for (let pass = 0; pass < bombs.length; pass++)
      for (const b of bombs) {
        const cells = game.blastCells(b);
        for (const other of bombs)
          if (cells.some((cell) => same(cell, other)))
            deadlines.set(
              other.id,
              Math.min(deadlines.get(other.id)!, deadlines.get(b.id)!),
            );
      }
    const result = new Map<string, number>();
    for (const b of bombs)
      for (const cell of game.blastCells(b))
        result.set(
          key(cell),
          Math.min(result.get(key(cell)) ?? Infinity, deadlines.get(b.id)!),
        );
    for (const flame of game.flames) result.set(key(flame), 0);
    if (game.closing)
      result.set(key(game.closing), game.closing.at - game.time);
    return result;
  }

  private route(
    game: Engine,
    goal: (p: Point) => boolean,
    danger: Map<string, number>,
  ): Direction[] | null {
    const start = game.players[1],
      seen = new Set([key(start)]);
    const queue: { cell: Point; path: Direction[] }[] = [
      { cell: start, path: [] },
    ];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (goal(node.cell) && !danger.has(key(node.cell))) return node.path;
      for (const [dir, delta] of Object.entries(DIRECTIONS)) {
        const cell = { x: node.cell.x + delta.x, y: node.cell.y + delta.y };
        const arrival = (node.path.length + 1) * (0.17 - start.speed * 0.018);
        if (
          seen.has(key(cell)) ||
          !game.walkable(cell, 1) ||
          (danger.get(key(cell)) ?? Infinity) <= arrival + 0.2
        )
          continue;
        seen.add(key(cell));
        queue.push({ cell, path: [...node.path, dir as Direction] });
      }
    }
    return null;
  }
}
