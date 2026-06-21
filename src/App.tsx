import { useRef, useEffect, useCallback } from 'react';
import styles from './App.module.css';
import TransportBar from './components/TransportBar/TransportBar';
import TrackHeaderList from './components/TrackHeaderList/TrackHeaderList';
import ArrangeView from './components/ArrangeView/ArrangeView';
import { useTransportStore } from './store/transportStore';
import { useTrackStore } from './store/trackStore';
import * as engine from './audio/engine';

function App() {
  const headerRef = useRef<HTMLDivElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  // Mutex flag to prevent infinite scroll-sync loops
  const syncingRef = useRef(false);
  const { isPlaying, play, pause, bpm } = useTransportStore();
  const tracks = useTrackStore((s) => s.tracks);
  
  const anchorCtxTimeRef = useRef(0);
  const anchorBeatsRef = useRef(0);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  const handlePlayPause = useCallback(() => {
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
        tracks,
        anchorBeatsRef.current,
        bpmRef.current,
      );
      play();
    };
    void startAudio();
  }, [isPlaying, pause, play, tracks]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlePlayPause]);

  const onArrangeScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (headerRef.current) {
      headerRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    syncingRef.current = false;
  };

  const onHeaderScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (arrangeRef.current) {
      arrangeRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    syncingRef.current = false;
  };

  return (
    <div className={styles.app}>
      <TransportBar />
      <div className={styles.workspace}>
        <TrackHeaderList scrollRef={headerRef} onScroll={onHeaderScroll} />
        <ArrangeView scrollRef={arrangeRef} onScroll={onArrangeScroll} />
      </div>
    </div>
  );
}

export default App;
