import { useRef, useEffect } from 'react';
import styles from './App.module.css';
import TransportBar from './components/TransportBar/TransportBar';
import TrackHeaderList from './components/TrackHeaderList/TrackHeaderList';
import ArrangeView from './components/ArrangeView/ArrangeView';
import MasterFader from './components/MasterFader/MasterFader';
import { useProjectStore } from './store/projectStore';

function App() {
  const headerRef = useRef<HTMLDivElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  // Mutex flag to prevent infinite scroll-sync loops
  const syncingRef = useRef(false);
  const pendingReconnect = useProjectStore((s) => s.pendingReconnect);
  const reconnectProjectFolder = useProjectStore((s) => s.reconnectProjectFolder);
  const dismissReconnect = useProjectStore((s) => s.dismissReconnect);

  // Auto-restore last opened project on app startup (F5 refresh). Reads the
  // store via getState() rather than the reactive hook, with an empty
  // dependency array, so restoreLastOpenedProject's own set() calls can't
  // change this effect's inputs and retrigger it - which previously caused
  // several concurrent restore attempts to stack up on every load.
  useEffect(() => {
    const timer = setTimeout(() => {
      useProjectStore.getState().restoreLastOpenedProject().catch((e) => {
        console.log('Auto-restore of last project failed or was cancelled:', e);
      });
    }, 500);

    return () => clearTimeout(timer);
  }, []);

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
      {pendingReconnect && (
        <div className={styles.reconnectBanner}>
          <span>
            Reconnect to &ldquo;{pendingReconnect.projectName}&rdquo; to restore its audio files
          </span>
          <button onClick={() => reconnectProjectFolder()}>Reconnect</button>
          <button onClick={() => dismissReconnect()} className={styles.reconnectDismiss}>
            Dismiss
          </button>
        </div>
      )}
      <TransportBar />
      <div className={styles.main}>
        <div className={styles.workspace}>
          <TrackHeaderList scrollRef={headerRef} onScroll={onHeaderScroll} />
          <ArrangeView scrollRef={arrangeRef} onScroll={onArrangeScroll} />
        </div>
        <MasterFader />
      </div>
    </div>
  );
}

export default App;
