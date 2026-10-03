import { decodeFile } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import type { MasterEffects, Track } from '../types/daw';
import type {
  SerializedProject,
  SerializedTrack,
  ProjectMetadata,
  ProjectFileStructure,
} from '../types/project';
import { getDefaultCompressorSettings } from '../audio/compressor';
import { getDefaultGateSettings } from '../audio/gate';
import { getDefaultEQSettings } from '../audio/eq';
import { getDefaultReverbSettings } from '../audio/reverb';
import { getDefaultDelaySettings } from '../audio/delay';
import type { ReverbRoomType } from '../types/daw';

// Project version for forward compatibility
const PROJECT_VERSION = '1.0';

// LocalStorage key for project metadata
const PROJECTS_STORAGE_KEY = 'webdaw-projects';

/**
 * Get all project metadata from localStorage
 */
export function getProjectMetadataList(): ProjectMetadata[] {
  try {
    const stored = localStorage.getItem(PROJECTS_STORAGE_KEY);
    const list = stored ? JSON.parse(stored) : [];
    // Most recently updated first
    return [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch {
    return [];
  }
}

/**
 * Save project metadata to localStorage
 */
export function saveProjectMetadata(metadata: ProjectMetadata): void {
  const list = getProjectMetadataList();
  const existingIndex = list.findIndex((p) => p.id === metadata.id);
  
  if (existingIndex >= 0) {
    list[existingIndex] = metadata;
  } else {
    list.push(metadata);
  }
  
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save project metadata:', e);
  }
}

/**
 * Remove project metadata from localStorage
 */
export function removeProjectMetadata(id: string): void {
  const list = getProjectMetadataList().filter((p) => p.id !== id);
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to remove project metadata:', e);
  }
}

/**
 * Convert current app state to a serializable project
 */
export function createProjectFromState(
  tracks: Track[],
  transportState: {
    bpm: number;
    playheadBeats: number;
    isRepeat: boolean;
    isSnapEnabled?: boolean;
    gridDivisionBeats?: number;
    zoomLevel: number;
    selectionStart: number | null;
    selectionEnd: number | null;
    masterVolume: number;
    masterEffects?: MasterEffects;
  },
  name: string = 'Untitled Project'
): SerializedProject {
  return {
    version: PROJECT_VERSION,
    name,
    transport: {
      bpm: transportState.bpm,
      playheadBeats: transportState.playheadBeats,
      isRepeat: transportState.isRepeat,
      isSnapEnabled: transportState.isSnapEnabled,
      gridDivisionBeats: transportState.gridDivisionBeats,
      zoomLevel: transportState.zoomLevel,
      selectionStart: transportState.selectionStart,
      selectionEnd: transportState.selectionEnd,
      masterVolume: transportState.masterVolume,
      masterEffects: transportState.masterEffects ?? {},
    },
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      muted: track.muted,
      soloed: track.soloed,
      volume: track.volume,
      pan: track.pan,
      color: track.color,
      compressor: track.compressor || getDefaultCompressorSettings(),
      gate: track.gate || getDefaultGateSettings(),
      eq: track.eq || getDefaultEQSettings(),
      delay: track.delay || getDefaultDelaySettings(),
      reverb: track.reverb || getDefaultReverbSettings(),
      clips: track.clips.map((clip) => ({
        id: clip.id,
        trackId: clip.trackId,
        startBeat: clip.startBeat,
        durationBeats: clip.durationBeats,
        name: clip.name,
        color: clip.color,
        bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
        clipGain: clip.clipGain ?? 1,
        muted: clip.muted ?? false,
        fadeInDuration: clip.fadeInDuration ?? 0,
        fadeOutDuration: clip.fadeOutDuration ?? 0,
        fadeType: clip.fadeType ?? 'linear',
        audioFile: clip.audioFile ?? null,
        audioBufferId: clip.audioBufferId,
      })),
    })),
  };
}

/**
 * Convert serialized project back to Track[] for the store
 */
export function convertToTracks(serializedTracks: SerializedTrack[]): Track[] {
  return serializedTracks.map((track) => ({
    id: track.id,
    name: track.name,
    muted: track.muted,
    soloed: track.soloed,
    armed: false,
    volume: track.volume,
    pan: track.pan,
    color: track.color,
    compressor: track.compressor || getDefaultCompressorSettings(),
    gate: track.gate || getDefaultGateSettings(),
    eq: track.eq || getDefaultEQSettings(),
    delay: track.delay || getDefaultDelaySettings(),
    reverb: track.reverb ? { ...track.reverb, roomType: track.reverb.roomType as ReverbRoomType } : getDefaultReverbSettings(),
    clips: track.clips.map((clip) => ({
      id: clip.id,
      trackId: clip.trackId,
      startBeat: clip.startBeat,
      durationBeats: clip.durationBeats,
      name: clip.name,
      color: clip.color,
      bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
      clipGain: clip.clipGain ?? 1,
      muted: clip.muted ?? false,
      fadeInDuration: clip.fadeInDuration ?? 0,
      fadeOutDuration: clip.fadeOutDuration ?? 0,
      fadeType: clip.fadeType === 'exponential' ? 'exponential' : 'linear',
      // Carried through for the localStorage auto-save round-trip; loading
      // from a real project folder overwrites this via loadAllAudioFiles.
      audioBufferId: clip.audioBufferId,
      audioFile: clip.audioFile,
    })),
  }));
}

/**
 * Save project to file system
 */
export async function saveProjectToFileSystem(
  project: SerializedProject,
  folderHandle: FileSystemDirectoryHandle
): Promise<ProjectFileStructure> {
  // Create audio directory
  const audioDirHandle = await folderHandle.getDirectoryHandle('audio', { create: true });

  // Save project.json
  const projectFileHandle = await folderHandle.getFileHandle(`project.json`, { create: true });
  const projectBlob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const projectWriteStream = await projectFileHandle.createWritable();
  await projectWriteStream.write(projectBlob);
  await projectWriteStream.close();

  return {
    folderHandle,
    projectFileHandle,
    audioDirHandle,
  };
}

/**
 * Load project from file system
 */
export async function loadProjectFromFileSystem(
  folderHandle: FileSystemDirectoryHandle
): Promise<SerializedProject> {
  try {
    const projectFileHandle = await folderHandle.getFileHandle('project.json');
    const file = await projectFileHandle.getFile();
    const content = await file.text();
    const project: SerializedProject = JSON.parse(content);
    
    // Validate version
    if (project.version !== PROJECT_VERSION) {
      console.warn(`Project version ${project.version} may not be compatible`);
    }
    
    return project;
  } catch (e) {
    throw new Error(`Failed to load project: ${e}`);
  }
}

/**
 * Save an audio buffer to the project's audio directory
 */
export async function saveAudioToProject(
  audioDirHandle: FileSystemDirectoryHandle,
  buffer: AudioBuffer,
  clipId: string,
  clipName: string
): Promise<string> {
  void clipName;
  const fileName = `${clipId}.wav`;
  const fileHandle = await audioDirHandle.getFileHandle(fileName, { create: true });

  const wavBlob = encodeWav(buffer);

  const writeStream = await fileHandle.createWritable();
  await writeStream.write(wavBlob);
  await writeStream.close();
  
  return `audio/${fileName}`;
}

/**
 * Load an audio file from the project's audio directory
 */
export async function loadAudioFromProject(
  audioDirHandle: FileSystemDirectoryHandle,
  audioFile: string
): Promise<AudioBuffer> {
  // audioFile is like "audio/clip123.wav", we need just the filename
  const fileName = audioFile.split('/').pop();
  
  if (!fileName) {
    throw new Error(`Invalid audio file path: ${audioFile}`);
  }
  
  const fileHandle = await audioDirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  
  // Decode the WAV file
  return decodeFile(file);
}

/**
 * Export project as a downloadable .zip file
 */
export async function exportProjectAsZip(
  project: SerializedProject,
  audioBuffers: Map<string, AudioBuffer>
): Promise<Blob> {
  void audioBuffers;
  // This would require a JSZip library or similar
  // For now, we'll just export the project.json and let users handle audio separately
  // TODO: Implement proper ZIP export
  
  const projectBlob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  return projectBlob;
}

/**
 * Import project from a file
 */
export async function importProjectFromFile(
  file: File
): Promise<{ project: SerializedProject; audioDirHandle: FileSystemDirectoryHandle | null }> {
  if (file.name.endsWith('.json')) {
    const content = await file.text();
    const project: SerializedProject = JSON.parse(content);
    return { project, audioDirHandle: null };
  }
  
  // TODO: Handle ZIP files
  throw new Error('Only .json project files are supported for import');
}
