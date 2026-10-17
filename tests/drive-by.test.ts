import { describe, expect, it } from "vitest";
import { DriveByBrain, overlapFraction } from "../src/playground/drive-by";
import {
  CurrentControls,
  PrecisionControls,
  keyDirections,
  makeMap,
  type Controller,
  type MovementEvent,
} from "../src/playground/movement";
import { scenarios } from "../src/playground/scenarios";

describe("drive-by answer overlap", () => {
  it("uses positive footprint overlap, including both sides and tiny corner overlaps", () => {
    expect(overlapFraction({ x: 3, y: 2 })).toBeCloseTo(1);
    expect(overlapFraction({ x: 2.35, y: 2 })).toBeCloseTo(0.25);
    expect(overlapFraction({ x: 2.2, y: 2 })).toBe(0);
    expect(overlapFraction({ x: 3.8, y: 2 })).toBe(0);
    expect(overlapFraction({ x: 2.200001, y: 2 })).toBeGreaterThan(0);
    expect(overlapFraction({ x: 3.799999, y: 2 })).toBeGreaterThan(0);
    expect(overlapFraction({ x: 3, y: 1.2 })).toBe(0);
    expect(overlapFraction({ x: 3, y: 2.8 })).toBe(0);
    expect(overlapFraction({ x: 2.21, y: 1.21 })).toBeGreaterThan(0);
    expect(overlapFraction({ x: 2.21, y: 1.19 })).toBe(0);
  });
  it.each([2.2001, 2.35, 3.65, 3.7999])(
    "accepts at x=%s without needing the tile centre",
    (x) => {
      const brain = new DriveByBrain();
      brain.edit({ kind: "append", text: "1" }, 10, { x, y: 2 });
      expect(brain.snapshot().solved).toBe(false);
      brain.edit({ kind: "append", text: "2" }, 11, { x, y: 2 });
      expect(brain.snapshot().acceptedAt).toBe(11);
      expect(brain.snapshot().bombsEarned).toBe(1);
    },
  );
  it("does not accept a late final digit, including on the exact exit boundary", () => {
    const events: MovementEvent[] = [],
      brain = new DriveByBrain((e) => events.push(e));
    brain.edit({ kind: "append", text: "1" }, 100, { x: 3.7, y: 2 });
    brain.edit({ kind: "append", text: "2" }, 110, { x: 3.8, y: 2 });
    expect(brain.snapshot().solved).toBe(false);
    expect(brain.snapshot().missedWindows).toBe(1);
    expect(brain.snapshot().buffer).toBe("2");
    expect(events.some((e) => e.kind === "answer-cleared")).toBe(true);
    brain.sample(120, { x: 4, y: 2 });
    expect(brain.snapshot().solved).toBe(false);
    brain.sample(150, { x: 3.79, y: 2 });
    expect(brain.snapshot().solved).toBe(false);
    brain.edit({ kind: "clear" }, 160, { x: 3.79, y: 2 });
    brain.edit({ kind: "append", text: "12" }, 170, { x: 3.79, y: 2 });
    expect(brain.snapshot().acceptedAt).toBe(170);
  });
  it("can prepare an answer before entry, accepting only once overlap actually begins", () => {
    const events: MovementEvent[] = [],
      brain = new DriveByBrain((e) => events.push(e));
    brain.edit({ kind: "append", text: "12" }, 10, { x: 2, y: 2 });
    brain.sample(20, { x: 2.2, y: 2 });
    expect(brain.snapshot().bombsEarned).toBe(0);
    brain.sample(30, { x: 2.2001, y: 2 });
    brain.sample(40, { x: 3, y: 2 });
    brain.edit({ kind: "append", text: "12" }, 50, { x: 3, y: 2 });
    expect(brain.snapshot().acceptedAt).toBe(30);
    expect(brain.snapshot().bombsEarned).toBe(1);
    expect(events.filter((e) => e.kind === "answer-accepted")).toHaveLength(1);
  });
  it("allows corrections during a pass and clears unfinished input on exit", () => {
    const brain = new DriveByBrain();
    brain.edit({ kind: "append", text: "19" }, 10, { x: 2.4, y: 2 });
    expect(brain.snapshot().solved).toBe(false);
    brain.edit({ kind: "backspace" }, 20, { x: 2.5, y: 2 });
    expect(brain.snapshot().buffer).toBe("1");
    brain.sample(100, { x: 4, y: 2 });
    expect(brain.snapshot().buffer).toBe("");
    expect(brain.snapshot().lastWindowMs).toBe(90);
    brain.edit({ kind: "clear" }, 110, { x: 4, y: 2 });
    expect(brain.snapshot().buffer).toBe("");
    brain.edit({ kind: "append", text: "12" }, 150, { x: 3.7, y: 2 });
    expect(brain.snapshot().solved).toBe(true);
  });
});

describe("moving and answering on the same timeline", () => {
  function replay(controller: Controller) {
    const events: MovementEvent[] = [],
      brain = new DriveByBrain((e) => events.push(e));
    let i = 0;
    for (let at = 0; at <= 800; at += 10) {
      while (
        i < scenarios.driveby.inputs.length &&
        scenarios.driveby.inputs[i].at <= at
      ) {
        const e = scenarios.driveby.inputs[i++];
        if (keyDirections[e.code]) {
          if (e.down) controller.down(e.code, e.at, e.repeat);
          else controller.up(e.code, e.at);
        } else controller.advance(e.at);
        if (e.down && e.answer)
          brain.edit(e.answer, e.at, controller.snapshot().visual);
        else brain.sample(e.at, controller.snapshot().visual);
      }
      controller.frame(at);
      brain.sample(at, controller.snapshot().visual);
    }
    return { controller, brain, events };
  }
  it("accepts before the first tile centre while the arrow stays held, then continues to the next tile", () => {
    const { controller, brain, events } = replay(
      new PrecisionControls(makeMap("open")),
    );
    expect(brain.snapshot().acceptedAt).toBe(70);
    expect(brain.snapshot().acceptedPosition!.x).toBeCloseTo(2 + 60 / 170);
    expect(controller.snapshot().cell).toEqual({ x: 4, y: 2 });
    expect(events.filter((e) => e.kind === "answer-accepted")).toHaveLength(1);
    expect(events.find((e) => e.kind === "brain-exit")!.at).toBeGreaterThan(
      300,
    );
  });
  it("uses the current controller's visible position rather than its prematurely committed grid destination", () => {
    const { controller, brain } = replay(new CurrentControls(makeMap("open")));
    expect(brain.snapshot().acceptedAt).toBeGreaterThan(70);
    expect(brain.snapshot().acceptedPosition!.x).toBeGreaterThan(2.2);
    expect(controller.snapshot().cell).toEqual({ x: 4, y: 2 });
    expect(brain.snapshot().bombsEarned).toBe(1);
  });
});
