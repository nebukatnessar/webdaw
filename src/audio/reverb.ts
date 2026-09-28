import type { ReverbSettings, ReverbRoomType } from '../types/daw';

// Default reverb settings
const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  enabled: false,
  roomType: 'Room',
  decay: 1.0,      // Multiplier (1.0 = default for room type)
  preDelay: 50,    // ms
  wet: 0.5,       // wet mix level (0-1)
  dry: 0.5,       // dry mix level (0-1)
  damping: 0.5,    // high-frequency damping (0-1)
};

// Room type configurations for IR generation
type RoomConfig = {
  name: string;
  baseLength: number; // seconds for the IR
  maxDelay: number;  // max delay time in seconds
  diffusion: number;  // amount of diffusion (0-1)
  modalDensity: number; // number of modes/peaks
};

const ROOM_CONFIGS: Record<ReverbRoomType, RoomConfig> = {
  Room: {
    name: 'Room',
    baseLength: 0.5,   // Short IR for small room
    maxDelay: 0.05,
    diffusion: 0.7,
    modalDensity: 30,
  },
  Hall: {
    name: 'Hall',
    baseLength: 2.0,   // Medium IR for concert hall
    maxDelay: 0.15,
    diffusion: 0.85,
    modalDensity: 60,
  },
  Cathedral: {
    name: 'Cathedral',
    baseLength: 4.0,   // Long IR for cathedral
    maxDelay: 0.3,
    diffusion: 0.95,
    modalDensity: 100,
  },
};

// Reverb chain using ConvolverNode with generated IR
export interface ReverbChain {
  input: GainNode;
  preDelay: DelayNode;
  convolver: ConvolverNode;
  dampingFilter: BiquadFilterNode;
  wetGain: GainNode;
  dryGain: GainNode;
  output: GainNode;
}

// Map to store reverb chains per track
const reverbNodes = new Map<string, ReverbChain>();

/**
 * Generate a simple impulse response for convolution reverb
 * Creates an exponentially decaying noise burst with some modal structure
 */
function generateIR(ctx: BaseAudioContext, config: RoomConfig, decay: number, damping: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const lengthInSamples = Math.floor(config.baseLength * decay * sampleRate);
  
  // Create a buffer with 2 channels (stereo)
  const buffer = ctx.createBuffer(2, lengthInSamples, sampleRate);
  
  // Get channel data
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  
  // Generate random noise with exponential decay
  // Use a simple PRNG for deterministic results
  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  
  // Generate modes (frequencies where the IR has peaks)
  const modes: number[] = [];
  const modeCount = config.modalDensity;
  const minFreq = 50;
  const maxFreq = 8000;
  
  for (let i = 0; i < modeCount; i++) {
    const freq = minFreq + (maxFreq - minFreq) * Math.pow(i / modeCount, 0.7);
    modes.push(freq);
  }
  
  // Generate the IR with modal structure and exponential decay
  for (let i = 0; i < lengthInSamples; i++) {
    const t = i / sampleRate; // Time in seconds
    const decayEnv = Math.exp(-t * 3.0 / (config.baseLength * decay));
    
    // Add modal content
    let modalSum = 0;
    for (const freq of modes) {
      const omega = 2 * Math.PI * freq;
      modalSum += Math.sin(omega * t) * Math.exp(-t * freq / 20000);
    }
    modalSum /= modes.length;
    
    // Apply damping (low-pass effect over time)
    const dampingEnv = Math.exp(-t * 10 * damping);
    
    const sample = random() * 0.3 + modalSum * 0.7;
    const envelope = decayEnv * dampingEnv;
    
    left[i] = sample * envelope * 0.5;
    right[i] = sample * envelope * 0.5;
  }
  
  return buffer;
}

// Cache for generated IRs
const irCache = new Map<string, AudioBuffer>();

/**
 * Get or generate an IR for a room type and settings
 */
function getOrGenerateIR(ctx: BaseAudioContext, roomType: ReverbRoomType, decay: number, damping: number): AudioBuffer {
  const cacheKey = `${roomType}-${decay}-${damping}`;
  
  let ir = irCache.get(cacheKey);
  if (!ir) {
    const config = ROOM_CONFIGS[roomType];
    ir = generateIR(ctx, config, decay, damping);
    irCache.set(cacheKey, ir);
  }
  
  return ir;
}

/**
 * Create a new reverb chain using ConvolverNode with generated IR
 */
function createReverbChain(ctx: BaseAudioContext, settings: ReverbSettings): ReverbChain {
  const input = ctx.createGain();
  
  // Pre-delay for clarity
  const preDelay = ctx.createDelay();
  preDelay.delayTime.value = settings.preDelay / 1000;
  
  // Convolver with generated IR
  const convolver = ctx.createConvolver();
  const ir = getOrGenerateIR(ctx, settings.roomType, settings.decay, settings.damping);
  convolver.buffer = ir;
  
  // Damping filter (applied before convolution for better control)
  const dampingFilter = ctx.createBiquadFilter();
  dampingFilter.type = 'lowpass';
  
  // Output mixing
  const wetGain = ctx.createGain();
  const dryGain = ctx.createGain();
  const output = ctx.createGain();
  
  // Connect the chain
  // Dry path: input -> dryGain -> output
  input.connect(dryGain);
  dryGain.connect(output);
  
  // Wet path: input -> preDelay -> dampingFilter -> convolver -> wetGain -> output
  input.connect(preDelay);
  preDelay.connect(dampingFilter);
  dampingFilter.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(output);
  
  return {
    input,
    preDelay,
    convolver,
    dampingFilter,
    wetGain,
    dryGain,
    output,
  };
}

/**
 * Update the reverb chain with new settings
 */
function updateReverbChain(
  chain: ReverbChain,
  settings: ReverbSettings,
  ctx: BaseAudioContext
): void {
  // Pre-delay in seconds (convert from ms)
  chain.preDelay.delayTime.value = settings.preDelay / 1000;
  
  // Update IR if room type or decay/damping changed
  const ir = getOrGenerateIR(ctx, settings.roomType, settings.decay, settings.damping);
  chain.convolver.buffer = ir;
  
  // Damping filter: higher damping = lower cutoff frequency
  // Map damping (0-1) to frequency (1000Hz to 20000Hz)
  const dampingFreq = 1000 + (19000 * (1 - settings.damping));
  chain.dampingFilter.frequency.value = dampingFreq;
  chain.dampingFilter.Q.value = 0.5;
  
  // Wet/dry mix
  chain.wetGain.gain.value = settings.wet;
  chain.dryGain.gain.value = settings.dry;
}

/**
 * Get or create a reverb node for a track
 */
export function getOrCreateReverbNode(
  ctx: AudioContext,
  trackId: string,
  settings: ReverbSettings = DEFAULT_REVERB_SETTINGS
): ReverbChain {
  let chain = reverbNodes.get(trackId);

  if (!chain) {
    chain = createReverbChain(ctx, settings);
    reverbNodes.set(trackId, chain);
  } else {
    // Update with new settings
    updateReverbChain(chain, settings, ctx);
  }

  return chain;
}

/**
 * Create and configure a reverb with the given settings
 */
export function createAndConfigureReverb(
  ctx: BaseAudioContext,
  settings: ReverbSettings,
): ReverbChain {
  const chain = createReverbChain(ctx, settings);
  return chain;
}

/**
 * Get the default reverb settings
 */
export function getDefaultReverbSettings(): ReverbSettings {
  return { ...DEFAULT_REVERB_SETTINGS };
}

/**
 * Clean up reverb node for a track
 */
export function cleanupReverbNode(trackId: string): void {
  const chain = reverbNodes.get(trackId);
  if (chain) {
    chain.input.disconnect();
    chain.preDelay.disconnect();
    chain.convolver.disconnect();
    chain.dampingFilter.disconnect();
    chain.wetGain.disconnect();
    chain.dryGain.disconnect();
    chain.output.disconnect();
    reverbNodes.delete(trackId);
  }
}

/**
 * Clean up all reverb nodes
 */
export function cleanupAllReverbNodes(): void {
  for (const [, chain] of reverbNodes) {
    chain.input.disconnect();
    chain.preDelay.disconnect();
    chain.convolver.disconnect();
    chain.dampingFilter.disconnect();
    chain.wetGain.disconnect();
    chain.dryGain.disconnect();
    chain.output.disconnect();
  }
  reverbNodes.clear();
}

/**
 * Get the reverb output node for a track (without creating if it doesn't exist)
 */
export function getReverbNode(trackId: string): GainNode | undefined {
  return reverbNodes.get(trackId)?.output;
}

/**
 * Clear the IR cache (useful when loading new IR files)
 */
export function clearIRCache(): void {
  irCache.clear();
}
