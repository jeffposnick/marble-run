import { MARBLE_RADIUS } from "../config.ts";
import type { Impact, MarbleState, Surface } from "../physics/world.ts";

/** Where a sound sits relative to the listener: stereo position and distance loudness. */
export interface Placement {
  /** -1 (left) to 1 (right). */
  pan: number;
  /** 0 to 1. */
  gain: number;
}

export type Placer = (x: number, y: number, z: number) => Placement;

/** Most marbles heard rolling at once; the fastest win. */
const MAX_ROLL_VOICES = 10;
/** Most impact sounds started per second, so a pile-up in the finish cup doesn't roar. */
const MAX_IMPACTS_PER_SECOND = 40;
/** Speed (m/s) at which rolling reaches full loudness. */
const ROLL_FULL_SPEED = 2.5;
/** Gravity alone changes a marble's velocity by about this much per step; quieter hits are noise. */
const MIN_IMPACT: Record<Impact["kind"], number> = { glass: 0.08, track: 0.7, table: 0.5 };
const MASTER_GAIN = 0.8;

/**
 * Procedural marble sounds, synthesised with the Web Audio API (no audio files): a hollow,
 * rumbling hiss for glass rolling along plastic channels, a bright "tink" when marbles strike
 * each other, and a plastic "tock" when one lands on the track.
 *
 * Browsers only allow audio after a user gesture, so call {@link unlock} from one.
 */
export class MarbleSounds {
  #ctx: AudioContext | undefined;
  #master: GainNode | undefined;
  #noise: AudioBuffer | undefined;
  #voices = new Map<number, RollVoice>();
  #enabled: boolean;
  #impactBudget = MAX_IMPACTS_PER_SECOND;
  #lastUpdate = 0;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Creates or resumes the audio context. Call from a user gesture (click, key press). */
  unlock(): void {
    if (!this.#enabled) return;
    if (!this.#ctx) {
      if (typeof AudioContext === "undefined") return;
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const compressor = new DynamicsCompressorNode(ctx, {
        threshold: -18,
        knee: 12,
        ratio: 4,
        attack: 0.003,
        release: 0.15,
      });
      compressor.connect(ctx.destination);
      this.#master = new GainNode(ctx, { gain: MASTER_GAIN });
      this.#master.connect(compressor);
      this.#noise = makeNoise(ctx, 2);
      this.#ctx = ctx;
    }
    if (this.#ctx.state === "suspended") void this.#ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.#enabled = on;
    if (on) this.unlock();
    else {
      this.#releaseAll();
      if (this.#ctx?.state === "running") void this.#ctx.suspend();
    }
  }

  /** Pauses output while the page is hidden; resumes it (if enabled) when shown again. */
  setHidden(hidden: boolean): void {
    if (!this.#ctx) return;
    if (hidden) void this.#ctx.suspend();
    else if (this.#enabled) void this.#ctx.resume();
  }

  /** Fades out every rolling sound, e.g. while the simulation is paused. */
  hush(): void {
    this.#releaseAll();
  }

  /** Call once per frame with the current marbles and the collisions since the last frame. */
  update(marbles: Iterable<MarbleState>, impacts: readonly Impact[], place: Placer): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#enabled || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const dt = Math.min(0.25, Math.max(0, now - this.#lastUpdate));
    this.#lastUpdate = now;
    this.#impactBudget = Math.min(
      MAX_IMPACTS_PER_SECOND / 4,
      this.#impactBudget + dt * MAX_IMPACTS_PER_SECOND,
    );

    // ---- Rolling: give voices to the fastest marbles touching a surface.
    const rolling = [...marbles]
      .filter((m) => m.surface !== null && m.speed > 0.03)
      .toSorted((a, b) => b.speed - a.speed)
      .slice(0, MAX_ROLL_VOICES);
    const heard = new Set<number>();
    for (const m of rolling) {
      let voice = this.#voices.get(m.id);
      if (!voice) {
        if (this.#voices.size >= MAX_ROLL_VOICES) continue;
        voice = new RollVoice(ctx, this.#noise!, this.#master!);
        this.#voices.set(m.id, voice);
      }
      heard.add(m.id);
      const where = place(m.x, m.y, m.z);
      voice.set(m.speed, m.surface!, where, now);
    }
    for (const [id, voice] of this.#voices) {
      if (heard.has(id)) continue;
      // Airborne, stopped or gone: fade out, and free the voice once it has been quiet a while.
      voice.silence(now);
      if (voice.quietSince !== undefined && now - voice.quietSince > 0.4) {
        voice.stop(now);
        this.#voices.delete(id);
      }
    }

    // ---- Impacts, loudest first, within the rate limit.
    const audible = impacts
      .filter((i) => i.strength >= MIN_IMPACT[i.kind])
      .toSorted((a, b) => b.strength - a.strength);
    for (const impact of audible) {
      if (this.#impactBudget < 1) break;
      this.#impactBudget -= 1;
      const where = place(impact.x, impact.y, impact.z);
      if (impact.kind === "glass") glassClick(ctx, this.#noise!, this.#master!, impact, where);
      else surfaceKnock(ctx, this.#noise!, this.#master!, impact, where);
    }
  }

  #releaseAll(): void {
    const now = this.#ctx?.currentTime ?? 0;
    for (const voice of this.#voices.values()) voice.stop(now);
    this.#voices.clear();
  }
}

/** One marble's rolling sound: filtered noise with a hollow resonance and a per-turn wobble. */
class RollVoice {
  readonly #source: AudioBufferSourceNode;
  readonly #body: BiquadFilterNode;
  readonly #ring: BiquadFilterNode;
  readonly #ringGain: GainNode;
  readonly #wobble: OscillatorNode;
  readonly #amp: GainNode;
  readonly #panner: StereoPannerNode;
  /** Each marble's channel resonates at a slightly different pitch. */
  readonly #ringBase = 1500 + Math.random() * 900;
  quietSince: number | undefined;

  constructor(ctx: AudioContext, noise: AudioBuffer, out: AudioNode) {
    this.#source = new AudioBufferSourceNode(ctx, {
      buffer: noise,
      loop: true,
      playbackRate: 0.9 + Math.random() * 0.2,
    });
    const highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 90 });
    // Broad band that rises with speed: the rumble of the glass on the channel floor.
    this.#body = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 300, Q: 0.8 });
    // Narrow band: the plastic channel ringing like a hollow tube.
    this.#ring = new BiquadFilterNode(ctx, { type: "bandpass", frequency: this.#ringBase, Q: 9 });
    this.#ringGain = new GainNode(ctx, { gain: 0 });
    // Tiny imperfections in the marble give a wobble once per revolution.
    const tremolo = new GainNode(ctx, { gain: 1 });
    this.#wobble = new OscillatorNode(ctx, { type: "sine", frequency: 1 });
    const depth = new GainNode(ctx, { gain: 0.3 });
    this.#amp = new GainNode(ctx, { gain: 0 });
    this.#panner = new StereoPannerNode(ctx, { pan: 0 });

    this.#source.connect(highpass);
    highpass.connect(this.#body).connect(tremolo);
    highpass.connect(this.#ring).connect(this.#ringGain).connect(tremolo);
    this.#wobble.connect(depth).connect(tremolo.gain);
    tremolo.connect(this.#amp).connect(this.#panner).connect(out);

    const t = ctx.currentTime;
    this.#source.start(t, Math.random() * noise.duration);
    this.#wobble.start(t);
  }

  set(speed: number, surface: Surface, where: Placement, now: number): void {
    const s = Math.min(1, speed / ROLL_FULL_SPEED);
    const onTrack = surface === "track";
    const level = (onTrack ? 0.22 : 0.1) * s ** 1.3 * where.gain;
    const smooth = 0.04;
    this.#amp.gain.setTargetAtTime(level, now, smooth);
    this.#body.frequency.setTargetAtTime((onTrack ? 260 : 160) + 1100 * s, now, smooth);
    this.#ring.frequency.setTargetAtTime(this.#ringBase * (0.85 + 0.3 * s), now, smooth);
    this.#ringGain.gain.setTargetAtTime(onTrack ? 2.2 : 0.4, now, smooth);
    const revolutionsPerSecond = speed / (2 * Math.PI * MARBLE_RADIUS);
    this.#wobble.frequency.setTargetAtTime(Math.min(45, revolutionsPerSecond), now, smooth);
    this.#panner.pan.setTargetAtTime(where.pan, now, smooth);
    this.quietSince = undefined;
  }

  silence(now: number): void {
    if (this.quietSince !== undefined) return;
    this.#amp.gain.setTargetAtTime(0, now, 0.025);
    this.quietSince = now;
  }

  stop(now: number): void {
    this.#amp.gain.setTargetAtTime(0, now, 0.02);
    this.#source.stop(now + 0.15);
    this.#wobble.stop(now + 0.15);
    this.#source.addEventListener("ended", () => this.#panner.disconnect());
  }
}

/**
 * Glass on glass: a hard, dry "clack". Two solid spheres meet for a fraction of a millisecond,
 * so the sound is mostly a sharp broadband snap; the glass barely gets to ring, so its tones
 * are heavily damped instead of left to sing (which sounds like a "plink").
 */
function glassClick(
  ctx: AudioContext,
  noise: AudioBuffer,
  out: AudioNode,
  impact: Impact,
  where: Placement,
): void {
  const t = ctx.currentTime;
  const v = Math.min(1, impact.strength / 1.5);
  const loudness = (0.1 + 0.55 * v ** 0.8) * where.gain;
  if (loudness < 0.002) return;
  const panner = new StereoPannerNode(ctx, { pan: where.pan });
  panner.connect(out);

  // The snap: a burst of noise centred in the upper mids, harder hits a touch longer and brighter.
  burst(ctx, noise, panner, t, 0.008 + 0.006 * v, loudness * 1.4, {
    type: "bandpass",
    frequency: (2000 + 900 * v) * jitter(),
    Q: 1.4,
  });
  // The crack of first contact.
  burst(ctx, noise, panner, t, 0.0025, loudness * 0.7, { type: "highpass", frequency: 5000 });

  // A little hard, hollow body under the snap, gone within about 10 ms.
  const base = 1300 * jitter();
  const tones: [ratio: number, amp: number, decay: number][] = [
    [1, 0.45, 0.006],
    [2.32, 0.25, 0.004],
    [0.42, 0.3, 0.005],
  ];
  for (const [ratio, amp, decay] of tones) {
    const osc = new OscillatorNode(ctx, { type: "triangle", frequency: base * ratio });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(loudness * amp, t + 0.0008);
    env.gain.setTargetAtTime(0, t + 0.0008, decay);
    osc.connect(env).connect(panner);
    osc.start(t);
    osc.stop(t + decay * 8);
  }
  setTimeout(() => panner.disconnect(), 500);
}

/** A marble landing on the plastic track (or the table): a short, hollow knock. */
function surfaceKnock(
  ctx: AudioContext,
  noise: AudioBuffer,
  out: AudioNode,
  impact: Impact,
  where: Placement,
): void {
  const t = ctx.currentTime;
  const v = Math.min(1, Math.max(0, impact.strength - 0.5) / 2.5);
  const onTrack = impact.kind === "track";
  const loudness = (0.06 + 0.4 * v) * where.gain * (onTrack ? 1 : 0.7);
  if (loudness < 0.002) return;
  const panner = new StereoPannerNode(ctx, { pan: where.pan });
  panner.connect(out);

  const tones: [freq: number, amp: number, decay: number][] = onTrack
    ? [
        [300 + Math.random() * 60, 0.7, 0.03],
        [1250 + Math.random() * 300, 0.45, 0.018],
        [3400 + Math.random() * 600, 0.25, 0.01],
      ]
    : [
        [140 + Math.random() * 30, 0.9, 0.04],
        [520 + Math.random() * 80, 0.3, 0.02],
      ];
  for (const [freq, amp, decay] of tones) {
    const osc = new OscillatorNode(ctx, { frequency: freq });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(loudness * amp, t + 0.002);
    env.gain.setTargetAtTime(0, t + 0.002, decay);
    osc.connect(env).connect(panner);
    osc.start(t);
    osc.stop(t + decay * 7);
  }
  burst(ctx, noise, panner, t, 0.012, loudness * 0.5, {
    type: "bandpass",
    frequency: onTrack ? 1800 : 600,
    Q: 1.5,
  });
  setTimeout(() => panner.disconnect(), 600);
}

/** A random factor within ±12.5%, so repeated hits don't sound identical. */
function jitter(): number {
  return 1 + (Math.random() - 0.5) * 0.25;
}

/** A short, filtered noise burst. */
function burst(
  ctx: AudioContext,
  noise: AudioBuffer,
  out: AudioNode,
  t: number,
  length: number,
  gain: number,
  filter: BiquadFilterOptions,
): void {
  const source = new AudioBufferSourceNode(ctx, { buffer: noise });
  const env = new GainNode(ctx, { gain });
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  source.connect(new BiquadFilterNode(ctx, filter)).connect(env).connect(out);
  source.start(t, Math.random() * (noise.duration - length - 0.01));
  source.stop(t + length + 0.01);
}

/** White noise, shared by every sound. */
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
