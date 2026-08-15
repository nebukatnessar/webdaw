import type { Track } from '../types/daw';
import { cacheBuffer } from './bufferCache';
import { useTrackStore } from '../store/trackStore';

let audioCtx: AudioContext | null = null;
const bufferMap = new Map<string, AudioBuffer>();
const activeSources: AudioBufferSourceNode[] = [];

// Single persistent master gain node that every track routes through
// before reaching the speakers, so there's one final volume stage for the
// whole mix (matching a DAW's master fader) instead of each track going
// straight to destination.
let masterGainNode: GainNode | null = null;
let masterAnalyserL: AnalyserNode | null = null;
let masterAnalyserR: AnalyserNode | null = null;

function getMasterGainNode(ctx: AudioContext): GainNode {
  if (!masterGainNode) {
    masterGainNode = ctx.createGain();
    masterGainNode.connect(ctx.destination);

    // Tap the post-fader signal for the L/R VU meters, split into
    // per-channel analysers. This runs alongside the destination
    // connection, not in place of it.
    const splitter = ctx.createChannelSplitter(2);
    masterAnalyserL = ctx.createAnalyser();
    masterAnalyserR = ctx.createAnalyser();
    masterAnalyserL.fftSize = 512;
    masterAnalyserR.fftSize = 512;
    masterGainNode.connect(splitter);
    splitter.connect(masterAnalyserL, 0);
    splitter.connect(masterAnalyserR, 1);
  }
  return masterGainNode;
}

export function setMasterVolume(volume: number): void {
  getMasterGainNode(getAudioContext()).gain.value = volume;
}

/**
 * Instantaneous RMS level (0-1) of the master bus, per channel - meant to
 * be polled on a rAF loop to drive a VU meter. Returns zeros until the
 * master node has been created (e.g. before anything has ever played).
 */
export function getMasterLevels(): { left: number; right: number } {
  if (!masterAnalyserL || !masterAnalyserR) return { left: 0, right: 0 };

  const rms = (analyser: AnalyserNode): number => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  };

  return { left: rms(masterAnalyserL), right: rms(masterAnalyserR) };
}

// One persistent gain+pan node per track, reused across the whole session
// instead of being recreated (and re-snapshotted) every time playback
// starts. This is what lets volume/pan/mute/solo changes take effect live,
// on whatever is currently playing, rather than only on the next Play.
const trackNodes = new Map<string, { gainNode: GainNode; panner: StereoPannerNode }>();

function getOrCreateTrackNodes(ctx: AudioContext, trackId: string) {
  let nodes = trackNodes.get(trackId);
  if (!nodes) {
    const gainNode = ctx.createGain();
    const panner = ctx.createStereoPanner();
    gainNode.connect(panner);
    panner.connect(getMasterGainNode(ctx));
    nodes = { gainNode, panner };
    trackNodes.set(trackId, nodes);
  }
  return nodes;
}

/**
 * Applies each track's volume/pan/mute/solo to its persistent audio node,
 * live - this runs on every track change (not just at playback start), so
 * dragging a slider or toggling mute/solo while something is already
 * playing takes effect immediately. Solo silences every non-soloed track.
 */
export function updateLiveTrackParams(tracks: Track[]): void {
  const ctx = getAudioContext();

  const currentIds = new Set(tracks.map((t) => t.id));
  for (const [id, nodes] of trackNodes) {
    if (!currentIds.has(id)) {
      nodes.gainNode.disconnect();
      nodes.panner.disconnect();
      trackNodes.delete(id);
    }
  }

  const hasSoloed = tracks.some((t) => t.soloed);
  for (const track of tracks) {
    const { gainNode, panner } = getOrCreateTrackNodes(ctx, track.id);
    const audible = hasSoloed ? track.soloed : !track.muted;
    gainNode.gain.value = audible ? track.volume : 0;
    panner.pan.value = track.pan;
  }
}

useTrackStore.subscribe((state) => updateLiveTrackParams(state.tracks));

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
  // Durably cache it so it survives a page refresh even without re-picking
  // a folder (see restoreLastOpenedProject in projectStore.ts).
  void cacheBuffer(id, buffer);
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

  // Make sure every track has an up-to-date persistent node before
  // scheduling - audibility (mute/solo) is enforced by that node's live
  // gain value, not by skipping scheduling, so toggling mute/solo later
  // affects sources that are already playing.
  updateLiveTrackParams(tracks);

  for (const track of tracks) {
    const { gainNode } = getOrCreateTrackNodes(ctx, track.id);

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
      source.connect(gainNode);
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
