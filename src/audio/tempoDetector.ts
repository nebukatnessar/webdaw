import { getBuffer } from './engine';

// Candidate tempo range. Widening much beyond this makes autocorrelation
// peaks ambiguous because every tempo also matches its multiples/divisors.
const MIN_BPM = 60;
const MAX_BPM = 190;

// Analysis window and hop. A ~23 ms window advanced by 50% gives an
// envelope rate near 86 frames/s at 44.1 kHz — fine enough to localize
// transients while keeping the FFT small.
const WINDOW_FRAMES = 1024;
const HOP_FRAMES = WINDOW_FRAMES >> 1;

// Cap on envelope frames analyzed (~45 s). Long clips are truncated to keep
// detection fast without losing accuracy — well past what the
// autocorrelation needs for a stable estimate.
const MAX_ANALYSIS_FRAMES = 3750;

function downmix(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / channels;
  }
  return mono;
}

// Iterative radix-2 FFT in place over real/imag arrays.
function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const cos = Math.cos(angle * j);
        const sin = Math.sin(angle * j);
        const evenIdx = i + j;
        const oddIdx = i + j + half;
        const tr = real[oddIdx] * cos - imag[oddIdx] * sin;
        const ti = real[oddIdx] * sin + imag[oddIdx] * cos;
        real[oddIdx] = real[evenIdx] - tr;
        imag[oddIdx] = imag[evenIdx] - ti;
        real[evenIdx] += tr;
        imag[evenIdx] += ti;
      }
    }
  }
}

/**
 * Computes an onset-strength envelope: per short window, the sum of positive
 * spectral change, which spikes on transients. Returns the envelope along
 * with its frame rate (envelope samples per second).
 */
function onsetEnvelope(buffer: AudioBuffer): { envelope: Float32Array; frameRate: number } {
  const mono = downmix(buffer);
  const frameRate = buffer.sampleRate / HOP_FRAMES;
  const hop = HOP_FRAMES;
  const frameCount = Math.min(
    MAX_ANALYSIS_FRAMES,
    Math.floor((mono.length - WINDOW_FRAMES) / hop) + 1,
  );
  if (frameCount < 2) return { envelope: new Float32Array(0), frameRate };

  const envelope = new Float32Array(frameCount);
  const win = new Float64Array(WINDOW_FRAMES);
  for (let i = 0; i < WINDOW_FRAMES; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WINDOW_FRAMES - 1)));
  }

  const real = new Float64Array(WINDOW_FRAMES);
  const imag = new Float64Array(WINDOW_FRAMES);
  const bins = WINDOW_FRAMES / 2;
  const prevSpectrum = new Float64Array(bins);
  const spectrum = new Float64Array(bins);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    real.fill(0);
    imag.fill(0);
    const avail = Math.min(WINDOW_FRAMES, mono.length - start);
    for (let i = 0; i < avail; i++) {
      real[i] = mono[start + i] * win[i];
    }
    fft(real, imag);
    for (let i = 0; i < bins; i++) {
      spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    let flux = 0;
    for (let i = 0; i < bins; i++) {
      const diff = spectrum[i] - prevSpectrum[i];
      if (diff > 0) flux += diff;
    }
    envelope[f] = flux;
    prevSpectrum.set(spectrum);
  }
  return { envelope, frameRate };
}

/** Raw autocorrelation of the centered envelope at an integer lag. */
function autocorrelation(centered: Float32Array, lag: number): number {
  let score = 0;
  for (let i = 0; i + lag < centered.length; i++) {
    score += centered[i] * centered[i + lag];
  }
  return score;
}

/**
 * Scores a candidate beat period by summing the autocorrelation at the lag
 * and its first few integer multiples — a comb that rewards evenly spaced
 * onsets. Fractional lags are covered by interpolating between the two
 * adjacent integer lags.
 */
function combScore(centered: Float32Array, lag: number): number {
  let total = 0;
  for (let mult = 1; mult <= 4; mult++) {
    const l = lag * mult;
    if (l >= centered.length - 1) break;
    const lo = Math.floor(l);
    const frac = l - lo;
    const raw = autocorrelation(centered, lo) * (1 - frac)
      + autocorrelation(centered, Math.min(lo + 1, centered.length - 1)) * frac;
    total += raw / (mult * mult);
  }
  return total;
}

/**
 * Picks the best tempo by evaluating the comb score over a fine BPM grid,
 * then resolves octave ambiguity by comparing the winner against its half
 * and double. A strict click at 128 BPM is indistinguishable from a sparse
 * click at 64 BPM from the envelope alone, so the stronger comb wins.
 */
function bestTempo(
  centered: Float32Array,
  frameRate: number,
): { bpm: number; score: number } | null {
  let bestBpm = -1;
  let bestScore = -Infinity;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const lag = (60 / bpm) * frameRate;
    if (lag < 2 || lag >= centered.length - 1) continue;
    const score = combScore(centered, lag);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  if (bestBpm < 0) return null;

  // A click train looks identical at half tempo (every other onset matches
  // the slower comb), so when the winner sits near the low end of the range
  // and its double-time reading scores nearly as well, prefer the faster
  // tempo — DAW users expect the audible beat rate, not half of it.
  const doubled = bestBpm * 2;
  if (doubled <= MAX_BPM) {
    const lag = (60 / doubled) * frameRate;
    if (lag >= 2 && lag < centered.length - 1 && combScore(centered, lag) > bestScore * 0.9) {
      return { bpm: doubled, score: combScore(centered, lag) };
    }
  }
  return { bpm: bestBpm, score: bestScore };
}

export interface TempoDetectionResult {
  bpm: number;
  confidence: number;
}

/**
 * Estimates the tempo of an audio buffer by combining an onset-strength
 * envelope with autocorrelation, refined on a 0.25 BPM grid. Returns null
 * when the buffer is too short or too static to judge.
 */
export function detectTempo(buffer: AudioBuffer): TempoDetectionResult | null {
  if (buffer.duration < 2) return null;
  const { envelope, frameRate } = onsetEnvelope(buffer);
  if (envelope.length < frameRate) return null;

  let mean = 0;
  for (let i = 0; i < envelope.length; i++) mean += envelope[i];
  mean /= envelope.length;
  const centered = Float32Array.from(envelope, (v) => v - mean);

  const result = bestTempo(centered, frameRate);
  if (result === null) return null;

  const meanEnergy = autocorrelation(centered, 0);
  const confidence = meanEnergy > 0 ? Math.max(0, Math.min(1, result.score / meanEnergy)) : 0;

  return { bpm: Math.round(result.bpm * 10) / 10, confidence };
}

/**
 * Detects the tempo of the most representative clip available: the longest
 * audio clip in the given clip list. Returns null when no audio exists.
 */
export function detectTempoForClips(
  clips: { audioBufferId?: string }[],
): TempoDetectionResult | null {
  let best: AudioBuffer | null = null;
  for (const clip of clips) {
    if (!clip.audioBufferId) continue;
    const buffer = getBuffer(clip.audioBufferId);
    if (buffer && (!best || buffer.duration > best.duration)) best = buffer;
  }
  if (!best) return null;
  return detectTempo(best);
}
