import { answersMatch } from "../game/answers";
import type { Point } from "../game/types";
import type { Emit } from "./movement";

/** The outline drawn around the player is exactly this acceptance footprint. */
export const ANSWER_HALF_SIZE = 0.3;
export const BRAIN_TILE = { x: 3, y: 2 };
export const DRILL_QUESTION = { expression: "7 + 5", answer: "12" };
export type AnswerEdit = {
  kind: "append" | "backspace" | "clear";
  text?: string;
};

/** Fraction of the player's footprint that overlaps the question's tile.
 * Touching edges have no area and do not count. Grid ownership is irrelevant. */
export function overlapFraction(
  position: Point,
  brain: Point = BRAIN_TILE,
): number {
  const width =
    Math.min(position.x + ANSWER_HALF_SIZE, brain.x + 0.5) -
    Math.max(position.x - ANSWER_HALF_SIZE, brain.x - 0.5);
  const height =
    Math.min(position.y + ANSWER_HALF_SIZE, brain.y + 0.5) -
    Math.max(position.y - ANSWER_HALF_SIZE, brain.y - 0.5);
  if (width <= 1e-9 || height <= 1e-9) return 0;
  return Math.min(1, (width * height) / (4 * ANSWER_HALF_SIZE ** 2));
}

export class DriveByBrain {
  private buffer = "";
  private inside = false;
  private overlap = 0;
  private enteredAt: number | null = null;
  private lastWindowMs: number | null = null;
  private acceptedAt: number | null = null;
  private acceptedPosition: Point | null = null;
  private missedWindows = 0;
  private windowCount = 0;
  constructor(
    private emit: Emit = () => {},
    readonly tile = BRAIN_TILE,
    readonly question = DRILL_QUESTION,
  ) {}

  sample(at: number, position: Point): void {
    this.overlap = overlapFraction(position, this.tile);
    const inside = this.overlap > 0;
    if (inside !== this.inside) {
      this.inside = inside;
      if (inside) {
        this.enteredAt = at;
        this.windowCount++;
        this.emit({
          at,
          kind: "brain-enter",
          note: `Answer window opens at (${position.x.toFixed(3)}, ${position.y.toFixed(3)}) · ${(this.overlap * 100).toFixed(1)}% overlap`,
        });
      } else {
        this.lastWindowMs = at - (this.enteredAt ?? at);
        this.emit({
          at,
          kind: "brain-exit",
          note: `Answer window closes after ${(at - (this.enteredAt ?? at)).toFixed(1)} ms${this.acceptedAt === null ? " · no answer accepted" : " · solved"}`,
        });
        if (this.acceptedAt === null) this.missedWindows++;
        if (this.buffer) {
          this.emit({
            at,
            kind: "answer-cleared",
            note: `Left brain tile; cleared ${JSON.stringify(this.buffer)}`,
          });
          this.buffer = "";
        }
        this.enteredAt = null;
      }
    }
    this.tryAccept(at, position);
  }

  edit(edit: AnswerEdit, at: number, position: Point): void {
    // Check the event-time position, even between animation frames.
    this.sample(at, position);
    if (this.acceptedAt !== null) return;
    if (edit.kind === "clear") this.buffer = "";
    else if (edit.kind === "backspace") this.buffer = this.buffer.slice(0, -1);
    else this.buffer = (this.buffer + (edit.text ?? "")).slice(0, 100);
    this.emit({
      at,
      kind: "answer-edit",
      note: `Typed ${JSON.stringify(this.buffer)} · ${this.inside ? "window open" : "outside brain tile"}`,
    });
    if (!this.inside && answersMatch(this.buffer, this.question.answer))
      this.emit({
        at,
        kind: "answer-outside",
        note: "Correct answer is ready, but no overlap: no bomb awarded. It can be accepted on a later entry.",
      });
    this.tryAccept(at, position);
  }

  private tryAccept(at: number, position: Point): void {
    if (
      this.acceptedAt !== null ||
      !this.inside ||
      !answersMatch(this.buffer, this.question.answer)
    )
      return;
    this.acceptedAt = at;
    this.acceptedPosition = { ...position };
    this.emit({
      at,
      kind: "answer-accepted",
      note: `${JSON.stringify(this.buffer)} accepted at (${position.x.toFixed(3)}, ${position.y.toFixed(3)}) · ${(this.overlap * 100).toFixed(1)}% overlap · +1 bomb · movement continues`,
    });
    this.buffer = "";
  }

  snapshot() {
    return {
      buffer: this.buffer,
      inside: this.inside,
      overlap: this.overlap,
      enteredAt: this.enteredAt,
      lastWindowMs: this.lastWindowMs,
      acceptedAt: this.acceptedAt,
      acceptedPosition: this.acceptedPosition && { ...this.acceptedPosition },
      solved: this.acceptedAt !== null,
      bombsEarned: this.acceptedAt === null ? 0 : 1,
      missedWindows: this.missedWindows,
      windowCount: this.windowCount,
    };
  }
}
