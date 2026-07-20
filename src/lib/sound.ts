/**
 * Nook's voice — a tiny synthesized foley kit built entirely on the Web Audio
 * API. No sample files: every sound is generated from oscillators and filtered
 * noise so it stays weightless, tunable, and premium rather than cartoonish.
 *
 * Everything is deliberately soft (low master gain, gentle envelopes). Sounds
 * are best-effort — if the audio context can't start (autoplay policy, no
 * device) we fail silent and never throw into the render loop.
 */

const MUTE_KEY = "nook.muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
/** Shared white-noise buffer reused by every footstep — cheap and jitter-free. */
let noiseBuffer: AudioBuffer | null = null;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* private mode — in-memory only */
  }
}

function ensureContext(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const secs = 0.4;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noiseBuffer = buf;
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Browsers gate audio behind a user gesture. Call once from a pointer/key
 * handler to unlock the context ahead of the first programmatic sound.
 */
export function primeAudio(): void {
  ensureContext();
}

/** A single soft footfall: a filtered-noise tap with a fast, rounded decay. */
export function footstep(strength = 1): void {
  const ac = ensureContext();
  if (!ac || !master || !noiseBuffer) return;
  const now = ac.currentTime;

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;

  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  // Small per-step wobble keeps a walk cycle from sounding like a metronome.
  band.frequency.value = 230 + Math.random() * 120;
  band.Q.value = 1.1;

  const low = ac.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 900;

  const g = ac.createGain();
  const peak = 0.06 * strength;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

  src.connect(band).connect(low).connect(g).connect(master);
  src.start(now);
  src.stop(now + 0.16);
}

/** A soft, grounded "here I am" thud when the walk lands. */
export function arrival(): void {
  const ac = ensureContext();
  if (!ac || !master) return;
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.36);
}

/** Two-note glimmer, used when a card/bubble appears. `up` reverses it on exit. */
function chime(up: boolean, gain = 0.05): void {
  const ac = ensureContext();
  if (!ac || !master) return;
  const now = ac.currentTime;
  const notes = up ? [523.25, 783.99] : [659.25, 392.0]; // C5→G5 / E5→G4

  notes.forEach((freq, i) => {
    const t = now + i * 0.07;
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(master!);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

export function appear(): void {
  chime(true);
}

export function disappear(): void {
  chime(false, 0.035);
}

/** Warm little three-note hello for greetings/waves. */
export function greet(): void {
  const ac = ensureContext();
  if (!ac || !master) return;
  const now = ac.currentTime;
  [392.0, 493.88, 587.33].forEach((freq, i) => {
    const t = now + i * 0.09;
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(g).connect(master!);
    osc.start(t);
    osc.stop(t + 0.28);
  });
}

/**
 * Drives a footstep cadence while the creature walks. Steps are spaced to match
 * the body's foot animation (~0.38s cycle → a footfall every ~0.19s), with a
 * gentle acceleration/deceleration so the gait feels natural, not mechanical.
 * Returns a stop handle.
 */
export function startFootsteps(totalMs: number): () => void {
  const ac = ensureContext();
  let cancelled = false;
  if (!ac) return () => {};

  const start = performance.now();
  const step = 190; // ms between footfalls at cruising pace
  let leftFoot = true;

  const tick = () => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    const progress = Math.min(elapsed / totalMs, 1);
    // Quieter at the very start and end (accel / decel of the gait).
    const ramp = Math.sin(Math.min(progress, 1) * Math.PI);
    footstep(0.55 + ramp * 0.65 * (leftFoot ? 1 : 0.85));
    leftFoot = !leftFoot;
    if (elapsed + step < totalMs) {
      window.setTimeout(tick, step);
    }
  };
  // First footfall lands just after the walk begins moving.
  const first = window.setTimeout(tick, 60);

  return () => {
    cancelled = true;
    clearTimeout(first);
  };
}
