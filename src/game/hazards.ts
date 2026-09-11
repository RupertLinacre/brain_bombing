import {
  DIRECTIONS,
  FLAME_SECONDS,
  key,
  same,
  type Bomb,
  type Point,
  type View,
} from "./types";

export type Hazard = { at: number; until: number; kind: "blast" | "wall" };
export type HazardMap = Map<string, Hazard[]>;
type ArenaState = Pick<View, "map" | "bombs" | "flames" | "time" | "closing">;

/** One definition of blast geometry for simulation, warning tiles and the bot. */
export function blastCells(
  map: number[][],
  bomb: Pick<Bomb, "x" | "y" | "range">,
): Point[] {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const d of Object.values(DIRECTIONS))
    for (let n = 1; n <= bomb.range; n++) {
      const p = { x: bomb.x + d.x * n, y: bomb.y + d.y * n };
      const tile = map[p.y]?.[p.x];
      if (tile === undefined || tile === 1) break;
      cells.push(p);
      if (tile === 2) break;
    }
  return cells;
}

/** Forecast public hazards, including shortened fuses and later blasts through cleared crates. */
export function predictHazards(state: ArenaState, extra?: Bomb): HazardMap {
  const map = state.map.map((row) => [...row]);
  let bombs = [...state.bombs, ...(extra ? [extra] : [])];
  const result: HazardMap = new Map();
  const add = (cell: Point, hazard: Hazard) => {
    const list = result.get(key(cell)) ?? [];
    list.push(hazard);
    result.set(key(cell), list);
  };
  for (const flame of state.flames)
    if (flame.expiresAt > state.time)
      add(flame, { at: state.time, until: flame.expiresAt, kind: "blast" });
  const times = new Map(
    bombs.map((b) => [
      b.id,
      state.flames.some((f) => same(f, b) && f.expiresAt > state.time)
        ? state.time
        : Math.max(state.time, b.explodesAt),
    ]),
  );
  let closing = state.closing;
  if (closing) add(closing, { at: closing.at, until: Infinity, kind: "wall" });
  while (bombs.length) {
    const at = Math.min(...bombs.map((b) => times.get(b.id)!));
    if (closing && closing.at <= at) {
      map[closing.y][closing.x] = 1;
      bombs = bombs.filter((b) => !same(b, closing!));
      closing = null;
    }
    const queue = bombs.filter((b) => times.get(b.id)! <= at);
    const fired = new Set<number>(),
      crates: Point[] = [];
    for (let i = 0; i < queue.length; i++) {
      const bomb = queue[i];
      if (fired.has(bomb.id)) continue;
      fired.add(bomb.id);
      for (const cell of blastCells(map, bomb)) {
        add(cell, { at, until: at + FLAME_SECONDS, kind: "blast" });
        if (map[cell.y][cell.x] === 2) crates.push(cell);
        for (const other of bombs)
          if (!fired.has(other.id) && same(cell, other)) queue.push(other);
      }
    }
    // A simultaneous chain sees the same terrain, just like the engine.
    for (const cell of crates) map[cell.y][cell.x] = 0;
    bombs = bombs.filter((b) => !fired.has(b.id));
  }
  return result;
}

export function safeDuring(
  hazards: HazardMap,
  cell: Point,
  from: number,
  until: number,
): boolean {
  return !(hazards.get(key(cell)) ?? []).some(
    (h) => h.at <= until && h.until > from,
  );
}

export function nextHazard(
  hazards: HazardMap,
  cell: Point,
  now: number,
): Hazard | undefined {
  return hazards
    .get(key(cell))
    ?.filter((h) => h.until > now)
    .reduce<Hazard | undefined>(
      (first, h) => (!first || h.at < first.at ? h : first),
      undefined,
    );
}
