import type { CompressorSettings } from '../types/daw';

// Default compressor settings
const DEFAULT_COMPRESSOR_SETTINGS: CompressorSettings = {
  enabled: false,
  threshold: -24, // dB
  ratio: 4,
  attack: 0.01, // seconds
  release: 0.1, // seconds
  knee: 5, // dB
};

// Map to store compressor nodes per track
const compressorNodes = new Map<string, DynamicsCompressorNode>();

/**
 * Get or create a compressor node for a track
 * Uses the Web Audio API's built-in DynamicsCompressorNode
 */
export function getOrCreateCompressorNode(
  ctx: AudioContext,
  trackId: string,
  settings: CompressorSettings = DEFAULT_COMPRESSOR_SETTINGS
): DynamicsCompressorNode {
  let node = compressorNodes.get(trackId);
  
  if (!node) {
    node = ctx.createDynamicsCompressor();
    compressorNodes.set(trackId, node);
  }
  
  // Update node parameters with current settings
  updateCompressorNode(node, settings);
  
  return node;
}

/**
 * Update a compressor node with new settings
 */
export function updateCompressorNode(
  node: DynamicsCompressorNode,
  settings: CompressorSettings
): void {
  node.threshold.value = settings.threshold;
  node.ratio.value = settings.ratio;
  node.attack.value = settings.attack;
  node.release.value = settings.release;
  node.knee.value = settings.knee;
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
  const node = compressorNodes.get(trackId);
  if (node) {
    node.disconnect();
    compressorNodes.delete(trackId);
  }
}

/**
 * Clean up all compressor nodes
 */
export function cleanupAllCompressorNodes(): void {
  for (const [trackId, node] of compressorNodes) {
    node.disconnect();
  }
  compressorNodes.clear();
}

/**
 * Get the compressor node for a track (without creating if it doesn't exist)
 */
export function getCompressorNode(trackId: string): DynamicsCompressorNode | undefined {
  return compressorNodes.get(trackId);
}
