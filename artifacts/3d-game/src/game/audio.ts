/**
 * Ambient wind noise synthesized entirely with the Web Audio API (no audio files):
 * a looping white-noise buffer through a lowpass filter, whose cutoff and gain
 * rise with flight speed so boosting feels like accelerating into the wind.
 */
export class WindAudio {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private targetGain = 0;
  private targetFreq = 500;
  private rafId: number | null = null;
  // Underwater the wind becomes a low, muffled rumble; the switch glides faster than the usual
  // speed changes so a dive sounds like plunging in.
  private underwater = false;
  private fastGlideUntil = 0;

  async start() {
    if (this.ctx) return;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    this.source = source;
    this.filter = filter;
    this.gain = gain;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const tick = () => {
      if (!this.ctx || !this.gain || !this.filter) return;
      const now = this.ctx.currentTime;
      const glide = performance.now() < this.fastGlideUntil ? 0.12 : 0.4;
      this.gain.gain.setTargetAtTime(this.targetGain, now, glide);
      this.filter.frequency.setTargetAtTime(this.targetFreq, now, glide);
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  /** speedRatio: 0 (idle) .. 1 (cruising) .. beyond 1 while boosting */
  setIntensity(speedRatio: number) {
    const clamped = Math.max(0, speedRatio);
    if (this.underwater) {
      this.targetGain = Math.min(0.1, 0.05 + clamped * 0.03);
      this.targetFreq = 170 + clamped * 90;
      return;
    }
    this.targetGain = Math.min(0.22, 0.03 + clamped * 0.14);
    this.targetFreq = 350 + clamped * 900;
  }

  /** Muffles the wind into an underwater rumble (and back), gliding quickly. */
  setUnderwater(underwater: boolean) {
    if (underwater === this.underwater) return;
    this.underwater = underwater;
    this.fastGlideUntil = performance.now() + 600;
  }

  /** Silences the wind while the game is paused (suspending the context), and brings it back. */
  setSuspended(suspended: boolean) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    void (suspended ? ctx.suspend() : ctx.resume()).catch(() => undefined);
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.source?.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.source = null;
    this.filter = null;
    this.gain = null;
  }
}

/**
 * One-shot synthesized sound effects (no audio files): the ring-collection chime (a couple of
 * quick sine "bell" tones) and water splashes (swept, filtered noise).
 */
export class SoundEffects {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  private getContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** A short, bright two-note chime — played when the bird flies through a ring. */
  playChime() {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const notes = [1046.5, 1568.0]; // C6, G6 — a bright little "ding"

    notes.forEach((freq, i) => {
      const start = now + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  /**
   * A water splash: filtered noise whose band sweeps down for a dive ("plunk") and up when
   * surfacing ("whoosh"). `volume` scales it (quieter for distant dolphins).
   */
  playSplash(kind: 'dive' | 'surface', volume = 1) {
    const ctx = this.getContext();
    if (!this.noise) {
      const length = Math.floor(ctx.sampleRate * 0.7);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    const dive = kind === 'dive';
    filter.frequency.setValueAtTime(dive ? 1800 : 450, now);
    filter.frequency.exponentialRampToValueAtTime(dive ? 280 : 2200, now + 0.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.26 * volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (dive ? 0.6 : 0.5));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.65);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.noise = null;
  }
}
