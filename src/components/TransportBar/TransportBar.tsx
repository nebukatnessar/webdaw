import { useEffect, useRef } from 'react';
import styles from './TransportBar.module.css';
import { useTransportStore } from '../../store/transportStore';
import { useTrackStore } from '../../store/trackStore';
import * as engine from '../../audio/engine';

export default function TransportBar() {
  const { bpm, isPlaying, playheadBeats, setBpm, play, pause, stop, setPlayheadBeats } =
    useTransportStore();
  const addTrack = useTrackStore((s) => s.addTrack);

  const rafRef = useRef<number | null>(null);
  const anchorCtxTimeRef = useRef(0);
  const anchorBeatsRef = useRef(0);
  // Keep a ref to bpm so the RAF loop always reads the latest value
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

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

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      const elapsed = engine.getAudioContext().currentTime - anchorCtxTimeRef.current;
      setPlayheadBeats(anchorBeatsRef.current + (elapsed * bpmRef.current) / 60);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, setPlayheadBeats]);

  const bar = Math.floor(playheadBeats / 4) + 1;
  const beat = (Math.floor(playheadBeats % 4) + 1).toString().padStart(2, '0');

  return (
    <div className={styles.bar}>
      <button
        className={`${styles.btn} ${styles.playBtn} ${isPlaying ? styles.active : ''}`}
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

      <button className={`${styles.btn} ${styles.addTrackBtn}`} onClick={addTrack}>
        + Track
      </button>
    </div>
  );
}
