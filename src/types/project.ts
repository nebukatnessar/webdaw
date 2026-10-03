import type { MasterEffects } from './daw';

// Project metadata stored in localStorage for the load dialog
export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

// Transport state that needs to be saved with the project
export interface ProjectTransportState {
  bpm: number;
  playheadBeats: number;
  isRepeat: boolean;
  isSnapEnabled?: boolean;
  gridDivisionBeats?: number;
  zoomLevel: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  masterVolume: number;
  // Master insert effect settings; absent in older projects (all bypassed)
  masterEffects?: MasterEffects;
}

// Full project state that gets saved to project.json
export interface SerializedProject {
  version: string; // "1.0"
  name: string;
  transport: ProjectTransportState;
  tracks: SerializedTrack[];
}

// Track with clips that reference audio files
export interface SerializedTrack {
  id: string;
  name: string;
  muted: boolean;
  soloed: boolean;
  volume: number; // 0–1
  pan: number;    // -1 to 1
  color: string;
  clips: SerializedClip[];
  compressor?: { enabled: boolean; threshold: number; ratio: number; attack: number; release: number; knee: number; makeupGain: number };
  gate?: { enabled: boolean; threshold: number; attack: number; hold: number; release: number; range: number };
  eq?: { enabled: boolean; lowGain: number; midGain: number; highGain: number; lowFreq: number; midFreq: number; highFreq: number; lowQ: number; midQ: number; highQ: number };
  delay?: { enabled: boolean; delayTime: number; feedback: number; wet: number; dry: number };
  reverb?: { enabled: boolean; roomType: string; decay: number; preDelay: number; wet: number; dry: number; damping: number };
}

// Clip with file reference instead of AudioBuffer
export interface SerializedClip {
  id: string;
  trackId: string;
  startBeat: number;
  durationBeats: number;
  name: string;
  color: string;
  bufferOffsetBeats: number;
  clipGain?: number; // Linear amplitude multiplier (1 = unity); absent in older projects
  audioFile: string | null; // Relative path to audio file, e.g., "audio/clip1.wav"
  // Session-scoped id into the in-memory audio buffer cache. Only meaningful
  // for the localStorage auto-save round-trip (restoring across a refresh
  // without re-picking a folder) - loading from a real project folder always
  // re-derives this from audioFile instead.
  audioBufferId?: string;
}

// Project file structure info
export interface ProjectFileStructure {
  folderHandle: FileSystemDirectoryHandle | null;
  projectFileHandle: FileSystemFileHandle | null;
  audioDirHandle: FileSystemDirectoryHandle | null;
}

// Project in memory (combines serialized data with runtime handles)
export interface Project extends SerializedProject {
  id: string;
  createdAt: number;
  updatedAt: number;
  fileStructure?: ProjectFileStructure;
}

// For the load dialog - lightweight project info
export interface LoadableProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}
