import { describe, expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { DriveByAnswer, MovementPrediction } from "../src/game/prediction";
import { overlapFraction } from "../src/game/answers";
import { validAction } from "../src/network/session";
import { COLS, ROWS, type Action, type PlayerId } from "../src/game/types";

function game() {
  const g = new Engine(
    [
      { name: "A", year: "year1" },
      { name: "B", year: "year1" },
    ],
    42,
    () => ({
      expression: "7 + 5",
      short: "7+5",
      choices: ["11", "12", "13", "14"],
      correct: 1,
    }),
  );
  g.map = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      !x || !y || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
  g.brains = [];
  return g;
}
function key(
  g: Engine,
  code: string,
  down: boolean,
  sequence: number,
  id: PlayerId = 0,
) {
  g.act(id, { type: "input", code, down, sequence });
}
function brain(g: Engine, id = 100) {
  g.brains.push({
    id,
    owner: 0,
    x: 2,
    y: 1,
    question: {
      expression: "7 + 5",
      short: "7+5",
      choices: ["11", "12", "13", "14"],
      correct: 1,
    },
    rejected: [],
    retryAt: 0,
  });
}

describe("approved controls in the authoritative game", () => {
  it("starts immediately and preserves two taps before a tick", () => {
    const g = game();
    key(g, "ArrowRight", true, 1);
    key(g, "ArrowRight", false, 2);
    key(g, "ArrowRight", true, 3);
    key(g, "ArrowRight", false, 4);
    expect(g.movement[0].snapshot().moving).toBe(true);
    g.step(0.085);
    expect(g.players[0].visualX).toBeCloseTo(1.5);
    g.step(0.255);
    expect(g.players[0].visualX).toBeCloseTo(3);
    expect(g.movement[0].snapshot().moving).toBe(false);
  });
  it("reverses continuously mid-tile, without waiting for a centre", () => {
    const g = game();
    key(g, "ArrowRight", true, 1);
    g.step(0.06);
    const x = g.players[0].visualX;
    key(g, "ArrowLeft", true, 2);
    expect(g.players[0].visualX).toBeCloseTo(x);
    key(g, "ArrowRight", false, 3);
    key(g, "ArrowLeft", false, 4);
    g.step(0.03);
    expect(g.players[0].visualX).toBeCloseTo(1 + 30 / 170);
    g.step(0.03);
    expect(g.players[0].visualX).toBeCloseTo(1);
  });
  it("lets a key release at the exact centre beat a held repeat already sampled there", () => {
    const g = game();
    key(g, "ArrowRight", true, 1);
    g.step(0.17);
    key(g, "ArrowRight", false, 2);
    g.step(0.4);
    expect(g.players[0].visualX).toBe(2);
  });
  it("clears a repeated hold on focus loss at the exact centre", () => {
    const g = game();
    key(g, "ArrowRight", true, 1);
    g.step(0.17);
    g.act(0, { type: "release", sequence: 2 });
    g.step(0.4);
    expect(g.players[0].visualX).toBe(2);
  });
  it("retreats instead of crossing a bomb placed in its path after a step began", () => {
    const g = game();
    key(g, "ArrowRight", true, 1);
    g.step(0.02);
    const x = g.players[0].visualX;
    g.bombs = [
      { id: 99, x: 2, y: 1, owner: 1, range: 2, explodesAt: 10, pass: [1] },
    ];
    g.step(0.01);
    expect(g.players[0].visualX).toBeLessThan(x);
    g.step(0.3);
    expect(g.players[0].visualX).toBe(1);
  });
  it("keeps a released turn through a junction and respects crates", () => {
    const g = game();
    g.map[2][2] = 2;
    key(g, "ArrowRight", true, 1);
    g.step(0.255);
    key(g, "ArrowDown", true, 2);
    key(g, "ArrowDown", false, 3);
    g.step(0.045);
    key(g, "ArrowRight", false, 4);
    g.step(0.21);
    expect(g.players[0]).toMatchObject({ visualX: 3, visualY: 2 });
  });
  it("honours speed upgrades at the next step, not by warping an active step", () => {
    const g = game();
    g.pickups = [{ x: 2, y: 1, kind: "speed" }];
    key(g, "ArrowRight", true, 1);
    g.step(0.17);
    expect(g.players[0].speed).toBe(1);
    g.step(0.076);
    expect(g.players[0].visualX).toBeCloseTo(2.5);
    key(g, "ArrowRight", false, 2);
    g.step(0.076);
    expect(g.players[0].visualX).toBeCloseTo(3);
  });
  it("clears buffered keys on release and expires an absent peer's hold", () => {
    const g = game();
    key(g, "ArrowRight", true, 1);
    g.step(0.02);
    key(g, "ArrowDown", true, 2);
    g.act(0, { type: "release", sequence: 3 });
    g.step(0.5);
    expect(g.players[0]).toMatchObject({ visualX: 2, visualY: 1 });
    key(g, "ArrowRight", true, 4);
    g.step(1);
    expect(g.movement[0].snapshot().held).toEqual([]);
    expect(g.movement[0].snapshot().moving).toBe(false);
  });
  it("keeps reversals on a fresh bomb safe until fully off, then prevents re-entry", () => {
    const g = game();
    g.players[0].bombs = 1;
    g.act(0, { type: "bomb" });
    key(g, "ArrowRight", true, 1);
    g.step(0.06);
    key(g, "ArrowLeft", true, 2);
    key(g, "ArrowRight", false, 3);
    key(g, "ArrowLeft", false, 4);
    g.step(0.06);
    expect(g.players[0].visualX).toBeCloseTo(1);
    key(g, "ArrowRight", true, 5);
    g.step(0.16);
    key(g, "ArrowLeft", true, 6);
    key(g, "ArrowRight", false, 7);
    key(g, "ArrowLeft", false, 8);
    g.step(0.3);
    expect(g.players[0].visualX).toBeCloseTo(2);
  });
});

describe("drive-by answers in the main game", () => {
  it("answers on approach and departure with continuous movement and exactly one reward", () => {
    for (const at of [0.04, 0.3]) {
      const g = game();
      brain(g);
      key(g, "ArrowRight", true, 1);
      g.step(at);
      expect(g.activeBrain(0)?.id).toBe(100);
      g.act(0, { type: "typed-answer", brain: 100, answer: "12" });
      g.act(0, { type: "typed-answer", brain: 100, answer: "12" });
      expect(g.players[0].solved).toBe(1);
      expect(g.players[0].bombs).toBe(1);
      expect(g.brains.filter((b) => b.owner === 0)).toHaveLength(3);
      key(g, "ArrowRight", false, 2);
      g.step(0.4);
      expect(g.players[0].visualX).toBeGreaterThan(1);
    }
  });
  it("rejects no-overlap answers on both boundaries despite the committed grid destination", () => {
    for (const at of [0.034, 0.306]) {
      const g = game();
      brain(g);
      key(g, "ArrowRight", true, 1);
      g.step(at);
      expect(g.activeBrain(0)).toBeUndefined();
      g.act(0, { type: "typed-answer", brain: 100, answer: "12" });
      expect(g.players[0].solved).toBe(0);
    }
  });
  it("lets a player drop a bomb while a question is open", () => {
    const g = game();
    brain(g);
    g.players[0].bombs = 1;
    key(g, "ArrowRight", true, 1);
    g.step(0.08);
    expect(g.activeBrain(0)?.id).toBe(100);
    g.act(0, { type: "bomb" });
    expect(g.bombs).toHaveLength(1);
    expect(g.bombs[0]).toMatchObject({ x: 1, y: 1 });
  });
  it("dismisses the displayed brain when two adjacent questions overlap", () => {
    const g = game();
    brain(g);
    g.brains.push({ ...g.brains[0], id: 101, x: 3 });
    key(g, "ArrowRight", true, 1);
    g.step(0.27);
    expect(g.activeBrain(0)?.id).toBe(101);
    g.act(0, { type: "dismiss", brain: 100 });
    g.act(0, { type: "typed-answer", brain: 101, answer: "12" });
    expect(g.players[0].solved).toBe(1);
    expect(g.brains.some((b) => b.id === 100)).toBe(true);
  });
  it("keeps unfinished text for tiny overlaps, clears at exit, and starts empty on re-entry", () => {
    const g = game();
    brain(g);
    const answer = new DriveByAnswer();
    key(g, "ArrowRight", true, 1);
    g.step(0.1);
    let v = g.view(0);
    answer.update(v, 0);
    answer.text = "1";
    v.players[0].visualX = 2.799999;
    answer.update(v, 0);
    expect(answer.text).toBe("1");
    v.players[0].visualX = 2.8;
    answer.update(v, 0);
    expect(answer.text).toBe("");
    v.players[0].visualX = 2.79;
    answer.update(v, 0);
    expect(answer.text).toBe("");
    expect(
      overlapFraction({ x: 2.799999, y: 1 }, { x: 2, y: 1 }),
    ).toBeGreaterThan(0);
  });
  it("clears the answer on a different brain, death, dismissal and round reset", () => {
    const g = game();
    brain(g);
    const answer = new DriveByAnswer();
    const v = g.view(0);
    v.players[0].visualX = 2;
    answer.update(v, 0);
    answer.text = "1";
    v.brains[0].id = 101;
    answer.update(v, 0);
    expect(answer.text).toBe("");
    answer.text = "2";
    answer.dismiss();
    expect(answer.update(v, 0)).toBeNull();
    v.players[0].visualX = 3;
    answer.update(v, 0);
    v.players[0].visualX = 2;
    answer.update(v, 0);
    expect(answer.brain).toBe(101);
    answer.text = "3";
    v.players[0].alive = false;
    answer.update(v, 0);
    expect(answer.text).toBe("");
    answer.reset();
    expect(answer.brain).toBeNull();
  });
});

describe("online responsiveness", () => {
  it("predicts an unacknowledged guest tap immediately, then reconciles without replaying it twice", () => {
    const g = game(),
      p = new MovementPrediction();
    p.receive(g.view(1), 1, 1000);
    const down: Action = {
      type: "input",
      code: "ArrowLeft",
      down: true,
      sequence: 1,
    };
    const up: Action = {
      type: "input",
      code: "ArrowLeft",
      down: false,
      sequence: 2,
    };
    p.input(down, 1010);
    p.input(up, 1020);
    expect(p.present(1095)!.players[1].visualX).toBeCloseTo(12.5);
    g.step(0.01);
    g.act(1, down);
    g.step(0.01);
    g.act(1, up);
    g.step(0.03);
    p.receive(g.view(1), 1, 1050);
    expect(p.present(1095)!.players[1].visualX).toBeCloseTo(12.5);
    expect(p.present(1250)!.players[1].visualX).toBeCloseTo(12);
  });
  it("replays outstanding taps onto a newer snapshot and obeys a new obstacle", () => {
    const g = game(),
      p = new MovementPrediction();
    p.receive(g.view(1), 1, 1000);
    p.input(
      { type: "input", code: "ArrowLeft", down: true, sequence: 1 },
      1010,
    );
    p.input(
      { type: "input", code: "ArrowLeft", down: false, sequence: 2 },
      1020,
    );
    g.step(0.005);
    p.receive(g.view(1), 1, 1005);
    expect(p.present(1095)!.players[1].visualX).toBeCloseTo(12.5);
    const fresh = game();
    fresh.map[9][12] = 2;
    p.reset();
    p.receive(fresh.view(1), 1, 2000);
    p.input(
      { type: "input", code: "ArrowLeft", down: true, sequence: 1 },
      2010,
    );
    expect(p.present(2095)!.players[1].visualX).toBe(13);
  });
  it("starts the prediction clock at GO and clears pending input on respawn", () => {
    const g = game(),
      p = new MovementPrediction(),
      v = g.view(1);
    v.readyIn = 3;
    p.receive(v, 1, 1000);
    g.step(0.01);
    p.receive(g.view(1), 1, 4010);
    p.input(
      { type: "input", code: "ArrowLeft", down: true, sequence: 1 },
      4020,
    );
    expect(p.present(4105)!.players[1].visualX).toBeCloseTo(12.5);
    const respawn = g.view(1);
    respawn.players[1].lives = 2;
    p.receive(respawn, 1, 4110);
    expect(p.present(4110)!.players[1].visualX).toBe(13);
  });
  it("validates physical input and rejects stale sequences on the host", () => {
    const g = game();
    key(g, "ArrowRight", true, 2);
    key(g, "ArrowLeft", true, 1);
    expect(g.movement[0].snapshot().held).toEqual(["ArrowRight"]);
    for (const action of [
      { type: "input", code: "__proto__", down: true, sequence: 1 },
      { type: "input", code: "ArrowRight", down: 1, sequence: 1 },
      { type: "input", code: "ArrowRight", down: true, sequence: NaN },
      { type: "release", sequence: 0 },
    ])
      expect(validAction(action)).toBe(false);
    expect(
      validAction({ type: "input", code: "KeyD", down: false, sequence: 2 }),
    ).toBe(true);
    expect(validAction({ type: "release", sequence: 3 })).toBe(true);
  });
});
