import type { CompressorSettings } from '../types/daw';

// Default compressor settings
const DEFAULT_COMPRESSOR_SETTINGS: CompressorSettings = {
  enabled: false,
  threshold: -24, // dB
  ratio: 4,
  attack: 0.01, // seconds
  release: 0.1, // seconds
  knee: 5, // dB
  makeupGain: 0, // dB
};

interface CompressorChain {
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
}

// Map to store compressor chains per track
const compressorNodes = new Map<string, CompressorChain>();

function createCompressorChain(ctx: BaseAudioContext): CompressorChain {
  const compressor = ctx.createDynamicsCompressor();
  const makeupGain = ctx.createGain();
  compressor.connect(makeupGain);
  return { compressor, makeupGain };
}

/**
 * Get or create a compressor node for a track
 * Uses the Web Audio API's built-in DynamicsCompressorNode
 */
export function getOrCreateCompressorNode(
  ctx: AudioContext,
  trackId: string,
  settings: CompressorSettings = DEFAULT_COMPRESSOR_SETTINGS
): GainNode {
  let chain = compressorNodes.get(trackId);
  
  if (!chain) {
    chain = createCompressorChain(ctx);
    compressorNodes.set(trackId, chain);
  }
  
  // Update node parameters with current settings
  updateCompressorNode(chain, settings);
  
  return chain.makeupGain;
}

/**
 * Update a compressor node with new settings
 */
export function updateCompressorNode(
  chain: CompressorChain,
  settings: CompressorSettings
): void {
  chain.compressor.threshold.value = settings.threshold;
  chain.compressor.ratio.value = settings.ratio;
  chain.compressor.attack.value = settings.attack;
  chain.compressor.release.value = settings.release;
  chain.compressor.knee.value = settings.knee;
  chain.makeupGain.gain.value = 10 ** (settings.makeupGain / 20);
}

export function createAndConfigureCompressor(
  ctx: BaseAudioContext,
  settings: CompressorSettings,
): GainNode {
  const chain = createCompressorChain(ctx);
  updateCompressorNode(chain, settings);
  return chain.makeupGain;
}

/**
 * Get the default compressor settings
 */
export function getDefaultCompressorSettings(): CompressorSettings {
  return { ...DEFAULT_COMPRESSOR_SETTINGS };
}

/**
 * Clean up compressor node for a track
 */
export function cleanupCompressorNode(trackId: string): void {
  const chain = compressorNodes.get(trackId);
  if (chain) {
    chain.compressor.disconnect();
    chain.makeupGain.disconnect();
    compressorNodes.delete(trackId);
  }
}

/**
 * Clean up all compressor nodes
 */
export function cleanupAllCompressorNodes(): void {
  for (const [, chain] of compressorNodes) {
    chain.compressor.disconnect();
    chain.makeupGain.disconnect();
  }
  compressorNodes.clear();
}

/**
 * Get the compressor node for a track (without creating if it doesn't exist)
 */
export function getCompressorNode(trackId: string): GainNode | undefined {
  return compressorNodes.get(trackId)?.makeupGain;
}
