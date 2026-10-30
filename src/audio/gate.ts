import type { GateSettings } from '../types/daw';

// Default gate settings
const DEFAULT_GATE_SETTINGS: GateSettings = {
  enabled: false,
  threshold: -30, // dB
  attack: 0.01,  // seconds
  hold: 0.1,     // seconds
  release: 0.1,  // seconds
  range: -60,    // dB (full mute)
};

export interface GateChain {
  input: GainNode;
  processor: AudioWorkletNode | null;
  output: GainNode;
  threshold: number;
  range: number;
  attack: number;
  hold: number;
  release: number;
}

// Map to store gate chains per track
const gateNodes = new Map<string, GateChain>();

const WORKLET_URL_PATH = 'worklets/gate-processor.js';
const PROCESSOR_NAME = 'webdaw-gate';

// Module registration is per-context (a new OfflineAudioContext needs its own
// addModule call), so cache the registration promise per context.
const registrationPromises = new WeakMap<BaseAudioContext, Promise<void>>();
const registeredContexts = new WeakSet<BaseAudioContext>();

/**
 * Registers the gate worklet module with the given context exactly once per
 * context. Must be awaited before creating worklet-based gate nodes on a
 * context (createAndConfigureGate does this; getOrCreateGateNode upgrades
 * asynchronously instead).
 */
export function ensureGateWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
  let promise = registrationPromises.get(ctx);
  if (!promise) {
    const url = `${import.meta.env.BASE_URL}${WORKLET_URL_PATH}`;
    promise = ctx.audioWorklet.addModule(url).then(() => {
      registeredContexts.add(ctx);
    }).catch((e) => {
      registrationPromises.delete(ctx);
      throw e;
    });
    registrationPromises.set(ctx, promise);
  }
  return promise;
}

function pushSettings(chain: GateChain): void {
  const node = chain.processor;
  if (!node) return;
  node.port.postMessage({ type: 'param', name: 'threshold', value: chain.threshold });
  node.port.postMessage({ type: 'param', name: 'range', value: chain.range });
  node.port.postMessage({ type: 'param', name: 'attack', value: chain.attack });
  node.port.postMessage({ type: 'param', name: 'hold', value: chain.hold });
  node.port.postMessage({ type: 'param', name: 'release', value: chain.release });
}

// Route input -> worklet -> output, replacing the direct passthrough. The
// processor's gain starts at 1 (open), matching the passthrough level, so
// the swap is click-free.
function attachWorklet(ctx: BaseAudioContext, chain: GateChain): void {
  if (chain.processor || !registeredContexts.has(ctx)) return;
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    outputChannelCount: [2],
  });
  chain.input.disconnect(chain.output);
  chain.input.connect(node);
  node.connect(chain.output);
  chain.processor = node;
  pushSettings(chain);
}

function createGateChain(ctx: BaseAudioContext): GateChain {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const chain: GateChain = {
    input,
    processor: null,
    output,
    threshold: DEFAULT_GATE_SETTINGS.threshold,
    range: DEFAULT_GATE_SETTINGS.range,
    attack: DEFAULT_GATE_SETTINGS.attack,
    hold: DEFAULT_GATE_SETTINGS.hold,
    release: DEFAULT_GATE_SETTINGS.release,
  };

  if (registeredContexts.has(ctx)) {
    attachWorklet(ctx, chain);
  } else {
    // Passthrough until the module is registered; swap in the worklet
    // seamlessly once addModule resolves.
    input.connect(output);
    void ensureGateWorkletRegistered(ctx)
      .then(() => attachWorklet(ctx, chain))
      .catch(() => {
        // Keep the passthrough if registration fails (e.g. old browser).
      });
  }

  return chain;
}

/**
 * Get or create a gate node for a track
 */
export function getOrCreateGateNode(
  ctx: AudioContext,
  trackId: string,
  settings: GateSettings = DEFAULT_GATE_SETTINGS
): GateChain {
  let chain = gateNodes.get(trackId);

  if (!chain) {
    chain = createGateChain(ctx);
    gateNodes.set(trackId, chain);
  }

  // Update node parameters with current settings
  updateGateNode(chain, settings);

  return chain;
}

/**
 * Update a gate node with new settings
 */
export function updateGateNode(
  chain: GateChain,
  settings: GateSettings
): void {
  chain.threshold = settings.threshold;
  chain.range = settings.range;
  chain.attack = settings.attack;
  chain.hold = settings.hold;
  chain.release = settings.release;
  pushSettings(chain);
}

/**
 * Create and configure a gate with the given settings. Awaits worklet module
 * registration on the context, so this also works on a fresh
 * OfflineAudioContext during export.
 */
export async function createAndConfigureGate(
  ctx: BaseAudioContext,
  settings: GateSettings,
): Promise<GateChain> {
  await ensureGateWorkletRegistered(ctx);
  const chain = createGateChain(ctx);
  updateGateNode(chain, settings);
  return chain;
}

/**
 * Get the default gate settings
 */
export function getDefaultGateSettings(): GateSettings {
  return { ...DEFAULT_GATE_SETTINGS };
}

function disconnectChain(chain: GateChain): void {
  chain.input.disconnect();
  chain.processor?.disconnect();
  chain.output.disconnect();
}

/**
 * Clean up gate node for a track
 */
export function cleanupGateNode(trackId: string): void {
  const chain = gateNodes.get(trackId);
  if (chain) {
    disconnectChain(chain);
    gateNodes.delete(trackId);
  }
}

/**
 * Clean up all gate nodes
 */
export function cleanupAllGateNodes(): void {
  for (const [, chain] of gateNodes) {
    disconnectChain(chain);
  }
  gateNodes.clear();
}

/**
 * Get the gate node for a track (without creating if it doesn't exist)
 */
export function getGateNode(trackId: string): GainNode | undefined {
  return gateNodes.get(trackId)?.output;
}
