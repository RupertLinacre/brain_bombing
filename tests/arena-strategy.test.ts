import { describe, expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { ARENAS, type ArenaId } from "../src/game/arenas";
import { predictHazards, nextHazard, safeDuring } from "../src/game/hazards";
import { Bot } from "../src/game/bot";
import {
  COLS,
  ROWS,
  MAX_RANGE,
  key,
  type PlayerId,
  type Question,
} from "../src/game/types";

const question = (): Question => ({
  expression: "3 + 4",
  short: "3+4",
  choices: ["6", "7", "8", "9"],
  correct: 1,
});
const make = (arena: ArenaId = "garden", seed = 42, intro = 0) =>
  new Engine(
    [
      { name: "A", year: "year2" },
      { name: "B", year: "year5" },
    ],
    seed,
    question,
    arena,
    intro,
  );
const advance = (g: Engine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) g.step();
};
const open = (g: Engine) => {
  g.map = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      !x || !y || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
  g.brains = [];
};
const solve = (g: Engine, id: PlayerId) => {
  const brain = g.brains.find((b) => b.owner === id)!;
  Object.assign(g.players[id], { x: brain.x, y: brain.y });
  g.act(id, { type: "answer", brain: brain.id, choice: 1 });
};

describe("arena variety", () => {
  for (const arena of ARENAS)
    it(`${arena.name} gives both players fair starts and private reachable brains`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const g = make(arena.id, seed);
        expect(g.view(1).arena).toBe(arena.id);
        for (const p of g.players) {
          const reachable = new Set(g.reachable(p).map(key));
          expect(reachable.size).toBeGreaterThanOrEqual(6);
          expect(g.brains.filter((b) => b.owner === p.id)).toHaveLength(3);
          for (const b of g.brains.filter((b) => b.owner === p.id))
            expect(reachable.has(key(b))).toBe(true);
        }
        for (let y = 0; y < ROWS; y++)
          for (let x = 0; x < COLS; x++)
            expect(g.map[y][x]).toBe(g.map[ROWS - 1 - y][COLS - 1 - x]);
      }
    });
  it("provides open cross lanes in Ember and a larger central plaza in Neon", () => {
    const ember = make("ember"),
      neon = make("arcade");
    expect(ember.map[5].slice(1, -1).every((tile) => tile === 0)).toBe(true);
    expect(ember.map.slice(1, -1).every((row) => row[7] === 0)).toBe(true);
    expect(
      neon.map
        .slice(3, 8)
        .every((row) => row.slice(5, 10).every((tile) => tile !== 1)),
    ).toBe(true);
    expect(make("garden").map).not.toEqual(neon.map);
  });
});

describe("earned flame progression", () => {
  for (const id of [0, 1] as const)
    it(`gives player ${id} one bomb per answer, plus reach every third brain`, () => {
      const g = make();
      for (let n = 1; n <= 15; n++) {
        solve(g, id);
        expect(g.players[id].bombs).toBe(n);
        expect(g.players[id].range).toBe(
          Math.min(MAX_RANGE, 2 + Math.floor(n / 3)),
        );
      }
      expect(g.view(id ? 0 : 1).players[id].range).toBe(MAX_RANGE);
      expect(make().players[id].range).toBe(2);
    });
  it("does not advance power for wrong answers or change an already placed bomb", () => {
    const g = make();
    solve(g, 0);
    g.act(0, { type: "bomb" });
    solve(g, 0);
    const brain = g.brains.find((b) => b.owner === 0)!;
    Object.assign(g.players[0], { x: brain.x, y: brain.y });
    g.act(0, { type: "answer", brain: brain.id, choice: 0 });
    expect(g.players[0].solved).toBe(2);
    expect(g.players[0].range).toBe(2);
    // A retry uses the normal cooldown; correct answers still earn one bomb.
    brain.retryAt = 0;
    g.act(0, { type: "answer", brain: brain.id, choice: 1 });
    expect(g.players[0].range).toBe(3);
    expect(g.players[0].bombs).toBe(2);
    expect(g.bombs[0].range).toBe(2);
  });
});

describe("public blast forecasts", () => {
  it("warns for chain reactions at the shortened fuse time", () => {
    const g = make();
    open(g);
    g.bombs = [
      { id: 101, x: 5, y: 5, range: 2, owner: 0, pass: [], explodesAt: 0.8 },
      { id: 102, x: 7, y: 5, range: 3, owner: 1, pass: [], explodesAt: 2.6 },
    ];
    expect(nextHazard(predictHazards(g), { x: 7, y: 7 }, 0)?.at).toBe(0.8);
  });
  it("forecasts later blasts through earlier destroyed crates without changing live terrain", () => {
    const g = make();
    open(g);
    g.map[3][5] = 2;
    g.bombs = [
      { id: 101, x: 5, y: 5, range: 2, owner: 0, pass: [], explodesAt: 1 },
      { id: 102, x: 3, y: 3, range: 4, owner: 1, pass: [], explodesAt: 2 },
    ];
    expect(nextHazard(predictHazards(g), { x: 7, y: 3 }, 0)?.at).toBe(2);
    expect(g.map[3][5]).toBe(2);
    advance(g, 2.05);
    expect(g.flames.some((f) => f.x === 7 && f.y === 3)).toBe(true);
  });
  it("keeps crates blocking all blasts in the same detonation batch", () => {
    const g = make();
    open(g);
    g.map[3][5] = 2;
    g.bombs = [
      { id: 101, x: 5, y: 5, range: 2, owner: 0, pass: [], explodesAt: 1 },
      { id: 102, x: 3, y: 3, range: 4, owner: 1, pass: [], explodesAt: 1 },
    ];
    expect(nextHazard(predictHazards(g), { x: 7, y: 3 }, 0)).toBeUndefined();
  });
  it("treats displayed fire as safe", () => {
    const g = make();
    open(g);
    g.flames = [{ x: 5, y: 5, owner: 0, expiresAt: 0.65 }];
    const danger = predictHazards(g);
    expect(safeDuring(danger, { x: 5, y: 5 }, 0.1, 0.3)).toBe(true);
    expect(safeDuring(danger, { x: 5, y: 5 }, 0.8, 1)).toBe(true);
  });
});

describe("fair starts and better tactics", () => {
  it("holds movement, solving, bomb placement and the round clock for the shared countdown", () => {
    const g = make("ember", 42, 3);
    const bot = new Bot("clever");
    const start = { x: g.players[1].x, y: g.players[1].y };
    g.players[0].bombs = 1;
    g.act(0, { type: "bomb" });
    solve(g, 0);
    bot.update(g);
    advance(g, 2.95);
    expect(g.bombs).toHaveLength(0);
    expect(g.players[0].solved).toBe(0);
    expect({ x: g.players[1].x, y: g.players[1].y }).toEqual(start);
    expect(g.view(1).time).toBe(0);
    expect(g.view(1).readyIn).toBeGreaterThan(0);
    advance(g, 0.05);
    expect(g.readyIn).toBe(0);
    solve(g, 0);
    expect(g.players[0].solved).toBe(1);
    advance(g, 0.1);
    expect(g.time).toBeCloseTo(0.1);
  });
  it("Clever prefers an attack lane to a nearby crate and survives its own blast", () => {
    const g = make();
    open(g);
    Object.assign(g.players[1], { x: 7, y: 5, bombs: 1 });
    Object.assign(g.players[0], { x: 9, y: 7 });
    g.map[4][7] = 2;
    // Keep the bot's questions away from this combat route.
    g.brains = [11, 12, 13].map((x) => ({
      x,
      y: 9,
      id: 700 + x,
      owner: 1,
      question: question(),
      rejected: [],
      retryAt: 0,
    }));
    const bot = new Bot("clever");
    bot.update(g);
    g.step();
    expect(g.bombs).toHaveLength(0);
    expect(g.players[1].y).toBe(6);
    for (let i = 0; i < 90 && g.phase === "playing"; i++) {
      bot.update(g);
      g.step();
    }
    expect(g.players[1].alive).toBe(true);
    expect(g.players[1].bombs).toBe(0);
    expect(g.players[0].lives).toBe(2);
  });
  it("does not spend its last bomb when there is no escape", () => {
    const g = make();
    open(g);
    Object.assign(g.players[1], { x: 7, y: 5, bombs: 1 });
    g.map[4][7] = g.map[6][7] = g.map[5][6] = 1;
    g.map[5][8] = 2;
    new Bot("clever").update(g);
    expect(g.bombs).toHaveLength(0);
    expect(g.players[1].bombs).toBe(1);
  });
});
