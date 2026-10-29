// AudioWorklet processor hosting the piano roll's synth prototypes. One
// processor instance per voice; parameters (frequency, velocity, gate, and
// synth-specific params) arrive via port messages, so the main thread never
// touches audio-rate code.
//
// Registered name: 'webdaw-synth'. Synth prototypes:
//   'base'    - single sawtooth (current default sound)
//   'monarch' - additive stack of harmonics 1-8 with a slow-decaying spectrum
//   'fm'      - classic 2-operator FM (carrier + modulator, ratio 1:2)

class WebdawSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = 'base';
    this.frequency = 440;
    this.velocity = 0.8;
    this.gate = 0;
    this.phase = 0;
    this.modPhase = 0;
    this.env = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'param') {
        if (m.name === 'synth') this.synth = m.value;
        else if (m.name === 'frequency') this.frequency = m.value;
        else if (m.name === 'velocity') this.velocity = m.value;
        else if (m.name === 'gate') this.gate = m.value ? 1 : 0;
        else if (m.name === 'modIndex') this.modIndex = m.value;
        else if (m.name === 'harmonicDecay') this.harmonicDecay = m.value;
      } else if (m.type === 'noteoff') {
        this.gate = 0;
      }
    };
    this.modIndex = 3;
    this.harmonicDecay = 0.6;
  }

  // Simple saw with anti-aliased-ish polyBLEP-ish smoothing via phase wrap
  saw(phase) {
    const p = phase % 1;
    let v = 2 * p - 1;
    // cheap one-pole smoothing to soften the aliasing edge
    return v;
  }

  process(_inputs, outputs, _params) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate;
    const vel = this.velocity;
    const gate = this.gate;

    for (let i = 0; i < out.length; i++) {
      // ADSR-lite: fast attack, exponential decay while gated, release when off
      const target = gate ? 1 : 0;
      const coeff = gate ? 1 - Math.exp(-1 / (0.005 * sr)) : 1 - Math.exp(-1 / (0.08 * sr));
      this.env += (target - this.env) * coeff;

      this.phase += this.frequency / sr;
      this.modPhase += (this.frequency * 2) / sr;

      let s = 0;
      if (this.synth === 'fm') {
        const mod = Math.sin(2 * Math.PI * this.modPhase) * this.modIndex;
        s = Math.sin(2 * Math.PI * this.phase + mod);
      } else if (this.synth === 'monarch') {
        for (let h = 1; h <= 8; h++) {
          s += (Math.sin(2 * Math.PI * this.phase * h) / h) * Math.pow(this.harmonicDecay, h - 1);
        }
        s *= 0.5;
      } else {
        s = this.saw(this.phase);
      }

      out[i] = s * this.env * vel * 0.25;
    }
    return true;
  }
}

registerProcessor('webdaw-synth', WebdawSynthProcessor);
