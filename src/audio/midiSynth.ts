// Synth voices for the piano roll (feature #26). Each track picks a synth
// prototype (Track.synth); 'base' is a plain sawtooth rendered with native
// nodes, while 'monarch' (additive) and 'fm' run inside the AudioWorklet
// processor in public/worklets/synth-processor.js (see workletSynth.ts).
// Every voice routes into the track's existing gain node, so track
// volume/pan/mute/effects apply to MIDI notes exactly like audio clips.
// This module is deliberately free of engine imports (the engine calls into
// it); the audio context and per-track destinations are passed in.
import type { MidiNote, SynthId, Track } from '../types/daw';
import { startWorkletVoice, type WorkletVoice } from './workletSynth';
import { MonarcEngine } from './monarcEngine';

export type TrackDestinationResolver = (trackId: string) => AudioNode | undefined;

const midiToFreq = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

// Release tail (seconds) applied after a voice's hold period ends.
const RELEASE_SECS = 0.08;

// How long a preview note rings when nothing else releases it (piano-roll
// click, key click). Without this the oscillator would sound forever.
const PREVIEW_HOLD_SECS = 1.5;

interface Voice {
  stop: () => void;
}

// Live voices keyed by caller-supplied key (note id, or key-combo while a
// computer-keyboard key is held), so note-off releases exactly that voice.
const activeVoices = new Map<string, Voice>();

function startBaseVoice(
  ctx: AudioContext,
  destination: AudioNode,
  pitch: number,
  velocity: number,
  options: { when?: number; durationSecs?: number } = {},
): Voice {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = midiToFreq(pitch);
  const gain = ctx.createGain();
  const peak = (velocity / 127) * 0.25;
  const when = options.when ?? ctx.currentTime;
  const duration = options.durationSecs ?? PREVIEW_HOLD_SECS;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.01);
  gain.gain.setValueAtTime(Math.max(0.0001, peak), when + duration);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + RELEASE_SECS);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(when);
  osc.stop(when + duration + RELEASE_SECS + 0.02);
  return {
    stop: () => {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + RELEASE_SECS);
        osc.stop(ctx.currentTime + RELEASE_SECS + 0.02);
      } catch {
        // already stopped naturally
      }
    },
  };
}

// One MonarcEngine per track: it is monophonic with its own held-note stack,
// so a single long-lived voice engine per track is the natural fit. Created
// lazily on first use, keyed by track id, and torn down when the track is gone.
const monarcEngines = new Map<string, MonarcEngine>();

function getMonarcEngine(ctx: AudioContext, trackId: string, destination: AudioNode): MonarcEngine {
  let engine = monarcEngines.get(trackId);
  if (!engine) {
    engine = new MonarcEngine({ context: ctx, destination });
    monarcEngines.set(trackId, engine);
  }
  return engine;
}

export function disposeMonarcEngine(trackId: string): void {
  monarcEngines.get(trackId)?.dispose();
  monarcEngines.delete(trackId);
}

function startSynthVoice(
  ctx: AudioContext,
  destination: AudioNode,
  synth: SynthId,
  pitch: number,
  velocity: number,
  options: { when?: number; durationSecs?: number; trackId?: string } = {},
): Voice {
  if (synth === 'base') {
    return startBaseVoice(ctx, destination, pitch, velocity, options);
  }
  if (synth === 'monarch' && options.trackId) {
    // Monarc is a monophonic engine: one noteOn now, noteOff when the note's
    // hold ends (previews) or when playback stops.
    const engine = getMonarcEngine(ctx, options.trackId, destination);
    engine.noteOn(pitch, velocity / 127);
    const holdSecs = options.durationSecs ?? PREVIEW_HOLD_SECS;
    let timer: number | null = null;
    if (options.durationSecs !== undefined) {
      timer = window.setTimeout(() => engine.noteOff(pitch), holdSecs * 1000);
    }
    return {
      stop: () => {
        if (timer !== null) window.clearTimeout(timer);
        engine.noteOff(pitch);
      },
    };
  }
  // Worklet prototypes are async (module registration); fire and forget - the
  // voice registers itself in activeVoices once created.
  const holdSecs = options.durationSecs ?? PREVIEW_HOLD_SECS;
  let workletVoice: WorkletVoice | null = null;
  void startWorkletVoice(ctx, destination, synth, { pitch, velocity }, { holdSecs }).then((v) => {
    workletVoice = v;
  }).catch(() => undefined);
  return {
    stop: () => {
      workletVoice?.stop();
    },
  };
}

/**
 * Preview a single note immediately (piano-roll click, computer-keyboard
 * press). The voice is keyed so stopNotePreview can release it early.
 */
export function startNotePreview(
  ctx: AudioContext,
  destination: AudioNode,
  synth: SynthId,
  note: Pick<MidiNote, 'pitch' | 'velocity'>,
  key: string,
  trackId?: string,
): void {
  stopNotePreview(key);
  const voice = startSynthVoice(ctx, destination, synth, note.pitch, note.velocity, { trackId });
  activeVoices.set(key, voice);
}

/**
 * Release a preview voice with a short release ramp (computer-keyboard
 * key-up). No-op if the key isn't held.
 */
export function stopNotePreview(key: string): void {
  const voice = activeVoices.get(key);
  if (!voice) return;
  activeVoices.delete(key);
  voice.stop();
}

export function stopAllNotePreviews(): void {
  for (const key of [...activeVoices.keys()]) stopNotePreview(key);
}

/**
 * Schedule all notes of `tracks` that overlap the playhead window, mirroring
 * schedulePlayback in engine.ts. Notes that ended before the playhead are
 * skipped; notes are cut at their end. Call from the same place audio clips
 * are scheduled so MIDI and audio stay in sync.
 */
export function scheduleMidiPlayback(
  ctx: AudioContext,
  tracks: Track[],
  notes: MidiNote[],
  playheadBeats: number,
  bpm: number,
  resolveDestination: TrackDestinationResolver,
): void {
  const now = ctx.currentTime;
  const beatsToSecs = 60 / bpm;
  const playheadSecs = playheadBeats * beatsToSecs;

  for (const note of notes) {
    const track = tracks.find((t) => t.id === note.trackId);
    if (!track) continue;
    const destination = resolveDestination(track.id);
    if (!destination) continue;
    if (track.muted || (tracks.some((t) => t.soloed) && !track.soloed)) continue;

    const noteStartSecs = note.startBeat * beatsToSecs;
    const noteEndSecs = noteStartSecs + note.durationBeats * beatsToSecs;
    if (noteEndSecs <= playheadSecs) continue;

    const when = now + Math.max(0, noteStartSecs - playheadSecs);
    const duration = note.durationBeats * beatsToSecs - Math.max(0, playheadSecs - noteStartSecs);
    const voice = startSynthVoice(ctx, destination, track.synth ?? 'base', note.pitch, note.velocity, {
      when,
      durationSecs: duration,
      trackId: track.id,
    });
    const key = `playback-${note.id}-${when}`;
    activeVoices.set(key, voice);
  }
}

export function stopAllMidiVoices(): void {
  stopAllNotePreviews();
  for (const engine of monarcEngines.values()) engine.allNotesOff();
}
