// MonarcEngine — ported from the webMonarc prototype repo
// (nebuknessar/webMonarc, src/engine.js) into WebDaw's TypeScript audio
// layer. Same signal chain and note behavior: fixed chain
// [osc1..3 + sub] -> mixBus -> lowpass filter -> vca -> tanh shaper -> master,
// monophonic with a held-note stack (last-note priority, legato retrigger)
// and portamento/glide.
//
// The original was built around an injectable context + destination so a DAW
// channel can drive it: here each track gets its own MonarcEngine instance
// whose destination is the track's gain node (same place clips and the other
// synth voices route), so track volume/pan/mute/FX apply unchanged.

export interface MonarcEngineOptions {
  context: AudioContext;
  destination: AudioNode;
}

interface OscVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export class MonarcEngine {
  static driveCurve(amount: number): Float32Array {
    // tanh saturation, normalized so peak output stays at 1 for any drive
    const n = 1024;
    const curve = new Float32Array(n);
    const k = 1 + amount * 49; // 1..50
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  readonly context: AudioContext;
  private readonly mixBus: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly vca: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly master: GainNode;
  private drive = 0.35;
  private readonly oscs: OscVoice[];
  private readonly subOsc: OscillatorNode;
  private readonly subGain: GainNode;
  private osc2Ratio = 1;
  private osc3Ratio = 0.5;

  private held: number[] = []; // midi note stack (mono, last-note priority)
  private currentNote: number | null = null;
  private glideTime = 0.05;
  private filterBase = 350;
  private filterEnvAmount = 4500;
  private ampEnv: Adsr = { attack: 0.002, decay: 0.35, sustain: 0.65, release: 0.3 };
  private filterEnv: Adsr = { attack: 0.001, decay: 0.3, sustain: 0.12, release: 0.35 };
  private velocity = 1;

  constructor({ context, destination }: MonarcEngineOptions) {
    this.context = context;
    const ctx = this.context;

    this.mixBus = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    this.shaper = ctx.createWaveShaper();
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.shaper.curve = MonarcEngine.driveCurve(this.drive);
    this.shaper.oversample = '4x';

    this.mixBus.connect(this.filter);
    this.filter.connect(this.vca);
    this.vca.connect(this.shaper);
    this.shaper.connect(this.master);
    this.master.connect(destination);

    this.oscs = [0, 1, 2].map((i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 1 : i === 1 ? 0.55 : 0.35;
      osc.type = i === 2 ? 'square' : 'sawtooth';
      osc.frequency.value = 110;
      osc.connect(gain);
      gain.connect(this.mixBus);
      osc.start();
      return { osc, gain };
    });
    this.oscs[1].osc.detune.value = 8; // gnarly default: slight beating between saws

    // sub oscillator — always one octave below the played note
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = 'sine';
    this.subOsc.frequency.value = 55;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.75;
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.mixBus);
    this.subOsc.start();
  }

  resume(): void {
    if (this.context.state === 'suspended') void this.context.resume();
  }

  private setFreq(midi: number, glideTime: number): void {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const t = this.context.currentTime;
    const parts: [OscillatorNode, number][] = [
      [this.oscs[0].osc, 1],
      [this.oscs[1].osc, this.osc2Ratio || 1],
      [this.oscs[2].osc, this.osc3Ratio || 0.5],
      [this.subOsc, 0.5],
    ];
    parts.forEach(([osc, ratio]) => {
      const target = f * ratio;
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(osc.frequency.value, t);
      if (glideTime > 0.005) {
        osc.frequency.linearRampToValueAtTime(target, t + glideTime);
      } else {
        osc.frequency.setValueAtTime(target, t);
      }
    });
  }

  private applyFilterEnv(gateOn: boolean, velocity: number): void {
    const t = this.context.currentTime;
    const g = this.filter.frequency;
    const base = this.filterBase;
    const peak = Math.min(18000, base + this.filterEnvAmount * velocity);
    const sus = base + (peak - base) * this.filterEnv.sustain;
    g.cancelScheduledValues(t);
    if (gateOn) {
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(peak, t + this.filterEnv.attack);
      g.setTargetAtTime(sus, t + this.filterEnv.attack, Math.max(0.01, this.filterEnv.decay / 3));
    } else {
      g.setTargetAtTime(base, t, Math.max(0.01, this.filterEnv.release / 3));
    }
  }

  private applyAmpEnv(gateOn: boolean): void {
    const t = this.context.currentTime;
    const g = this.vca.gain;
    const e = this.ampEnv;
    g.cancelScheduledValues(t);
    if (gateOn) {
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.linearRampToValueAtTime(this.velocity, t + e.attack);
      g.setTargetAtTime(this.velocity * e.sustain, t + e.attack, Math.max(0.01, e.decay / 3));
    } else {
      g.setTargetAtTime(0.0001, t, Math.max(0.01, e.release / 3));
    }
  }

  noteOn(midi: number, velocity = 1): void {
    this.resume();
    const wasIdle = this.held.length === 0;
    this.held = this.held.filter((n) => n !== midi);
    this.held.push(midi);
    this.velocity = velocity;
    if (wasIdle || this.currentNote === null) {
      this.applyAmpEnv(true);
    }
    this.currentNote = midi;
    this.setFreq(midi, wasIdle ? 0 : this.glideTime);
    this.applyFilterEnv(true, velocity);
  }

  noteOff(midi: number): void {
    this.held = this.held.filter((n) => n !== midi);
    if (this.held.length === 0) {
      this.applyAmpEnv(false);
      this.applyFilterEnv(false, 0);
      this.currentNote = null;
    } else {
      const backTo = this.held[this.held.length - 1];
      this.currentNote = backTo;
      this.setFreq(backTo, this.glideTime);
    }
  }

  allNotesOff(): void {
    this.held = [];
    this.applyAmpEnv(false);
    this.applyFilterEnv(false, 0);
    this.currentNote = null;
  }

  dispose(): void {
    this.allNotesOff();
    for (const { osc } of this.oscs) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    try { this.subOsc.stop(); } catch { /* already stopped */ }
    this.master.disconnect();
  }

  setParam(name: string, value: number | OscillatorType): void {
    const t = this.context.currentTime;
    switch (name) {
      case 'master': this.master.gain.setTargetAtTime(value as number, t, 0.01); break;
      case 'cutoff': this.filterBase = value as number; this.filter.frequency.setTargetAtTime(value as number, t, 0.01); break;
      case 'resonance': this.filter.Q.setTargetAtTime(value as number, t, 0.01); break;
      case 'filterEnv': this.filterEnvAmount = value as number; break;
      case 'glide': this.glideTime = value as number; break;
      case 'ampAttack': this.ampEnv.attack = value as number; break;
      case 'ampDecay': this.ampEnv.decay = value as number; break;
      case 'ampSustain': this.ampEnv.sustain = value as number; break;
      case 'ampRelease': this.ampEnv.release = value as number; break;
      case 'filterAttack': this.filterEnv.attack = value as number; break;
      case 'filterDecay': this.filterEnv.decay = value as number; break;
      case 'filterSustain': this.filterEnv.sustain = value as number; break;
      case 'filterRelease': this.filterEnv.release = value as number; break;
      case 'osc1Level': this.oscs[0].gain.gain.setTargetAtTime(value as number, t, 0.01); break;
      case 'osc2Level': this.oscs[1].gain.gain.setTargetAtTime(value as number, t, 0.01); break;
      case 'osc3Level': this.oscs[2].gain.gain.setTargetAtTime(value as number, t, 0.01); break;
      case 'osc2Detune': this.oscs[1].osc.detune.setTargetAtTime(value as number, t, 0.01); break;
      case 'osc2Ratio':
        this.osc2Ratio = value as number;
        if (this.currentNote !== null) this.setFreq(this.currentNote, 0);
        break;
      case 'osc3Ratio':
        this.osc3Ratio = value as number;
        if (this.currentNote !== null) this.setFreq(this.currentNote, 0);
        break;
      case 'osc1Wave': this.oscs[0].osc.type = value as OscillatorType; break;
      case 'osc2Wave': this.oscs[1].osc.type = value as OscillatorType; break;
      case 'osc3Wave': this.oscs[2].osc.type = value as OscillatorType; break;
      case 'subLevel': this.subGain.gain.setTargetAtTime(value as number, t, 0.01); break;
      case 'subWave': this.subOsc.type = value as OscillatorType; break;
      case 'drive':
        this.drive = value as number;
        this.shaper.curve = MonarcEngine.driveCurve(this.drive);
        break;
    }
  }
}
