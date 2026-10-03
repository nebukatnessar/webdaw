import type { Clip } from '../types/daw';

// Number of linear segments used to schedule a quadratic ("exponential")
// fade curve, so the scheduled shape matches clipEnvelopeValueAt at every
// point and can be rebuilt mid-fade without discontinuities.
const FADE_CURVE_STEPS = 16;

export interface ClipGainEnvelope {
  peak: number; // clipGain ?? 1
  muted: boolean;
  fadeInSecs: number; // already clamped to the clip length
  fadeOutSecs: number;
  exponential: boolean;
}

/**
 * Derives the per-clip gain envelope (mute, clip gain, fade-in/out) for a
 * clip at the given BPM. Fade durations live on the clip in beats and are
 * converted to seconds here, clamped to the clip's own duration so a fade
 * can never exceed the clip (e.g. after a trim or a split).
 */
export function clipGainEnvelope(clip: Clip, bpm: number): ClipGainEnvelope {
  const beatsToSecs = 60 / bpm;
  const totalSecs = Math.max(0, clip.durationBeats * beatsToSecs);
  return {
    peak: Math.max(0, clip.clipGain ?? 1),
    muted: clip.muted ?? false,
    fadeInSecs: Math.min(Math.max(0, clip.fadeInDuration ?? 0) * beatsToSecs, totalSecs),
    fadeOutSecs: Math.min(Math.max(0, clip.fadeOutDuration ?? 0) * beatsToSecs, totalSecs),
    exponential: (clip.fadeType ?? 'linear') === 'exponential',
  };
}

/**
 * Envelope gain (0..peak) at a position inside the clip, in seconds.
 */
export function clipEnvelopeValueAt(
  env: ClipGainEnvelope,
  totalSecs: number,
  positionSecs: number,
): number {
  if (env.muted) return 0;
  const pos = Math.max(0, Math.min(positionSecs, totalSecs));
  if (env.fadeInSecs > 0 && pos < env.fadeInSecs) {
    const t = pos / env.fadeInSecs;
    return env.peak * (env.exponential ? t * t : t);
  }
  const fadeOutStart = totalSecs - env.fadeOutSecs;
  if (env.fadeOutSecs > 0 && pos > fadeOutStart) {
    const t = (pos - fadeOutStart) / env.fadeOutSecs;
    const inv = 1 - t;
    return env.peak * (env.exponential ? inv * inv : inv);
  }
  return env.peak;
}

// Schedules a curve from startValue to endValue. Linear fades are a single
// ramp; exponential (quadratic) fades are sampled as short linear segments
// so they match clipEnvelopeValueAt at every point.
function scheduleCurve(
  param: AudioParam,
  startValue: number,
  endValue: number,
  startTime: number,
  endTime: number,
  progressAt: (t: number) => number,
): void {
  if (endTime <= startTime) {
    param.setValueAtTime(endValue, startTime);
    return;
  }
  for (let i = 1; i <= FADE_CURVE_STEPS; i++) {
    const t = i / FADE_CURVE_STEPS;
    param.linearRampToValueAtTime(
      startValue + (endValue - startValue) * progressAt(t),
      startTime + (endTime - startTime) * t,
    );
  }
}

/**
 * Schedules the clip's gain envelope (mute, clip gain, fade-in/out) on an
 * AudioParam. `startCtxTime`/`endCtxTime` are the absolute context times of
 * the scheduled audio window; `positionSecs` is where that window starts
 * inside the clip (0 for a clip played from its start, > 0 when playback
 * begins mid-clip or a live update lands mid-clip). Only the part of the
 * envelope after `positionSecs` is scheduled.
 */
export function scheduleClipGainEnvelope(
  param: AudioParam,
  clip: Clip,
  startCtxTime: number,
  endCtxTime: number,
  bpm: number,
  positionSecs = 0,
): void {
  const beatsToSecs = 60 / bpm;
  const totalSecs = Math.max(0, clip.durationBeats * beatsToSecs);
  const env = clipGainEnvelope(clip, bpm);
  if (env.muted) {
    param.setValueAtTime(0, startCtxTime);
    return;
  }

  const windowEndSecs = positionSecs + (endCtxTime - startCtxTime);
  const toCtxTime = (localSecs: number) => startCtxTime + Math.max(0, localSecs - positionSecs);

  // Anchor the envelope at the start of this window
  param.setValueAtTime(clipEnvelopeValueAt(env, totalSecs, positionSecs), startCtxTime);

  // Remaining fade-in
  if (env.fadeInSecs > 0 && positionSecs < env.fadeInSecs) {
    scheduleCurve(
      param,
      clipEnvelopeValueAt(env, totalSecs, positionSecs),
      env.peak,
      startCtxTime,
      toCtxTime(env.fadeInSecs),
      (t) => (env.exponential ? t * t : t),
    );
  }

  // Remaining fade-out. The fade-out start is kept at or after the fade-in
  // end so overlapping fade handles on a short clip degrade gracefully
  // instead of interleaving automation events.
  const fadeOutStartSecs = Math.max(totalSecs - env.fadeOutSecs, env.fadeInSecs);
  if (env.fadeOutSecs > 0 && windowEndSecs > fadeOutStartSecs) {
    if (fadeOutStartSecs > positionSecs) {
      param.setValueAtTime(env.peak, toCtxTime(fadeOutStartSecs));
    }
    scheduleCurve(
      param,
      env.peak,
      0,
      Math.max(startCtxTime, toCtxTime(fadeOutStartSecs)),
      endCtxTime,
      (t) => 1 - (1 - t) * (1 - t),
    );
  }
}
