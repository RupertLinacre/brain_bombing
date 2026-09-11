declare module "maths-game-problem-generator" {
  export interface GeneratedProblem {
    expression: string;
    expression_short: string;
    choices: string[];
    correctChoice: string;
    yearLevel: string;
    type: string;
  }
  export function generateProblem(options: {
    yearLevel: string;
    multipleChoice: true;
    choiceCount: 4;
  }): GeneratedProblem;
  export function getYearLevels(): string[];
}
