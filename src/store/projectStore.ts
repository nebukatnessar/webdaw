import { create } from 'zustand';
import type { Track } from '../types/daw';
import type {
  SerializedProject,
  ProjectMetadata,
  ProjectTransportState,
  ProjectFileStructure,
} from '../types/project';
import {
  getProjectMetadataList,
  saveProjectMetadata,
  removeProjectMetadata,
  createProjectFromState,
  convertToTracks,
  saveProjectToFileSystem,
  loadProjectFromFileSystem,
  saveAudioToProject,
  loadAudioFromProject,
} from '../utils/projectSerializer';
import * as engine from '../audio/engine';
import * as bufferCache from '../audio/bufferCache';
import * as handleStore from '../utils/handleStore';
// Import stores to access their state outside React components
import { useTrackStore as trackStore } from './trackStore';
import { useTransportStore as transportStore } from './transportStore';

interface ProjectState {
  // Current project
  currentProjectId: string | null;
  currentProjectName: string;

  // Project file handles (for File System Access API)
  fileStructure: ProjectFileStructure | null;

  // Remember the last directory used for saving (for OPFS persistence)
  lastUsedDirectory: FileSystemDirectoryHandle | null;

  // Set when a persisted folder handle exists but its permission needs to be
  // re-affirmed by the user (requestPermission requires a user gesture) -
  // surfaced as a one-click "Reconnect" action instead of losing file-backed
  // audio silently.
  pendingReconnect: { handle: FileSystemDirectoryHandle; projectName: string } | null;

  // Actions
  setCurrentProject: (id: string | null, name: string) => void;
  setFileStructure: (structure: ProjectFileStructure | null) => void;
  setLastUsedDirectory: (directory: FileSystemDirectoryHandle | null) => void;

  // Project management
  getProjects: () => ProjectMetadata[];
  saveCurrentProject: (tracks: Track[], transportState: ProjectTransportState, name?: string) => Promise<void>;
  loadProject: (folderHandle: FileSystemDirectoryHandle) => Promise<{ tracks: Track[]; transport: ProjectTransportState }>;
  newProject: (name?: string) => Promise<void>;
  deleteProject: (id: string) => void;

  // Last used directory management
  getLastUsedDirectory: () => FileSystemDirectoryHandle | null;

  // Auto-restore functionality
  restoreLastOpenedProject: () => Promise<void>;
  reconnectProjectFolder: () => Promise<void>;
  dismissReconnect: () => void;

  // Export/Import
  exportProject: () => Promise<void>;
  importProject: (file: File) => Promise<{ tracks: Track[]; transport: ProjectTransportState }>;
}

// LocalStorage key
const PROJECT_AUTO_SAVE_KEY = 'webdaw-project-autosave';

// IndexedDB handle-store keys (see src/utils/handleStore.ts)
const PROJECT_FOLDER_HANDLE_KEY = 'currentProjectFolder';
const BASE_DIRECTORY_HANDLE_KEY = 'lastUsedDirectory';

let projectCounter = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  currentProjectName: 'Untitled Project',
  fileStructure: null,
  lastUsedDirectory: null,
  pendingReconnect: null,

  setCurrentProject: (id, name) => {
    set({
      currentProjectId: id,
      currentProjectName: name || 'Untitled Project',
    });
  },

  setFileStructure: (structure) => {
    set({ fileStructure: structure });
  },

  setLastUsedDirectory: (directory) => {
    set({ lastUsedDirectory: directory });
  },

  getProjects: () => getProjectMetadataList(),

  getLastUsedDirectory: () => get().lastUsedDirectory,

  restoreLastOpenedProject: async () => {
    console.log('[restore] starting');
    try {
      // Restore the last-used base directory regardless of whether we can
      // reconnect the active project, so "New Project" doesn't need the
      // base folder re-picked either.
      const storedBaseDir = await withTimeout(
        handleStore.getHandle<FileSystemDirectoryHandle>(BASE_DIRECTORY_HANDLE_KEY),
        3000,
        'reading stored base directory handle',
      );
      console.log('[restore] storedBaseDir:', storedBaseDir ? storedBaseDir.name : null);
      if (storedBaseDir) {
        set({ lastUsedDirectory: storedBaseDir });
      }

      // Preferred path: reconnect to the real project folder via a
      // persisted handle. queryPermission() needs no user gesture and shows
      // no UI - if still granted, this loads real audio from disk exactly
      // like a normal Open, no separate cache required.
      const storedProjectDir = await withTimeout(
        handleStore.getHandle<FileSystemDirectoryHandle>(PROJECT_FOLDER_HANDLE_KEY),
        3000,
        'reading stored project folder handle',
      );
      console.log('[restore] storedProjectDir:', storedProjectDir ? storedProjectDir.name : null);
      if (storedProjectDir) {
        try {
          const permission = await withTimeout(
            (storedProjectDir as any).queryPermission({ mode: 'readwrite' }),
            3000,
            'queryPermission on stored project folder',
          );
          console.log('[restore] queryPermission result:', permission);
          if (permission === 'granted') {
            const { tracks, transport } = await get().loadProject(storedProjectDir);
            trackStore.getState().setTracks(tracks);
            transportStore.getState().setTransportState(transport);
            console.log('[restore] reconnected to last project folder:', storedProjectDir.name);
            return;
          }
          // Permission needs re-affirming, which requestPermission() can
          // only do in response to an actual user gesture - surface a
          // one-click reconnect instead of a folder re-pick.
          set({ pendingReconnect: { handle: storedProjectDir, projectName: storedProjectDir.name } });
          console.log('[restore] permission not granted, showing reconnect banner');
          // The project folder exists on disk and is the only source of
          // truth for its audio. Do not fall back to the localStorage
          // snapshot here - that would restore the structure with
          // cache-hydrated wavs instead of the real files. Return and
          // wait for the user to click Reconnect, which loads from disk.
          return;
        } catch (e) {
          console.warn('[restore] could not query permission for the stored project folder:', e);
        }
      }

      // Fallback: restore structure (and its own cached audio) from the
      // localStorage auto-save snapshot - covers browsers without File
      // System Access support, and projects never given a real folder yet.
      // Never reached while a reconnect is pending - that path returns
      // early above so project data only ever comes from disk.
      const autoSaveData = localStorage.getItem(PROJECT_AUTO_SAVE_KEY);
      console.log('[restore] localStorage auto-save present:', !!autoSaveData);
      if (autoSaveData) {
        try {
          const serialized = JSON.parse(autoSaveData) as SerializedProject;
          const tracks = convertToTracks(serialized.tracks);
          await hydrateAudioFromCache(tracks);

          trackStore.getState().setTracks(tracks);
          transportStore.getState().setTransportState({
            bpm: serialized.transport.bpm,
            playheadBeats: serialized.transport.playheadBeats,
            isRepeat: serialized.transport.isRepeat,
            isSnapEnabled: serialized.transport.isSnapEnabled,
            gridDivisionBeats: serialized.transport.gridDivisionBeats,
            zoomLevel: serialized.transport.zoomLevel,
            selectionStart: serialized.transport.selectionStart,
            selectionEnd: serialized.transport.selectionEnd,
            masterVolume: serialized.transport.masterVolume,
          });
          set({
            currentProjectId: `restored-${Date.now()}`,
            currentProjectName: serialized.name,
          });

          console.log('[restore] restored project from auto-save:', serialized.name);
        } catch (e) {
          console.warn('[restore] failed to restore from auto-save:', e);
        }
      } else {
        console.log('[restore] no previous project to restore');
      }
    } catch (e) {
      console.error('[restore] error restoring last opened project:', e);
    }
  },

  reconnectProjectFolder: async () => {
    const pending = get().pendingReconnect;
    if (!pending) return;
    try {
      const permission = await (pending.handle as any).requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        const { tracks, transport } = await get().loadProject(pending.handle);
        trackStore.getState().setTracks(tracks);
        transportStore.getState().setTransportState(transport);
      }
    } catch (e) {
      console.error('Failed to reconnect to project folder:', e);
    } finally {
      set({ pendingReconnect: null });
    }
  },

  dismissReconnect: () => set({ pendingReconnect: null }),

  saveCurrentProject: async (tracks, transportState, name) => {
    const state = get();
    const projectName = name || state.currentProjectName;
    const now = Date.now();
    
    // Create project ID if needed
    const projectId = state.currentProjectId || `project-${now}`;
    
    // Create serialized project
    const serialized = createProjectFromState(tracks, transportState, projectName);
    
    // Check if File System Access API is available
    const hasFileSystemAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    
    // Check if we have a file structure (existing project with file system access)
    if (state.fileStructure) {
      try {
        // Save to existing file system location
        if (!state.fileStructure.folderHandle) {
          throw new Error('No folder handle available for existing project');
        }
        await saveProjectWithAudio(tracks, serialized, state.fileStructure.folderHandle);

        // Update metadata (preserve createdAt if project exists)
        const existingProjects = getProjectMetadataList();
        const existingProject = existingProjects.find((p) => p.id === projectId);
        saveProjectMetadata({
          id: projectId,
          name: projectName,
          createdAt: existingProject ? existingProject.createdAt : now,
          updatedAt: now,
        });
        
        set({
          currentProjectId: projectId,
          currentProjectName: projectName,
        });
        
        // Save to auto-save for F5 restore
        try {
          localStorage.setItem(PROJECT_AUTO_SAVE_KEY, JSON.stringify(serialized));
        } catch (e) {
          console.warn('Failed to save project to auto-save:', e);
        }
        
        return;
      } catch (e: unknown) {
        console.error('Failed to save to existing project location:', e);
        throw new Error('Failed to save project');
      }
    }
    
    // If we have a last used directory (base directory), create a project subfolder under it
    if (state.lastUsedDirectory) {
      try {
        // Create a project subfolder under the base directory
        const projectFolderHandle = await state.lastUsedDirectory.getDirectoryHandle(projectName, { create: true });
        
        // Save project to the project subfolder
        const structure = await saveProjectWithAudio(tracks, serialized, projectFolderHandle);

        // Update metadata (preserve createdAt if project exists)
        const existingProjects2 = getProjectMetadataList();
        const existingProject2 = existingProjects2.find((p) => p.id === projectId);
        saveProjectMetadata({
          id: projectId,
          name: projectName,
          createdAt: existingProject2 ? existingProject2.createdAt : now,
          updatedAt: now,
        });

        set({
          currentProjectId: projectId,
          currentProjectName: projectName,
          fileStructure: structure,
          lastUsedDirectory: state.lastUsedDirectory, // Keep the same last used directory
        });

        if (structure.folderHandle) {
          void handleStore.saveHandle(PROJECT_FOLDER_HANDLE_KEY, structure.folderHandle);
        }

        // Save to auto-save for F5 restore
        try {
          localStorage.setItem(PROJECT_AUTO_SAVE_KEY, JSON.stringify(serialized));
        } catch (e) {
          console.warn('Failed to save project to auto-save:', e);
        }
        
        return;
      } catch (e: unknown) {
        console.error('Failed to save to last used directory:', e);
        // If it fails, fall through to regular save
      }
    }
    
    // New project without base directory - need to get file system access
    if (!hasFileSystemAccess) {
      throw new Error('File System Access API not available in this browser. Please use Chrome, Edge, or Opera.');
    }
    
    try {
      // Request a folder to use as the base directory for all projects
      const baseDirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });
      
      // Create a project subfolder under the base directory
      const projectFolderHandle = await baseDirHandle.getDirectoryHandle(projectName, { create: true });
      
      // Save project to the project subfolder (not the base directory directly)
      const structure = await saveProjectWithAudio(tracks, serialized, projectFolderHandle);

      // Update metadata (preserve createdAt if project exists)
      const existingProjects3 = getProjectMetadataList();
      const existingProject3 = existingProjects3.find((p) => p.id === projectId);
      saveProjectMetadata({
        id: projectId,
        name: projectName,
        createdAt: existingProject3 ? existingProject3.createdAt : now,
        updatedAt: now,
      });
      
      set({
        currentProjectId: projectId,
        currentProjectName: projectName,
        fileStructure: structure,
        lastUsedDirectory: baseDirHandle, // Remember the base directory for next time
      });

      void handleStore.saveHandle(BASE_DIRECTORY_HANDLE_KEY, baseDirHandle);
      if (structure.folderHandle) {
        void handleStore.saveHandle(PROJECT_FOLDER_HANDLE_KEY, structure.folderHandle);
      }

      // Save to auto-save for F5 restore
      try {
        localStorage.setItem(PROJECT_AUTO_SAVE_KEY, JSON.stringify(serialized));
      } catch (e) {
        console.warn('Failed to save project to auto-save:', e);
      }
      
    } catch (e: unknown) {
      // User cancelled the folder picker - that's okay
      if ((e as Error).name !== 'AbortError') {
        console.error('Project save error:', e);
      }
      throw e;
    }
  },

  loadProject: async (folderHandle) => {
    // Discard buffers from whatever project was previously loaded so they
    // don't leak into this project's buffer map (and its next save).
    engine.clearAllBuffers();

    const serialized = await loadProjectFromFileSystem(folderHandle);
    const tracks = convertToTracks(serialized.tracks);
    
    // Load audio files for all clips
    await loadAllAudioFiles(folderHandle, tracks);
    
    const now = Date.now();
    const projectName = serialized.name;
    
    // Check if there's already a project with this name in metadata
    const existingProjects = getProjectMetadataList();
    const existingProject = existingProjects.find((p) => p.name === projectName);
    
    const projectId = existingProject ? existingProject.id : `project-${now}`;
    const createdAt = existingProject ? existingProject.createdAt : now;
    
    // Save/update metadata
    saveProjectMetadata({
      id: projectId,
      name: projectName,
      createdAt,
      updatedAt: now,
    });
    
    // Set up file structure
    const audioDirHandle = await folderHandle.getDirectoryHandle('audio');
    const projectFileHandle = await folderHandle.getFileHandle('project.json');
    
    set({
      currentProjectId: projectId,
      currentProjectName: projectName,
      fileStructure: {
        folderHandle,
        projectFileHandle,
        audioDirHandle,
      },
    });

    void handleStore.saveHandle(PROJECT_FOLDER_HANDLE_KEY, folderHandle);

    // Save this as the last opened project for auto-restore on F5
    try {
      localStorage.setItem(PROJECT_AUTO_SAVE_KEY, JSON.stringify(serialized));
    } catch (e) {
      console.warn('Failed to save project info for auto-restore:', e);
    }
    
    // Return the loaded project data for the stores to use
    return { tracks, transport: serialized.transport };
  },

  newProject: async (name) => {
    const projectName = name || `Project ${++projectCounter}`;
    const projectId = `project-${Date.now()}`;
    const now = Date.now();
    
    // Clear current project
    set({
      currentProjectId: projectId,
      currentProjectName: projectName,
      fileStructure: null,
      pendingReconnect: null,
    });

    // Save empty metadata
    saveProjectMetadata({
      id: projectId,
      name: projectName,
      createdAt: now,
      updatedAt: now,
    });

    // Clear audio buffer map and its durable cache
    engine.clearAllBuffers();
    void bufferCache.clearBufferCache();
    // A brand new project has no folder yet - don't let a refresh try to
    // reconnect to whatever project was open before this one.
    void handleStore.deleteHandle(PROJECT_FOLDER_HANDLE_KEY);
  },

  deleteProject: (id) => {
    removeProjectMetadata(id);
    if (get().currentProjectId === id) {
      set({
        currentProjectId: null,
        currentProjectName: 'Untitled Project',
        fileStructure: null,
        pendingReconnect: null,
      });
      void handleStore.deleteHandle(PROJECT_FOLDER_HANDLE_KEY);
    }
  },

  exportProject: async () => {
    const state = get();
    if (!state.fileStructure) {
      throw new Error('No project loaded to export');
    }
    
    // For now, just trigger a download of the project.json
    const folderHandle = state.fileStructure.folderHandle;
    if (!folderHandle) {
      throw new Error('No folder handle available for export');
    }
    const projectFileHandle = await folderHandle.getFileHandle('project.json');
    const file = await projectFileHandle.getFile();
    
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.currentProjectName}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  },

  importProject: async (file) => {
    if (!file.name.endsWith('.json')) {
      throw new Error('Please select a .json project file');
    }
    
    const content = await file.text();
    const serialized: SerializedProject = JSON.parse(content);
    const tracks = convertToTracks(serialized.tracks);
    
    // For imported projects, we need to load audio files
    // This is tricky - for now, we'll just import the structure
    // and let users re-import audio files
    
    const now = Date.now();
    const projectName = serialized.name;
    
    // Check if there's already a project with this name in metadata
    const existingProjects = getProjectMetadataList();
    const existingProject = existingProjects.find((p) => p.name === projectName);
    
    const projectId = existingProject ? existingProject.id : `imported-${now}`;
    const createdAt = existingProject ? existingProject.createdAt : now;
    
    // Save/update metadata
    saveProjectMetadata({
      id: projectId,
      name: projectName,
      createdAt,
      updatedAt: now,
    });
    
    set({
      currentProjectId: projectId,
      currentProjectName: projectName,
      fileStructure: null, // No file system handle for imported projects
    });
    
    return { tracks, transport: serialized.transport };
  },
}));

// Bounds a promise that should normally resolve quickly, so a stuck
// IndexedDB connection or permission query can't silently hang the whole
// restore-on-refresh flow forever.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

// Save the project's audio buffers (keyed by clip, not by the whole global
// buffer map) and link each saved file back onto the serialized clip before
// writing project.json, then write the project file.
async function saveProjectWithAudio(
  tracks: Track[],
  serialized: SerializedProject,
  folderHandle: FileSystemDirectoryHandle,
): Promise<ProjectFileStructure> {
  const audioDirHandle = await folderHandle.getDirectoryHandle('audio', { create: true });

  const clipsById = new Map<string, Track['clips'][number]>();
  for (const track of tracks) {
    for (const clip of track.clips) clipsById.set(clip.id, clip);
  }

  for (const track of serialized.tracks) {
    for (const clip of track.clips) {
      const runtimeClip = clipsById.get(clip.id);
      if (!runtimeClip?.audioBufferId) continue;
      const buffer = engine.getBuffer(runtimeClip.audioBufferId);
      if (!buffer) continue;
      try {
        clip.audioFile = await saveAudioToProject(audioDirHandle, buffer, clip.id, clip.name);
      } catch (e) {
        console.error(`Failed to save audio for clip ${clip.id}:`, e);
      }
    }
  }

  return saveProjectToFileSystem(serialized, folderHandle);
}

// Re-populate the engine buffer map from the durable IndexedDB cache for
// clips restored from the localStorage auto-save snapshot (no folder handle
// available in that path, so this is the only way to get audio back after a
// refresh). Clears audioBufferId for anything that didn't survive in cache
// so playback correctly skips it instead of looking up a buffer that will
// never exist.
async function hydrateAudioFromCache(tracks: Track[]): Promise<void> {
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.audioBufferId) continue;
      const buffer = await bufferCache.getCachedBuffer(clip.audioBufferId);
      if (buffer) {
        engine.storeBuffer(clip.audioBufferId, buffer);
      } else {
        clip.audioBufferId = undefined;
      }
    }
  }
}

// Helper to load audio files for clips
async function loadAllAudioFiles(
  folderHandle: FileSystemDirectoryHandle,
  tracks: Track[]
): Promise<void> {
  try {
    const audioDirHandle = await folderHandle.getDirectoryHandle('audio');
    
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.audioFile) {
          try {
            const buffer = await loadAudioFromProject(audioDirHandle, clip.audioFile);
            const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            engine.storeBuffer(bufferId, buffer);
            clip.audioBufferId = bufferId;
          } catch (e) {
            console.warn(`Failed to load audio file ${clip.audioFile}:`, e);
            clip.audioBufferId = undefined;
          }
        }
      }
    }
  } catch (e) {
    console.warn('No audio directory found in project');
  }
}