import type { Clip } from '../types/daw';

// Exponential fades change quickly at the silent end of the fade and
// settle toward full level - the shape that reads as a smooth, musical
// fade (a fade-in swells in quickly instead of lurking inaudible for most
// of its length; a fade-out drops away early with a long tail). Web Audio's
// exponentialRamp cannot reach 0, so fades start and end at a -60 dB floor
// relative to the peak and step to/from true silence at the clip edges.
const EXPONENTIAL_FLOOR_RATIO = Math.pow(10, -60 / 20); // 0.001

// The exponential fade-in rises so steeply near its start that it is not a
// pure exponential ramp, so it is scheduled as short linear segments that
// sample fadeCurveValueAt at every point.
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
 * can never exceed the clip (e.g. after a trim or a split). Fades default
 * to the exponential (constant-dB) curve when no type is set.
 */
export function clipGainEnvelope(clip: Clip, bpm: number): ClipGainEnvelope {
  const beatsToSecs = 60 / bpm;
  const totalSecs = Math.max(0, clip.durationBeats * beatsToSecs);
  return {
    peak: Math.max(0, clip.clipGain ?? 1),
    muted: clip.muted ?? false,
    fadeInSecs: Math.min(Math.max(0, clip.fadeInDuration ?? 0) * beatsToSecs, totalSecs),
    fadeOutSecs: Math.min(Math.max(0, clip.fadeOutDuration ?? 0) * beatsToSecs, totalSecs),
    exponential: (clip.fadeType ?? 'exponential') === 'exponential',
  };
}

/**
 * Normalized fade curve shape (0..1) at progress `t` into a fade. Linear fades
 * move at constant amplitude. Exponential fades change quickly at the
 * silent end of the fade and settle toward full level - the fade-in rises
 * fast from the corner then flattens, the fade-out leaves full level early
 * with a smooth tail. Used both for audio scheduling and for drawing the
 * fade line on the clip.
 */
export function fadeCurveValueAt(exponential: boolean, phase: 'in' | 'out', t: number): number {
  const tc = Math.max(0, Math.min(1, t));
  if (!exponential) return phase === 'in' ? tc : 1 - tc;
  return phase === 'in'
    ? 1 - Math.pow(EXPONENTIAL_FLOOR_RATIO, tc)
    : Math.pow(EXPONENTIAL_FLOOR_RATIO, tc);
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
    return env.peak * fadeCurveValueAt(env.exponential, 'in', pos / env.fadeInSecs);
  }
  const fadeOutStart = totalSecs - env.fadeOutSecs;
  if (env.fadeOutSecs > 0 && pos > fadeOutStart) {
    return env.peak * fadeCurveValueAt(env.exponential, 'out', (pos - fadeOutStart) / env.fadeOutSecs);
  }
  return env.peak;
}

// Schedules a fade segment between the previously anchored value and
// `toValue`. Both curve types are native Web Audio ramps, and both have the
// same closed form as fadeCurveValueAt, so an envelope rebuilt mid-fade
// continues the exact same curve.
function scheduleFadeCurve(param: AudioParam, env: ClipGainEnvelope, toValue: number, endTime: number): void {
  if (env.exponential) {
    param.exponentialRampToValueAtTime(toValue, endTime);
  } else {
    param.linearRampToValueAtTime(toValue, endTime);
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

  // Remaining fade-in. The exponential fade-in starts at true silence, so
  // it cannot use exponentialRamp - it is sampled as short linear segments
  // matching fadeCurveValueAt (also when rebuilt mid-fade).
  if (env.fadeInSecs > 0 && positionSecs < env.fadeInSecs) {
    if (env.exponential) {
      const startProgress = positionSecs / env.fadeInSecs;
      const remaining = env.fadeInSecs - positionSecs;
      for (let i = 1; i <= FADE_CURVE_STEPS; i++) {
        const p = startProgress + (1 - startProgress) * (i / FADE_CURVE_STEPS);
        param.linearRampToValueAtTime(
          env.peak * fadeCurveValueAt(true, 'in', p),
          startCtxTime + (p - startProgress) * remaining,
        );
      }
    } else {
      scheduleFadeCurve(param, env, env.peak, toCtxTime(env.fadeInSecs));
    }
  }

  // Remaining fade-out. The fade-out start is kept at or after the fade-in
  // end so overlapping fade handles on a short clip degrade gracefully
  // instead of interleaving automation events.
  const fadeOutStartSecs = Math.max(totalSecs - env.fadeOutSecs, env.fadeInSecs);
  if (env.fadeOutSecs > 0 && windowEndSecs > fadeOutStartSecs) {
    if (fadeOutStartSecs > positionSecs) {
      param.setValueAtTime(env.peak, toCtxTime(fadeOutStartSecs));
    }
    // Linear fades ramp all the way to 0; exponential ramps stop at the
    // -60 dB floor and step to true silence at the clip's end.
    const fadeFloor = env.exponential ? env.peak * EXPONENTIAL_FLOOR_RATIO : 0;
    scheduleFadeCurve(param, env, fadeFloor, endCtxTime);
    if (env.exponential) {
      param.setValueAtTime(0, endCtxTime);
    }
  }
}
