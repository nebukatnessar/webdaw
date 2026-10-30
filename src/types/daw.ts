export interface Clip {
  id: string;
  trackId: string;
  startBeat: number;
  durationBeats: number;
  name: string;
  color: string;
  audioBufferId?: string;
  audioFile?: string | null; // File path for saved projects
  bufferOffsetBeats?: number; // Beats into the source AudioBuffer where this clip's window begins. 0/undefined = play from buffer start.
  clipGain?: number; // Linear amplitude multiplier applied to this clip (1 = unity). Stored linear; UI converts from dB via 10^(dB/20).
  muted?: boolean; // Add this property. Default: false.
  fadeInDuration?: number; // Fade-in length in beats (0 or undefined = no fade)
  fadeOutDuration?: number; // Fade-out length in beats (0 or undefined = no fade)
  fadeInType?: FadeType; // Fade-in curve shape (default: 'exponential'; double-click the fade-in handle to cycle shapes)
  fadeOutType?: FadeType; // Fade-out curve shape (default: 'exponential'; double-click the fade-out handle to cycle shapes)
  takeGroupId?: string;
  takeNumber?: number;
  activeTake?: boolean;
  comped?: boolean;
}

// Fade curve shapes. 'exponential' swells in quickly and releases with an
// accelerating dive; 'logarithmic' is its mirror (slow swell in, early
// release with a long tail); 'linear' is a straight amplitude ramp.
export type FadeType = 'linear' | 'exponential' | 'logarithmic';


export interface CompressorSettings {
  enabled: boolean;
  threshold: number; // dB (-60 to 0)
  ratio: number;    // 1 to 20
  attack: number;   // seconds (0 to 1)
  release: number;  // seconds (0 to 1)
  knee: number;     // dB (0 to 40)
  makeupGain: number; // dB (0 to 20, default 0)
}


export interface GateSettings {
  enabled: boolean;
  threshold: number; // dB (-60 to 0)
  attack: number;   // seconds (0 to 1)
  hold: number;     // seconds (0 to 1)
  release: number;  // seconds (0 to 1)
  range: number;    // dB (0 to -60, where 0 = no attenuation, -60 = full mute)
}


export interface EQSettings {
  enabled: boolean;
  lowGain: number;   // dB (-20 to +20)
  midGain: number;   // dB (-20 to +20)
  highGain: number;  // dB (-20 to +20)
  lowFreq: number;   // Hz (20-2000)
  midFreq: number;   // Hz (200-8000)
  highFreq: number;  // Hz (1000-20000)
  lowQ: number;      // Quality factor for low band (0.1 to 5)
  midQ: number;      // Quality factor for mid band (0.1 to 5)
  highQ: number;     // Quality factor for high band (0.1 to 5)
}


export type ReverbRoomType = 'Room' | 'Hall' | 'Cathedral';


export interface ReverbSettings {
  enabled: boolean;
  roomType: ReverbRoomType;
  decay: number;      // Decay time multiplier (0.1 to 2.0)
  preDelay: number;   // Pre-delay in ms (0 to 500)
  wet: number;        // Wet mix level (0 to 1)
  dry: number;        // Dry mix level (0 to 1)
  damping: number;    // High-frequency damping (0 to 1, where 1 = full damping)
}


export interface DelaySettings {
  enabled: boolean;
  delayTime: number; // ms (1 to 2000)
  feedback: number;  // 0 to 1 (0 = no feedback, 1 = infinite feedback)
  wet: number;       // Wet mix level (0 to 1)
  dry: number;       // Dry mix level (0 to 1)
}


// Master-chain insert effect settings, mirroring the per-track effect
// settings on Track. Each effect is optional; an unset (or disabled)
// effect is excluded from the master insert chain.
export interface MasterEffects {
  gate?: GateSettings;
  eq?: EQSettings;
  compressor?: CompressorSettings;
  delay?: DelaySettings;
  reverb?: ReverbSettings;
}


// What an effects dialog (and its control panels) is bound to: a specific
// track's effect rack, or the master chain.
export type EffectsTarget = { kind: 'track'; trackId: string } | { kind: 'master' };

// Synth prototype used to audition/play a track's MIDI notes (chosen at the
// top of the piano roll). 'base' is the plain saw voice; 'drum' routes notes
// through the drum machine engine (feature #194).
export type SynthId = 'base' | 'monarch' | 'fm' | 'drum';

// Editable Monarc (webMonarc) engine parameters, stored per track. Keys match
// MonarcEngine.setParam names; defaults mirror the webMonarc prototype's UI.
export interface MonarcParams {
  master: number;        // 0..1
  cutoff: number;        // Hz 40..12000
  resonance: number;     // Q 0.1..20
  filterEnv: number;     // Hz 0..8000
  glide: number;         // s 0..1
  ampAttack: number;     // s
  ampDecay: number;      // s
  ampSustain: number;    // 0..1
  ampRelease: number;    // s
  filterAttack: number;  // s
  filterDecay: number;   // s
  filterSustain: number; // 0..1
  filterRelease: number; // s
  osc1Level: number;     // 0..1
  osc2Level: number;     // 0..1
  osc3Level: number;     // 0..1
  osc1Wave: OscillatorType;
  osc2Wave: OscillatorType;
  osc3Wave: OscillatorType;
  osc2Detune: number;    // cents -50..50
  osc2Ratio: number;     // 0.25..4
  osc3Ratio: number;     // 0.25..4
  subLevel: number;      // 0..1
  subWave: OscillatorType;
  drive: number;         // 0..1
}

export const DEFAULT_MONARC_PARAMS: MonarcParams = {
  master: 0.7,
  cutoff: 350, resonance: 12, filterEnv: 4500,
  glide: 0.05,
  ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.65, ampRelease: 0.3,
  filterAttack: 0.001, filterDecay: 0.3, filterSustain: 0.12, filterRelease: 0.35,
  osc1Level: 1, osc2Level: 0.55, osc3Level: 0.35,
  osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc3Wave: 'square',
  osc2Detune: 8, osc2Ratio: 1, osc3Ratio: 0.5,
  subLevel: 0.75, subWave: 'sine',
  drive: 0.35,
};


// Drum machine voices (feature #194, task #195): synthesized DSP voices
// rendered by the AudioWorklet in public/worklets/drum-processor.js. Lanes of
// the step sequencer (#197) map 1:1 onto these ids.
export type DrumVoiceId = 'kick' | 'snare' | 'hihat';

export const DRUM_LABELS: Record<DrumVoiceId, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-Hat',
};

// Per-voice tunable parameters, sent to the worklet via its message port.
// tune is in semitones, decay/tone in seconds / 0..1.
export interface DrumVoiceParams {
  tune: number;   // semitones -24..24
  decay: number;  // seconds 0.02..2
  tone: number;   // 0..1 (filter cutoff / character)
}

export const DEFAULT_DRUM_PARAMS: Record<DrumVoiceId, DrumVoiceParams> = {
  kick: { tune: 0, decay: 0.35, tone: 0.5 },
  snare: { tune: 0, decay: 0.2, tone: 0.6 },
  hihat: { tune: 0, decay: 0.06, tone: 0.8 },
};

export interface Track {
  id: string;
  name: string;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  synth?: SynthId;      // MIDI instrument for this track; absent = 'base'
  monarcParams?: Partial<MonarcParams>; // Monarc knob values; absent = defaults
  drumParams?: Partial<Record<DrumVoiceId, Partial<DrumVoiceParams>>>; // drum machine voice tuning; absent = defaults
  recordingMode?: 'layered' | 'multiTake';
  showAllTakes?: boolean;
  volume: number; // 0–1
  pan: number;    // -1 to 1
  color: string;
  clips: Clip[];
  compressor?: CompressorSettings;
  gate?: GateSettings;
  eq?: EQSettings;
  reverb?: ReverbSettings;
  delay?: DelaySettings;
}


export interface Project {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
  masterVolume: number;
  masterEffects?: MasterEffects;
}

// A single MIDI note in the piano roll (feature #26, tasks #63/#64). Pitch is
// a MIDI note number (0-127, 60 = middle C); start/duration are in beats,
// matching the clip timeline so notes and audio share one clock. Velocity is
// 1-127 (MIDI convention).
export interface MidiNote {
  id: string;
  trackId: string;
  pitch: number;        // MIDI note number 0-127
  startBeat: number;    // in beats
  durationBeats: number;
  velocity: number;     // 1-127
}
