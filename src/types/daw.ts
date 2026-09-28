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
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
  masterVolume: number;
}
