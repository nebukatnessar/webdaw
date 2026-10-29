// AudioWorklet plumbing for the piano roll synth prototypes. The processor
// code lives in public/worklets/synth-processor.js (served as a static asset
// and registered with the AudioContext); this module owns the node lifecycle
// on the main thread: one AudioWorkletNode per voice, parameters pushed via
// port messages.
import type { MidiNote } from '../types/daw';

export type SynthId = 'base' | 'monarch' | 'fm';

export const SYNTH_LABELS: Record<SynthId, string> = {
  base: 'Base Saw',
  monarch: 'Monarc Bass (webMonarc)',
  fm: 'FM Synth',
};

const WORKLET_URL_PATH = 'worklets/synth-processor.js';
const PROCESSOR_NAME = 'webdaw-synth';

let registrationPromise: Promise<void> | null = null;

/**
 * Registers the synth worklet module with the given context exactly once.
 * Must be called (and awaited) before creating any worklet voice.
 */
export function ensureSynthWorkletRegistered(ctx: AudioContext): Promise<void> {
  if (!registrationPromise) {
    const url = `${import.meta.env.BASE_URL}${WORKLET_URL_PATH}`;
    registrationPromise = ctx.audioWorklet.addModule(url).catch((e) => {
      registrationPromise = null;
      throw e;
    });
  }
  return registrationPromise;
}

const midiToFreq = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

export interface WorkletVoice {
  node: AudioWorkletNode;
  stop: () => void;
}

/**
 * Start a synthesized voice through the worklet. `holdSecs` gives the note a
 * finite envelope when no explicit note-off is sent (previews); pass 0 to
 * leave the gate open until stopVoice is called.
 */
export async function startWorkletVoice(
  ctx: AudioContext,
  destination: AudioNode,
  synth: SynthId,
  note: Pick<MidiNote, 'pitch' | 'velocity'>,
  options: { when?: number; holdSecs?: number } = {},
): Promise<WorkletVoice> {
  await ensureSynthWorkletRegistered(ctx);
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { outputChannelCount: [1] });
  node.connect(destination);
  // `when` is honored by delaying the gate-on message: the processor idles
  // at env=0 until the gate arrives, so the note starts at the right time.
  const when = options.when ?? ctx.currentTime;
  const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
  const sendGateOn = () => {
    node.port.postMessage({ type: 'param', name: 'synth', value: synth });
    node.port.postMessage({ type: 'param', name: 'frequency', value: midiToFreq(note.pitch) });
    node.port.postMessage({ type: 'param', name: 'velocity', value: note.velocity / 127 });
    node.port.postMessage({ type: 'param', name: 'gate', value: 1 });
  };
  if (delayMs > 0) window.setTimeout(sendGateOn, delayMs);
  else sendGateOn();
  const holdSecs = options.holdSecs ?? 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      node.port.postMessage({ type: 'noteoff' });
      node.disconnect();
    } catch {
      // already torn down
    }
  };
  if (holdSecs > 0) {
    window.setTimeout(stop, delayMs + holdSecs * 1000 + 120);
  }
  return { node, stop };
}
