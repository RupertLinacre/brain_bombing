import {
  COLS,
  ROWS,
  FUSE_SECONDS,
  key,
  type PlayerId,
  type View,
} from "./types";

const TILE = 60;
const COLORS = ["#51e3d2", "#ff877b"];
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private positions = [
    { x: TILE * 1.5, y: TILE * 1.5 },
    { x: TILE * 13.5, y: TILE * 9.5 },
  ];
  private particles: Particle[] = [];
  private oldFlames = new Set<string>();
  private lastTime = 0;
  private lastFrame = 0;
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
    this.oldFlames.clear();
    this.particles = [];
  }

  draw(view: View, local: PlayerId, now: number, preview = false): void {
    const ctx = this.ctx,
      dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    if (view.time < this.lastTime) this.reset();
    this.lastTime = view.time;
    const pulse = now / 1000;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#12272e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const px = x * TILE,
          py = y * TILE;
        const edge = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        ctx.fillStyle = edge
          ? "#1c3038"
          : (x + y) % 2 === 0
            ? "#284448"
            : "#2c494c";
        this.round(px + 1, py + 1, TILE - 2, TILE - 2, 5);
        ctx.fill();
        if (!edge) {
          ctx.fillStyle = "#52706c40";
          ctx.fillRect(px + 7, py + 7, 2, 2);
          ctx.fillStyle = "#101f293b";
          ctx.fillRect(px + 2, py + TILE - 3, TILE - 4, 2);
        }
        if (view.map[y][x] === 1) {
          if (edge) {
            ctx.fillStyle = "#30444c";
            this.round(px + 5, py + 4, TILE - 10, TILE - 11, 6);
            ctx.fill();
            ctx.fillStyle = "#3f5660";
            ctx.fillRect(px + 10, py + 8, TILE - 20, 2);
            ctx.fillStyle = "#152832";
            ctx.fillRect(px + 8, py + TILE - 9, TILE - 16, 3);
            ctx.fillStyle = "#71908655";
            ctx.beginPath();
            ctx.arc(px + TILE / 2, py + TILE / 2, 2, 0, Math.PI * 2);
            ctx.fill();
          } else
            this.sprite("steel", px + TILE / 2, py + TILE / 2 - 2, TILE + 9);
        } else if (view.map[y][x] === 2)
          this.sprite("crate", px + TILE / 2, py + TILE / 2 - 2, TILE + 5);
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
      this.sprite(
        "bomb",
        x,
        y - 1,
        53 + Math.sin(pulse * (fuse < 0.3 ? 24 : 9)) * (1 - fuse) * 5,
      );
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
    const newFlames = new Set<string>();
    for (const flame of view.flames) {
      const x = flame.x * TILE,
        y = flame.y * TILE;
      newFlames.add(key(flame));
      if (!this.oldFlames.has(key(flame)))
        for (let i = 0; i < 5; i++)
          this.particles.push({
            x: x + TILE / 2,
            y: y + TILE / 2,
            vx: (Math.random() - 0.5) * 170,
            vy: (Math.random() - 0.5) * 170,
            life: 0.3 + Math.random() * 0.4,
            color: i % 2 ? "#fff5a0" : "#ffab48",
          });
      const gradient = ctx.createRadialGradient(
        x + 30,
        y + 30,
        2,
        x + 30,
        y + 30,
        43,
      );
      gradient.addColorStop(0, "#fff7b4");
      gradient.addColorStop(0.38, "#ffca53");
      gradient.addColorStop(1, "#fa693a00");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - 8, y - 8, TILE + 16, TILE + 16);
      ctx.fillStyle = "#fff4ad";
      this.round(x + 19, y + 8, 22, TILE - 16, 8);
      ctx.fill();
      this.round(x + 8, y + 19, TILE - 16, 22, 8);
      ctx.fill();
    }
    this.oldFlames = newFlames;
    for (const p of view.players) {
      const pos = this.positions[p.id],
        x = (p.x + 0.5) * TILE,
        y = (p.y + 0.5) * TILE;
      if (Math.abs(pos.x - x) + Math.abs(pos.y - y) > TILE * 3 || preview) {
        pos.x = x;
        pos.y = y;
      }
      const moving = Math.abs(pos.x - x) + Math.abs(pos.y - y) > 2;
      const lerp = Math.min(1, dt * 24);
      pos.x += (x - pos.x) * lerp;
      pos.y += (y - pos.y) * lerp;
      ctx.globalAlpha = p.alive ? 1 : 0.23;
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
      this.sprite(
        p.id ? "player-coral" : "player-teal",
        pos.x,
        pos.y - 10 + bounce,
        69,
        p.facing === "left",
      );
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
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
      p.life -= dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 3));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    ctx.globalAlpha = 1;
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
