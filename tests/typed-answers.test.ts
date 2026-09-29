import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { answersMatch } from "../src/game/answers";
import { validAction } from "../src/network/session";

describe("typed answers", () => {
  it("accepts equivalent numbers and formatted units without evaluating code", () => {
    for (const [a, b] of [
      [" 7.0 ", "7"],
      ["2/4", "0.5"],
      ["½", "1/2"],
      ["1 1/2", "1.5"],
      ["1½", "1.5"],
      ["12 CM", "12cm"],
      ["−3", "-3"],
    ])
      expect(answersMatch(a, b)).toBe(true);
    for (const [a, b] of [
      ["", "0"],
      ["1/0", "0"],
      ["7+0", "7"],
      ["12m", "12cm"],
      ["6", "7"],
    ])
      expect(answersMatch(a, b)).toBe(false);
  });
  it("validates on the host, enforces retry delay and awards only once", () => {
    const g = new Engine(
      [
        { name: "A", year: "year1" },
        { name: "B", year: "year1" },
      ],
      42,
      () => ({
        expression: "3 + 4",
        short: "3+4",
        choices: ["6", "7", "8", "9"],
        correct: 1,
      }),
    );
    const b = g.brains.find((b) => b.owner === 1)!;
    Object.assign(g.players[1], { x: b.x, y: b.y });
    g.act(0, { type: "typed-answer", brain: b.id, answer: "7" });
    expect(g.players[0].solved).toBe(0);
    g.act(1, { type: "typed-answer", brain: b.id, answer: "6" });
    g.act(1, { type: "typed-answer", brain: b.id, answer: "7" });
    expect(g.players[1].solved).toBe(0);
    g.step(0.85);
    g.act(1, { type: "typed-answer", brain: b.id, answer: "7.0" });
    g.act(1, { type: "typed-answer", brain: b.id, answer: "7" });
    expect(g.players[1].solved).toBe(1);
    expect(g.players[1].bombs).toBe(1);
    expect(JSON.stringify(g.view(1))).not.toContain('"correct"');
  });
  it("rejects malformed network submissions", () => {
    expect(validAction({ type: "typed-answer", brain: 1, answer: "7" })).toBe(
      true,
    );
    for (const answer of [7, null, "", " ", "7".repeat(101)])
      expect(validAction({ type: "typed-answer", brain: 1, answer })).toBe(
        false,
      );
  });
});
