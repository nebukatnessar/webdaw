// AudioWorklet processor hosting the noise gate. One processor instance per
// gate (per track / master bus); settings arrive via port messages as
// { type: 'param', name, value } with name in
// threshold | range (dB), attack | hold | release (seconds).
//
// The envelope follower runs per sample on the audio thread: peak across
// channels is compared against the threshold, a hold counter keeps the gate
// open between hits, and the applied gain glides toward its target with a
// one-pole smoother (attack time when opening, release time when closing),
// so there are no block-boundary steps or clicks.
//
// Registered name: 'webdaw-gate'.

class WebdawGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.thresholdDb = -30;
    this.rangeDb = -60;
    this.attackSec = 0.01;
    this.holdSec = 0.1;
    this.releaseSec = 0.1;
    this.gain = 1;
    this.holdRemaining = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m || m.type !== 'param') return;
      if (m.name === 'threshold') this.thresholdDb = m.value;
      else if (m.name === 'range') this.rangeDb = m.value;
      else if (m.name === 'attack') this.attackSec = m.value;
      else if (m.name === 'hold') this.holdSec = m.value;
      else if (m.name === 'release') this.releaseSec = m.value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0 || !output[0]) return true;

    const sr = sampleRate;
    const threshold = Math.pow(10, this.thresholdDb / 20);
    const closedGain = Math.pow(10, this.rangeDb / 20);
    const attackCoeff = 1 - Math.exp(-1 / (Math.max(0.0001, this.attackSec) * sr));
    const releaseCoeff = 1 - Math.exp(-1 / (Math.max(0.0001, this.releaseSec) * sr));
    const holdSamples = Math.round(this.holdSec * sr);
    const frames = output[0].length;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      if (input) {
        for (let ch = 0; ch < input.length; ch++) {
          const v = Math.abs(input[ch][i]);
          if (v > peak) peak = v;
        }
      }

      if (peak >= threshold) {
        this.holdRemaining = holdSamples;
      } else if (this.holdRemaining > 0) {
        this.holdRemaining -= 1;
      }

      const open = peak >= threshold || this.holdRemaining > 0;
      const target = open ? 1 : closedGain;
      const coeff = target > this.gain ? attackCoeff : releaseCoeff;
      this.gain += (target - this.gain) * coeff;

      for (let ch = 0; ch < output.length; ch++) {
        const inCh = input && input[ch] ? input[ch] : input && input[0];
        output[ch][i] = (inCh ? inCh[i] : 0) * this.gain;
      }
    }
    return true;
  }
}

registerProcessor('webdaw-gate', WebdawGateProcessor);
