/**
 * Procedural weather bed.
 *
 * Two looping noise sources are shaped into rain and wind, then shared through
 * a low-pass "shelter" filter. No audio files are shipped, and a browser that
 * blocks audio simply leaves the graph suspended until the player enters the
 * world (a user gesture).
 */
import type { WeatherKind } from "../game/world/weather";

type AudioContextConstructor = typeof AudioContext;

export class WeatherAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private disposed = false;

  constructor() {
    try {
      const Ctor: AudioContextConstructor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
      if (!Ctor) return;
      const context = new Ctor();
      const master = context.createGain();
      const muffle = context.createBiquadFilter();
      const rainGain = context.createGain();
      const windGain = context.createGain();
      master.gain.value = 0.55;
      muffle.type = "lowpass";
      muffle.frequency.value = 16000;
      rainGain.gain.value = 0;
      windGain.gain.value = 0;

      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.96 + white * 0.04;
        data[index] = last * 5 + white * 0.12;
      }

      const rain = context.createBufferSource();
      rain.buffer = buffer;
      rain.loop = true;
      const rainFilter = context.createBiquadFilter();
      rainFilter.type = "highpass";
      rainFilter.frequency.value = 1600;
      rain.connect(rainFilter).connect(rainGain).connect(master);

      const wind = context.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const windFilter = context.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.value = 420;
      wind.connect(windFilter).connect(windGain).connect(master);

      master.connect(muffle).connect(context.destination);
      rain.start();
      wind.start();
      this.context = context;
      this.master = master;
      this.muffle = muffle;
      this.rainGain = rainGain;
      this.windGain = windGain;
    } catch {
      this.context = null;
    }
  }

  resume(): void {
    if (this.disposed) return;
    void this.context?.resume().catch(() => undefined);
  }

  update(kind: WeatherKind, intensity: number, sheltered: boolean): void {
    if (!this.context || !this.rainGain || !this.windGain || !this.muffle) return;
    const now = this.context.currentTime;
    const wet = kind === "rain" || kind === "storm" || kind === "snow";
    const rainLevel = kind === "snow" ? 0.018 : kind === "rain" || kind === "storm" ? 0.12 + intensity * 0.09 : 0;
    const windLevel = kind === "storm" ? 0.16 : kind === "snow" ? 0.05 : kind === "rain" ? 0.035 : 0.012;
    const exposed = sheltered ? 0.22 : 1;
    this.rainGain.gain.setTargetAtTime(rainLevel * exposed, now, 0.35);
    this.windGain.gain.setTargetAtTime(windLevel * exposed, now, 0.35);
    this.muffle.frequency.setTargetAtTime(sheltered ? 700 : wet ? 9000 : 16000, now, 0.4);
    this.master?.gain.setTargetAtTime(sheltered ? 0.45 : 0.55, now, 0.4);
  }

  dispose(): void {
    this.disposed = true;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
