import type { ReverbSettings, ReverbRoomType } from '../types/daw';
import { encodeWav } from './wav';

// Default reverb settings
const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  enabled: false,
  roomType: 'Room',
  decay: 1.0,
  preDelay: 50,
  wet: 0.5,
  dry: 0.5,
  damping: 0.5,
};

// Room type configurations
type RoomConfig = {
  name: string;
  baseLength: number;
  modalDensity: number;
};

const ROOM_CONFIGS: Record<ReverbRoomType, RoomConfig> = {
  Room: { name: 'Room', baseLength: 0.5, modalDensity: 30 },
  Hall: { name: 'Hall', baseLength: 2.0, modalDensity: 60 },
  Cathedral: { name: 'Cathedral', baseLength: 4.0, modalDensity: 100 },
};

export interface ReverbChain {
  input: GainNode;
  preDelay: DelayNode;
  convolver: ConvolverNode;
  dampingFilter: BiquadFilterNode;
  wetGain: GainNode;
  dryGain: GainNode;
  output: GainNode;
}

const reverbNodes = new Map<string, ReverbChain>();
const irCache = new Map<string, AudioBuffer>();

// Map to store custom loaded IRs: roomType -> AudioBuffer
const customIRs = new Map<ReverbRoomType, AudioBuffer>();

function generateIR(ctx: BaseAudioContext, config: RoomConfig, decay: number, damping: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const lengthInSamples = Math.floor(config.baseLength * decay * sampleRate);
  const buffer = ctx.createBuffer(2, lengthInSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };

  const modes: number[] = [];
  const minFreq = 50;
  const maxFreq = 8000;
  for (let i = 0; i < config.modalDensity; i++) {
    const freq = minFreq + (maxFreq - minFreq) * Math.pow(i / config.modalDensity, 0.7);
    modes.push(freq);
  }

  for (let i = 0; i < lengthInSamples; i++) {
    const t = i / sampleRate;
    const decayEnv = Math.exp(-t * 3.0 / (config.baseLength * decay));
    let modalSum = 0;
    for (const freq of modes) {
      const omega = 2 * Math.PI * freq;
      modalSum += Math.sin(omega * t) * Math.exp(-t * freq / 20000);
    }
    modalSum /= modes.length;
    const dampingEnv = Math.exp(-t * 10 * damping);
    const sample = random() * 0.3 + modalSum * 0.7;
    const envelope = decayEnv * dampingEnv;
    left[i] = sample * envelope * 0.5;
    right[i] = sample * envelope * 0.5;
  }
  return buffer;
}

function getIR(ctx: BaseAudioContext, roomType: ReverbRoomType, decay: number, damping: number): AudioBuffer {
  const cacheKey = `${roomType}-${decay}-${damping}`;
  
  // Check for custom loaded IR first
  if (customIRs.has(roomType)) {
    return customIRs.get(roomType)!;
  }
  
  let ir = irCache.get(cacheKey);
  if (!ir) {
    const config = ROOM_CONFIGS[roomType];
    ir = generateIR(ctx, config, decay, damping);
    irCache.set(cacheKey, ir);
  }
  return ir;
}

function createReverbChain(ctx: BaseAudioContext, settings: ReverbSettings): ReverbChain {
  const input = ctx.createGain();
  const preDelay = ctx.createDelay();
  preDelay.delayTime.value = settings.preDelay / 1000;
  
  const convolver = ctx.createConvolver();
  const ir = getIR(ctx, settings.roomType, settings.decay, settings.damping);
  convolver.buffer = ir;
  
  const dampingFilter = ctx.createBiquadFilter();
  dampingFilter.type = 'lowpass';
  
  const wetGain = ctx.createGain();
  const dryGain = ctx.createGain();
  const output = ctx.createGain();
  
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(preDelay);
  preDelay.connect(dampingFilter);
  dampingFilter.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(output);
  
  return { input, preDelay, convolver, dampingFilter, wetGain, dryGain, output };
}

function updateReverbChain(chain: ReverbChain, settings: ReverbSettings, ctx: BaseAudioContext): void {
  chain.preDelay.delayTime.value = settings.preDelay / 1000;
  chain.convolver.buffer = getIR(ctx, settings.roomType, settings.decay, settings.damping);
  const dampingFreq = 1000 + (19000 * (1 - settings.damping));
  chain.dampingFilter.frequency.value = dampingFreq;
  chain.dampingFilter.Q.value = 0.5;
  chain.wetGain.gain.value = settings.wet;
  chain.dryGain.gain.value = settings.dry;
}

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
    updateReverbChain(chain, settings, ctx);
  }
  return chain;
}

export function createAndConfigureReverb(ctx: BaseAudioContext, settings: ReverbSettings): ReverbChain {
  return createReverbChain(ctx, settings);
}

export function getDefaultReverbSettings(): ReverbSettings {
  return { ...DEFAULT_REVERB_SETTINGS };
}

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

export function getReverbNode(trackId: string): GainNode | undefined {
  return reverbNodes.get(trackId)?.output;
}

export function clearIRCache(): void {
  irCache.clear();
}

// ========== File-based IR functions ==========

/**
 * Load a custom IR from a WAV file for a specific room type
 */
export async function loadCustomIR(roomType: ReverbRoomType, file: File): Promise<void> {
  const ctx = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const ir = await ctx.decodeAudioData(arrayBuffer);
  customIRs.set(roomType, ir);
  clearIRCache();
}

/**
 * Export the current IR for a room type as a WAV file
 */
export function exportIRToWAV(roomType: ReverbRoomType, decay: number, damping: number): Blob {
  const ctx = new AudioContext();
  const config = ROOM_CONFIGS[roomType];
  const ir = generateIR(ctx, config, decay, damping);
  return encodeWav(ir);
}

/**
 * Get all room types
 */
export function getRoomTypes(): ReverbRoomType[] {
  return ['Room', 'Hall', 'Cathedral'];
}

/**
 * Check if a custom IR is loaded for a room type
 */
export function hasCustomIR(roomType: ReverbRoomType): boolean {
  return customIRs.has(roomType);
}

/**
 * Remove a custom IR
 */
export function clearCustomIR(roomType: ReverbRoomType): void {
  customIRs.delete(roomType);
  clearIRCache();
}
