import type { Track } from '../types/daw';

let audioCtx: AudioContext | null = null;
const bufferMap = new Map<string, AudioBuffer>();
const activeSources: AudioBufferSourceNode[] = [];

export function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export async function resumeContext(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
}

export function storeBuffer(id: string, buffer: AudioBuffer): void {
  bufferMap.set(id, buffer);
}

export function getBuffer(id: string): AudioBuffer | undefined {
  return bufferMap.get(id);
}

export function getBufferMap(): Map<string, AudioBuffer> {
  return new Map(bufferMap);
}

export function clearAllBuffers(): void {
  bufferMap.clear();
}

export async function decodeFile(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

/**
 * Schedule all clips in the given tracks to play from the current playhead
 * position. Each clip is scheduled against the AudioContext timeline so that
 * even sub-millisecond accuracy is maintained.
 */
export function schedulePlayback(
  tracks: Track[],
  playheadBeats: number,
  bpm: number,
): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const beatsToSecs = 60 / bpm;

  for (const track of tracks) {
    if (track.muted) continue;

    for (const clip of track.clips) {
      if (!clip.audioBufferId) continue;
      const buffer = bufferMap.get(clip.audioBufferId);
      if (!buffer) continue;

      // All timing computed in seconds to avoid BPM drift issues
      const clipStartSecs = clip.startBeat * beatsToSecs;
      const playheadSecs = playheadBeats * beatsToSecs;
      const clipEndSecs = clipStartSecs + buffer.duration;

      if (clipEndSecs <= playheadSecs) continue; // already ended

      const offset = Math.max(0, playheadSecs - clipStartSecs);
      const when = now + Math.max(0, clipStartSecs - playheadSecs);
      const duration = buffer.duration - offset;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(when, offset, duration);

      activeSources.push(source);
      source.onended = () => {
        const idx = activeSources.indexOf(source);
        if (idx !== -1) activeSources.splice(idx, 1);
      };
    }
  }
}

export function stopAllSources(): void {
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      // Already stopped naturally — ignore
    }
  }
  activeSources.length = 0;
}
