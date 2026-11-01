// DrumMachineEngine - synthesized drum machine voices behind the thin
// {context, destination} engine abstraction (feature #194, task #195), the
// same shape as MonarcEngine: a channel creates one engine whose destination
// is the track's gain node, so track volume/pan/mute/FX apply unchanged.
//
// Real-time DSP runs inside the AudioWorklet processor in
// public/worklets/drum-processor.js (per #89: no ScriptProcessorNode); this
// module owns worklet registration and the node lifecycle per hit, and pushes
// voice/tuning via port messages. One AudioWorkletNode per hit keeps
// triggering polyphonic and click-free; classic drum-machine behavior (kick
// retriggers, hats choke) is handled here.
import type { DrumKitLane, DrumVoiceId, DrumVoiceParams } from '../types/daw';
import { DEFAULT_DRUM_PARAMS } from '../types/daw';

export interface DrumEngineOptions {
  context: AudioContext;
  destination: AudioNode;
}

const WORKLET_URL_PATH = 'worklets/drum-processor.js';
const PROCESSOR_NAME = 'webdaw-drum';

// Lane pitch used when the step grid (#197) emits MIDI-style note events:
// one pitch per voice so the existing MIDI machinery can address lanes.
export const DRUM_LANE_PITCHES: Record<DrumVoiceId, number> = {
  kick: 36,  // C1, standard GM kick
  snare: 38, // D1, standard GM snare
  hihat: 42, // F#1, standard GM closed hat
};

export const DRUM_VOICE_IDS: DrumVoiceId[] = ['kick', 'snare', 'hihat'];

const registrationPromises = new WeakMap<BaseAudioContext, Promise<void>>();

export function ensureDrumWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
  let promise = registrationPromises.get(ctx);
  if (!promise) {
    const url = `${import.meta.env.BASE_URL}${WORKLET_URL_PATH}`;
    promise = ctx.audioWorklet.addModule(url).catch((e) => {
      registrationPromises.delete(ctx);
      throw e;
    });
    registrationPromises.set(ctx, promise);
  }
  return promise;
}

export function pitchToDrumVoice(pitch: number): DrumVoiceId | null {
  for (const id of DRUM_VOICE_IDS) {
    if (DRUM_LANE_PITCHES[id] === pitch) return id;
  }
  return null;
}

interface Hit {
  node: AudioWorkletNode;
  voice: DrumVoiceId;
}

interface SampleHit {
  source: AudioBufferSourceNode;
  gain: GainNode;
  chokeGroup: string | null;
}

export class DrumMachineEngine {
  readonly context: AudioContext;
  private readonly destination: AudioNode;
  private readonly params: Record<DrumVoiceId, DrumVoiceParams>;
  private readonly live: Hit[] = [];
  private readonly sampleHits: SampleHit[] = [];

  constructor({ context, destination }: DrumEngineOptions, params?: Partial<Record<DrumVoiceId, Partial<DrumVoiceParams>>>) {
    this.context = context;
    this.destination = destination;
    this.params = {
      kick: { ...DEFAULT_DRUM_PARAMS.kick, ...params?.kick },
      snare: { ...DEFAULT_DRUM_PARAMS.snare, ...params?.snare },
      hihat: { ...DEFAULT_DRUM_PARAMS.hihat, ...params?.hihat },
    };
  }

  resume(): void {
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /**
   * Trigger a drum voice. `when` (audio-clock seconds) gives sample-accurate
   * scheduling for transport-synced hits; omitted = now. A new hi-hat hit
   * chokes any ringing hi-hat (classic drum machine behavior); kick and snare
   * layer/retrigger freely.
   */
  async trigger(voice: DrumVoiceId, velocity = 1, when?: number): Promise<void> {
    const ctx = this.context;
    await ensureDrumWorkletRegistered(ctx);
    if (voice === 'hihat') this.choke('hihat');

    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { outputChannelCount: [1] });
    node.connect(this.destination);
    const p = this.params[voice];
    const send = () => {
      node.port.postMessage({
        type: 'trigger',
        voice,
        velocity: Math.min(1, Math.max(0, velocity)),
        tune: p.tune,
        decay: p.decay,
        tone: p.tone,
      });
    };
    const delayMs = when !== undefined ? Math.max(0, (when - ctx.currentTime) * 1000) : 0;
    if (delayMs > 0) window.setTimeout(send, delayMs);
    else send();

    const hit: Hit = { node, voice };
    this.live.push(hit);
    // Safety cleanup once the voice has certainly decayed (max decay 2s).
    window.setTimeout(() => {
      try { node.disconnect(); } catch { /* already torn down */ }
      const idx = this.live.indexOf(hit);
      if (idx !== -1) this.live.splice(idx, 1);
    }, delayMs + (p.decay + 0.5) * 1000);
  }

  /**
   * Trigger a bundled sample one-shot (task #196). Playback runs through an
   * AudioBufferSourceNode into a per-lane gain node, so per-lane gain and
   * tuning (playbackRate detune) apply; `when` gives sample-accurate timing.
   * Lanes sharing a chokeGroup stop each other's ringing hits immediately
   * (e.g. a closed hat cuts an open hat).
   */
  triggerSample(lane: DrumKitLane, buffer: AudioBuffer, velocity = 1, when?: number): void {
    const ctx = this.context;
    this.resume();
    if (lane.chokeGroup) this.chokeGroup(lane.chokeGroup);

    const whenSecs = when ?? ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, lane.tune / 12);
    const gain = ctx.createGain();
    gain.gain.value = lane.gain * Math.min(1, Math.max(0, velocity));
    source.connect(gain);
    gain.connect(this.destination);
    source.start(whenSecs);

    const hit: SampleHit = { source, gain, chokeGroup: lane.chokeGroup };
    this.sampleHits.push(hit);
    source.onended = () => {
      try { gain.disconnect(); } catch { /* already torn down */ }
      const idx = this.sampleHits.indexOf(hit);
      if (idx !== -1) this.sampleHits.splice(idx, 1);
    };
  }

  /** Immediately stop all ringing sample hits in a choke group. */
  chokeGroup(group: string): void {
    for (const hit of [...this.sampleHits]) {
      if (hit.chokeGroup === group) {
        try { hit.source.stop(); } catch { /* already stopped */ }
      }
    }
  }

  /** Immediately choke (fast-release) all ringing voices of the given id. */
  choke(voice: DrumVoiceId): void {
    for (const hit of this.live) {
      if (hit.voice === voice) {
        try { hit.node.port.postMessage({ type: 'choke' }); } catch { /* torn down */ }
      }
    }
  }

  setVoiceParam(voice: DrumVoiceId, name: keyof DrumVoiceParams, value: number): void {
    this.params[voice] = { ...this.params[voice], [name]: value };
  }

  getVoiceParams(voice: DrumVoiceId): DrumVoiceParams {
    return { ...this.params[voice] };
  }

  allNotesOff(): void {
    for (const voice of DRUM_VOICE_IDS) this.choke(voice);
    for (const hit of [...this.sampleHits]) {
      try { hit.source.stop(); } catch { /* already stopped */ }
    }
  }

  dispose(): void {
    this.allNotesOff();
    for (const hit of this.live) {
      try { hit.node.disconnect(); } catch { /* already torn down */ }
    }
    this.live.length = 0;
    this.sampleHits.length = 0;
  }
}
