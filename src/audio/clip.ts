import type { Clip, FadeType } from '../types/daw';

// Curved fades are mirrored around the fade midpoint. The 'exponential'
// pair swells in quickly from the silent corner and releases with an
// accelerating dive; the 'logarithmic' pair is its mirror, creeping in and
// dropping away early with a long tail. Both curves are defined by
// fadeCurveValueAt below, and both the audio scheduling and the clip
// drawing sample that exact function, so picture and sound always agree.
const CURVE_STEEPNESS = Math.pow(10, -60 / 20); // 0.001

// Number of linear segments used to schedule a curved fade, sampling
// fadeCurveValueAt at every point so audio, drawing, and mid-fade rebuilds
// all land on the same curve.
const FADE_CURVE_STEPS = 16;

/**
 * Coerces an unknown fade curve name (e.g. from a saved project) to a valid
 * shape, defaulting to the exponential curve.
 */
export function normalizeFadeType(value: unknown): FadeType {
  return value === 'linear' || value === 'logarithmic' ? value : 'exponential';
}

export interface ClipGainEnvelope {
  peak: number; // clipGain ?? 1
  muted: boolean;
  fadeInSecs: number; // already clamped to the clip length
  fadeOutSecs: number;
  inCurve: FadeType;
  outCurve: FadeType;
}

/**
 * Derives the per-clip gain envelope (mute, clip gain, fade-in/out) for a
 * clip at the given BPM. Fade durations live on the clip in beats and are
 * converted to seconds here, clamped to the clip's own duration so a fade
 * can never exceed the clip (e.g. after a trim or a split). Each fade edge
 * has its own curve shape, defaulting to exponential when unset.
 */
export function clipGainEnvelope(clip: Clip, bpm: number): ClipGainEnvelope {
  const beatsToSecs = 60 / bpm;
  const totalSecs = Math.max(0, clip.durationBeats * beatsToSecs);
  return {
    peak: Math.max(0, clip.clipGain ?? 1),
    muted: clip.muted ?? false,
    fadeInSecs: Math.min(Math.max(0, clip.fadeInDuration ?? 0) * beatsToSecs, totalSecs),
    fadeOutSecs: Math.min(Math.max(0, clip.fadeOutDuration ?? 0) * beatsToSecs, totalSecs),
    inCurve: normalizeFadeType(clip.fadeInType),
    outCurve: normalizeFadeType(clip.fadeOutType),
  };
}

/**
 * Normalized fade curve shape (0..1) at progress `t` into a fade. Linear
 * fades move at constant amplitude. The exponential pair changes quickly at
 * the silent end and settles toward full level - the fade-in swells in fast
 * from the corner, the fade-out holds then accelerates into silence. The
 * logarithmic pair is its mirror - the fade-in creeps up and sweeps in at
 * the end, the fade-out drops away early with a long tail. Used both for
 * audio scheduling and for drawing the fade line on the clip.
 */
export function fadeCurveValueAt(curve: FadeType, phase: 'in' | 'out', t: number): number {
  const tc = Math.max(0, Math.min(1, t));
  if (curve === 'linear') return phase === 'in' ? tc : 1 - tc;
  if (curve === 'logarithmic') {
    return phase === 'in'
      ? Math.pow(CURVE_STEEPNESS, 1 - tc)
      : Math.pow(CURVE_STEEPNESS, tc);
  }
  return phase === 'in'
    ? 1 - Math.pow(CURVE_STEEPNESS, tc)
    : 1 - Math.pow(CURVE_STEEPNESS, 1 - tc);
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
    return env.peak * fadeCurveValueAt(env.inCurve, 'in', pos / env.fadeInSecs);
  }
  const fadeOutStart = totalSecs - env.fadeOutSecs;
  if (env.fadeOutSecs > 0 && pos > fadeOutStart) {
    return env.peak * fadeCurveValueAt(env.outCurve, 'out', (pos - fadeOutStart) / env.fadeOutSecs);
  }
  return env.peak;
}

// Schedules the part of a fade between two progress points as short linear
// segments sampling fadeCurveValueAt (a single straight ramp for the
// linear curve), so the scheduled shape is exact at every point and a
// rebuild mid-fade continues the same curve.
function scheduleFadeSegments(
  param: AudioParam,
  curve: FadeType,
  peak: number,
  phase: 'in' | 'out',
  fromProgress: number,
  toProgress: number,
  startCtxTime: number,
  endCtxTime: number,
): void {
  if (toProgress <= fromProgress || endCtxTime <= startCtxTime) return;
  const span = toProgress - fromProgress;
  if (curve === 'linear') {
    param.linearRampToValueAtTime(
      peak * fadeCurveValueAt('linear', phase, toProgress),
      endCtxTime,
    );
    return;
  }
  const duration = endCtxTime - startCtxTime;
  for (let i = 1; i <= FADE_CURVE_STEPS; i++) {
    const p = fromProgress + span * (i / FADE_CURVE_STEPS);
    param.linearRampToValueAtTime(
      peak * fadeCurveValueAt(curve, phase, p),
      startCtxTime + duration * (i / FADE_CURVE_STEPS),
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
  if (env.muted || env.peak <= 0) {
    param.setValueAtTime(0, startCtxTime);
    return;
  }

  const windowEndSecs = positionSecs + (endCtxTime - startCtxTime);
  const toCtxTime = (localSecs: number) => startCtxTime + Math.max(0, localSecs - positionSecs);

  // Anchor the envelope at the start of this window
  param.setValueAtTime(clipEnvelopeValueAt(env, totalSecs, positionSecs), startCtxTime);

  // Remaining fade-in (the fade may be cut short by the window's end, e.g.
  // when the underlying audio buffer is shorter than the clip)
  if (env.fadeInSecs > 0 && positionSecs < env.fadeInSecs) {
    const fromProgress = positionSecs / env.fadeInSecs;
    const toProgress = Math.min(1, windowEndSecs / env.fadeInSecs);
    scheduleFadeSegments(
      param, env.inCurve, env.peak, 'in', fromProgress, toProgress,
      startCtxTime,
      toProgress === 1 ? toCtxTime(env.fadeInSecs) : endCtxTime,
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
    const fromProgress = Math.max(0, (positionSecs - fadeOutStartSecs) / env.fadeOutSecs);
    const toProgress = Math.min(1, (windowEndSecs - fadeOutStartSecs) / env.fadeOutSecs);
    scheduleFadeSegments(
      param, env.outCurve, env.peak, 'out', fromProgress, toProgress,
      Math.max(startCtxTime, toCtxTime(fadeOutStartSecs)),
      toProgress === 1 ? toCtxTime(totalSecs) : endCtxTime,
    );
  }
}
