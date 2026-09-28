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
  gate: GainNode;
  envelope: GainNode;
  attackTime: number;
  holdTime: number;
  releaseTime: number;
  lastAboveThreshold: number;
  lastBelowThreshold: number;
}

// Map to store gate chains per track
const gateNodes = new Map<string, GateChain>();

function createGateChain(ctx: BaseAudioContext): GateChain {
  const gate = ctx.createGain();
  const envelope = ctx.createGain();
  gate.connect(envelope);
  return {
    gate,
    envelope,
    attackTime: 0,
    holdTime: 0,
    releaseTime: 0,
    lastAboveThreshold: 0,
    lastBelowThreshold: 0,
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
  updateGateNode(chain, settings, ctx.currentTime);

  return chain.envelope;
}

/**
 * Update a gate node with new settings
 */
export function updateGateNode(
  chain: GateChain,
  settings: GateSettings,
  currentTime: number
): void {
  // Update the static parameters
  chain.attackTime = settings.attack;
  chain.holdTime = settings.hold;
  chain.releaseTime = settings.release;

  // The gate's behavior is implemented via automation of the envelope gain
  // This is a simplified version that sets up the static parameters
  // The actual gating behavior is handled in the audio thread via the envelope
  chain.gate.gain.value = 1; // Always pass through, envelope handles gating
  chain.envelope.gain.value = settings.enabled ? 1 : 0;
}

/**
 * Apply gate automation to the envelope node
 * This function should be called during audio processing to update the envelope
 */
export function applyGateAutomation(
  chain: GateChain,
  inputLevel: number,
  settings: GateSettings,
  currentTime: number
): void {
  const thresholdLinear = 10 ** (settings.threshold / 20);
  const rangeLinear = 10 ** (settings.range / 20);

  if (inputLevel > thresholdLinear) {
    // Signal is above threshold
    chain.lastAboveThreshold = currentTime;
    chain.lastBelowThreshold = currentTime;
    // Open the gate (attack phase)
    chain.envelope.gain.setTargetAtTime(1, currentTime, settings.attack);
  } else {
    // Signal is below threshold
    const timeSinceBelow = currentTime - chain.lastAboveThreshold;
    
    if (timeSinceBelow <= settings.hold) {
      // Still in hold period, keep gate open
      chain.envelope.gain.value = 1;
    } else {
      // Hold period has passed, start release
      const timeSinceHoldEnded = timeSinceBelow - settings.hold;
      const releaseGain = Math.max(0, 1 - timeSinceHoldEnded / settings.release);
      chain.envelope.gain.setTargetAtTime(rangeLinear, currentTime, settings.release);
    }
    chain.lastBelowThreshold = currentTime;
  }
}

export function createAndConfigureGate(
  ctx: BaseAudioContext,
  settings: GateSettings,
): GainNode {
  const chain = createGateChain(ctx);
  updateGateNode(chain, settings, ctx.currentTime);
  return chain.envelope;
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
    chain.gate.disconnect();
    chain.envelope.disconnect();
    gateNodes.delete(trackId);
  }
}

/**
 * Clean up all gate nodes
 */
export function cleanupAllGateNodes(): void {
  for (const [, chain] of gateNodes) {
    chain.gate.disconnect();
    chain.envelope.disconnect();
  }
  gateNodes.clear();
}

/**
 * Get the gate node for a track (without creating if it doesn't exist)
 */
export function getGateNode(trackId: string): GainNode | undefined {
  return gateNodes.get(trackId)?.envelope;
}
