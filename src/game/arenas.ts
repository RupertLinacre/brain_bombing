import { COLS, ROWS } from "./types";

export type ArenaId = "garden" | "ember" | "arcade";
export const ARENAS = [
  {
    id: "garden",
    name: "Circuit Garden",
    tag: "THE CLASSIC",
    description: "Winding paths. Sneaky ambushes.",
    floor: ["#284448", "#2c494c"],
    edge: "#1c3038",
    wall: "#30444c",
    accent: "#a9d789",
  },
  {
    id: "ember",
    name: "Ember Works",
    tag: "CHAIN REACTION",
    description: "Long lanes. Explosive crossroads.",
    floor: ["#49363c", "#513c40"],
    edge: "#31262f",
    wall: "#51404a",
    accent: "#ffb469",
  },
  {
    id: "arcade",
    name: "Neon Arcade",
    tag: "ROOM TO DODGE",
    description: "Open centre. Make your own escape.",
    floor: ["#353853", "#3b3e5c"],
    edge: "#24273d",
    wall: "#3d4160",
    accent: "#aaacff",
  },
] as const;

export const arenaInfo = (id: ArenaId) =>
  ARENAS.find((arena) => arena.id === id) ?? ARENAS[0];

/** Symmetric obstacles and generous spawn pockets keep every arena fair. */
export function makeArena(id: ArenaId, random: () => number): number[][] {
  const map: number[][] = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => {
      const edge = !x || !y || x === COLS - 1 || y === ROWS - 1;
      const plaza = id === "arcade" && x >= 5 && x <= 9 && y >= 3 && y <= 7;
      return edge || (!plaza && x % 2 === 0 && y % 2 === 0) ? 1 : 0;
    }),
  );
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++) {
      if (map[y][x] || x + y <= 6 || COLS - 1 - x + ROWS - 1 - y <= 6) continue;
      if (y * COLS + x > (ROWS - 1 - y) * COLS + COLS - 1 - x) continue;
      // Ember's cross stays open; Arcade has a roomy central plaza.
      if (id === "ember" && (x === 7 || y === 5)) continue;
      const chance =
        id === "ember"
          ? 0.72
          : id === "arcade" && x >= 5 && x <= 9 && y >= 3 && y <= 7
            ? 0.12
            : 0.53;
      if (random() < chance) map[y][x] = map[ROWS - 1 - y][COLS - 1 - x] = 2;
    }
  return map;
}
