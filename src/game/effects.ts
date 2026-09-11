import type { FrameFeedback } from "./feedback";
import { type PlayerId, type View } from "./types";

const TILE = 60;
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  angle: number;
  spin: number;
  color: string;
  kind: "spark" | "wood" | "smoke" | "confetti";
  fragment: number;
};
type Ring = {
  x: number;
  y: number;
  life: number;
  max: number;
  radius: number;
  color: string;
};
type Floater = {
  x: number;
  y: number;
  life: number;
  max: number;
  text: string;
  color: string;
  big: boolean;
  angle: number;
};

/** All effects are cosmetic. Neither screen shake nor particles alter collision. */
export class ArenaEffects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private words: Floater[] = [];
  private scorch: { x: number; y: number; life: number }[] = [];
  private deaths = new Map<PlayerId, number>();
  private hops = new Map<PlayerId, number>();
  private shake = 0;
  readonly motion = matchMedia("(prefers-reduced-motion: reduce)");

  reset(): void {
    this.particles = [];
    this.rings = [];
    this.words = [];
    this.scorch = [];
    this.deaths.clear();
    this.hops.clear();
    this.shake = 0;
  }

  react(events: FrameFeedback, view: View, local: PlayerId): void {
    for (const b of events.placed)
      this.rings.push({
        x: (b.x + 0.5) * TILE,
        y: (b.y + 0.5) * TILE,
        life: 0.35,
        max: 0.35,
        radius: 34,
        color: b.owner ? "#ff9386" : "#6befd1",
      });
    for (const e of events.explosions) {
      const x = (e.x + 0.5) * TILE,
        y = (e.y + 0.5) * TILE;
      this.shake = Math.min(1, this.shake + 0.7);
      this.rings.push({
        x,
        y,
        life: 0.42,
        max: 0.42,
        radius: 82,
        color: "#ffcb65",
      });
      for (let i = 0; i < 22; i++)
        this.emit(
          x,
          y,
          "spark",
          ["#fff3ab", "#ffb84b", "#ff7043"][i % 3],
          70 + Math.random() * 220,
          0.35 + Math.random() * 0.45,
          2 + Math.random() * 4,
        );
      for (const cell of e.cells) {
        const cx = (cell.x + 0.5) * TILE,
          cy = (cell.y + 0.5) * TILE;
        if (!this.scorch.some((s) => s.x === cx && s.y === cy))
          this.scorch.push({ x: cx, y: cy, life: 4 });
        for (let i = 0; i < 2; i++)
          this.emit(
            cx,
            cy,
            "spark",
            "#ffd279",
            60 + Math.random() * 80,
            0.25 + Math.random() * 0.25,
            2.5,
          );
        if ((cell.x + cell.y) % 2 === 0)
          this.emit(
            cx,
            cy,
            "smoke",
            "#6d8583",
            18,
            0.8 + Math.random() * 0.5,
            12 + Math.random() * 11,
          );
      }
      for (const c of e.crates)
        for (let i = 0; i < 6; i++)
          this.emit(
            (c.x + 0.5) * TILE,
            (c.y + 0.5) * TILE,
            "wood",
            "#cd9458",
            80 + Math.random() * 140,
            0.55 + Math.random() * 0.45,
            8 + Math.random() * 11,
          );
    }
    if (events.explosions.length) {
      const chain =
        events.explosions.length > 1 || events.explosions.some((e) => e.chain);
      const e = events.explosions[0];
      this.word(
        (e.x + 0.5) * TILE,
        (e.y + 0.1) * TILE,
        chain ? "CHAIN REACTION!" : ["BOOM!", "KABOOM!", "POW!"][e.id % 3],
        chain ? "#7effd5" : "#ffe19b",
        true,
      );
    }
    const p = view.players[local],
      x = (p.x + 0.5) * TILE,
      y = (p.y + 0.5) * TILE;
    if (events.solved || events.upgraded) {
      const milestone = events.solved && events.upgraded === "fire";
      const color = milestone
        ? "#ffd06a"
        : events.solved
          ? "#ffb9e7"
          : events.upgraded === "fire"
            ? "#ffd06a"
            : "#81f5d7";
      this.word(
        x,
        y - 32,
        milestone
          ? "BRAIN POWER!"
          : events.solved
            ? "+1 BOMB"
            : events.upgraded === "fire"
              ? "FLAME UP!"
              : "SPEED UP!",
        color,
        milestone,
      );
      this.rings.push({ x, y, life: 0.6, max: 0.6, radius: 55, color });
      for (let i = 0; i < 16; i++)
        this.emit(
          x,
          y,
          "confetti",
          i % 3 ? color : "#fff7d7",
          60 + Math.random() * 85,
          0.5 + Math.random() * 0.4,
          3 + Math.random() * 3,
        );
      this.hops.set(local, 0.35);
    }
    for (const id of events.deaths) {
      this.deaths.set(id, 0);
      const p = view.players[id];
      for (let i = 0; i < 18; i++)
        this.emit(
          (p.x + 0.5) * TILE,
          (p.y + 0.5) * TILE,
          "confetti",
          id ? "#ff9487" : "#71f9dd",
          80 + Math.random() * 130,
          0.5 + Math.random() * 0.4,
          4,
        );
    }
    if (events.warning) this.word(450, 310, "SUDDEN DEATH!", "#ffa48a", true);
    // Bound cost when a crowded arena chain-detonates in one snapshot.
    this.particles = this.particles.slice(-500);
    this.rings = this.rings.slice(-24);
    this.words = this.words.slice(-6);
    this.scorch = this.scorch.slice(-165);
  }

  private word(
    x: number,
    y: number,
    text: string,
    color: string,
    big = false,
  ): void {
    this.words.push({
      x: Math.max(big ? 150 : 90, Math.min(900 - (big ? 150 : 90), x)),
      y: Math.max(80, y),
      text,
      color,
      big,
      life: big ? 0.95 : 1.15,
      max: big ? 0.95 : 1.15,
      angle: big ? -0.09 : 0,
    });
  }
  private emit(
    x: number,
    y: number,
    kind: Particle["kind"],
    color: string,
    speed: number,
    life: number,
    size: number,
  ): void {
    const angle = Math.random() * Math.PI * 2;
    this.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (kind === "smoke" ? 22 : 35),
      life,
      max: life,
      size,
      angle,
      spin: (Math.random() - 0.5) * 12,
      color,
      kind,
      fragment: Math.floor(Math.random() * 4),
    });
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 3.5);
    for (const [id, age] of this.deaths) this.deaths.set(id, age + dt);
    for (const [id, time] of this.hops)
      this.hops.set(id, Math.max(0, time - dt));
    for (const p of this.particles) {
      p.life -= dt;
      if (!this.motion.matches) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        p.vx *= Math.exp(-dt * (p.kind === "smoke" ? 1.5 : 1));
        p.vy += (p.kind === "smoke" ? -13 : 190) * dt;
      }
    }
    for (const items of [this.rings, this.words, this.scorch])
      for (const item of items) item.life -= dt;
    this.particles = this.particles.filter((p) => p.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
    this.words = this.words.filter((w) => w.life > 0);
    this.scorch = this.scorch.filter((s) => s.life > 0);
  }

  shakeOffset(now: number): { x: number; y: number } {
    const amount = this.motion.matches ? 0 : this.shake * this.shake * 5;
    return {
      x: Math.sin(now * 0.09) * amount,
      y: Math.cos(now * 0.073) * amount * 0.7,
    };
  }
  deathAge(id: PlayerId): number {
    return this.deaths.get(id) ?? 10;
  }
  hop(id: PlayerId): number {
    return this.motion.matches
      ? 0
      : Math.sin(((this.hops.get(id) ?? 0) / 0.35) * Math.PI) * 12;
  }

  drawFloor(ctx: CanvasRenderingContext2D): void {
    for (const s of this.scorch) {
      ctx.fillStyle = `rgba(12,24,27,${Math.min(0.26, s.life * 0.09)})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 24, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(ctx: CanvasRenderingContext2D, crate?: HTMLImageElement): void {
    ctx.save();
    for (const r of this.rings) {
      const progress = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - progress) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 5 * (1 - progress) + 1;
      ctx.beginPath();
      ctx.arc(
        r.x,
        r.y,
        this.motion.matches
          ? r.radius * 0.5
          : 8 + r.radius * (1 - (1 - progress) ** 3),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    for (const p of this.particles) {
      const life = p.life / p.max;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha =
        Math.min(1, life * 2.2) * (p.kind === "smoke" ? 0.2 : 1);
      if (p.kind === "wood" && crate) {
        ctx.drawImage(
          crate,
          (p.fragment % 2) * 96,
          Math.floor(p.fragment / 2) * 96,
          96,
          96,
          -p.size / 2,
          -p.size / 2,
          p.size,
          p.size,
        );
      } else if (p.kind === "smoke") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1.5 - life * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        if (p.kind === "spark") {
          ctx.globalCompositeOperation = "lighter";
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size * 2.2, p.size * 0.65);
        } else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      }
      ctx.restore();
    }
    for (const w of this.words) {
      const age = w.max - w.life;
      const scale = this.motion.matches
        ? 1
        : age < 0.12
          ? 0.7 + (age / 0.12) * 0.5
          : 1 + Math.exp(-(age - 0.12) * 13) * 0.2;
      ctx.save();
      ctx.translate(
        w.x,
        w.y - (this.motion.matches ? 0 : age * (w.big ? 17 : 27)),
      );
      ctx.rotate(w.angle);
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.min(1, w.life * 3);
      ctx.font = `${w.big ? "italic 900 38" : "800 22"}px "Barlow Condensed", "Trebuchet MS", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = w.big ? 7 : 5;
      ctx.strokeStyle = "#172631";
      ctx.strokeText(w.text, 0, 0);
      ctx.fillStyle = w.color;
      ctx.fillText(w.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}
