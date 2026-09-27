import { useState, useEffect, useRef } from 'react';
import styles from './TransportBar.module.css';
import { useTransportStore } from '../../store/transportStore';
import { useTrackStore } from '../../store/trackStore';
import { useProjectStore } from '../../store/projectStore';
import { useRecordingStore } from '../../store/recordingStore';
import * as engine from '../../audio/engine';
import * as recording from '../../audio/recording';
import ExportDialog from '../ExportDialog/ExportDialog';
import ProjectDialog from '../ProjectDialog/ProjectDialog';
import { toggleTheme, setHighContrast, isHighContrast, getTheme } from '../../utils/theme';
import type { Project } from '../../types/daw';

export default function TransportBar() {
  const { bpm, isPlaying, playheadBeats, isRepeat, zoomLevel, selectionStart, selectionEnd, masterVolume, setBpm, play, pause, stop, setPlayheadBeats, toggleRepeat } =
    useTransportStore();
  const tracks = useTrackStore((s) => s.tracks);
  const addTrack = useTrackStore((s) => s.addTrack);
  const addClip = useTrackStore((s) => s.addClip);

  const projectStore = useProjectStore();

  const {
    inputDevices,
    selectedDeviceId,
    permissionGranted,
    isRecording,
    isCountingIn,
    countInEnabled,
    countInBars,
    setInputDevices,
    setSelectedDeviceId,
    setPermissionGranted,
    setIsRecording,
    setIsCountingIn,
    toggleCountIn,
    setCountInBars,
  } = useRecordingStore();

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showProjectDialog, setShowProjectDialog] = useState<false | 'save' | 'load' | 'new' | 'open'>(false);
  const [currentTheme, setCurrentTheme] = useState(getTheme());
  const [highContrastEnabled, setHighContrastEnabled] = useState(isHighContrast());

  const rafRef = useRef<number | null>(null);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const lastBpmRef = useRef(bpm);
  const recordStartBeatRef = useRef(0);

  // Update theme state when theme changes
  useEffect(() => {
    const updateThemeState = () => {
      setCurrentTheme(getTheme());
      setHighContrastEnabled(isHighContrast());
    };
    
    // Listen for theme change events
    window.addEventListener('themechange', updateThemeState);
    
    return () => {
      window.removeEventListener('themechange', updateThemeState);
    };
  }, []);

  const handlePlayPause = () => {
    if (isPlaying) {
      engine.stopAllSources();
      pause();
      return;
    }
    const startAudio = async () => {
      await engine.resumeContext();
      engine.startPlaybackAt(tracks, playheadBeats, bpmRef.current);
      play();
    };
    void startAudio();
  };

  const handleStop = () => {
    engine.stopAllSources();
    recording.cancelCountIn();
    setIsCountingIn(false);
    if (isRecording) void finishRecording();
    stop();
  };

  const finishRecording = async () => {
    const buffer = await recording.stopRecording();
    setIsRecording(false);
    if (!buffer) return;

    const durationBeats = (buffer.duration * bpmRef.current) / 60;
    const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    engine.storeBuffer(bufferId, buffer);
    for (const track of useTrackStore.getState().tracks) {
      if (track.armed) {
        addClip(track.id, recordStartBeatRef.current, durationBeats, 'Recording', bufferId);
      }
    }
  };

  const armedTracks = tracks.filter((t) => t.armed);
  const canRecord = armedTracks.length > 0 && !!selectedDeviceId;

  const handleRecordToggle = () => {
    if (isRecording) {
      const wasPlaying = useTransportStore.getState().isPlaying;
      void finishRecording().then(() => {
        if (wasPlaying) {
          engine.stopAllSources();
          pause();
        }
      });
      return;
    }
    if (!canRecord) return;

    const beginRecording = async () => {
      await engine.resumeContext();
      if (countInEnabled) {
        setIsCountingIn(true);
        const completed = await recording.scheduleCountIn(countInBars, bpmRef.current);
        setIsCountingIn(false);
        if (!completed) return;
      }
      recordStartBeatRef.current = useTransportStore.getState().playheadBeats;
      if (!useTransportStore.getState().isPlaying) {
        handlePlayPause();
      }
      await recording.startRecording(selectedDeviceId);
      setIsRecording(true);
    };
    void beginRecording();
  };

  const handleRequestMicPermission = () => {
    if (permissionGranted) return;
    const grantPermission = async () => {
      try {
        await recording.requestMicPermission();
        setPermissionGranted(true);
        setInputDevices(await recording.listInputDevices());
      } catch (e) {
        console.warn('Microphone permission was not granted:', e);
      }
    };
    void grantPermission();
  };

  useEffect(() => {
    let cancelled = false;
    const refreshDevices = () => {
      recording.listInputDevices().then((devices) => {
        if (!cancelled) setInputDevices(devices);
      });
    };
    refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
    };
  }, [setInputDevices]);

  const handleExport = () => {
    setShowExportDialog(true);
  };

  const handleSaveClick = () => {
    // Once a project has a name (created, loaded, or previously saved), save
    // straight back into it instead of re-prompting for a name every time.
    if (projectStore.currentProjectId) {
      void quickSave();
    } else {
      setShowProjectDialog('save');
    }
  };

  const quickSave = async () => {
    try {
      await projectStore.saveCurrentProject(tracks, transportState);
    } catch (e) {
      console.error('Quick save failed, falling back to Save dialog:', e);
      setShowProjectDialog('save');
    }
  };

  const project: Project = {
    id: 'current',
    name: 'Untitled Project',
    bpm,
    tracks,
    masterVolume,
  };

  useEffect(() => {
    document.title = projectStore.currentProjectId
      ? `${projectStore.currentProjectName} - WebDAW`
      : 'WebDAW';
  }, [projectStore.currentProjectId, projectStore.currentProjectName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowProjectDialog('new');
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setShowProjectDialog('load');
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveClick();
        return;
      }
      if (e.code === 'Space') {
        const target = e.target as HTMLElement | null;
        const isTyping =
          !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        if (isTyping) return;
        e.preventDefault();
        handlePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    
    if (bpm !== lastBpmRef.current) {
      engine.reanchorPlayhead(playheadBeats);
      lastBpmRef.current = bpm;
    }

    const tick = () => {
      let newPlayhead = engine.computePlayheadBeats(bpmRef.current);

      if (isRepeat && selectionStart !== null && selectionEnd !== null) {
        if (newPlayhead >= selectionEnd) {
          const loopDuration = selectionEnd - selectionStart;
          newPlayhead = selectionStart + ((newPlayhead - selectionStart) % loopDuration);
          engine.seekDuringPlayback(useTrackStore.getState().tracks, newPlayhead, bpmRef.current);
        }
      }

      setPlayheadBeats(newPlayhead);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, setPlayheadBeats, bpm, playheadBeats, isRepeat, selectionStart, selectionEnd]);

  const bar = Math.floor(playheadBeats / 4) + 1;
  const beat = (Math.floor(playheadBeats % 4) + 1).toString().padStart(2, '0');

  // Theme toggle handlers
  const handleToggleTheme = () => {
    const newTheme = toggleTheme();
    setCurrentTheme(newTheme);
  };

  const handleToggleHighContrast = () => {
    const newHighContrast = !highContrastEnabled;
    setHighContrastEnabled(newHighContrast);
    setHighContrast(newHighContrast);
  };

  // Get transport state for saving
  const transportState = {
    bpm,
    playheadBeats,
    isRepeat,
    zoomLevel,
    selectionStart,
    selectionEnd,
    masterVolume,
  };

  return (
    <>
      <div className={styles.bar}>
        {/* Project buttons */}
        <button
          className={styles.btn + ' ' + styles.projectBtn}
          onClick={() => setShowProjectDialog('new')}
          aria-label="New Project"
          title="New Project (Ctrl+N)"
        >
          📄 New
        </button>
        <button
          className={styles.btn + ' ' + styles.projectBtn}
          onClick={() => setShowProjectDialog('load')}
          aria-label="Open Project"
          title="Open Project (Ctrl+O)"
        >
          📂 Open
        </button>
        <button
          className={styles.btn + ' ' + styles.projectBtn}
          onClick={handleSaveClick}
          aria-label="Save Project"
          title={projectStore.currentProjectId ? 'Save Project (Ctrl+S)' : 'Save Project - choose a name (Ctrl+S)'}
        >
          💾 Save
        </button>

        <span className={styles.projectName} title="Current project">
          {projectStore.currentProjectName}
        </span>

        <div className={styles.divider} />

        <button
          className={styles.btn + ' ' + (isPlaying ? styles.active : '')}
          onClick={handlePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className={styles.btn}
          onClick={handleStop}
          aria-label="Stop"
          title="Stop and return to start"
        >
          ■
        </button>
        <button
          className={styles.btn + ' ' + (isRepeat ? styles.active : '')}
          onClick={toggleRepeat}
          aria-label="Toggle repeat"
          title="Toggle repeat mode"
        >
          ↻
        </button>
        <button
          className={styles.btn + ' ' + (isRecording ? styles.recording : isCountingIn ? styles.countingIn : '')}
          onClick={handleRecordToggle}
          disabled={isCountingIn || (!isRecording && !canRecord)}
          aria-label={isRecording ? 'Stop Recording' : 'Record'}
          title={
            isRecording
              ? 'Stop Recording'
              : isCountingIn
                ? 'Counting in…'
                : canRecord
                  ? 'Record'
                  : armedTracks.length === 0
                    ? 'Arm a track to record'
                    : 'Select an input device to record'
          }
        >
          {isCountingIn ? '⏳' : '⏺'}
        </button>

        <select
          className={styles.deviceSelect}
          value={selectedDeviceId ?? ''}
          onFocus={handleRequestMicPermission}
          onChange={(e) => setSelectedDeviceId(e.target.value || null)}
          aria-label="Recording input device"
          title="Recording input device"
        >
          {inputDevices.length === 0 && <option value="">No input devices</option>}
          {inputDevices.map((device, i) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>

        <label className={styles.countInLabel} title="Play a count-in before recording starts">
          <input type="checkbox" checked={countInEnabled} onChange={toggleCountIn} />
          Count-in
        </label>
        <input
          type="number"
          className={styles.countInBarsInput}
          min={1}
          max={8}
          value={countInBars}
          disabled={!countInEnabled}
          onChange={(e) => setCountInBars(Number(e.target.value))}
          title="Count-in length in bars"
          aria-label="Count-in bars"
        />

        <span className={styles.position} aria-label="Position">
          {bar}:{beat}
        </span>

        <label className={styles.bpmLabel} htmlFor="bpm-input">BPM</label>
        <input
          id="bpm-input"
          type="number"
          className={styles.bpmInput}
          value={bpm}
          min={20}
          max={300}
          onChange={(e) => setBpm(Number(e.target.value))}
        />

        <button className={styles.btn + ' ' + styles.exportBtn} onClick={handleExport} title="Export as WAV">
          💾 Export
        </button>

        <button className={styles.btn + ' ' + styles.addTrackBtn} onClick={addTrack}>
          + Track
        </button>

        {/* Theme toggle buttons */}
        <div className={styles.divider} />
        <button
          className={styles.btn + ' ' + styles.themeBtn}
          onClick={handleToggleTheme}
          aria-label="Toggle Light/Dark Mode"
          title="Toggle Light/Dark Mode"
        >
          {currentTheme === 'light' ? '☀️' : '🌙'}
        </button>
        <button
          className={styles.btn + ' ' + styles.themeBtn + ' ' + (highContrastEnabled ? styles.active : '')}
          onClick={handleToggleHighContrast}
          aria-label="Toggle High Contrast Mode"
          title="Toggle High Contrast Mode"
        >
          HC
        </button>
      </div>
      
      {showExportDialog && (
        <ExportDialog
          onClose={() => setShowExportDialog(false)}
          project={project}
          tracks={tracks}
        />
      )}

      {showProjectDialog && (
        <ProjectDialog
          onClose={() => setShowProjectDialog(false)}
          mode={showProjectDialog}
        />
      )}
    </>
  );
}
