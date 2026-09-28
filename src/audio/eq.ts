import type { EQSettings } from '../types/daw';

// Default EQ settings for a 3-band parametric EQ with individual Q for each band
const DEFAULT_EQ_SETTINGS: EQSettings = {
  enabled: false,
  lowGain: 0,    // dB
  midGain: 0,    // dB
  highGain: 0,   // dB
  lowFreq: 200,  // Hz
  midFreq: 2000, // Hz
  highFreq: 8000, // Hz
  lowQ: 1,      // Quality factor
  midQ: 1,      // Quality factor
  highQ: 1,     // Quality factor
};

// EQ Chain using 3 BiquadFilterNodes for low, mid, high bands
export interface EQChain {
  input: GainNode;
  lowFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  highFilter: BiquadFilterNode;
  output: GainNode;
}

// Map to store EQ chains per track
const eqNodes = new Map<string, EQChain>();

/**
 * Create a new EQ chain with 3 parametric bands
 */
function createEQChain(ctx: BaseAudioContext): EQChain {
  const input = ctx.createGain();
  const lowFilter = ctx.createBiquadFilter();
  const midFilter = ctx.createBiquadFilter();
  const highFilter = ctx.createBiquadFilter();
  const output = ctx.createGain();

  // Configure filter types as peaking (parametric EQ)
  lowFilter.type = 'peaking';
  midFilter.type = 'peaking';
  highFilter.type = 'peaking';

  // Connect the chain: input -> low -> mid -> high -> output
  input.connect(lowFilter);
  lowFilter.connect(midFilter);
  midFilter.connect(highFilter);
  highFilter.connect(output);

  return { input, lowFilter, midFilter, highFilter, output };
}

/**
 * Update a BiquadFilterNode with parametric EQ settings
 * For type='peaking', the Web Audio API uses:
 * - frequency.value = center frequency in Hz
 * - Q.value = quality factor
 * - gain.value = gain in dB (not linear!)
 */
function updateFilter(
  filter: BiquadFilterNode,
  freq: number,
  gainDb: number,
  q: number
): void {
  filter.frequency.value = freq;
  filter.Q.value = q;
  filter.gain.value = gainDb; // Web Audio API BiquadFilter uses dB directly for peaking type
}

/**
 * Get or create an EQ node for a track
 */
export function getOrCreateEQNode(
  ctx: AudioContext,
  trackId: string,
  settings: EQSettings = DEFAULT_EQ_SETTINGS
): EQChain {
  let chain = eqNodes.get(trackId);

  if (!chain) {
    chain = createEQChain(ctx);
    eqNodes.set(trackId, chain);
  }

  // Update node parameters with current settings
  updateEQNode(chain, settings);

  return chain;
}

/**
 * Update an EQ node with new settings
 */
export function updateEQNode(
  chain: EQChain,
  settings: EQSettings
): void {
  updateFilter(chain.lowFilter, settings.lowFreq, settings.lowGain, settings.lowQ);
  updateFilter(chain.midFilter, settings.midFreq, settings.midGain, settings.midQ);
  updateFilter(chain.highFilter, settings.highFreq, settings.highGain, settings.highQ);
}

/**
 * Create and configure an EQ with the given settings
 */
export function createAndConfigureEQ(
  ctx: BaseAudioContext,
  settings: EQSettings,
): EQChain {
  const chain = createEQChain(ctx);
  updateEQNode(chain, settings);
  return chain;
}

/**
 * Get the default EQ settings
 */
export function getDefaultEQSettings(): EQSettings {
  return { ...DEFAULT_EQ_SETTINGS };
}

/**
 * Clean up EQ node for a track
 */
export function cleanupEQNode(trackId: string): void {
  const chain = eqNodes.get(trackId);
  if (chain) {
    chain.input.disconnect();
    chain.lowFilter.disconnect();
    chain.midFilter.disconnect();
    chain.highFilter.disconnect();
    chain.output.disconnect();
    eqNodes.delete(trackId);
  }
}

/**
 * Clean up all EQ nodes
 */
export function cleanupAllEQNodes(): void {
  for (const [, chain] of eqNodes) {
    chain.input.disconnect();
    chain.lowFilter.disconnect();
    chain.midFilter.disconnect();
    chain.highFilter.disconnect();
    chain.output.disconnect();
  }
  eqNodes.clear();
}

/**
 * Get the EQ node for a track (without creating if it doesn't exist)
 */
export function getEQNode(trackId: string): GainNode | undefined {
  return eqNodes.get(trackId)?.output;
}
