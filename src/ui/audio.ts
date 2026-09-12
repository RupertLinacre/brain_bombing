import type { FrameFeedback } from "../game/feedback";
import { COLS, distance, type PlayerId, type View } from "../game/types";

export type Sound =
  | "explode"
  | "place"
  | "fuse"
  | "good"
  | "bad"
  | "power"
  | "question"
  | "step"
  | "start"
  | "win"
  | "lose"
  | "warning"
  | "click";
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  frequency: number,
  end: number,
  at: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
): void {
  const oscillator = ctx.createOscillator(),
    gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(1, end),
    at + duration,
  );
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.007);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(out);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function noise(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  duration: number,
  volume: number,
  cutoff: number,
  end: number,
  highpass = false,
): void {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  const source = ctx.createBufferSource(),
    filter = ctx.createBiquadFilter(),
    gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = highpass ? "highpass" : "lowpass";
  filter.frequency.setValueAtTime(cutoff, at);
  filter.frequency.exponentialRampToValueAtTime(end, at + duration);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(at);
  source.stop(at + duration + 0.02);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

/** Original procedural sounds. Also works with OfflineAudioContext for audio QA. */
export function synthesizeSound(
  ctx: BaseAudioContext,
  out: AudioNode,
  kind: Sound,
  at = ctx.currentTime,
  strength = 1,
): void {
  const t = (
    hz: number,
    end: number,
    delay: number,
    duration: number,
    volume: number,
    wave: OscillatorType = "sine",
  ) => tone(ctx, out, hz, end, at + delay, duration, volume * strength, wave);
  const n = (
    delay: number,
    duration: number,
    volume: number,
    cutoff: number,
    end: number,
    high = false,
  ) =>
    noise(ctx, out, at + delay, duration, volume * strength, cutoff, end, high);
  if (kind === "explode") {
    const pitch = 0.91 + Math.random() * 0.18;
    t(145 * pitch, 29, 0, 0.48, 0.65);
    t(72 * pitch, 23, 0.025, 0.65, 0.28, "triangle");
    n(0, 0.065, 0.38, 4500, 1400, true);
    n(0.015, 0.58, 0.9, 2100, 85);
    for (let i = 0; i < 4; i++) n(0.08 + i * 0.075, 0.04, 0.1, 2400, 700);
  } else if (kind === "place") {
    t(260, 72, 0, 0.14, 0.3, "triangle");
    t(800, 250, 0, 0.045, 0.08);
    n(0, 0.035, 0.1, 2000, 400);
  } else if (kind === "fuse") {
    n(0, 0.026, 0.075, 5200, 2800, true);
    t(1350, 1100, 0, 0.025, 0.045, "triangle");
  } else if (kind === "good") {
    [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) =>
      t(hz, hz * 1.003, i * 0.065, 0.21, 0.23, "triangle"),
    );
    t(1568, 2093, 0.17, 0.22, 0.075);
  } else if (kind === "bad") {
    t(294, 245, 0, 0.12, 0.17, "triangle");
    t(220, 170, 0.11, 0.19, 0.14, "triangle");
  } else if (kind === "power") {
    [392, 523, 659, 784, 1047, 1568].forEach((hz, i) =>
      t(hz, hz * 1.015, i * 0.045, 0.16, 0.18, "triangle"),
    );
  } else if (kind === "question") {
    t(880, 1109, 0, 0.13, 0.11);
    t(1320, 1661, 0.07, 0.18, 0.09);
  } else if (kind === "step") {
    t(130 + Math.random() * 35, 65, 0, 0.045, 0.09, "triangle");
    n(0, 0.025, 0.045, 650, 150);
  } else if (kind === "start") {
    [392, 523, 659, 1047].forEach((hz, i) =>
      t(hz, hz, i * 0.1, 0.23, 0.2, "triangle"),
    );
  } else if (kind === "win") {
    [523, 659, 784, 1047, 784, 1047].forEach((hz, i) =>
      t(hz, hz, i * 0.12 + 0.25, i === 5 ? 0.55 : 0.21, 0.23, "triangle"),
    );
  } else if (kind === "lose") {
    [392, 330, 294, 196].forEach((hz, i) =>
      t(hz, hz * 0.88, i * 0.14 + 0.25, 0.28, 0.19, "triangle"),
    );
  } else if (kind === "warning") {
    [0, 0.17, 0.34].forEach((delay) =>
      t(659, 523, delay, 0.12, 0.19, "triangle"),
    );
  } else t(760, 480, 0, 0.045, 0.1, "triangle");
}

export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private music?: GainNode;
  private active = false;
  private silent = false;
  private withMusic = true;
  private musicStep = 0;
  private nextNote = 0;
  private scheduler?: ReturnType<typeof setInterval>;
  private lastExplosion = -1;

  get muted(): boolean {
    return this.silent;
  }
  set muted(value: boolean) {
    this.silent = value;
    this.applyLevels();
  }
  get musicEnabled(): boolean {
    return this.withMusic;
  }
  set musicEnabled(value: boolean) {
    this.withMusic = value;
    this.applyLevels();
  }

  unlock(): void {
    try {
      if (!this.context) {
        const ctx = (this.context = new AudioContext());
        this.master = ctx.createGain();
        this.music = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 14;
        limiter.ratio.value = 6;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.22;
        this.music.connect(this.master);
        this.master.connect(limiter);
        limiter.connect(ctx.destination);
        this.applyLevels();
        this.scheduler = setInterval(() => this.scheduleMusic(), 90);
      }
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      /* Audio availability never blocks the game. */
    }
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active && this.context) {
      this.nextNote = this.context.currentTime + 0.1;
      this.musicStep = 0;
    }
    this.applyLevels();
  }

  private applyLevels(): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.music) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.music.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(
      this.silent ? 0 : 0.55,
      ctx.currentTime + 0.035,
    );
    this.music.gain.setValueAtTime(this.music.gain.value, ctx.currentTime);
    this.music.gain.linearRampToValueAtTime(
      this.active && this.withMusic ? 0.12 : 0,
      ctx.currentTime + 0.08,
    );
  }

  play(kind: Sound, pan = 0, strength = 1): void {
    const ctx = this.context;
    if (
      !ctx ||
      !this.master ||
      this.silent ||
      ctx.state !== "running" ||
      document.hidden
    )
      return;
    if (kind === "explode") {
      // Dense chains stay punchy without creating unbounded layers of noise.
      if (ctx.currentTime - this.lastExplosion < 0.035) return;
      this.lastExplosion = ctx.currentTime;
      this.music?.gain.setTargetAtTime(0.035, ctx.currentTime, 0.008);
      this.music?.gain.setTargetAtTime(
        this.active && this.withMusic ? 0.12 : 0,
        ctx.currentTime + 0.3,
        0.13,
      );
    }
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = Math.max(-0.75, Math.min(0.75, pan));
    stereo.connect(this.master);
    synthesizeSound(ctx, stereo, kind, ctx.currentTime, strength);
    setTimeout(() => stereo.disconnect(), 2200);
  }

  react(events: FrameFeedback, view: View, local: PlayerId): void {
    const pan = (x: number) => ((x / (COLS - 1)) * 2 - 1) * 0.65;
    if (events.explosions.length) {
      const nearest = [...events.explosions].sort(
        (a, b) =>
          distance(a, view.players[local]) - distance(b, view.players[local]),
      )[0];
      this.play(
        "explode",
        pan(nearest.x),
        Math.min(1.4, 0.85 + events.explosions.length * 0.12),
      );
    }
    for (const b of events.placed.slice(0, 3))
      this.play("place", pan(b.x), b.owner === local ? 1 : 0.6);
    if (events.fuse) this.play("fuse", pan(events.fuse.x), 0.75);
    if (events.solved) this.play("good");
    if (events.upgraded) this.play("power");
    if (events.wrong) this.play("bad");
    if (events.hits.includes(local)) this.play("lose");
    if (events.question) this.play("question");
    if (events.stepped && !events.question)
      this.play("step", pan(view.players[local].x));
  }

  private scheduleMusic(): void {
    const ctx = this.context;
    if (
      !ctx ||
      !this.music ||
      !this.active ||
      !this.withMusic ||
      this.silent ||
      ctx.state !== "running" ||
      document.hidden
    )
      return;
    if (this.nextNote < ctx.currentTime - 0.1) this.nextNote = ctx.currentTime;
    // An original 8-bar pentatonic arcade groove at 108 bpm. Sparse enough for maths.
    const melody = [
      76, 0, 79, 0, 81, 79, 0, 76, 74, 0, 72, 0, 74, 0, 79, 0, 76, 0, 79, 81,
      84, 0, 81, 0, 79, 0, 76, 0, 74, 0, 0, 0,
    ];
    const roots = [48, 45, 53, 55];
    while (this.nextNote < ctx.currentTime + 0.16) {
      const step = this.musicStep++,
        at = this.nextNote;
      const note = melody[step % melody.length],
        root = roots[Math.floor(step / 16) % 4];
      const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
      if (note)
        tone(ctx, this.music, hz(note), hz(note), at, 0.16, 0.22, "triangle");
      if (step % 4 === 0)
        tone(ctx, this.music, hz(root), hz(root), at, 0.25, 0.42, "triangle");
      if (step % 4 === 2)
        tone(
          ctx,
          this.music,
          hz(root + 7),
          hz(root + 7),
          at,
          0.13,
          0.23,
          "sine",
        );
      if (step % 2 === 0)
        noise(ctx, this.music, at, 0.027, 0.055, 6000, 2500, true);
      if (step % 8 === 0) tone(ctx, this.music, 90, 38, at, 0.11, 0.4);
      this.nextNote += 60 / 108 / 2;
    }
  }

  dispose(): void {
    clearInterval(this.scheduler);
    void this.context?.close();
  }
}
