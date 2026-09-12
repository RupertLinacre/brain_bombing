import type { ArenaId } from "./arenas";

export type PlayerId = 0 | 1;
export type Direction = "up" | "down" | "left" | "right";
export type YearLevel =
  "reception" | "year1" | "year2" | "year3" | "year4" | "year5" | "year6";
export type Point = { x: number; y: number };
export type Profile = { name: string; year: YearLevel };
export type Player = Point & {
  id: PlayerId;
  name: string;
  year: YearLevel;
  alive: boolean;
  lives: number;
  invulnerableUntil: number;
  /** Continuous arena position used for rendering and forgiving blast collision. */
  visualX: number;
  visualY: number;
  bombs: number;
  range: number;
  speed: number;
  solved: number;
  facing: Direction;
};
export type Bomb = Point & {
  id: number;
  owner: PlayerId;
  range: number;
  explodesAt: number;
  pass: PlayerId[];
};
export type Flame = Point & { expiresAt: number; owner: PlayerId };
export type Pickup = Point & { kind: "fire" | "speed" };
export type Question = {
  expression: string;
  short: string;
  choices: string[];
  correct: number;
};
export type Brain = Point & {
  id: number;
  owner: PlayerId;
  question: Question;
  rejected: number[];
  retryAt: number;
};
export type VisibleBrain = Point & {
  id: number;
  expression: string;
  short: string;
  choices: string[];
  rejected: number[];
  retryAt: number;
};
export type Feedback = {
  text: string;
  kind: "good" | "bad" | "info";
  at: number;
};
/** Public, short-lived presentation events, retained across snapshot gaps. */
export type Explosion = Point & {
  id: number;
  owner: PlayerId;
  at: number;
  chain: boolean;
  cells: Point[];
  crates: Point[];
};
export type View = {
  arena: ArenaId;
  readyIn: number;
  tick: number;
  time: number;
  remaining: number;
  phase: "playing" | "ended";
  winner: PlayerId | "draw" | null;
  map: number[][];
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  explosions: Explosion[];
  pickups: Pickup[];
  brains: VisibleBrain[];
  activeBrain: number | null;
  feedback: Feedback;
};
export type Action =
  | { type: "move"; direction: Direction | null }
  | { type: "bomb" }
  | { type: "answer"; brain: number; choice: number }
  | { type: "dismiss" };
export const COLS = 15;
export const ROWS = 11;
export const ROUND_SECONDS = 180;
export const FUSE_SECONDS = 3.6;
export const FLAME_SECONDS = 0.65;
export const STARTING_LIVES = 3;
export const RESPAWN_SHIELD_SECONDS = 1.2;
export const BLAST_HALF_WIDTH = 0.3;
export const BRAINS_PER_UPGRADE = 3;
export const MAX_RANGE = 6;
export const DIRECTIONS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const YEARS: YearLevel[] = [
  "reception",
  "year1",
  "year2",
  "year3",
  "year4",
  "year5",
  "year6",
];
export const yearLabel = (year: string) =>
  year === "reception" ? "Reception" : `Year ${year.slice(-1)}`;
export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const key = (p: Point) => `${p.x},${p.y}`;
export const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
