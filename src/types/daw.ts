export interface Clip {
  id: string;
  trackId: string;
  startBeat: number;
  durationBeats: number;
  name: string;
  color: string;
  audioBufferId?: string;
  audioFile?: string | null; // File path for saved projects
}


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


export interface Track {
  id: string;
  name: string;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  volume: number; // 0–1
  pan: number;    // -1 to 1
  color: string;
  clips: Clip[];
  compressor?: CompressorSettings;
  gate?: GateSettings;
  eq?: EQSettings;
}


export interface Project {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
  masterVolume: number;
}
