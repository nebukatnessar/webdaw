import { useState, useEffect, useRef } from 'react';
import styles from './TransportBar.module.css';
import { useTransportStore } from '../../store/transportStore';
import { useTrackStore } from '../../store/trackStore';
import * as engine from '../../audio/engine';
import ExportDialog from '../ExportDialog/ExportDialog';
import type { Project } from '../../types/daw';

export default function TransportBar() {
  const { bpm, isPlaying, playheadBeats, isRepeat, selectionStart, selectionEnd, setBpm, play, pause, stop, setPlayheadBeats, toggleRepeat } =
    useTransportStore();
  const tracks = useTrackStore((s) => s.tracks);
  const addTrack = useTrackStore((s) => s.addTrack);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const rafRef = useRef<number | null>(null);
  const anchorCtxTimeRef = useRef(0);
  const anchorBeatsRef = useRef(0);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const lastBpmRef = useRef(bpm);

  const handlePlayPause = () => {
    if (isPlaying) {
      engine.stopAllSources();
      pause();
      return;
    }
    const startAudio = async () => {
      await engine.resumeContext();
      const ctx = engine.getAudioContext();
      anchorCtxTimeRef.current = ctx.currentTime;
      anchorBeatsRef.current = useTransportStore.getState().playheadBeats;
      engine.schedulePlayback(
        useTrackStore.getState().tracks,
        anchorBeatsRef.current,
        bpmRef.current,
      );
      play();
    };
    void startAudio();
  };

  const handleStop = () => {
    engine.stopAllSources();
    stop();
  };

  const handleExport = () => {
    setShowExportDialog(true);
  };

  const project: Project = {
    id: 'current',
    name: 'Untitled Project',
    bpm,
    tracks,
  };

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    
    if (bpm !== lastBpmRef.current) {
      const ctx = engine.getAudioContext();
      anchorCtxTimeRef.current = ctx.currentTime;
      anchorBeatsRef.current = playheadBeats;
      lastBpmRef.current = bpm;
    }
    
    const tick = () => {
      const elapsed = engine.getAudioContext().currentTime - anchorCtxTimeRef.current;
      let newPlayhead = anchorBeatsRef.current + (elapsed * bpmRef.current) / 60;
      
      if (isRepeat && selectionStart !== null && selectionEnd !== null) {
        if (newPlayhead >= selectionEnd) {
          const loopDuration = selectionEnd - selectionStart;
          newPlayhead = selectionStart + ((newPlayhead - selectionStart) % loopDuration);
          
          const ctx = engine.getAudioContext();
          const beatsIntoLoop = newPlayhead - selectionStart;
          anchorCtxTimeRef.current = ctx.currentTime - (beatsIntoLoop * 60 / bpmRef.current);
          anchorBeatsRef.current = newPlayhead;
          
          engine.stopAllSources();
          engine.schedulePlayback(
            useTrackStore.getState().tracks,
            newPlayhead,
            bpmRef.current,
          );
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

  return (
    <>
      <div className={styles.bar}>
        <button
          className={styles.btn + ' ' + (isPlaying ? styles.active : '')}
          onClick={handlePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
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
        <button className={styles.btn} aria-label="Record" title="Record (not yet implemented)">
          ⏺
        </button>

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
      </div>
      
      {showExportDialog && (
        <ExportDialog
          onClose={() => setShowExportDialog(false)}
          project={project}
          tracks={tracks}
        />
      )}
    </>
  );
}
