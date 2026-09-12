import {
  same,
  type Bomb,
  type Explosion,
  type PlayerId,
  type View,
} from "./types";

export type FrameFeedback = {
  explosions: Explosion[];
  placed: Bomb[];
  fuse: Bomb | null;
  solved: boolean;
  upgraded: "fire" | "speed" | null;
  wrong: boolean;
  question: boolean;
  stepped: boolean;
  deaths: PlayerId[];
  hits: PlayerId[];
  warning: boolean;
};

/** Presentation follows authoritative events, never a guessed change in bomb count. */
export class FeedbackTracker {
  private previous?: View;
  private seen = new Set<number>();
  private fuseBeats = new Map<number, number>();
  reset(initial?: View): void {
    this.previous = initial;
    this.seen.clear();
    this.fuseBeats.clear();
  }

  consume(view: View, local: PlayerId): FrameFeedback {
    const previous = this.previous;
    if (previous && view.time < previous.time) this.reset();
    const before = this.previous;
    const p = view.players[local],
      old = before?.players[local];
    const explosions = (view.explosions ?? []).filter(
      (e) => !this.seen.has(e.id),
    );
    for (const e of explosions) this.seen.add(e.id);
    const placed = before
      ? view.bombs.filter((b) => !before.bombs.some((old) => old.id === b.id))
      : [];
    let fuse: Bomb | null = null;
    for (const b of view.bombs) {
      const remaining = b.explodesAt - view.time;
      const beat = Math.floor((1.2 - remaining) / 0.18);
      if (
        remaining > 0 &&
        remaining <= 1.2 &&
        beat !== this.fuseBeats.get(b.id)
      ) {
        if (!fuse || b.explodesAt < fuse.explodesAt) fuse = b;
        this.fuseBeats.set(b.id, beat);
      }
    }
    for (const id of this.fuseBeats.keys())
      if (!view.bombs.some((b) => b.id === id)) this.fuseBeats.delete(id);
    const result: FrameFeedback = {
      explosions,
      placed,
      fuse,
      solved: !!old && p.solved > old.solved,
      upgraded:
        old && p.range > old.range
          ? "fire"
          : old && p.speed > old.speed
            ? "speed"
            : null,
      wrong:
        !!before &&
        view.feedback.kind === "bad" &&
        (view.feedback.at !== before.feedback.at ||
          before.feedback.kind !== "bad"),
      question:
        !!before &&
        view.activeBrain !== null &&
        view.activeBrain !== before.activeBrain,
      stepped: !!old && p.alive && !same(p, old),
      deaths: before
        ? view.players
            .filter((p) => !p.alive && before.players[p.id].alive)
            .map((p) => p.id)
        : [],
      hits: before
        ? view.players
            .filter((p) => p.lives < before.players[p.id].lives)
            .map((p) => p.id)
        : [],
      warning: !!before && before.remaining > 45 && view.remaining <= 45,
    };
    this.previous = view;
    return result;
  }
}
