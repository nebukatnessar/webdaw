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

interface GateChain {
  input: GainNode;
  output: GainNode;
  envelope: GainNode;
  threshold: number;
  range: number;
  attack: number;
  hold: number;
  release: number;
}

// Map to store gate chains per track
const gateNodes = new Map<string, GateChain>();

function createGateChain(ctx: BaseAudioContext): GateChain {
  const input = ctx.createGain();
  const envelope = ctx.createGain();
  const output = ctx.createGain();
  
  input.connect(envelope);
  envelope.connect(output);
  
  return {
    input,
    output,
    envelope,
    threshold: 0,
    range: 0,
    attack: 0,
    hold: 0,
    release: 0,
  };
}

/**
 * Get or create a gate node for a track
 */
export function getOrCreateGateNode(
  ctx: AudioContext,
  trackId: string,
  settings: GateSettings = DEFAULT_GATE_SETTINGS
): GainNode {
  let chain = gateNodes.get(trackId);

  if (!chain) {
    chain = createGateChain(ctx);
    gateNodes.set(trackId, chain);
  }

  // Update node parameters with current settings
  updateGateNode(chain, settings);

  return chain.output;
}

/**
 * Update a gate node with new settings
 */
export function updateGateNode(
  chain: GateChain,
  settings: GateSettings
): void {
  // Store the settings for potential future use
  chain.threshold = settings.threshold;
  chain.range = settings.range;
  chain.attack = settings.attack;
  chain.hold = settings.hold;
  chain.release = settings.release;

  // Set the envelope gain based on whether the gate is enabled
  // Note: This is a simplified implementation. A full implementation would
  // require an AudioWorklet or ScriptProcessor to analyze the input signal
  // and apply the gate parameters dynamically.
  chain.envelope.gain.value = settings.enabled ? 1 : 0;
}

/**
 * Create and configure a gate with the given settings
 */
export function createAndConfigureGate(
  ctx: BaseAudioContext,
  settings: GateSettings,
): GainNode {
  const chain = createGateChain(ctx);
  updateGateNode(chain, settings);
  return chain.output;
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
    chain.envelope.disconnect();
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
    chain.envelope.disconnect();
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
