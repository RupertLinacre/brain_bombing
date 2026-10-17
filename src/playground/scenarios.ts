import type { AnswerEdit } from "./drive-by";

export type RecordedInput = {
  at: number;
  code: string;
  down: boolean;
  repeat?: boolean;
  answer?: AnswerEdit;
};
export const scenarios: Record<
  string,
  {
    label: string;
    description: string;
    inputs: RecordedInput[];
    duration: number;
  }
> = {
  driveby: {
    label: "Drive-by answer",
    description:
      "Hold → and type 12 while only partly over the 7 + 5 tile. No Enter, no stopping. The prototype accepts before reaching the tile centre.",
    inputs: [
      { at: 10, code: "ArrowRight", down: true },
      {
        at: 55,
        code: "Digit1",
        down: true,
        answer: { kind: "append", text: "1" },
      },
      { at: 60, code: "Digit1", down: false },
      {
        at: 70,
        code: "Digit2",
        down: true,
        answer: { kind: "append", text: "2" },
      },
      { at: 75, code: "Digit2", down: false },
      { at: 350, code: "ArrowRight", down: false },
    ],
    duration: 800,
  },
  double: {
    label: "Double tap →",
    description:
      "Two complete taps inside one 50 ms simulation tick. Expect two deliberate steps.",
    inputs: [
      { at: 10, code: "ArrowRight", down: true },
      { at: 18, code: "ArrowRight", down: false },
      { at: 25, code: "ArrowRight", down: true },
      { at: 33, code: "ArrowRight", down: false },
    ],
    duration: 650,
  },
  reverse: {
    label: "Left → right",
    description:
      "Press left, then change your mind 80 ms later. Watch whether the player first finishes moving left.",
    inputs: [
      { at: 10, code: "ArrowLeft", down: true },
      { at: 60, code: "ArrowLeft", down: false },
      { at: 90, code: "ArrowRight", down: true },
      { at: 120, code: "ArrowRight", down: false },
    ],
    duration: 650,
  },
  corner: {
    label: "Buffered corner",
    description:
      "Press ↑ during the second rightward step, then release before the open junction. The turn should still happen, including on the crate board.",
    inputs: [
      { at: 10, code: "ArrowRight", down: true },
      { at: 255, code: "ArrowUp", down: true },
      { at: 275, code: "ArrowUp", down: false },
      { at: 300, code: "ArrowRight", down: false },
    ],
    duration: 800,
  },
  burst: {
    label: "Too many taps",
    description:
      "Five taps in 60 ms. A small, expiring buffer should avoid a long tail of movement after you stop.",
    inputs: Array.from({ length: 5 }, (_, i) => [
      { at: 10 + i * 12, code: "ArrowUp", down: true },
      { at: 15 + i * 12, code: "ArrowUp", down: false },
    ]).flat(),
    duration: 850,
  },
  hold: {
    label: "Hold & release",
    description:
      "Hold → for 300 ms. OS repeat events are ignored; movement follows how long the key is actually held.",
    inputs: [
      { at: 10, code: "ArrowRight", down: true },
      { at: 130, code: "ArrowRight", down: true, repeat: true },
      { at: 210, code: "ArrowRight", down: true, repeat: true },
      { at: 310, code: "ArrowRight", down: false },
    ],
    duration: 750,
  },
};
