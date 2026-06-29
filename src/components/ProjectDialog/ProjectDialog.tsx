import { useState, useCallback } from 'react';
import styles from './ProjectDialog.module.css';
import { useProjectStore } from '../../store/projectStore';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';

export interface ProjectDialogProps {
  onClose: () => void;
  mode: 'save' | 'load' | 'new' | 'open';
}

export default function ProjectDialog({ onClose, mode }: ProjectDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Track store
  const tracks = useTrackStore((s) => s.tracks);
  const setTracks = useTrackStore((s) => s.setTracks);
  const clearTracks = useTrackStore((s) => s.clearTracks);
  
  // Transport store
  const bpm = useTransportStore((s) => s.bpm);
  const playheadBeats = useTransportStore((s) => s.playheadBeats);
  const isRepeat = useTransportStore((s) => s.isRepeat);
  const zoomLevel = useTransportStore((s) => s.zoomLevel);
  const selectionStart = useTransportStore((s) => s.selectionStart);
  const selectionEnd = useTransportStore((s) => s.selectionEnd);
  const setTransportState = useTransportStore((s) => s.setTransportState);
  
  // Project store
  const projectStore = useProjectStore();
  const projects = projectStore.getProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // For load mode, we need to handle folder selection
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const lastUsedDirectory = projectStore.getLastUsedDirectory();

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Please enter a project name');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      await projectStore.saveCurrentProject(tracks, {
        bpm,
        playheadBeats,
        isRepeat,
        zoomLevel,
        selectionStart,
        selectionEnd,
      }, name.trim());
      onClose();
    } catch (e: unknown) {
      // User cancelled - that's fine
      if ((e as Error).name !== 'AbortError') {
        const message = e instanceof Error ? e.message : 'Failed to save project';
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [name, tracks, bpm, playheadBeats, isRepeat, zoomLevel, selectionStart, selectionEnd, projectStore, onClose]);

  const handleNewProject = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Clear current state
      clearTracks();
      engine.stopAllSources();
      engine.clearAllBuffers();
      
      // Create new project
      await projectStore.newProject(name.trim() || undefined);
      onClose();
    } catch (e) {
      setError('Failed to create new project');
    } finally {
      setIsLoading(false);
    }
  }, [name, clearTracks, projectStore, onClose]);

  const handleLoadFromFolder = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Show folder picker
      const folderHandle = await (window as any).showDirectoryPicker({
        mode: 'readonly',
        startIn: 'documents',
      });
      
      // Load project from folder
      const { tracks: loadedTracks, transport } = await projectStore.loadProject(folderHandle);
      
      // Update stores with loaded data
      setTracks(loadedTracks);
      setTransportState({
        bpm: transport.bpm,
        playheadBeats: transport.playheadBeats,
        isRepeat: transport.isRepeat,
        zoomLevel: transport.zoomLevel,
        selectionStart: transport.selectionStart,
        selectionEnd: transport.selectionEnd,
      });
      
      onClose();
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setError('Failed to load project');
      }
    } finally {
      setIsLoading(false);
      setShowFolderPicker(false);
    }
  }, [projectStore, setTracks, setTransportState, onClose]);

  const handleLoadFromList = useCallback(async (projectId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // For now, we need to re-open the folder picker since we don't persist file handles
      // In the future, we could use IndexedDB to store permissions
      setSelectedProjectId(projectId);
      setShowFolderPicker(true);
    } catch (e) {
      setError('Failed to load project');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const { tracks: loadedTracks, transport } = await projectStore.importProject(file);
      
      // Update stores with loaded data
      setTracks(loadedTracks);
      setTransportState({
        bpm: transport.bpm,
        playheadBeats: transport.playheadBeats,
        isRepeat: transport.isRepeat,
        zoomLevel: transport.zoomLevel,
        selectionStart: transport.selectionStart,
        selectionEnd: transport.selectionEnd,
      });
      
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import project');
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  }, [projectStore, setTracks, setTransportState, onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>
          {mode === 'save' && 'Save Project'}
          {mode === 'load' && 'Load Project'}
          {mode === 'new' && 'New Project'}
          {mode === 'open' && 'Open Project'}
        </h2>

        {error && <div className={styles.error}>{error}</div>}

        {mode === 'save' && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="project-name">
                Project Name
              </label>
              <input
                id="project-name"
                type="text"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                autoFocus
              />
            </div>
            
            {lastUsedDirectory && (
              <div className={styles.field}>
                <p className={styles.helpText}>
                  Projects will be saved to: {lastUsedDirectory.name || 'WebDaw Projects'}
                </p>
              </div>
            )}
            
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={isLoading}>
                Cancel
              </button>
              <button
                className={styles.saveBtn}
                onClick={handleSave}
                disabled={isLoading || !name.trim()}
              >
                {isLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}

        {mode === 'new' && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-project-name">
                Project Name
              </label>
              <input
                id="new-project-name"
                type="text"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Untitled Project"
                autoFocus
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={isLoading}>
                Cancel
              </button>
              <button
                className={styles.createBtn}
                onClick={handleNewProject}
                disabled={isLoading}
              >
                {isLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </>
        )}

        {(mode === 'load' || mode === 'open') && (
          <>
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Recent Projects</h3>
              {projects.length === 0 ? (
                <p className={styles.empty}>No saved projects found</p>
              ) : (
                <ul className={styles.projectList}>
                  {projects.map((p) => (
                    <li
                      key={p.id}
                      className={`${styles.projectItem} ${selectedProjectId === p.id ? styles.selected : ''}`}
                      onClick={() => handleLoadFromList(p.id)}
                    >
                      <span className={styles.projectName}>{p.name}</span>
                      <span className={styles.projectDate}>
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.divider}>
              <span>or</span>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Import Project File</h3>
              <p className={styles.helpText}>
                Select a .json project file to import
              </p>
              <label className={styles.importBtn}>
                Choose File
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  disabled={isLoading}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {showFolderPicker && (
              <div className={styles.folderPicker}>
                <p>Please select the project folder containing project.json</p>
                <button
                  className={styles.openFolderBtn}
                  onClick={handleLoadFromFolder}
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading...' : 'Select Project Folder'}
                </button>
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={isLoading}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
