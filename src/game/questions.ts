import { generateProblem } from "maths-game-problem-generator";
import type { Question, YearLevel } from "./types";

/** Keep the library's own formatted distractors, including fractions and units. */
export function makeQuestion(year: YearLevel): Question {
  for (let attempt = 0; attempt < 8; attempt++) {
    const p = generateProblem({
      yearLevel: year,
      multipleChoice: true,
      choiceCount: 4,
    });
    const choices = [...new Set(p.choices)];
    if (choices.length !== 4 || !choices.includes(p.correctChoice)) continue;
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return {
      expression: p.expression,
      short: p.expression_short || p.expression,
      choices,
      correct: choices.indexOf(p.correctChoice),
    };
  }
  throw new Error(
    "The maths generator could not make four distinct choices. Please try again.",
  );
}
