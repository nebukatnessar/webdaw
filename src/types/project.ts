import type { Track } from './daw';

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
  zoomLevel: number;
  selectionStart: number | null;
  selectionEnd: number | null;
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
}

// Clip with file reference instead of AudioBuffer
export interface SerializedClip {
  id: string;
  trackId: string;
  startBeat: number;
  durationBeats: number;
  name: string;
  color: string;
  audioFile: string | null; // Relative path to audio file, e.g., "audio/clip1.wav"
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
