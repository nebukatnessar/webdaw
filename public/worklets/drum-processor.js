// AudioWorklet processor for the drum machine's synthesized voices (feature
// #194, task #195). One processor instance per voice per hit; the main-thread
// DrumMachineEngine (src/audio/drumMachine.ts) owns node lifecycle and pushes
// voice selection, velocity, and tuning via port messages.
//
// Registered name: 'webdaw-drum'. Voices:
//   'kick'   - sine with pitch sweep (start freq drops to the tuned base)
//   'snare'  - band-passed noise + tonal body
//   'hihat'  - high-passed noise with a short decay
//
// The process loop is allocation-free: all per-voice state lives in typed
// arrays / plain fields, and noise comes from a precomputed buffer.

const NUM_VOICES = 8;
const NOISE_LEN = 16384;

class WebdawDrumProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voice = 'kick';
    this.velocity = 1;
    this.tune = 0;    // semitones
    this.decay = 0.3; // seconds
    this.tone = 0.5;  // 0..1
    this.active = false;

    // Shared noise buffer, generated once (no Math.random per sample).
    this.noise = new Float32Array(NOISE_LEN);
    let seed = 22222;
    for (let i = 0; i < NOISE_LEN; i++) {
      seed = (seed * 16807) % 2147483647;
      this.noise[i] = (seed / 2147483647) * 2 - 1;
    }

    // Per-voice persistent state (kick only uses slot fields it needs).
    this.phases = new Float64Array(NUM_VOICES);
    this.envs = new Float64Array(NUM_VOICES);
    this.noisePos = new Float64Array(NUM_VOICES);
    // One-pole filter state for snare body / hat HPF
    this.lp = new Float64Array(NUM_VOICES);
    this.hpPrev = new Float64Array(NUM_VOICES);
    this.hpPrevIn = new Float64Array(NUM_VOICES);

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'trigger') {
        this.trigger(m.voice, m.velocity, m.tune, m.decay, m.tone);
      } else if (m.type === 'choke') {
        this.choke();
      }
    };
  }

  trigger(voice, velocity, tune, decay, tone) {
    this.voice = voice;
    this.velocity = velocity;
    this.tune = tune;
    this.decay = decay;
    this.tone = tone;
    // Retrigger the single voice slot 0 (kick retriggers; hats choke via the
    // explicit choke message from the engine for grouped lanes).
    const v = 0;
    this.phases[v] = 0;
    this.envs[v] = 1;
    this.noisePos[v] = 0;
    this.active = true;
  }

  choke() {
    // Fast release: decay the envelope to zero over ~5ms.
    this.envs[0] = Math.min(this.envs[0], 0.001);
    this.active = false;
  }

  kickSample(i, sr, tune, decay, tone) {
    const v = 0;
    const base = 120 * Math.pow(2, tune / 12); // tuned base frequency
    const start = Math.min(960, base * 8);     // sweep start, clamped
    const sweepT = Math.max(0.005, decay * 0.25);
    const t = i / sr;
    // Exponential pitch sweep from start down to base over sweepT.
    const freq = t < sweepT
      ? base + (start - base) * Math.exp(-t / (sweepT / 3))
      : base;
    this.phases[v] += freq / sr;
    const env = Math.exp(-t / Math.max(0.01, decay * 0.5));
    this.envs[v] = env;
    const click = Math.exp(-t / 0.002) * 0.5 * (1 - tone); // transient, tamed by tone
    return (Math.sin(2 * Math.PI * this.phases[v]) * env + click) * 0.9;
  }

  snareSample(i, sr, tune, decay, tone) {
    const v = 0;
    const t = i / sr;
    const bodyFreq = 190 * Math.pow(2, tune / 12);
    this.phases[v] += bodyFreq / sr;
    const bodyEnv = Math.exp(-t / Math.max(0.01, decay * 0.3));
    const body = Math.sin(2 * Math.PI * this.phases[v]) * bodyEnv * 0.6;

    // Band-ish noise: one-pole LP at cutoff from tone, minus one-pole HP.
    const cutoff = 800 + tone * 7000;
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
    const n = this.noise[Math.floor(this.noisePos[v]) % NOISE_LEN];
    this.noisePos[v] += 1;
    this.lp[v] += a * (n - this.lp[v]);
    const hp = n - this.lp[v];
    const noiseEnv = Math.exp(-t / Math.max(0.005, decay * 0.6));
    return body + hp * noiseEnv * 0.7;
  }

  hihatSample(i, sr, tune, decay, tone) {
    const v = 0;
    const t = i / sr;
    // High-pass noise: difference of successive noise samples, cutoff by tone.
    const cutoff = 5000 + tone * 5000;
    const a = Math.exp(-2 * Math.PI * cutoff / sr);
    const n = this.noise[Math.floor(this.noisePos[v]) % NOISE_LEN];
    this.noisePos[v] += 1;
    const hp = n - (this.hpPrevIn[v] + a * (this.hpPrev[v] - this.hpPrevIn[v]));
    this.hpPrev[v] = hp;
    this.hpPrevIn[v] = n;
    const env = Math.exp(-t / Math.max(0.003, decay * 0.4));
    this.envs[v] = env;
    return hp * env * 0.5;
  }

  process(_inputs, outputs, _params) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate;
    const vel = this.velocity;

    for (let i = 0; i < out.length; i++) {
      let s = 0;
      if (this.voice === 'kick') s = this.kickSample(i, sr, this.tune, this.decay, this.tone);
      else if (this.voice === 'snare') s = this.snareSample(i, sr, this.tune, this.decay, this.tone);
      else s = this.hihatSample(i, sr, this.tune, this.decay, this.tone);
      out[i] = s * vel * 0.8;
      if (this.envs[0] < 0.0005 && this.voice !== 'kick') {
        // Voice has decayed to silence; keep returning true (cheap idle).
      }
    }
    return true;
  }
}

registerProcessor('webdaw-drum', WebdawDrumProcessor);
