import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { FeedbackTracker } from "../src/game/feedback";
import type { Bomb } from "../src/game/types";

const makeGame = () =>
  new Engine(
    [
      { name: "A", year: "year1" },
      { name: "B", year: "year1" },
    ],
    4,
  );
const bomb = (id: number, x: number, at = 0.01): Bomb => ({
  id,
  x,
  y: 1,
  owner: 0,
  range: 2,
  explodesAt: at,
  pass: [],
});

describe("explosion feedback across snapshots", () => {
  it("reports a detonation even when another placement leaves the bomb count unchanged", () => {
    const game = makeGame(),
      tracker = new FeedbackTracker();
    game.map[1][3] = game.map[1][4] = game.map[1][5] = 0;
    game.bombs = [bomb(900, 3)];
    tracker.reset(game.view(0));
    game.bombs.push(bomb(901, 12, 5));
    game.step();
    const view = game.view(0),
      feedback = tracker.consume(view, 0);
    expect(view.bombs).toHaveLength(1);
    expect(feedback.explosions.map((e) => e.id)).toEqual([900]);
    expect(feedback.placed.map((e) => e.id)).toEqual([901]);
    expect(tracker.consume(view, 0).explosions).toHaveLength(0);
  });

  it("retains events past the flame lifetime, then expires them", () => {
    const game = makeGame(),
      tracker = new FeedbackTracker();
    game.players[0].y = 3;
    game.map[1][3] = 0;
    tracker.reset(game.view(0));
    game.bombs = [bomb(900, 3)];
    game.step();
    for (let i = 0; i < 16; i++) game.step();
    expect(game.flames).toHaveLength(0);
    expect(tracker.consume(game.view(0), 0).explosions).toHaveLength(1);
    for (let i = 0; i < 20; i++) game.step();
    expect(game.explosions).toHaveLength(0);
  });

  it("marks chain detonations and sends independent copies of affected tiles", () => {
    const game = makeGame();
    game.map[1][3] = game.map[1][4] = game.map[1][5] = 0;
    game.map[1][6] = 2;
    game.bombs = [bomb(900, 3), bomb(901, 5, 10)];
    game.step();
    const view = game.view(0);
    expect(view.explosions).toHaveLength(2);
    expect(view.explosions[0].chain).toBe(false);
    expect(view.explosions[1].chain).toBe(true);
    expect(view.explosions[1].crates).toContainEqual({ x: 6, y: 1 });
    view.explosions[0].cells[0].x = 99;
    expect(game.explosions[0].cells[0].x).toBe(3);
  });

  it("keeps question and correct-answer sounds private to the local player", () => {
    const game = makeGame(),
      own = new FeedbackTracker(),
      other = new FeedbackTracker();
    own.reset(game.view(0));
    other.reset(game.view(1));
    game.players[0].solved++;
    game.players[0].bombs++;
    expect(own.consume(game.view(0), 0).solved).toBe(true);
    expect(other.consume(game.view(1), 1).solved).toBe(false);
  });

  it("re-arms feedback for reused bomb ids in a new round", () => {
    const game = makeGame(),
      tracker = new FeedbackTracker();
    game.map[1][3] = 0;
    game.bombs = [bomb(900, 3)];
    game.step();
    expect(tracker.consume(game.view(0), 0).explosions).toHaveLength(1);
    tracker.reset();
    expect(tracker.consume(game.view(0), 0).explosions).toHaveLength(1);
  });
});
