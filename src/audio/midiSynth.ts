// Simple Web Audio synth used to audition MIDI notes in the piano roll and to
// play them back during transport playback (feature #26). Each note becomes
// an oscillator -> gain envelope -> the track's existing gain node, so track
// volume/pan/mute/effects all apply to MIDI notes exactly like audio clips.
// This module is deliberately free of engine imports (the engine calls into
// it); the audio context and per-track destinations are passed in.
import type { MidiNote, Track } from '../types/daw';

export type TrackDestinationResolver = (trackId: string) => AudioNode | undefined;

const midiToFreq = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

// Live voices keyed by caller-supplied key (note id, or key-combo while a
// computer-keyboard key is held), so note-off releases exactly that voice.
const activeVoices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();

interface VoiceOptions {
  when?: number;
  durationSecs?: number;
}

function startVoice(
  ctx: AudioContext,
  destination: AudioNode,
  pitch: number,
  velocity: number,
  options: VoiceOptions = {},
): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = midiToFreq(pitch);
  const gain = ctx.createGain();
  const peak = (velocity / 127) * 0.25;
  const when = options.when ?? ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.01);
  const duration = options.durationSecs;
  if (duration !== undefined) {
    gain.gain.setValueAtTime(Math.max(0.0001, peak), when + duration);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.08);
  }
  osc.connect(gain);
  gain.connect(destination);
  osc.start(when);
  if (duration !== undefined) {
    osc.stop(when + duration + 0.1);
  }
  return { osc, gain };
}

/**
 * Preview a single note immediately (piano-roll click, computer-keyboard
 * press). The voice is keyed so stopNotePreview can release it early.
 */
export function startNotePreview(
  ctx: AudioContext,
  destination: AudioNode,
  note: Pick<MidiNote, 'pitch' | 'velocity'>,
  key: string,
): void {
  stopNotePreview(key);
  const voice = startVoice(ctx, destination, note.pitch, note.velocity);
  activeVoices.set(key, voice);
  voice.osc.onended = () => {
    if (activeVoices.get(key) === voice) activeVoices.delete(key);
  };
}

/**
 * Release a preview voice with a short release ramp (computer-keyboard
 * key-up). No-op if the key isn't held.
 */
export function stopNotePreview(key: string): void {
  const voice = activeVoices.get(key);
  if (!voice) return;
  activeVoices.delete(key);
  const ctx = voice.osc.context as AudioContext;
  const now = ctx.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  voice.osc.stop(now + 0.1);
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
    const voice = startVoice(ctx, destination, note.pitch, note.velocity, { when, durationSecs: duration });
    const key = `playback-${note.id}-${when}`;
    activeVoices.set(key, voice);
    voice.osc.onended = () => {
      if (activeVoices.get(key) === voice) activeVoices.delete(key);
    };
  }
}

export function stopAllMidiVoices(): void {
  stopAllNotePreviews();
}
