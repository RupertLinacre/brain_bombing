import { answersMatch } from "../game/answers";
import { makeQuestion } from "../game/questions";
import type { Point } from "../game/types";
import {
  BRAIN_TILE,
  DRILL_QUESTION,
  overlapFraction,
  type AnswerEdit,
} from "./drive-by";
import type { Emit } from "./movement";

export type FieldQuestion = { expression: string; answer: string };
export type FieldSetup = {
  seed: number;
  questions: FieldQuestion[];
  fixture?: boolean;
};
type FieldBrain = {
  id: number;
  tile: Point;
  question: FieldQuestion;
  overlap: number;
  enteredAt: number | null;
};

/** Generate once per board. Both controllers and recorded replays share the bank. */
export function makeFieldSetup(fixture = false): FieldSetup {
  const questions: FieldQuestion[] = fixture ? [{ ...DRILL_QUESTION }] : [];
  for (let i = 0; i < 160 && questions.length < 32; i++) {
    const q = makeQuestion("year1"),
      answer = q.choices[q.correct];
    // This keyboard drill keeps WASD for movement and uses short, numeric problems.
    if (
      /^\d{1,2}$/.test(answer) &&
      q.short.length <= 12 &&
      /^[\d\s+−–×x÷*/()=?-]+$/.test(q.short) &&
      !questions.some((existing) => existing.expression === q.short)
    )
      questions.push({ expression: q.short, answer });
  }
  if (!questions.length) questions.push({ ...DRILL_QUESTION });
  return {
    seed: Math.floor(Math.random() * 0x100000000) || 1,
    questions,
    fixture,
  };
}

/** Three live questions, a shared typing buffer, and one replacement per solve. */
export class BrainField {
  private brains: FieldBrain[] = [];
  private randomState: number;
  private nextId = 1;
  private questionIndex = 0;
  private buffer = "";
  private position: Point = { x: 2, y: 2 };
  private solved = 0;
  private missedWindows = 0;
  private windowCount = 0;
  private lastWindowMs: number | null = null;
  private lastSolved: {
    id: number;
    at: number;
    tile: Point;
    position: Point;
    answer: string;
    expression: string;
  } | null = null;
  private readonly floors: Point[];

  constructor(
    map: number[][],
    readonly setup: FieldSetup,
    private emit: Emit = () => {},
  ) {
    if (!setup.questions.length) throw new Error("A question bank is required");
    this.randomState = setup.seed >>> 0 || 1;
    const seen = new Set(["2,2"]),
      queue = [{ x: 2, y: 2 }];
    for (let i = 0; i < queue.length; i++)
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ]) {
        const p = { x: queue[i].x + dx, y: queue[i].y + dy },
          k = `${p.x},${p.y}`;
        if (map[p.y]?.[p.x] === 0 && !seen.has(k)) {
          seen.add(k);
          queue.push(p);
        }
      }
    this.floors = queue.filter((p) => map[p.y]?.[p.x] === 0);
    for (let i = 0; i < 3; i++)
      this.spawn(
        0,
        undefined,
        setup.fixture && i === 0 ? BRAIN_TILE : undefined,
      );
  }

  private random(): number {
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    return (this.randomState >>> 0) / 0x100000000;
  }
  private spawn(at: number, previous?: Point, fixed?: Point): void {
    const empty = this.floors.filter(
      (p) =>
        !this.brains.some((b) => b.tile.x === p.x && b.tile.y === p.y) &&
        (previous
          ? Math.max(Math.abs(p.x - previous.x), Math.abs(p.y - previous.y)) > 1
          : overlapFraction(this.position, p) === 0),
    );
    // Spread questions out when possible, making fast passes easier to read.
    const spaced = empty.filter((p) =>
      this.brains.every(
        (b) => Math.abs(b.tile.x - p.x) + Math.abs(b.tile.y - p.y) >= 2,
      ),
    );
    const choices = spaced.length ? spaced : empty;
    if (!choices.length)
      throw new Error("The board has no room for a replacement brain");
    const tile =
      fixed && empty.some((p) => p.x === fixed.x && p.y === fixed.y)
        ? { ...fixed }
        : { ...choices[Math.floor(this.random() * choices.length)] };
    let question =
      this.setup.questions[this.questionIndex++ % this.setup.questions.length];
    for (
      let i = 1;
      i < this.setup.questions.length &&
      this.brains.some((b) => b.question.expression === question.expression);
      i++
    )
      question =
        this.setup.questions[
          this.questionIndex++ % this.setup.questions.length
        ];
    question = { ...question };
    const brain = {
      id: this.nextId++,
      tile,
      question,
      overlap: 0,
      enteredAt: null,
    };
    this.brains.push(brain);
    this.emit({
      at,
      kind: "brain-spawn",
      note: `Brain #${brain.id}: ${question.expression} at (${tile.x}, ${tile.y}) · ${this.brains.length}/3 live`,
    });
  }

  sample(at: number, position: Point): void {
    this.position = { ...position };
    for (const b of this.brains) {
      const overlap = overlapFraction(position, b.tile);
      if (overlap > 0 && b.overlap === 0) {
        b.enteredAt = at;
        this.windowCount++;
        this.emit({
          at,
          kind: "brain-enter",
          note: `Brain #${b.id} ${b.question.expression} · ${(overlap * 100).toFixed(1)}% overlap at (${position.x.toFixed(3)}, ${position.y.toFixed(3)})`,
        });
      } else if (overlap === 0 && b.overlap > 0) {
        this.lastWindowMs = at - (b.enteredAt ?? at);
        this.missedWindows++;
        this.emit({
          at,
          kind: "brain-exit",
          note: `Brain #${b.id}: window closes after ${this.lastWindowMs.toFixed(1)} ms · no answer accepted`,
        });
        if (this.buffer) {
          this.emit({
            at,
            kind: "answer-cleared",
            note: `Left brain #${b.id}; cleared ${JSON.stringify(this.buffer)}`,
          });
          this.buffer = "";
        }
        b.enteredAt = null;
      }
      b.overlap = overlap;
    }
    this.tryAccept(at);
  }

  edit(edit: AnswerEdit, at: number, position: Point): void {
    const before = this.solved;
    this.sample(at, position);
    // An already-prepared answer may have accepted on entry at this timestamp.
    if (this.solved !== before) return;
    if (edit.kind === "clear") this.buffer = "";
    else if (edit.kind === "backspace") this.buffer = this.buffer.slice(0, -1);
    else this.buffer = (this.buffer + (edit.text ?? "")).slice(0, 100);
    this.emit({
      at,
      kind: "answer-edit",
      note: `Typed ${JSON.stringify(this.buffer)} · ${this.brains.filter((b) => b.overlap > 0).length} questions in reach`,
    });
    if (
      !this.brains.some((b) => b.overlap > 0) &&
      this.brains.some((b) => answersMatch(this.buffer, b.question.answer))
    )
      this.emit({
        at,
        kind: "answer-outside",
        note: "Answer prepared; waiting for overlap with a matching question",
      });
    this.tryAccept(at);
  }

  private tryAccept(at: number): void {
    if (!this.buffer) return;
    const b = this.brains
      .filter(
        (b) => b.overlap > 0 && answersMatch(this.buffer, b.question.answer),
      )
      .sort((a, b) => b.overlap - a.overlap)[0];
    if (!b) return;
    this.solved++;
    this.lastSolved = {
      id: b.id,
      at,
      tile: { ...b.tile },
      position: { ...this.position },
      answer: this.buffer,
      expression: b.question.expression,
    };
    this.emit({
      at,
      kind: "answer-accepted",
      note: `Brain #${b.id} ${b.question.expression}: ${JSON.stringify(this.buffer)} at (${this.position.x.toFixed(3)}, ${this.position.y.toFixed(3)}) · ${(b.overlap * 100).toFixed(1)}% overlap · +1 bomb · total ${this.solved}`,
    });
    this.brains = this.brains.filter((other) => other.id !== b.id);
    this.buffer = "";
    // Keep the replacement away from the solved tile, so it cannot appear under
    // the moving player or immediately reuse the accepted keystroke.
    this.spawn(at, b.tile);
  }

  snapshot() {
    const ordered = [...this.brains].sort(
      (a, b) =>
        b.overlap - a.overlap ||
        Math.hypot(a.tile.x - this.position.x, a.tile.y - this.position.y) -
          Math.hypot(b.tile.x - this.position.x, b.tile.y - this.position.y),
    );
    const active = ordered[0];
    return {
      buffer: this.buffer,
      inside: ordered.some((b) => b.overlap > 0),
      overlap: active?.overlap ?? 0,
      enteredAt: active?.enteredAt ?? null,
      lastWindowMs: this.lastWindowMs,
      solved: this.solved,
      bombsEarned: this.solved,
      missedWindows: this.missedWindows,
      windowCount: this.windowCount,
      lastSolved: this.lastSolved && {
        ...this.lastSolved,
        tile: { ...this.lastSolved.tile },
        position: { ...this.lastSolved.position },
      },
      activeId: active?.id ?? null,
      questions: this.brains.map((b) => ({
        ...b,
        tile: { ...b.tile },
        question: { ...b.question },
      })),
    };
  }
}
