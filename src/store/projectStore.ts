import { create } from 'zustand';
import type { Track } from '../types/daw';
import type {
  Project,
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
  
  // Export/Import
  exportProject: () => Promise<void>;
  importProject: (file: File) => Promise<{ tracks: Track[]; transport: ProjectTransportState }>;
}

// LocalStorage keys
const LAST_OPENED_PROJECT_KEY = 'webdaw-last-opened-project';
const PROJECT_AUTO_SAVE_KEY = 'webdaw-project-autosave';

let projectCounter = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  currentProjectName: 'Untitled Project',
  fileStructure: null,
  lastUsedDirectory: null,

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
    
    try {
      // First, try to restore from localStorage auto-save
      const autoSaveData = localStorage.getItem(PROJECT_AUTO_SAVE_KEY);
      if (autoSaveData) {
        try {
          const serialized = JSON.parse(autoSaveData) as SerializedProject;
          const tracks = convertToTracks(serialized.tracks);
          
          // Update the track store with restored tracks
          trackStore.getState().setTracks(tracks);
          
          // Update transport state
          transportStore.getState().setTransportState({
            bpm: serialized.transport.bpm,
            playheadBeats: serialized.transport.playheadBeats,
            isRepeat: serialized.transport.isRepeat,
            zoomLevel: serialized.transport.zoomLevel,
            selectionStart: serialized.transport.selectionStart,
            selectionEnd: serialized.transport.selectionEnd,
          });
          
          // Update project state
          set({
            currentProjectId: `restored-${Date.now()}`,
            currentProjectName: serialized.name,
          });
          
          console.log('Successfully restored project from auto-save:', serialized.name);
          return;
        } catch (e) {
          console.warn('Failed to restore from auto-save, trying file system:', e);
        }
      }
      
      // If auto-save restore failed, try file system approach
      // Check if File System Access API is available
      if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
        console.log('File System Access API not available, cannot restore from file system');
        return;
      }

      // Get last opened project info from localStorage
      const lastProject = localStorage.getItem(LAST_OPENED_PROJECT_KEY);
      
      if (!lastProject) {
        console.log('No last opened project found');
        return;
      }
      
      const { projectName } = JSON.parse(lastProject);
      
      try {
        // Try to re-acquire the directory handle
        // The browser SHOULD remember the permission if it was previously granted
        // and should NOT show a permission dialog
        const folderHandle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'documents',
        });
        
        // Now try to find and load the project
        // Since we now use subfolders, try to find the project subfolder
        try {
          const projectFolderHandle = await folderHandle.getDirectoryHandle(projectName);
          await get().loadProject(projectFolderHandle);
          console.log('Successfully restored last opened project from file system');
          return;
        } catch (e) {
          // If project not found in subfolder, try the folder directly (legacy projects)
          try {
            await get().loadProject(folderHandle);
            console.log('Successfully restored last opened project (legacy format)');
            return;
          } catch (e2) {
            console.log('Could not find project in selected folder');
          }
        }
        
      } catch (e: unknown) {
        // User cancelled or permission not granted
        if ((e as Error).name !== 'AbortError') {
          console.log('Could not restore last opened project from file system:', e);
        }
        // If we get here, the user either cancelled or permissions weren't granted
        // As a fallback, try to restore just the project structure from localStorage
        if (autoSaveData) {
          try {
            const serialized = JSON.parse(autoSaveData) as SerializedProject;
            const tracks = convertToTracks(serialized.tracks);
            trackStore.getState().setTracks(tracks);
            transportStore.getState().setTransportState(serialized.transport);
            set({ currentProjectName: serialized.name });
            console.log('Restored project structure from auto-save as fallback');
          } catch (e2) {
            console.log('Could not restore from any source');
          }
        }
      }
      
    } catch (e) {
      console.error('Error restoring last opened project:', e);
    }
  },

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
        if (state.fileStructure.folderHandle) {
          await saveProjectToFileSystem(serialized, state.fileStructure.folderHandle);
        } else {
          throw new Error('No folder handle available for existing project');
        }
        
        // Save all audio buffers to the project
        await saveAllAudioBuffers(state.fileStructure.audioDirHandle);
        
        // Update metadata
        saveProjectMetadata({
          id: projectId,
          name: projectName,
          createdAt: now,
          updatedAt: now,
        });
        
        set({
          currentProjectId: projectId,
          currentProjectName: projectName,
        });
        
        // Save to auto-save for F5 restore
        try {
          localStorage.setItem(LAST_OPENED_PROJECT_KEY, JSON.stringify({
            projectName: projectName,
            projectId: projectId,
          }));
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
        const structure = await saveProjectToFileSystem(serialized, projectFolderHandle);
        
        // Save all audio buffers to the project
        await saveAllAudioBuffers(structure.audioDirHandle);
        
        // Update metadata
        saveProjectMetadata({
          id: projectId,
          name: projectName,
          createdAt: now,
          updatedAt: now,
        });
        
        set({
          currentProjectId: projectId,
          currentProjectName: projectName,
          fileStructure: structure,
          lastUsedDirectory: state.lastUsedDirectory, // Keep the same last used directory
        });
        
        // Save to auto-save for F5 restore
        try {
          localStorage.setItem(LAST_OPENED_PROJECT_KEY, JSON.stringify({
            projectName: projectName,
            projectId: projectId,
          }));
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
      const structure = await saveProjectToFileSystem(serialized, projectFolderHandle);
      
      // Save all audio buffers to the project
      await saveAllAudioBuffers(structure.audioDirHandle);
      
      // Update metadata
      saveProjectMetadata({
        id: projectId,
        name: projectName,
        createdAt: now,
        updatedAt: now,
      });
      
      set({
        currentProjectId: projectId,
        currentProjectName: projectName,
        fileStructure: structure,
        lastUsedDirectory: baseDirHandle, // Remember the base directory for next time
      });
      
      // Save to auto-save for F5 restore
      try {
        localStorage.setItem(LAST_OPENED_PROJECT_KEY, JSON.stringify({
          projectName: projectName,
          projectId: projectId,
        }));
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
    const serialized = await loadProjectFromFileSystem(folderHandle);
    const tracks = convertToTracks(serialized.tracks);
    
    // Load audio files for all clips
    await loadAllAudioFiles(folderHandle, tracks);
    
    const now = Date.now();
    const projectId = `project-${now}`;
    
    // Save metadata
    saveProjectMetadata({
      id: projectId,
      name: serialized.name,
      createdAt: now,
      updatedAt: now,
    });
    
    // Set up file structure
    const audioDirHandle = await folderHandle.getDirectoryHandle('audio');
    const projectFileHandle = await folderHandle.getFileHandle('project.json');
    
    set({
      currentProjectId: projectId,
      currentProjectName: serialized.name,
      fileStructure: {
        folderHandle,
        projectFileHandle,
        audioDirHandle,
      },
    });
    
    // Save this as the last opened project for auto-restore on F5
    try {
      localStorage.setItem(LAST_OPENED_PROJECT_KEY, JSON.stringify({
        projectName: serialized.name,
        projectId: projectId,
      }));
      
      // Also save the complete serialized project for auto-restore
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
    });
    
    // Save empty metadata
    saveProjectMetadata({
      id: projectId,
      name: projectName,
      createdAt: now,
      updatedAt: now,
    });
    
    // Clear audio buffer map
    engine.clearAllBuffers();
  },

  deleteProject: (id) => {
    removeProjectMetadata(id);
    if (get().currentProjectId === id) {
      set({
        currentProjectId: null,
        currentProjectName: 'Untitled Project',
        fileStructure: null,
      });
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
    const projectId = `imported-${now}`;
    
    saveProjectMetadata({
      id: projectId,
      name: serialized.name,
      createdAt: now,
      updatedAt: now,
    });
    
    set({
      currentProjectId: projectId,
      currentProjectName: serialized.name,
      fileStructure: null, // No file system handle for imported projects
    });
    
    return { tracks, transport: serialized.transport };
  },
}));

// Helper to save all audio buffers to a project
async function saveAllAudioBuffers(audioDirHandle: FileSystemDirectoryHandle | null): Promise<void> {
  if (!audioDirHandle) return;
  
  const bufferMap = engine.getBufferMap();
  
  for (const [bufferId, buffer] of bufferMap) {
    try {
      // Extract clip ID from buffer ID if possible
      // Buffer IDs are like "buf-{timestamp}-{random}"
      const clipId = bufferId.replace(/^buf-/, '');
      await saveAudioToProject(audioDirHandle, buffer, clipId, '');
    } catch (e) {
      console.error(`Failed to save buffer ${bufferId}:`, e);
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
