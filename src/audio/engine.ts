import type { Track, MasterEffects } from '../types/daw';
import { cacheBuffer } from './bufferCache';
import useTrackStore from '../store/trackStore';
import type { TrackState } from '../store/trackStore';
import { useTransportStore } from '../store/transportStore';
import { rmsFromAnalyser } from './meterUtils';
import {
  getOrCreateCompressorNode,
  cleanupCompressorNode,
  getDefaultCompressorSettings,
} from './compressor';
import {
  getOrCreateGateNode,
  cleanupGateNode,
  getDefaultGateSettings,
} from './gate';
import {
  getOrCreateEQNode,
  cleanupEQNode,
  getDefaultEQSettings,
} from './eq';
import {
  getOrCreateReverbNode,
  cleanupReverbNode,
  getDefaultReverbSettings,
  loadBundledIRs,
} from './reverb';
import {
  getOrCreateDelayNode,
  cleanupDelayNode,
  getDefaultDelaySettings,
} from './delay';
import { scheduleClipGainEnvelope } from './clip';

let audioCtx: AudioContext | null = null;
const bufferMap = new Map<string, AudioBuffer>();
const activeSources: AudioBufferSourceNode[] = [];
// Per-clip gain nodes for sources currently scheduled, keyed by clip id, so
// clip mute, clip gain, and fade changes apply live to already-playing
// sources by rebuilding the remaining gain envelope.
interface ActiveClipSource {
  node: GainNode;
  startCtxTime: number;
  endCtxTime: number;
  bpm: number;
  startPosSecs: number; // clip-local position where this window starts
}
const activeClipGainNodes = new Map<string, ActiveClipSource[]>();

// Single persistent master gain node that every track routes through
// before reaching the speakers, so there's one final volume stage for the
// whole mix (matching a DAW's master fader) instead of each track going
// straight to destination.
let masterGainNode: GainNode | null = null;
let masterAnalyserL: AnalyserNode | null = null;
let masterAnalyserR: AnalyserNode | null = null;
// Splitter tapping the master signal for the L/R VU meters. applyMasterEffects
// reconnects it to the end of the master insert chain so the meters reflect
// the post-insert signal that actually reaches the speakers.
let masterSplitterNode: ChannelSplitterNode | null = null;

function getMasterGainNode(ctx: AudioContext): GainNode {
  if (!masterGainNode) {
    masterGainNode = ctx.createGain();
    masterGainNode.connect(ctx.destination);

    // Tap the post-fader signal for the L/R VU meters, split into
    // per-channel analysers. This runs alongside the destination
    // connection, not in place of it.
    const splitter = ctx.createChannelSplitter(2);
    masterSplitterNode = splitter;
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

// Key under which the master chain's effect nodes are stored in the shared
// per-id effect node maps. Track ids are timestamps, so this never collides
// with a real track (and the cleanup loop in updateLiveTrackParams only
// touches ids present in the trackNodes map, leaving these alone).
const MASTER_FX_NODE_KEY = '__master__';

/**
 * Rebuilds the master insert chain live: masterGain -> [gate -> eq ->
 * compressor -> delay -> reverb] -> destination, skipping unset/bypassed
 * effects - the same construction pattern as the per-track chain in
 * updateLiveTrackParams. The master gain node is never recreated; only its
 * connections are rewired, so ongoing playback is not interrupted. The VU
 * meter splitter is re-tapped at the end of the chain so the meters show
 * the post-insert signal.
 */
export function applyMasterEffects(masterEffects: MasterEffects): void {
  const ctx = getAudioContext();
  const master = getMasterGainNode(ctx);
  if (!masterSplitterNode) return;

  master.disconnect();

  // Same order as the per-track chain: dynamics -> EQ -> time-based effects.
  let currentNode: AudioNode = master;

  if (masterEffects.gate?.enabled) {
    const gate = getOrCreateGateNode(ctx, MASTER_FX_NODE_KEY, masterEffects.gate);
    currentNode.connect(gate.input);
    currentNode = gate.output;
  }

  if (masterEffects.eq?.enabled) {
    const eq = getOrCreateEQNode(ctx, MASTER_FX_NODE_KEY, masterEffects.eq);
    currentNode.connect(eq.input);
    currentNode = eq.output;
  }

  if (masterEffects.compressor?.enabled) {
    const compressor = getOrCreateCompressorNode(ctx, MASTER_FX_NODE_KEY, masterEffects.compressor);
    currentNode.connect(compressor.input);
    currentNode = compressor.output;
  }

  if (masterEffects.delay?.enabled) {
    const delay = getOrCreateDelayNode(ctx, MASTER_FX_NODE_KEY, masterEffects.delay);
    currentNode.connect(delay.input);
    currentNode = delay.output;
  }

  if (masterEffects.reverb?.enabled) {
    const reverb = getOrCreateReverbNode(ctx, MASTER_FX_NODE_KEY, masterEffects.reverb);
    currentNode.connect(reverb.input);
    currentNode = reverb.output;
  }

  currentNode.connect(ctx.destination);
  currentNode.connect(masterSplitterNode);
}

/**
 * Instantaneous RMS level (0-1) of the master bus, per channel - meant to
 * be polled on a rAF loop to drive a VU meter. Returns zeros until the
 * master node has been created (e.g. before anything has ever played).
 */
export function getMasterLevels(): { left: number; right: number } {
  if (!masterAnalyserL || !masterAnalyserR) return { left: 0, right: 0 };
  return { left: rmsFromAnalyser(masterAnalyserL), right: rmsFromAnalyser(masterAnalyserR) };
}

// One persistent gain+pan node per track, reused across the whole session
// instead of being recreated (and re-snapshotted) every time playback
// starts. This is what lets volume/pan/mute/solo changes take effect live,
// on whatever is currently playing, rather than only on the next Play.
const trackNodes = new Map<string, { gainNode: GainNode; panner: StereoPannerNode }>();

// Per-track analyser tapping each track's post-fader, post-pan signal (the
// same point its audio reaches the master bus), for a per-track VU meter in
// the track header list - separate from the trackNodes map since it's purely
// a metering tap, not part of the audio path itself.
const trackAnalysers = new Map<string, AnalyserNode>();

function getOrCreateTrackNodes(ctx: AudioContext, trackId: string) {
  let nodes = trackNodes.get(trackId);
  if (!nodes) {
    const gainNode = ctx.createGain();
    const panner = ctx.createStereoPanner();
    gainNode.connect(panner);
    panner.connect(getMasterGainNode(ctx));

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    panner.connect(analyser);
    trackAnalysers.set(trackId, analyser);

    nodes = { gainNode, panner };
    trackNodes.set(trackId, nodes);
  }
  return nodes;
}

/**
 * Instantaneous RMS level (0-1) of a track's post-fader signal - meant to be
 * polled on a rAF loop to drive that track's VU meter. Returns 0 until the
 * track's nodes have been created (e.g. before it's ever been part of a
 * schedulePlayback/updateLiveTrackParams call).
 */
export function getTrackLevel(trackId: string): number {
  const analyser = trackAnalysers.get(trackId);
  return analyser ? rmsFromAnalyser(analyser) : 0;
}

/**
 * Applies each track's volume/pan/mute/solo to its persistent audio node,
 * live - this runs on every track change (not just at playback start), so
 * dragging a slider or toggling mute/solo while something is already
 * playing takes effect immediately. Solo silences every non-soloed track.
 * Also updates compressor, gate, EQ, delay, and reverb settings for each track.
 */
export function updateLiveTrackParams(tracks: Track[]): void {
  const ctx = getAudioContext();

  const currentIds = new Set(tracks.map((t) => t.id));
  for (const [id, nodes] of trackNodes) {
    if (!currentIds.has(id)) {
      nodes.gainNode.disconnect();
      nodes.panner.disconnect();
      trackNodes.delete(id);
      trackAnalysers.get(id)?.disconnect();
      trackAnalysers.delete(id);
      // Clean up compressor, gate, EQ, delay, and reverb nodes for removed tracks
      cleanupCompressorNode(id);
      cleanupGateNode(id);
      cleanupEQNode(id);
      cleanupDelayNode(id);
      cleanupReverbNode(id);
    }
  }

  const hasSoloed = tracks.some((t) => t.soloed);
  for (const track of tracks) {
    const compressorSettings = track.compressor || getDefaultCompressorSettings();
    const gateSettings = track.gate || getDefaultGateSettings();
    const eqSettings = track.eq || getDefaultEQSettings();
    const delaySettings = track.delay || getDefaultDelaySettings();
    const reverbSettings = track.reverb || getDefaultReverbSettings();
    const { gainNode, panner } = getOrCreateTrackNodes(ctx, track.id);
    const audible = hasSoloed ? track.soloed : !track.muted;
    gainNode.gain.value = audible ? track.volume : 0;
    panner.pan.value = track.pan;

    // Disconnect existing connections to rebuild the effect chain
    gainNode.disconnect();

    // Build the effect chain: gain -> gate -> eq -> compressor -> delay -> reverb -> panner
    // Standard signal processing order: dynamics -> EQ -> time-based effects
    let currentNode: AudioNode = gainNode;

    // Add gate if enabled
    if (gateSettings.enabled) {
      const gate = getOrCreateGateNode(ctx, track.id, gateSettings);
      currentNode.connect(gate.input);
      currentNode = gate.output;
    }

    // Add EQ if enabled
    if (eqSettings.enabled) {
      const eq = getOrCreateEQNode(ctx, track.id, eqSettings);
      currentNode.connect(eq.input);
      currentNode = eq.output;
    }

    // Add compressor if enabled
    if (compressorSettings.enabled) {
      const compressor = getOrCreateCompressorNode(ctx, track.id, compressorSettings);
      currentNode.connect(compressor.input);
      currentNode = compressor.output;
    }

    // Add delay if enabled
    if (delaySettings.enabled) {
      const delay = getOrCreateDelayNode(ctx, track.id, delaySettings);
      currentNode.connect(delay.input);
      currentNode = delay.output;
    }

    // Add reverb if enabled
    if (reverbSettings.enabled) {
      const reverb = getOrCreateReverbNode(ctx, track.id, reverbSettings);
      currentNode.connect(reverb.input);
      currentNode = reverb.output;
    }

    // Connect to panner (final destination)
    currentNode.connect(panner);
  }
}

/**
 * Re-applies clip-level mute, gain, and fades to sources that are already
 * playing (or scheduled), so toggling M or dragging a fade during playback
 * takes effect live - the same way track mute/solo does - without
 * re-scheduling anything. The envelope from now on is rebuilt, so an
 * ongoing fade continues smoothly from its current value.
 */
function applyLiveClipGain(tracks: Track[]): void {
  if (activeClipGainNodes.size === 0) return;
  const ctx = getAudioContext();
  for (const track of tracks) {
    for (const clip of track.clips) {
      const sources = activeClipGainNodes.get(clip.id);
      if (!sources) continue;
      for (const source of sources) {
        const now = ctx.currentTime;
        if (now >= source.endCtxTime) continue;
        source.node.gain.cancelScheduledValues(now);
        if (now < source.startCtxTime) {
          scheduleClipGainEnvelope(source.node.gain, clip, source.startCtxTime, source.endCtxTime, source.bpm, source.startPosSecs);
        } else {
          scheduleClipGainEnvelope(source.node.gain, clip, now, source.endCtxTime, source.bpm, source.startPosSecs + (now - source.startCtxTime));
        }
      }
    }
  }
}

useTrackStore.subscribe((state: TrackState) => {
  updateLiveTrackParams(state.tracks);
  applyLiveClipGain(state.tracks);
});

// Track the last-applied master effect settings so the insert chain is only
// rebuilt when they actually change, not on every transport store update
// (the playhead position updates on every animation frame).
let lastAppliedMasterEffects: MasterEffects | null = null;

useTransportStore.subscribe((state) => {
  if (state.masterEffects === lastAppliedMasterEffects) return;
  lastAppliedMasterEffects = state.masterEffects;
  applyMasterEffects(state.masterEffects);
});

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    void loadBundledIRs(audioCtx);
  }
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
      const clipEndSecs = clipStartSecs + clip.durationBeats * beatsToSecs;

      if (clipEndSecs <= playheadSecs) continue; // already ended

      // Calculate buffer offset in seconds
      const bufferOffsetSecs = (clip.bufferOffsetBeats ?? 0) * beatsToSecs;
      
      // Calculate the offset within the buffer to start playback
      const offset = bufferOffsetSecs + Math.max(0, playheadSecs - clipStartSecs);
      
      // Calculate when to start playback
      const when = now + Math.max(0, clipStartSecs - playheadSecs);
      
      // Calculate duration of playback, clamped to the clip's window
      const duration = Math.min(
        buffer.duration - bufferOffsetSecs,
        clip.durationBeats * beatsToSecs - Math.max(0, playheadSecs - clipStartSecs)
      );

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Per-clip gain stage: source -> clipGainNode -> gainNode, so clip
      // gain, mute, and fades all multiply before track gain. The envelope
      // (fades) is scheduled on the node; the node dies with the source.
      const clipGainNode = ctx.createGain();
      const endCtxTime = when + duration;
      const startPosSecs = Math.max(0, playheadSecs - clipStartSecs);
      scheduleClipGainEnvelope(clipGainNode.gain, clip, when, endCtxTime, bpm, startPosSecs);
      source.connect(clipGainNode);
      clipGainNode.connect(gainNode);
      source.start(when, offset, duration);

      const clipSources = activeClipGainNodes.get(clip.id) ?? [];
      clipSources.push({ node: clipGainNode, startCtxTime: when, endCtxTime, bpm, startPosSecs });
      activeClipGainNodes.set(clip.id, clipSources);

      activeSources.push(source);
      source.onended = () => {
        const idx = activeSources.indexOf(source);
        if (idx !== -1) activeSources.splice(idx, 1);
        const sources = activeClipGainNodes.get(clip.id);
        if (sources) {
          const nodeIdx = sources.findIndex((entry) => entry.node === clipGainNode);
          if (nodeIdx !== -1) sources.splice(nodeIdx, 1);
          if (sources.length === 0) activeClipGainNodes.delete(clip.id);
        }
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

// Anchor (audio-clock time + beat position) that the displayed playhead is
// currently timed against. Lives here rather than as component-local state
// so any part of the UI (the transport's own playback loop, or the ruler
// when the user relocates the playhead) can jump the playhead to a new
// position without needing to stop playback to it.
let anchorCtxTime = 0;
let anchorBeats = 0;

/**
 * Start playing back `tracks` from `beats`, anchoring the playhead clock to
 * the current audio time. Used for the initial Play press.
 */
export function startPlaybackAt(tracks: Track[], beats: number, bpm: number): void {
  const ctx = getAudioContext();
  anchorCtxTime = ctx.currentTime;
  anchorBeats = beats;
  schedulePlayback(tracks, beats, bpm);
}

/**
 * Jump to a new playhead position while already playing: stops whatever is
 * currently scheduled and reschedules from the new position, re-anchoring
 * the clock so playback continues rather than requiring a pause/resume.
 */
export function seekDuringPlayback(tracks: Track[], beats: number, bpm: number): void {
  stopAllSources();
  startPlaybackAt(tracks, beats, bpm);
}

/**
 * Re-anchors the playhead clock to the current time without touching what's
 * scheduled - used when BPM changes mid-playback so the displayed playhead
 * keeps advancing smoothly at the new rate.
 */
export function reanchorPlayhead(beats: number): void {
  anchorCtxTime = getAudioContext().currentTime;
  anchorBeats = beats;
}

/**
 * Computes the current playhead position (in beats) from the anchor -
 * polled once per animation frame to drive the playhead display.
 */
export function computePlayheadBeats(bpm: number): number {
  const ctx = getAudioContext();
  const elapsed = ctx.currentTime - anchorCtxTime;
  return anchorBeats + (elapsed * bpm) / 60;
}