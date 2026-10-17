import { describe, expect, it } from "vitest";
import {
  GridMovement,
  STEP_MS,
  type MovementEvent,
  type Emit,
} from "../src/game/movement";
const makeMap = (layout: "open" | "pillars") =>
  Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) =>
      layout === "pillars" && x % 2 === 1 && y % 2 === 1 ? 1 : 0,
    ),
  );
class PrecisionControls extends GridMovement {
  constructor(map: number[][], emit?: Emit, bufferMs = 220) {
    super(
      (p) => map[p.y]?.[p.x] === 0,
      { x: 2, y: 2 },
      undefined,
      undefined,
      emit,
      bufferMs,
    );
  }
}
const cornerInputs = [
  { at: 10, code: "ArrowRight", down: true },
  { at: 255, code: "ArrowUp", down: true },
  { at: 275, code: "ArrowUp", down: false },
  { at: 300, code: "ArrowRight", down: false },
];

describe("timing-focused movement", () => {
  it("starts on keydown and reverses mid-tile without jumping or changing speed", () => {
    const events: MovementEvent[] = [],
      c = new PrecisionControls(makeMap("open"), (e) => events.push(e));
    c.down("ArrowLeft", 0);
    c.advance(60);
    const before = c.snapshot().visual;
    c.down("ArrowRight", 60);
    expect(c.snapshot().visual).toEqual(before);
    c.up("ArrowLeft", 61);
    c.up("ArrowRight", 62);
    c.advance(90);
    expect(c.snapshot().visual.x).toBeCloseTo(2 - 30 / STEP_MS);
    c.advance(120);
    expect(c.snapshot().cell).toEqual({ x: 2, y: 2 });
    expect(events.find((e) => e.kind === "move")?.latency).toBe(0);
    expect(events.find((e) => e.kind === "reverse")?.latency).toBe(0);
  });
  it("keeps perpendicular turns at centres with no diagonal shortcut", () => {
    const c = new PrecisionControls(makeMap("open"));
    c.down("ArrowRight", 0);
    c.up("ArrowRight", 1);
    c.down("ArrowUp", 70);
    c.up("ArrowUp", 80);
    c.advance(100);
    expect(c.snapshot().visual.y).toBe(2);
    c.advance(200);
    expect(c.snapshot().visual.x).toBe(3);
    expect(c.snapshot().visual.y).toBeCloseTo(2 - 30 / STEP_MS);
    c.advance(340);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 1 });
  });
  it("honours a key release exactly at a tile centre without an extra step", () => {
    const c = new PrecisionControls(makeMap("open"));
    c.down("ArrowRight", 0);
    c.up("ArrowRight", STEP_MS);
    c.advance(600);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 2 });
  });
  it("waits for a blocked turn while continuing an older held direction", () => {
    const map = makeMap("open");
    map[1][3] = 1;
    const c = new PrecisionControls(map, undefined, 400);
    c.down("ArrowRight", 0);
    c.down("ArrowUp", 80);
    c.up("ArrowUp", 90);
    c.up("ArrowRight", 300);
    c.advance(510);
    expect(c.snapshot().cell).toEqual({ x: 4, y: 1 });
  });
  it("expires stale taps and keeps the queue bounded", () => {
    const events: MovementEvent[] = [],
      c = new PrecisionControls(makeMap("open"), (e) => events.push(e), 80);
    c.down("ArrowRight", 0);
    c.up("ArrowRight", 1);
    for (let i = 0; i < 6; i++) {
      c.down("ArrowUp", 10 + i * 5);
      c.up("ArrowUp", 11 + i * 5);
    }
    expect(c.snapshot().queue.length).toBeLessThanOrEqual(2);
    c.advance(1000);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 2 });
    expect(events.some((e) => e.kind === "superseded")).toBe(true);
    expect(events.some((e) => e.kind === "expired")).toBe(true);
  });
  it("ignores OS repeats and does not extend released movement", () => {
    const c = new PrecisionControls(makeMap("open"));
    c.down("ArrowRight", 0);
    c.down("ArrowRight", 50, true);
    c.up("ArrowRight", 60);
    c.advance(500);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 2 });
  });
  it("keeps independent physical keys mapped to the same direction", () => {
    const c = new PrecisionControls(makeMap("open"));
    c.down("ArrowRight", 0);
    c.down("KeyD", 30);
    c.up("ArrowRight", 40);
    expect(c.snapshot().held).toEqual(["KeyD"]);
    c.up("KeyD", 50);
    c.advance(500);
    expect(c.snapshot().cell).toEqual({ x: 4, y: 2 });
  });
  it("clears held keys and buffered steps on blur, finishing only the active step", () => {
    const c = new PrecisionControls(makeMap("open"));
    c.down("ArrowRight", 0);
    c.down("ArrowUp", 20);
    c.release(30);
    c.advance(1000);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 2 });
    expect(c.snapshot().queue).toEqual([]);
    expect(c.snapshot().held).toEqual([]);
  });
  it("never moves outside the board or through a pillar", () => {
    const c = new PrecisionControls(makeMap("pillars"));
    c.down("ArrowRight", 0);
    c.advance(1000);
    c.up("ArrowRight", 1000);
    expect(c.snapshot().cell).toEqual({ x: 4, y: 2 });
    c.down("ArrowUp", 1001);
    c.advance(2000);
    c.up("ArrowUp", 2000);
    expect(c.snapshot().cell).toEqual({ x: 4, y: 0 });
    c.down("ArrowLeft", 2001);
    c.up("ArrowLeft", 2010);
    c.advance(2300);
    c.down("ArrowDown", 2301);
    c.advance(3000);
    expect(c.snapshot().cell).toEqual({ x: 3, y: 0 });
  });
  it("gives the same final result with very different rendering cadences", () => {
    function play(frameMs: number) {
      const c = new PrecisionControls(makeMap("open"));
      let i = 0;
      const inputs = cornerInputs;
      for (let at = 0; at < 1000; at += frameMs) {
        while (i < inputs.length && inputs[i].at <= at) {
          const e = inputs[i++];
          if (e.down) c.down(e.code, e.at);
          else c.up(e.code, e.at);
        }
        c.frame(at);
      }
      return c.snapshot();
    }
    expect(play(7).cell).toEqual(play(100).cell);
    expect(play(7).visual).toEqual(play(100).visual);
  });
});
