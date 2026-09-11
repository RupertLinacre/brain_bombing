export class GameAudio {
  muted = true;
  private context?: AudioContext;
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
    } catch {
      /* Sound is optional. */
    }
  }
  play(kind: "good" | "bad" | "bomb" | "end"): void {
    if (this.muted || !this.context) return;
    const ctx = this.context,
      now = ctx.currentTime;
    const notes =
      kind === "good"
        ? [523, 659, 784]
        : kind === "bad"
          ? [220, 160]
          : kind === "end"
            ? [392, 523, 659, 784]
            : [85, 50, 30];
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = kind === "bomb" ? "sawtooth" : "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + i * 0.075);
      gain.gain.linearRampToValueAtTime(
        kind === "bomb" ? 0.045 : 0.1,
        now + i * 0.075 + 0.01,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.075 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.075);
      osc.stop(now + i * 0.075 + 0.22);
    });
  }
}
