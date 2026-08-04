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
      this.gain.gain.setTargetAtTime(this.targetGain, now, 0.4);
      this.filter.frequency.setTargetAtTime(this.targetFreq, now, 0.4);
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  /** speedRatio: 0 (idle) .. 1 (cruising) .. beyond 1 while boosting */
  setIntensity(speedRatio: number) {
    const clamped = Math.max(0, speedRatio);
    this.targetGain = Math.min(0.22, 0.03 + clamped * 0.14);
    this.targetFreq = 350 + clamped * 900;
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
 * One-shot synthesized sound effects (no audio files) — currently just the pleasant
 * ring-collection chime, built from a couple of quick sine "bell" tones.
 */
export class SoundEffects {
  private ctx: AudioContext | null = null;

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

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
