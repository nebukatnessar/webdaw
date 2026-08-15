import { useRef, useEffect, useState } from 'react';
import styles from './App.module.css';
import TransportBar from './components/TransportBar/TransportBar';
import TrackHeaderList from './components/TrackHeaderList/TrackHeaderList';
import ArrangeView from './components/ArrangeView/ArrangeView';
import { useProjectStore } from './store/projectStore';

function App() {
  const headerRef = useRef<HTMLDivElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  // Mutex flag to prevent infinite scroll-sync loops
  const syncingRef = useRef(false);
  const projectStore = useProjectStore();
  const pendingReconnect = useProjectStore((s) => s.pendingReconnect);
  const [restoreAttempted, setRestoreAttempted] = useState(false);

  // Auto-restore last opened project on app startup (F5 refresh)
  useEffect(() => {
    if (restoreAttempted) return;
    
    const restoreProject = async () => {
      try {
        await projectStore.restoreLastOpenedProject();
      } catch (e) {
        console.log('Auto-restore of last project failed or was cancelled:', e);
      } finally {
        setRestoreAttempted(true);
      }
    };
    
    // Add a small delay to let the app fully initialize
    const timer = setTimeout(() => {
      restoreProject();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [projectStore, restoreAttempted]);

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
          <button onClick={() => projectStore.reconnectProjectFolder()}>Reconnect</button>
          <button onClick={() => projectStore.dismissReconnect()} className={styles.reconnectDismiss}>
            Dismiss
          </button>
        </div>
      )}
      <TransportBar />
      <div className={styles.workspace}>
        <TrackHeaderList scrollRef={headerRef} onScroll={onHeaderScroll} />
        <ArrangeView scrollRef={arrangeRef} onScroll={onArrangeScroll} />
      </div>
    </div>
  );
}

export default App;
