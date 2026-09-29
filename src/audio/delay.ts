import type { DelaySettings } from '../types/daw';

// Default delay settings
const DEFAULT_DELAY_SETTINGS: DelaySettings = {
  enabled: false,
  delayTime: 500, // ms (1ms-2000ms)
  feedback: 0.5,  // 0 to 1 (0 = no feedback, 1 = infinite feedback)
  wet: 0.5,      // Wet mix level (0 to 1)
  dry: 0.5,      // Dry mix level (0 to 1)
};

export interface DelayChain {
  input: GainNode;
  delay: DelayNode;
  feedback: GainNode;
  wetGain: GainNode;
  dryGain: GainNode;
  output: GainNode;
}

// Map to store delay chains per track
const delayNodes = new Map<string, DelayChain>();

function createDelayChain(ctx: BaseAudioContext, settings: DelaySettings): DelayChain {
  const input = ctx.createGain();
  const delay = ctx.createDelay();
  const feedback = ctx.createGain();
  const wetGain = ctx.createGain();
  const dryGain = ctx.createGain();
  const output = ctx.createGain();

  // Set initial values
  delay.delayTime.value = settings.delayTime / 1000; // Convert ms to seconds
  feedback.gain.value = settings.feedback;
  wetGain.gain.value = settings.wet;
  dryGain.gain.value = settings.dry;

  // Connect the nodes:
  // input -> delay -> wetGain -> output
  // input -> dryGain -> output
  // delay -> feedback -> delay (for feedback loop)
  input.connect(delay);
  input.connect(dryGain);
  dryGain.connect(output);
  delay.connect(wetGain);
  wetGain.connect(output);
  delay.connect(feedback);
  feedback.connect(delay);

  return { input, delay, feedback, wetGain, dryGain, output };
}

function updateDelayChain(chain: DelayChain, settings: DelaySettings): void {
  chain.delay.delayTime.value = settings.delayTime / 1000; // Convert ms to seconds
  chain.feedback.gain.value = settings.feedback;
  chain.wetGain.gain.value = settings.wet;
  chain.dryGain.gain.value = settings.dry;
}

/**
 * Get or create a delay node for a track
 * Uses the Web Audio API's built-in DelayNode
 */
export function getOrCreateDelayNode(
  ctx: AudioContext,
  trackId: string,
  settings: DelaySettings = DEFAULT_DELAY_SETTINGS
): DelayChain {
  let chain = delayNodes.get(trackId);

  if (!chain) {
    chain = createDelayChain(ctx, settings);
    delayNodes.set(trackId, chain);
  } else {
    updateDelayChain(chain, settings);
  }

  return chain;
}

/**
 * Create and configure a delay chain with settings
 */
export function createAndConfigureDelay(
  ctx: BaseAudioContext,
  settings: DelaySettings
): DelayChain {
  const chain = createDelayChain(ctx, settings);
  return chain;
}

/**
 * Get the default delay settings
 */
export function getDefaultDelaySettings(): DelaySettings {
  return { ...DEFAULT_DELAY_SETTINGS };
}

/**
 * Clean up delay node for a track
 */
export function cleanupDelayNode(trackId: string): void {
  const chain = delayNodes.get(trackId);
  if (chain) {
    chain.input.disconnect();
    chain.delay.disconnect();
    chain.feedback.disconnect();
    chain.wetGain.disconnect();
    chain.dryGain.disconnect();
    chain.output.disconnect();
    delayNodes.delete(trackId);
  }
}

/**
 * Clean up all delay nodes
 */
export function cleanupAllDelayNodes(): void {
  for (const [, chain] of delayNodes) {
    chain.input.disconnect();
    chain.delay.disconnect();
    chain.feedback.disconnect();
    chain.wetGain.disconnect();
    chain.dryGain.disconnect();
    chain.output.disconnect();
  }
  delayNodes.clear();
}

/**
 * Get the delay node for a track (without creating if it doesn't exist)
 */
export function getDelayNode(trackId: string): GainNode | undefined {
  return delayNodes.get(trackId)?.output;
}