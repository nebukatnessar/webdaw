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
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
  masterVolume: number;
}
