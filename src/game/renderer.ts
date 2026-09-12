import {
  COLS,
  ROWS,
  FUSE_SECONDS,
  FLAME_SECONDS,
  key,
  type PlayerId,
  type View,
} from "./types";

import { ArenaEffects } from "./effects";
import type { FrameFeedback } from "./feedback";
import { arenaInfo } from "./arenas";
import { predictHazards, nextHazard, type HazardMap } from "./hazards";

const TILE = 60;
const COLORS = ["#51e3d2", "#ff877b"];
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private positions = [
    { x: TILE * 1.5, y: TILE * 1.5 },
    { x: TILE * 13.5, y: TILE * 9.5 },
  ];
  private effects = new ArenaEffects();
  private endedAge = 0;
  private lastTime = 0;
  private lastFrame = 0;
  private hazardView?: View;
  private hazards: HazardMap = new Map();
  ready: Promise<void>;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = COLS * TILE;
    canvas.height = ROWS * TILE;
    this.ctx = canvas.getContext("2d")!;
    this.ready = Promise.all(
      [
        "player-teal",
        "player-coral",
        "brain",
        "bomb",
        "crate",
        "steel",
        "fire",
        "speed",
      ].map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              this.images.set(name, image);
              resolve();
            };
            image.onerror = () =>
              reject(new Error(`Could not load ${name} artwork`));
            image.src = `${import.meta.env.BASE_URL}sprites/${name}.webp`;
          }),
      ),
    ).then(() => {});
  }

  reset(): void {
    this.lastTime = 0;
    this.effects.reset();
    this.endedAge = 0;
  }

  react(events: FrameFeedback, view: View, local: PlayerId): void {
    this.effects.react(events, view, local);
  }

  draw(view: View, local: PlayerId, now: number, preview = false): void {
    const ctx = this.ctx,
      dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    if (view.time < this.lastTime) this.reset();
    this.lastTime = view.time;
    this.effects.update(dt);
    this.endedAge = view.phase === "ended" ? this.endedAge + dt : 0;
    const renderTime = view.time + this.endedAge;
    const pulse = now / 1000;
    const theme = arenaInfo(view.arena);
    if (this.hazardView !== view) {
      this.hazards = predictHazards(view);
      this.hazardView = view;
    }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#12272e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    const shake = this.effects.shakeOffset(now);
    ctx.translate(shake.x, shake.y);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const px = x * TILE,
          py = y * TILE;
        const edge = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        ctx.fillStyle = edge
          ? theme.edge
          : (x + y) % 2 === 0
            ? theme.floor[0]
            : theme.floor[1];
        this.round(px + 1, py + 1, TILE - 2, TILE - 2, 5);
        ctx.fill();
        if (!edge) {
          ctx.fillStyle = `${theme.accent}35`;
          ctx.fillRect(px + 7, py + 7, 2, 2);
          if (view.arena === "ember" && (x === 7 || y === 5)) {
            ctx.fillStyle = `${theme.accent}20`;
            ctx.fillRect(px + 5, py + 5, TILE - 10, 2);
            ctx.fillRect(px + 5, py + TILE - 7, TILE - 10, 2);
          } else if (
            view.arena === "arcade" &&
            x >= 5 &&
            x <= 9 &&
            y >= 3 &&
            y <= 7
          ) {
            ctx.strokeStyle = `${theme.accent}40`;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 5, py + 5, TILE - 10, TILE - 10);
          }
          ctx.fillStyle = "#101f293b";
          ctx.fillRect(px + 2, py + TILE - 3, TILE - 4, 2);
        }
        if (view.map[y][x] === 1) {
          if (edge) {
            ctx.fillStyle = theme.wall;
            this.round(px + 5, py + 4, TILE - 10, TILE - 11, 6);
            ctx.fill();
            ctx.fillStyle = `${theme.accent}50`;
            ctx.fillRect(px + 10, py + 8, TILE - 20, 2);
            ctx.fillStyle = "#152832";
            ctx.fillRect(px + 8, py + TILE - 9, TILE - 16, 3);
            ctx.fillStyle = `${theme.accent}70`;
            ctx.beginPath();
            ctx.arc(px + TILE / 2, py + TILE / 2, 2, 0, Math.PI * 2);
            ctx.fill();
          } else
            this.sprite("steel", px + TILE / 2, py + TILE / 2 - 2, TILE + 9);
        } else if (view.map[y][x] === 2)
          this.sprite("crate", px + TILE / 2, py + TILE / 2 - 2, TILE + 5);
      }
    this.effects.drawFloor(ctx);
    // Short, readable floor warnings never alter blast timing or collision.
    if (!preview && view.phase === "playing")
      for (let y = 1; y < ROWS - 1; y++)
        for (let x = 1; x < COLS - 1; x++) {
          const hazard = nextHazard(this.hazards, { x, y }, view.time);
          if (!hazard || hazard.kind !== "blast" || view.map[y][x] !== 0)
            continue;
          const left = hazard.at - view.time;
          if (left <= 0 || left > 1.1) continue;
          const urgent = left < 0.5;
          ctx.fillStyle = urgent ? "#ff785438" : "#ffcd701b";
          this.round(x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8, 5);
          ctx.fill();
          ctx.strokeStyle = urgent ? "#ffb18aac" : "#ffcb7080";
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
    // Coloured spawn pads also keep player colours distinguishable without text.
    for (const [id, x, y] of [
      [0, 1, 1],
      [1, 13, 9],
    ])
      if (view.map[y][x] === 0) {
        ctx.strokeStyle = `${COLORS[id]}60`;
        ctx.lineWidth = 2;
        this.round(x * TILE + 7, y * TILE + 8, TILE - 14, TILE - 16, 10);
        ctx.stroke();
      }
    for (const p of view.pickups) {
      ctx.fillStyle = p.kind === "fire" ? "#ffbe3620" : "#66edcd20";
      ctx.beginPath();
      ctx.ellipse(
        (p.x + 0.5) * TILE,
        (p.y + 0.72) * TILE,
        21,
        9,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      this.sprite(
        p.kind,
        (p.x + 0.5) * TILE,
        (p.y + 0.5) * TILE + Math.sin(pulse * 3 + p.x) * 2,
        51,
      );
    }
    for (const brain of view.brains) {
      const x = (brain.x + 0.5) * TILE,
        y = (brain.y + 0.6) * TILE;
      ctx.strokeStyle = "#ff9dda66";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y + 12,
        17 + Math.sin(pulse * 2 + brain.id) * 2,
        6,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      this.sprite("brain", x, y - 1 + Math.sin(pulse * 2.5 + brain.id) * 3, 48);
    }
    for (const bomb of view.bombs) {
      const x = (bomb.x + 0.5) * TILE,
        y = (bomb.y + 0.5) * TILE;
      ctx.strokeStyle = COLORS[bomb.owner];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y + 14, 20, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      const fuse = Math.max(0, (bomb.explodesAt - view.time) / FUSE_SECONDS);
      const squish = this.effects.motion.matches
        ? 0
        : Math.sin(pulse * (fuse < 0.3 ? 27 : 10)) * (1 - fuse) * 0.085;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 + squish, 1 - squish);
      this.sprite("bomb", 0, -1, 53 + (1 - fuse) * 3);
      ctx.restore();
      if (!this.effects.motion.matches)
        for (let i = 0; i < 5; i++) {
          const age = (pulse * 3 + i / 5 + bomb.id * 0.13) % 1;
          ctx.globalAlpha = 1 - age;
          ctx.fillStyle = i % 2 ? "#fff3ad" : "#ffa350";
          ctx.fillRect(
            x + 12 + Math.cos(i * 2.4) * age * 16,
            y - 20 - age * 23,
            2.5,
            2.5,
          );
        }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fuse < 0.3 ? "#ff7874" : "#ffce68";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fuse);
      ctx.stroke();
    }
    if (view.closing) {
      const x = view.closing.x * TILE,
        y = view.closing.y * TILE;
      ctx.fillStyle = `rgba(255,100,77,${0.22 + Math.sin(pulse * 15) * 0.12})`;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = "#ff9478";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
    }
    const liveFlames = view.flames.filter((f) => f.expiresAt > renderTime);
    const flameCells = new Set(liveFlames.map(key));
    const drawn = new Set<string>();
    for (const flame of liveFlames) {
      if (drawn.has(key(flame))) continue;
      drawn.add(key(flame));
      const x = flame.x * TILE,
        y = flame.y * TILE;
      const life = Math.min(1, (flame.expiresAt - renderTime) / FLAME_SECONDS);
      const horizontal =
        flameCells.has(`${flame.x - 1},${flame.y}`) ||
        flameCells.has(`${flame.x + 1},${flame.y}`);
      const vertical =
        flameCells.has(`${flame.x},${flame.y - 1}`) ||
        flameCells.has(`${flame.x},${flame.y + 1}`);
      ctx.save();
      // Keep hot flame geometry within the lethal cell, even beside steel walls.
      ctx.beginPath();
      ctx.rect(x, y, TILE, TILE);
      ctx.clip();
      const flicker = this.effects.motion.matches
        ? 1
        : 1 + Math.sin(pulse * 32 + flame.x * 2 + flame.y) * 0.1;
      ctx.globalAlpha = Math.min(1, life * 4);
      const glow = ctx.createRadialGradient(
        x + 30,
        y + 30,
        1,
        x + 30,
        y + 30,
        42,
      );
      glow.addColorStop(0, "#fff0a1");
      glow.addColorStop(0.48, "#ffb038");
      glow.addColorStop(1, "#ed503600");
      ctx.fillStyle = glow;
      ctx.fillRect(x, y, TILE, TILE);
      for (const [width, color] of [
        [39, "#ff773a"],
        [28, "#ffc85b"],
        [13, "#fff3ba"],
      ] as const) {
        const w = width * flicker * (0.7 + life * 0.3);
        ctx.fillStyle = color;
        if (horizontal) {
          this.round(x - 3, y + 30 - w / 2, TILE + 6, w, w / 2);
          ctx.fill();
        }
        if (vertical) {
          this.round(x + 30 - w / 2, y - 3, w, TILE + 6, w / 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x + 30, y + 30, w / 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const p of view.players) {
      const pos = this.positions[p.id],
        x = (p.visualX + 0.5) * TILE,
        y = (p.visualY + 0.5) * TILE;
      if (
        Math.abs(pos.x - x) + Math.abs(pos.y - y) > TILE * 3 ||
        preview ||
        view.readyIn > 0
      ) {
        pos.x = x;
        pos.y = y;
      }
      const moving = Math.abs(pos.x - x) + Math.abs(pos.y - y) > 2;
      const lerp = Math.min(1, dt * 24);
      pos.x += (x - pos.x) * lerp;
      pos.y += (y - pos.y) * lerp;
      ctx.globalAlpha = p.alive ? 1 : 0.23;
      const shielded = p.alive && p.invulnerableUntil > view.time;
      if (shielded) {
        ctx.globalAlpha = 0.68 + Math.sin(pulse * 17) * 0.22;
        ctx.strokeStyle = `${COLORS[p.id]}bb`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - 8, 31 + Math.sin(pulse * 7) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = `${COLORS[p.id]}35`;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 17, 23, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS[p.id];
      ctx.lineWidth = p.id === local ? 2.5 : 1;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 17, 23, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      const bounce = moving
        ? Math.sin(pulse * 24) * 3
        : Math.sin(pulse * 2 + p.id) * 0.7;
      const age = this.effects.deathAge(p.id);
      const knockedOut = !p.alive && age < 0.7;
      ctx.save();
      const hop = p.alive ? this.effects.hop(p.id) : 0;
      const lift =
        knockedOut && !this.effects.motion.matches
          ? Math.sin((age / 0.7) * Math.PI) * 55
          : 0;
      ctx.translate(pos.x, pos.y - 10 + bounce - hop - lift);
      if (knockedOut) {
        ctx.globalAlpha = 1 - age / 0.8;
        if (!this.effects.motion.matches) ctx.rotate(age * 8);
      }
      this.sprite(
        p.id ? "player-coral" : "player-teal",
        0,
        0,
        69,
        p.facing === "left",
      );
      ctx.restore();
      ctx.globalAlpha = 1;
      if (p.id === local && !preview && p.alive) {
        ctx.fillStyle = COLORS[p.id];
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - 42);
        ctx.lineTo(pos.x - 4, pos.y - 48);
        ctx.lineTo(pos.x + 4, pos.y - 48);
        ctx.fill();
      }
    }
    for (const brain of view.brains) {
      if (view.activeBrain === brain.id) continue;
      const x = (brain.x + 0.5) * TILE,
        y = brain.y * TILE - 1;
      this.questionLabel(brain.short, x, y);
    }
    this.effects.draw(ctx, this.images.get("crate"));
    ctx.restore();
  }

  private questionLabel(text: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.font = '600 16px "Trebuchet MS", sans-serif';
    const words = text.split(" "),
      lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (line && ctx.measureText(`${line} ${word}`).width > 142) {
        lines.push(line);
        line = word;
      } else line += (line ? " " : "") + word;
    }
    lines.push(line);
    const width = Math.min(
        174,
        Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18,
      ),
      height = lines.length * 19 + 8;
    x = Math.max(width / 2 + 4, Math.min(this.canvas.width - width / 2 - 4, x));
    y = Math.max(height / 2 + 4, y);
    ctx.fillStyle = "#1b2235f5";
    this.round(x - width / 2, y - height / 2, width, height, 7);
    ctx.fill();
    ctx.strokeStyle = "#d589c96b";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd7f4";
    lines.forEach((l, i) =>
      ctx.fillText(l, x, y - height / 2 + 13 + i * 19, width - 12),
    );
  }

  private sprite(
    name: string,
    x: number,
    y: number,
    size: number,
    flip = false,
  ): void {
    const img = this.images.get(name);
    if (!img) return;
    this.ctx.save();
    this.ctx.translate(x, y);
    if (flip) this.ctx.scale(-1, 1);
    this.ctx.drawImage(img, -size / 2, -size / 2, size, size);
    this.ctx.restore();
  }
  private round(x: number, y: number, w: number, h: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
  }
}
