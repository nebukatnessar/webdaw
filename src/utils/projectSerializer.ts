import { getBuffer, storeBuffer, decodeFile } from '../audio/engine';
import type { Track, Clip } from '../types/daw';
import type {
  Project,
  SerializedProject,
  SerializedTrack,
  SerializedClip,
  ProjectMetadata,
  LoadableProject,
  ProjectFileStructure,
} from '../types/project';

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
    return stored ? JSON.parse(stored) : [];
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
    zoomLevel: number;
    selectionStart: number | null;
    selectionEnd: number | null;
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
      zoomLevel: transportState.zoomLevel,
      selectionStart: transportState.selectionStart,
      selectionEnd: transportState.selectionEnd,
    },
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      muted: track.muted,
      soloed: track.soloed,
      volume: track.volume,
      pan: track.pan,
      color: track.color,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        trackId: clip.trackId,
        startBeat: clip.startBeat,
        durationBeats: clip.durationBeats,
        name: clip.name,
        color: clip.color,
        audioFile: clip.audioFile ?? null,
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
    volume: track.volume,
    pan: track.pan,
    color: track.color,
    clips: track.clips.map((clip) => ({
      id: clip.id,
      trackId: clip.trackId,
      startBeat: clip.startBeat,
      durationBeats: clip.durationBeats,
      name: clip.name,
      color: clip.color,
      audioBufferId: undefined, // Will be set when loaded
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
  const fileName = `${clipId}.wav`;
  const fileHandle = await audioDirHandle.getFileHandle(fileName, { create: true });
  
  // Convert AudioBuffer to WAV blob
  const wavBlob = await renderBufferAsWAV(buffer);
  
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
 * Render AudioBuffer as WAV blob
 */
function renderBufferAsWAV(buffer: AudioBuffer): Promise<Blob> {
  return new Promise((resolve) => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * numChannels * bytesPerSample;
    
    const bufferLength = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);
    
    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write audio data
    const offset = 44;
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      const channelData = buffer.getChannelData(i);
      for (let j = 0; j < channelData.length; j++) {
        const sample = Math.max(-1, Math.min(1, channelData[j]));
        const intSample = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(offset + j * blockAlign + i * bytesPerSample, intSample, true);
      }
    }
    
    resolve(new Blob([arrayBuffer], { type: 'audio/wav' }));
  });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Export project as a downloadable .zip file
 */
export async function exportProjectAsZip(
  project: SerializedProject,
  audioBuffers: Map<string, AudioBuffer>
): Promise<Blob> {
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
