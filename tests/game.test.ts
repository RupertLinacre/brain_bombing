import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { Bot } from "../src/game/bot";
import { makeQuestion } from "../src/game/questions";
import { validAction } from "../src/network/session";
import {
  YEARS,
  COLS,
  ROWS,
  key,
  same,
  type Question,
  type YearLevel,
} from "../src/game/types";

const question = (year: YearLevel): Question => ({
  expression: `${year}: 3 + 4`,
  short: "3+4",
  choices: ["6", "7", "8", "9"],
  correct: 1,
});
const game = (seed = 16) =>
  new Engine(
    [
      { name: "A", year: "year1" },
      { name: "B", year: "year6" },
    ],
    seed,
    question,
  );
function clear(g: Engine): void {
  g.map = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      !x || !y || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
  g.brains = [];
  g.pickups = [];
}
function advance(g: Engine, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) g.step();
}

describe("maths generator integration", () => {
  for (const year of YEARS)
    it(`uses real ${year} short expressions and four distinct choices`, () => {
      for (let i = 0; i < 80; i++) {
        const q = makeQuestion(year);
        expect(q.expression.length).toBeGreaterThan(0);
        expect(q.short.length).toBeGreaterThan(0);
        expect(new Set(q.choices).size).toBe(4);
        expect(q.correct).toBeGreaterThanOrEqual(0);
        expect(q.correct).toBeLessThan(4);
      }
    });
});

describe("brains and private views", () => {
  it("starts with zero ammunition and three reachable private brains each on symmetric maps", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = game(seed);
      for (const p of g.players) {
        expect(p.bombs).toBe(0);
        const reachable = new Set(g.reachable(p).map(key));
        const brains = g.brains.filter((b) => b.owner === p.id);
        expect(brains).toHaveLength(3);
        for (const b of brains) expect(reachable.has(key(b))).toBe(true);
      }
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
          expect(g.map[y][x]).toBe(g.map[ROWS - 1 - y][COLS - 1 - x]);
    }
  });
  it("sends each player only their own questions and never sends correct answers", () => {
    const g = game();
    for (const id of [0, 1] as const) {
      const v = g.view(id),
        enemyBrains = g.brains.filter((b) => b.owner !== id);
      expect(v.brains).toHaveLength(3);
      expect(v.players).toHaveLength(2);
      expect(
        v.brains.every((b) => b.expression.startsWith(id ? "year6" : "year1")),
      ).toBe(true);
      expect(
        v.brains.some((b) => enemyBrains.some((enemy) => enemy.id === b.id)),
      ).toBe(false);
      expect(JSON.stringify(v)).not.toContain("correct");
    }
  });
  it("requires contact, awards exactly one bomb, consumes the brain and prevents replay", () => {
    const g = game(),
      b = g.brains[0];
    g.act(0, { type: "answer", brain: b.id, choice: 1 });
    expect(g.players[0].bombs).toBe(0);
    Object.assign(g.players[0], { x: b.x, y: b.y });
    g.act(0, { type: "answer", brain: b.id, choice: 1 });
    expect(g.players[0].bombs).toBe(1);
    expect(g.players[0].solved).toBe(1);
    expect(g.brains.some((brain) => brain.id === b.id)).toBe(false);
    g.act(0, { type: "answer", brain: b.id, choice: 1 });
    expect(g.players[0].bombs).toBe(1);
    expect(g.brains.filter((brain) => brain.owner === 0)).toHaveLength(3);
  });
  it("wrong answers add no bombs and enforce a brief retry delay", () => {
    const g = game(),
      b = g.brains[0];
    Object.assign(g.players[0], { x: b.x, y: b.y });
    g.act(0, { type: "answer", brain: b.id, choice: 0 });
    expect(b.rejected).toEqual([0]);
    expect(g.players[0].bombs).toBe(0);
    g.act(0, { type: "answer", brain: b.id, choice: 1 });
    expect(g.players[0].bombs).toBe(0);
    advance(g, 0.85);
    g.act(0, { type: "answer", brain: b.id, choice: 1 });
    expect(g.players[0].bombs).toBe(1);
  });
  it("a rival cannot collect or answer the other player’s brain", () => {
    const g = game(),
      b = g.brains[0];
    Object.assign(g.players[1], { x: b.x, y: b.y });
    g.act(1, { type: "answer", brain: b.id, choice: 1 });
    expect(g.players[1].bombs).toBe(0);
  });
  it("snapshots cannot mutate the authoritative state", () => {
    const g = game(),
      v = g.view(0);
    v.map[1][1] = 1;
    v.players[0].bombs = 99;
    v.brains[0].choices[0] = "cheat";
    expect(g.map[1][1]).toBe(0);
    expect(g.players[0].bombs).toBe(0);
    expect(g.brains[0].question.choices[0]).toBe("6");
  });
});

describe("arena combat", () => {
  it("keeps short key taps that begin and end between ticks", () => {
    const g = game();
    clear(g);
    g.act(0, { type: "move", direction: "right" });
    g.act(0, { type: "move", direction: null });
    g.step();
    expect(g.players[0].x).toBe(2);
    advance(g, 0.4);
    expect(g.players[0].x).toBe(2);
  });
  it("does not place free bombs or allow duplicate bombs on a tile", () => {
    const g = game();
    g.act(0, { type: "bomb" });
    expect(g.bombs).toHaveLength(0);
    g.players[0].bombs = 2;
    g.act(0, { type: "bomb" });
    g.act(0, { type: "bomb" });
    expect(g.bombs).toHaveLength(1);
    expect(g.players[0].bombs).toBe(1);
  });
  it("starts each player with three lives and gives placed bombs a 3.6-second fuse", () => {
    const g = game();
    expect(g.players.map((p) => p.lives)).toEqual([3, 3]);
    g.players[0].bombs = 1;
    g.act(0, { type: "bomb" });
    expect(g.bombs[0].explodesAt - g.time).toBeCloseTo(3.6);
    advance(g, 3.55);
    expect(g.bombs).toHaveLength(1);
    advance(g, 0.1);
    expect(g.bombs).toHaveLength(0);
  });
  it("loses one life on an explosion, respawns safely, and gets a short shield", () => {
    const g = game();
    clear(g);
    Object.assign(g.players[0], { x: 5, y: 5, visualX: 5, visualY: 5 });
    g.bombs = [
      { id: 90, x: 5, y: 5, owner: 1, range: 2, explodesAt: 0.01, pass: [] },
      { id: 93, x: 5, y: 3, owner: 1, range: 3, explodesAt: 0.01, pass: [] },
    ];
    g.step();
    expect(g.players[0].lives).toBe(2);
    expect(g.players[0].alive).toBe(true);
    expect(g.players[0]).toMatchObject({ x: 1, y: 1, visualX: 1, visualY: 1 });
    expect(g.players[0].invulnerableUntil).toBeGreaterThan(g.time);
    // A simultaneous overlapping blast costs only one life.
    expect(g.players[0].lives).toBe(2);
  });
  it("makes the lingering flame visual-only and does not let it trigger a later bomb", () => {
    const g = game();
    clear(g);
    Object.assign(g.players[0], { x: 5, y: 5, visualX: 5, visualY: 5 });
    g.flames = [{ x: 5, y: 5, owner: 1, expiresAt: 0.6 }];
    g.bombs = [
      { id: 91, x: 5, y: 5, owner: 0, range: 2, explodesAt: 10, pass: [] },
    ];
    advance(g, 0.5);
    expect(g.players[0].lives).toBe(3);
    expect(g.bombs).toHaveLength(1);
  });
  it("only hits the centre of a blast lane, so a player mostly clear survives", () => {
    const scenario = (explodesAt: number) => {
      const g = game();
      clear(g);
      Object.assign(g.players[0], { x: 5, y: 5, visualX: 5, visualY: 5 });
      Object.assign(g.players[1], { x: 11, y: 8, visualX: 11, visualY: 8 });
      g.bombs = [
        { id: 92, x: 3, y: 5, owner: 1, range: 3, explodesAt, pass: [] },
      ];
      g.act(0, { type: "move", direction: "up" });
      advance(g, explodesAt + 0.01);
      return g;
    };
    // About 30% out of the lane: the player's centre is still caught.
    expect(scenario(0.1).players[0].lives).toBe(2);
    // More than halfway into the next tile: the player's centre has cleared it.
    expect(scenario(0.15).players[0].lives).toBe(3);
  });
  it("lets a player leave a new bomb but blocks returning through it", () => {
    const g = game();
    clear(g);
    g.players[0].bombs = 1;
    g.act(0, { type: "bomb" });
    g.act(0, { type: "move", direction: "right" });
    g.step();
    expect(g.players[0].x).toBe(2);
    expect(g.bombs[0].pass).not.toContain(0);
    g.act(0, { type: "move", direction: "left" });
    advance(g, 0.25);
    expect(g.players[0].x).toBe(2);
  });
  it("blasts cross-shaped paths, stop at steel, and include only the first crate", () => {
    const g = game();
    clear(g);
    g.map[3][5] = 2;
    g.map[2][3] = 1;
    const cells = new Set(g.blastCells({ x: 3, y: 3, range: 5 }).map(key));
    expect(cells.has("5,3")).toBe(true);
    expect(cells.has("6,3")).toBe(false);
    expect(cells.has("3,2")).toBe(false);
    expect(cells.has("4,4")).toBe(false);
    expect(cells.has("3,4")).toBe(true);
  });
  it("chain reactions detonate fresh bombs and destroy crates without leaking through them", () => {
    const g = game();
    clear(g);
    g.map[3][6] = 2;
    g.bombs = [
      { id: 101, x: 3, y: 3, owner: 0, range: 3, explodesAt: 0.01, pass: [] },
      { id: 102, x: 5, y: 3, owner: 1, range: 3, explodesAt: 5, pass: [] },
    ];
    g.step();
    expect(g.bombs).toHaveLength(0);
    expect(g.map[3][6]).toBe(0);
    expect(g.flames.some((f) => f.x === 7 && f.y === 3)).toBe(false);
    expect(g.flames.some((f) => f.x === 5 && f.y === 5)).toBe(true);
  });
  it("the final life is lethal, and simultaneous final hits result in a draw", () => {
    const g = game();
    clear(g);
    Object.assign(g.players[0], { x: 3, y: 3 });
    Object.assign(g.players[1], { x: 4, y: 3 });
    g.players[0].lives = g.players[1].lives = 1;
    g.players[0].bombs = 1;
    g.act(0, { type: "bomb" });
    advance(g, 3.7);
    expect(g.players.every((p) => !p.alive)).toBe(true);
    expect(g.phase).toBe("ended");
    expect(g.winner).toBe("draw");
  });
  it("does not pause bombs while answering a question", () => {
    const g = game(),
      brain = g.brains[0];
    Object.assign(g.players[0], { x: brain.x, y: brain.y });
    g.players[0].lives = 1;
    g.bombs.push({
      id: 99,
      x: brain.x,
      y: brain.y,
      owner: 1,
      range: 2,
      explodesAt: 0.1,
      pass: [0],
    });
    expect(g.activeBrain(0)?.id).toBe(brain.id);
    advance(g, 0.15);
    expect(g.players[0].alive).toBe(false);
    expect(g.winner).toBe(1);
  });
  it("increases and caps reach and speed using pickups", () => {
    const g = game();
    clear(g);
    g.players[0].range = 5;
    g.pickups = [
      { x: 2, y: 1, kind: "fire" },
      { x: 3, y: 1, kind: "fire" },
      { x: 4, y: 1, kind: "speed" },
    ];
    for (let i = 0; i < 3; i++) {
      g.act(0, { type: "move", direction: "right" });
      advance(g, 0.2);
    }
    expect(g.players[0].range).toBe(6);
    expect(g.players[0].speed).toBe(1);
  });
  it("warns before sudden-death walls land and stops ended rounds", () => {
    const g = game();
    clear(g);
    g.time = 135;
    g.step();
    expect(g.closing).not.toBeNull();
    const closing = g.closing!;
    Object.assign(g.players[0], { x: closing.x, y: closing.y });
    g.players[0].lives = 1;
    expect(g.map[closing.y][closing.x]).toBe(0);
    advance(g, 0.85);
    expect(g.map[closing.y][closing.x]).toBe(1);
    expect(g.winner).toBe(1);
    const time = g.time;
    advance(g, 2);
    expect(g.time).toBe(time);
  });
});

describe("computer opponent", () => {
  it("solves real brain encounters, spends earned bombs, and creates space", () => {
    const g = game(4),
      bot = new Bot("clever");
    const cratesBefore = g.map.flat().filter((tile) => tile === 2).length;
    for (let i = 0; i < 1400 && g.phase === "playing"; i++) {
      bot.update(g);
      g.step();
    }
    expect(g.players[1].solved).toBeGreaterThan(1);
    expect(g.map.flat().filter((tile) => tile === 2).length).toBeLessThan(
      cratesBefore,
    );
    expect(g.players[1].bombs).toBeLessThan(g.players[1].solved);
  });
  it("moves to shelter from an imminent cross blast", () => {
    const g = game(),
      bot = new Bot("clever");
    clear(g);
    Object.assign(g.players[1], { x: 7, y: 5 });
    g.bombs = [
      { id: 99, x: 7, y: 5, owner: 0, range: 3, explodesAt: 1.5, pass: [1] },
    ];
    for (let i = 0; i < 40; i++) {
      bot.update(g);
      g.step();
    }
    expect(g.players[1].alive).toBe(true);
    expect(same(g.players[1], { x: 7, y: 5 })).toBe(false);
  });
});

describe("network action validation", () => {
  it("rejects invalid directions, answer indices and malformed data", () => {
    for (const action of [
      null,
      1,
      {},
      { type: "move", direction: "diagonal" },
      { type: "answer", brain: 2, choice: 4 },
      { type: "answer", brain: 2, choice: 1.5 },
    ])
      expect(validAction(action)).toBe(false);
    expect(validAction({ type: "answer", brain: 2, choice: 3 })).toBe(true);
    expect(validAction({ type: "move", direction: null })).toBe(true);
  });
});
