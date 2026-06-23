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

interface ProjectState {
  // Current project
  currentProjectId: string | null;
  currentProjectName: string;
  
  // Project file handles (for File System Access API)
  fileStructure: ProjectFileStructure | null;
  
  // Actions
  setCurrentProject: (id: string | null, name: string) => void;
  setFileStructure: (structure: ProjectFileStructure | null) => void;
  
  // Project management
  getProjects: () => ProjectMetadata[];
  saveCurrentProject: (tracks: Track[], transportState: ProjectTransportState, name?: string) => Promise<void>;
  loadProject: (folderHandle: FileSystemDirectoryHandle) => Promise<{ tracks: Track[]; transport: ProjectTransportState } | void>;
  newProject: (name?: string) => Promise<void>;
  deleteProject: (id: string) => void;
  
  // Export/Import
  exportProject: () => Promise<void>;
  importProject: (file: File) => Promise<{ tracks: Track[]; transport: ProjectTransportState } | void>;
}

let projectCounter = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  currentProjectName: 'Untitled Project',
  fileStructure: null,

  setCurrentProject: (id, name) => {
    set({
      currentProjectId: id,
      currentProjectName: name || 'Untitled Project',
    });
  },

  setFileStructure: (structure) => {
    set({ fileStructure: structure });
  },

  getProjects: () => getProjectMetadataList(),

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
        await saveProjectToFileSystem(serialized, state.fileStructure.folderHandle);
        
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
        return;
      } catch (e) {
        console.error('Failed to save to existing project location:', e);
        throw new Error('Failed to save project');
      }
    }
    
    // New project - need to get file system access
    if (!hasFileSystemAccess) {
      throw new Error('File System Access API not available in this browser. Please use Chrome, Edge, or Opera.');
    }
    
    try {
      // Request a folder for the project
      const folderHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });
      
      // Save project to the selected folder
      const structure = await saveProjectToFileSystem(serialized, folderHandle);
      
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
      });
      
    } catch (e) {
      // User cancelled the folder picker - that's okay
      if (e.name !== 'AbortError') {
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
