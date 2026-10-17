import { describe, it, expect } from "vitest";
import {
  BrainField,
  makeFieldSetup,
  type FieldSetup,
} from "../src/playground/brain-field";
import { overlapFraction } from "../src/playground/drive-by";
import {
  PrecisionControls,
  makeMap,
  type MovementEvent,
} from "../src/playground/movement";

const setup = (seed = 42, fixture = false): FieldSetup => ({
  seed,
  fixture,
  questions: Array.from({ length: 12 }, (_, i) => ({
    expression: `${i + 7} + 5`,
    answer: String(i + 12),
  })),
});
describe("continuous questions on the controls playground", () => {
  it("generates a varied bank using the maths library", () => {
    const bank = makeFieldSetup();
    expect(bank.questions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(bank.questions.map((q) => q.expression)).size).toBe(
      bank.questions.length,
    );
    expect(bank.questions.every((q) => /^\d{1,2}$/.test(q.answer))).toBe(true);
  });
  it("places three reachable, distinct brains away from crates and the player across seeds", () => {
    const map = makeMap("crates");
    expect(map.flat().filter((t) => t === 2)).toHaveLength(4);
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const field = new BrainField(map, setup(seed)),
        brains = field.snapshot().questions;
      expect(brains).toHaveLength(3);
      expect(new Set(brains.map((b) => `${b.tile.x},${b.tile.y}`)).size).toBe(
        3,
      );
      for (const b of brains) {
        expect(map[b.tile.y][b.tile.x]).toBe(0);
        expect(overlapFraction({ x: 2, y: 2 }, b.tile)).toBe(0);
      }
      layouts.add(JSON.stringify(brains.map((b) => b.tile)));
    }
    expect(layouts.size).toBeGreaterThan(20);
  });
  it("immediately replaces a solved brain, clears typing and accumulates rewards", () => {
    const field = new BrainField(makeMap("crates"), setup());
    for (let i = 0; i < 100; i++) {
      const before = field.snapshot(),
        b = before.questions[i % 3],
        position = { ...b.tile };
      field.edit({ kind: "append", text: b.question.answer }, i * 10, position);
      const after = field.snapshot();
      expect(after.solved).toBe(i + 1);
      expect(after.bombsEarned).toBe(i + 1);
      expect(after.questions).toHaveLength(3);
      expect(after.buffer).toBe("");
      expect(after.questions.some((q) => q.id === b.id)).toBe(false);
      const replacement = after.questions.find(
        (q) => !before.questions.some((old) => old.id === q.id),
      )!;
      expect(replacement).toBeDefined();
      expect(overlapFraction(position, replacement.tile)).toBe(0);
      expect(after.questions.map((q) => q.tile)).not.toContainEqual(b.tile);
      const otherIds = before.questions
        .filter((q) => q.id !== b.id)
        .map((q) => q.id);
      expect(
        after.questions.filter((q) => otherIds.includes(q.id)),
      ).toHaveLength(2);
    }
  });
  it("recreates exactly the same board and replacements from its exported setup", () => {
    const a = new BrainField(makeMap("crates"), setup(934)),
      b = new BrainField(makeMap("crates"), setup(934));
    expect(a.snapshot()).toEqual(b.snapshot());
    for (let i = 0; i < 10; i++) {
      const q = a.snapshot().questions[0];
      a.edit({ kind: "append", text: q.question.answer }, i * 20, q.tile);
      b.edit({ kind: "append", text: q.question.answer }, i * 20, q.tile);
      expect(a.snapshot()).toEqual(b.snapshot());
    }
  });
  it("prepares one answer outside then solves only the matching overlapping brain", () => {
    const field = new BrainField(makeMap("crates"), setup()),
      b = field.snapshot().questions[0];
    field.edit({ kind: "append", text: b.question.answer }, 0, { x: 2, y: 2 });
    expect(field.snapshot().solved).toBe(0);
    field.sample(10, b.tile);
    expect(field.snapshot().solved).toBe(1);
    field.sample(20, b.tile);
    expect(field.snapshot().solved).toBe(1);
    expect(field.snapshot().buffer).toBe("");
  });
  it("rejects a wrong answer and preserves correction without changing the board", () => {
    const field = new BrainField(makeMap("crates"), setup()),
      b = field.snapshot().questions[0];
    field.edit({ kind: "append", text: "999" }, 0, b.tile);
    expect(field.snapshot().solved).toBe(0);
    expect(field.snapshot().questions).toHaveLength(3);
    field.edit({ kind: "clear" }, 1, b.tile);
    field.edit({ kind: "append", text: b.question.answer }, 2, b.tile);
    expect(field.snapshot().solved).toBe(1);
  });
  it.each([
    [
      { x: 3.799999, y: 2 },
      { x: 3.8, y: 2 },
    ],
    [
      { x: 2.200001, y: 2 },
      { x: 2.2, y: 2 },
    ],
    [
      { x: 3, y: 2.799999 },
      { x: 3, y: 2.8 },
    ],
    [
      { x: 3, y: 1.200001 },
      { x: 3, y: 1.2 },
    ],
  ])(
    "keeps unfinished typing until the last overlap disappears: %j → %j",
    (partial, outside) => {
      const events: MovementEvent[] = [],
        field = new BrainField(makeMap("crates"), setup(42, true), (e) =>
          events.push(e),
        );
      field.edit({ kind: "append", text: "1" }, 10, { x: 3, y: 2 });
      field.sample(20, partial);
      expect(field.snapshot().buffer).toBe("1");
      field.sample(30, outside);
      expect(field.snapshot().buffer).toBe("");
      expect(events.filter((e) => e.kind === "answer-cleared")).toHaveLength(1);
      field.sample(40, { x: 3, y: 2 });
      field.edit({ kind: "append", text: "2" }, 50, { x: 3, y: 2 });
      expect(field.snapshot().solved).toBe(0);
      expect(field.snapshot().buffer).toBe("2");
      field.edit({ kind: "clear" }, 60, { x: 3, y: 2 });
      field.edit({ kind: "append", text: "12" }, 70, { x: 3, y: 2 });
      expect(field.snapshot().solved).toBe(1);
    },
  );
  it("does not carry an answer from a departed brain into a different question", () => {
    const field = new BrainField(makeMap("crates"), setup(42, true)),
      [first, second] = field.snapshot().questions;
    field.edit(
      { kind: "append", text: second.question.answer },
      10,
      first.tile,
    );
    expect(field.snapshot().buffer).toBe(second.question.answer);
    field.sample(20, second.tile);
    expect(field.snapshot().buffer).toBe("");
    expect(field.snapshot().solved).toBe(0);
  });
  it("keeps the drive-by replay reproducible with three questions and crates", () => {
    const events: MovementEvent[] = [],
      map = makeMap("crates"),
      field = new BrainField(map, setup(42, true), (e) => events.push(e)),
      c = new PrecisionControls(map);
    c.down("ArrowRight", 10);
    c.advance(55);
    field.edit({ kind: "append", text: "1" }, 55, c.snapshot().visual);
    c.advance(70);
    field.edit({ kind: "append", text: "2" }, 70, c.snapshot().visual);
    expect(field.snapshot().lastSolved!.at).toBe(70);
    expect(field.snapshot().lastSolved!.position.x).toBeLessThan(3);
    expect(field.snapshot().questions).toHaveLength(3);
    c.up("ArrowRight", 350);
    c.advance(800);
    field.sample(800, c.snapshot().visual);
    expect(c.snapshot().cell).toEqual({ x: 4, y: 2 });
    expect(events.filter((e) => e.kind === "answer-accepted")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "brain-spawn")).toHaveLength(4);
  });
  it("treats crates as solid obstacles without spending a buffered input through them", () => {
    const c = new PrecisionControls(makeMap("crates"));
    c.down("ArrowRight", 0);
    c.up("ArrowRight", 1);
    c.advance(200);
    c.down("ArrowUp", 210);
    c.up("ArrowUp", 220);
    c.advance(1000);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 2 });
  });
});
