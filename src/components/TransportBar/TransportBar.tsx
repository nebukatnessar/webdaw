import { useState, useEffect, useRef } from 'react';
import styles from './TransportBar.module.css';
import { useTransportStore } from '../../store/transportStore';
import { useTrackStore } from '../../store/trackStore';
import { useProjectStore } from '../../store/projectStore';
import { useRecordingStore } from '../../store/recordingStore';
import * as engine from '../../audio/engine';
import * as recording from '../../audio/recording';
import { groupTakes } from '../../audio/takes';
import ExportDialog from '../ExportDialog/ExportDialog';
import ProjectDialog from '../ProjectDialog/ProjectDialog';
import { toggleTheme, setHighContrast, isHighContrast, getTheme } from '../../utils/theme';
import type { Project } from '../../types/daw';

export default function TransportBar() {
  const { bpm, isPlaying, playheadBeats, isRepeat, isSnapEnabled, gridDivisionBeats, zoomLevel, selectionStart, selectionEnd, masterVolume, setBpm, play, pause, stop, setPlayheadBeats, toggleRepeat, toggleSnap, setGridDivisionBeats } =
    useTransportStore();
  const tracks = useTrackStore((s) => s.tracks);
  const addTrack = useTrackStore((s) => s.addTrack);
  const addClip = useTrackStore((s) => s.addClip);
  const addRecordedTakes = useTrackStore((s) => s.addRecordedTakes);

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
  const takeRecordingRef = useRef<{
    startBeat: number;
    selectionEndBeat: number | null;
    bpm: number;
    takeDurationSecs: number | null;
    loop: boolean;
    takeGroupIds: Record<string, string>;
    nextTakeNumbers: Record<string, number>;
  } | null>(null);

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
    const takeRecording = takeRecordingRef.current;
    takeRecordingRef.current = null;
    const buffer = await recording.stopRecording();
    setIsRecording(false);
    if (!buffer) return;

    const armedTracks = useTrackStore.getState().tracks.filter((track) => track.armed);
    const multiTakeTracks = takeRecording
      ? armedTracks.filter((track) => track.recordingMode === 'multiTake' && takeRecording.takeGroupIds[track.id])
      : [];
    const layeredTracks = armedTracks.filter((track) => !multiTakeTracks.includes(track));

    if (layeredTracks.length > 0) {
      const durationBeats = (buffer.duration * bpmRef.current) / 60;
      const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      engine.storeBuffer(bufferId, buffer);
      for (const track of layeredTracks) {
        addClip(track.id, recordStartBeatRef.current, durationBeats, 'Recording', bufferId);
      }
    }

    if (takeRecording && multiTakeTracks.length > 0) {
      const takes = takeRecording.loop && takeRecording.takeDurationSecs
        ? recording.splitRecordingIntoTakes(buffer, takeRecording.takeDurationSecs)
        : [buffer];
      const takeBufferIds = takes.map((take) => {
        const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        engine.storeBuffer(bufferId, take);
        return bufferId;
      });
      addRecordedTakes(multiTakeTracks.map((track) => ({
        trackId: track.id,
        clips: takes.map((take, index) => ({
          startBeat: takeRecording.startBeat,
          durationBeats: (take.duration * takeRecording.bpm) / 60,
          audioBufferId: takeBufferIds[index],
          takeGroupId: takeRecording.takeGroupIds[track.id],
          takeNumber: (takeRecording.nextTakeNumbers[track.id] ?? 1) + index,
          name: `Take ${(takeRecording.nextTakeNumbers[track.id] ?? 1) + index}`,
        })),
      })));
    }
  };

  const armedTracks = tracks.filter((t) => t.armed);
  const canRecord = armedTracks.length > 0;

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
    if (!selectedDeviceId && !permissionGranted) {
      handleRequestMicPermission();
      return;
    }

    const beginRecording = async () => {
      await engine.resumeContext();
      if (countInEnabled) {
        setIsCountingIn(true);
        const completed = await recording.scheduleCountIn(countInBars, bpmRef.current);
        setIsCountingIn(false);
        if (!completed) return;
      }

      await recording.prepareRecording(selectedDeviceId);
      const transport = useTransportStore.getState();
      const currentTracks = useTrackStore.getState().tracks;
      const currentArmedTracks = currentTracks.filter((track) => track.armed);
      const currentHasMultiTake = currentArmedTracks.some((track) => track.recordingMode === 'multiTake');
      const selectionStartBeat = transport.selectionStart;
      const selectionEndBeat = transport.selectionEnd;
      const hasTakeLoop = transport.isRepeat && selectionStartBeat !== null &&
        selectionEndBeat !== null && selectionEndBeat > selectionStartBeat;
      const takeStartBeat = currentHasMultiTake && hasTakeLoop && selectionStartBeat !== null
        ? selectionStartBeat
        : transport.playheadBeats;
      recordStartBeatRef.current = takeStartBeat;
      if (currentHasMultiTake) {
        const takeBpm = bpmRef.current;
        const groupStartBeat = hasTakeLoop && selectionStartBeat !== null ? selectionStartBeat : takeStartBeat;
        const groupEndBeat = hasTakeLoop && selectionEndBeat !== null ? selectionEndBeat : takeStartBeat;
        const multiTakeTrackIds = currentArmedTracks
          .filter((track) => track.recordingMode === 'multiTake')
          .map((track) => track.id);
        const selectedClipIds = new Set(useTrackStore.getState().selectedClipIds);
        const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const takeGroupIds: Record<string, string> = {};
        const baseTakeNumbers: Record<string, number> = {};
        for (const trackId of multiTakeTrackIds) {
          const track = currentArmedTracks.find((item) => item.id === trackId);
          if (!track) continue;
          const overlappingGroups = [...groupTakes(track.clips).entries()]
            .filter(([, takes]) => takes.some((clip) => hasTakeLoop
              ? clip.startBeat < groupEndBeat && clip.startBeat + clip.durationBeats > groupStartBeat
              : clip.startBeat <= groupStartBeat && clip.startBeat + clip.durationBeats > groupStartBeat,
            ))
            .sort(([, first], [, second]) =>
              Math.max(...first.map((clip) => clip.startBeat)) - Math.max(...second.map((clip) => clip.startBeat)),
            );
          const selectedGroup = overlappingGroups.find(([, takes]) =>
            takes.some((clip) => selectedClipIds.has(clip.id)),
          );
          const existingGroup = selectedGroup ?? overlappingGroups[overlappingGroups.length - 1];
          const groupId = existingGroup?.[0] ?? `take-group-${sessionId}-${trackId}`;
          takeGroupIds[trackId] = groupId;
          baseTakeNumbers[trackId] = existingGroup
            ? Math.max(...existingGroup[1].map((clip) => clip.takeNumber ?? 0))
            : 0;
        }
        if (hasTakeLoop && selectionStartBeat !== null && selectionEndBeat !== null) {
          useTrackStore.getState().prepareTakeGroup(
            multiTakeTrackIds,
            selectionStartBeat,
            selectionEndBeat,
            takeGroupIds,
            baseTakeNumbers,
          );
        }
        const preparedTracks = useTrackStore.getState().tracks;
        const nextTakeNumbers = Object.fromEntries(multiTakeTrackIds.map((trackId) => {
          const track = preparedTracks.find((item) => item.id === trackId);
          const groupNumbers = track?.clips
            .filter((clip) => clip.takeGroupId === takeGroupIds[trackId])
            .map((clip) => clip.takeNumber ?? 0) ?? [];
          return [trackId, Math.max(0, ...groupNumbers) + 1];
        }));
        takeRecordingRef.current = {
          startBeat: takeStartBeat,
          selectionEndBeat: hasTakeLoop ? selectionEndBeat : null,
          bpm: takeBpm,
          takeDurationSecs: hasTakeLoop && selectionStartBeat !== null && selectionEndBeat !== null
            ? ((selectionEndBeat - selectionStartBeat) * 60) / takeBpm
            : null,
          loop: hasTakeLoop,
          takeGroupIds,
          nextTakeNumbers,
        };
      } else {
        takeRecordingRef.current = null;
      }

      const preparedTracks = useTrackStore.getState().tracks;
      if (transport.isPlaying) {
        if (currentHasMultiTake) {
          engine.seekDuringPlayback(preparedTracks, takeStartBeat, bpmRef.current);
          setPlayheadBeats(takeStartBeat);
        }
      }
      recording.startRecording();
      setIsRecording(true);
      if (!transport.isPlaying) {
        setPlayheadBeats(takeStartBeat);
        engine.startPlaybackAt(preparedTracks, takeStartBeat, bpmRef.current);
        play();
      }
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
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable
      );

      if (!mod && e.key.toLowerCase() === 't' && !isTyping) {
        const trackStore = useTrackStore.getState();
        if (trackStore.activeTrackId) {
          e.preventDefault();
          trackStore.cycleTake(trackStore.activeTrackId, e.shiftKey ? -1 : 1);
          const transport = useTransportStore.getState();
          if (transport.isPlaying) {
            engine.seekDuringPlayback(useTrackStore.getState().tracks, transport.playheadBeats, transport.bpm);
          }
        }
        return;
      }

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

      const takeLoop = takeRecordingRef.current;
      const shouldRepeat = takeLoop ? takeLoop.loop : isRepeat;
      const loopStart = takeLoop?.loop ? takeLoop.startBeat : selectionStart;
      const loopEnd = takeLoop?.loop ? takeLoop.selectionEndBeat : selectionEnd;
      if (shouldRepeat && loopStart !== null && loopEnd !== null && loopEnd > loopStart) {
        if (newPlayhead >= loopEnd) {
          const loopDuration = loopEnd - loopStart;
          newPlayhead = loopStart + ((newPlayhead - loopStart) % loopDuration);
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
    isSnapEnabled,
    gridDivisionBeats,
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
          disabled={isRecording && !!takeRecordingRef.current}
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
                    : !selectedDeviceId && !permissionGranted
                      ? 'Click to allow microphone access'
                      : 'Record one take; enable repeat with a time selection to capture multiple passes'
          }
        >
          {isCountingIn ? '⏳' : '⏺'}
        </button>
        
        <button
          className={styles.btn + ' ' + (isSnapEnabled ? styles.active : '')}
          onClick={toggleSnap}
          aria-label="Toggle snap"
          title="Toggle snap to grid"
        >
          🧲
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
          disabled={isRecording && !!takeRecordingRef.current}
          min={20}
          max={300}
          onChange={(e) => setBpm(Number(e.target.value))}
        />

        <label className={styles.bpmLabel} htmlFor="grid-input">Grid</label>
        <select
          id="grid-input"
          className={styles.bpmInput}
          value={gridDivisionBeats}
          onChange={(e) => setGridDivisionBeats(Number(e.target.value))}
        >
          <option value="4">Bar</option>
          <option value="1">Beat</option>
          <option value="0.5">1/8</option>
          <option value="0.25">1/16</option>
        </select>

        <button className={styles.btn + ' ' + styles.exportBtn} onClick={handleExport} title="Export as WAV">
          💾 Export
        </button>

        <button
          className={styles.btn + ' ' + styles.addTrackBtn}
          onClick={() => addTrack({
            name: `Track ${tracks.length + 1}`,
            muted: false,
            soloed: false,
            armed: false,
            volume: 1,
            pan: 0,
            color: '#4f46e5',
          })}
        >
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
