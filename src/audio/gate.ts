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
  processor: ScriptProcessorNode;
  output: GainNode;
  threshold: number;
  range: number;
  attack: number;
  hold: number;
  release: number;
  gain: number;
  holdFramesRemaining: number;
}

// Map to store gate chains per track
const gateNodes = new Map<string, GateChain>();

function createGateChain(ctx: BaseAudioContext): GateChain {
  const input = ctx.createGain();
  const processor = ctx.createScriptProcessor(1024, 2, 2);
  const output = ctx.createGain();

  const chain: GateChain = {
    input,
    processor,
    output,
    threshold: 0,
    range: 0,
    attack: 0,
    hold: 0,
    release: 0,
    gain: 1,
    holdFramesRemaining: 0,
  };

  processor.onaudioprocess = (event) => {
    const inputBuffer = event.inputBuffer;
    const outputBuffer = event.outputBuffer;
    const threshold = 10 ** (chain.threshold / 20);
    const closedGain = 10 ** (chain.range / 20);
    const attackFrames = Math.max(1, Math.round(chain.attack * ctx.sampleRate));
    const releaseFrames = Math.max(1, Math.round(chain.release * ctx.sampleRate));
    const holdFrames = Math.round(chain.hold * ctx.sampleRate);

    for (let frame = 0; frame < inputBuffer.length; frame += 1) {
      let peak = 0;
      for (let channel = 0; channel < inputBuffer.numberOfChannels; channel += 1) {
        peak = Math.max(peak, Math.abs(inputBuffer.getChannelData(channel)[frame]));
      }

      if (peak >= threshold) {
        chain.holdFramesRemaining = holdFrames;
      } else if (chain.holdFramesRemaining > 0) {
        chain.holdFramesRemaining -= 1;
      }

      const targetGain = peak >= threshold || chain.holdFramesRemaining > 0 ? 1 : closedGain;
      const frames = targetGain > chain.gain ? attackFrames : releaseFrames;
      chain.gain += (targetGain - chain.gain) / frames;

      for (let channel = 0; channel < outputBuffer.numberOfChannels; channel += 1) {
        outputBuffer.getChannelData(channel)[frame] =
          inputBuffer.getChannelData(channel)[frame] * chain.gain;
      }
    }
  };

  input.connect(processor);
  processor.connect(output);
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
}

/**
 * Create and configure a gate with the given settings
 */
export function createAndConfigureGate(
  ctx: BaseAudioContext,
  settings: GateSettings,
): GateChain {
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

/**
 * Clean up gate node for a track
 */
export function cleanupGateNode(trackId: string): void {
  const chain = gateNodes.get(trackId);
  if (chain) {
    chain.input.disconnect();
    chain.processor.disconnect();
    chain.output.disconnect();
    gateNodes.delete(trackId);
  }
}

/**
 * Clean up all gate nodes
 */
export function cleanupAllGateNodes(): void {
  for (const [, chain] of gateNodes) {
    chain.input.disconnect();
    chain.processor.disconnect();
    chain.output.disconnect();
  }
  gateNodes.clear();
}

/**
 * Get the gate node for a track (without creating if it doesn't exist)
 */
export function getGateNode(trackId: string): GainNode | undefined {
  return gateNodes.get(trackId)?.output;
}
