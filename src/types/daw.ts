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

export interface Track {
  id: string;
  name: string;
  muted: boolean;
  soloed: boolean;
  volume: number; // 0–1
  pan: number;    // -1 to 1
  color: string;
  clips: Clip[];
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
}
