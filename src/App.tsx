import { useRef, useEffect, useState } from 'react';
import styles from './App.module.css';
import TransportBar from './components/TransportBar/TransportBar';
import TrackHeaderList from './components/TrackHeaderList/TrackHeaderList';
import ArrangeView from './components/ArrangeView/ArrangeView';
import MasterFader from './components/MasterFader/MasterFader';
import { useProjectStore } from './store/projectStore';
import { useTrackStore } from './store/trackStore';
import { useTransportStore } from './store/transportStore';
import Toast from './components/Toast/Toast';

function App() {
  const headerRef = useRef<HTMLDivElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  // Mutex flag to prevent infinite scroll-sync loops
  const syncingRef = useRef(false);
  const pendingReconnect = useProjectStore((s) => s.pendingReconnect);
  const reconnectProjectFolder = useProjectStore((s) => s.reconnectProjectFolder);
  const dismissReconnect = useProjectStore((s) => s.dismissReconnect);

  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);

  // Auto-restore last opened project on app startup (F5 refresh).
  useEffect(() => {
    const timer = setTimeout(() => {
      useProjectStore.getState().restoreLastOpenedProject().then(() => {
        setToast({ message: "Project restored successfully", key: Date.now() });
      }).catch((e) => {
        console.log('Auto-restore of last project failed or was cancelled:', e);
      });
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Listen for project save events
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe(
      (state) => state.currentProjectId,
      (currentProjectId, previousProjectId) => {
        if (currentProjectId !== previousProjectId) {
          setToast({ message: "Project saved successfully", key: Date.now() });
        }
      }
    );

    return () => unsubscribe();
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

  // Keyboard handler for split (S), undo split (Ctrl/Cmd+Z), and clip operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in form fields
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) {
        return;
      }

      // Handle split with S key
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const { selectionStart, selectionEnd, playheadBeats } = useTransportStore.getState();
        const splitBeats: number[] = [];

        if (selectionStart !== null && selectionEnd !== null) {
          // Split at both selection boundaries
          splitBeats.push(selectionStart, selectionEnd);
        } else {
          // Split at playhead position
          splitBeats.push(playheadBeats);
        }

        useTrackStore.getState().splitClipsAt(splitBeats);
      }

      // Handle undo split with Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useTrackStore.getState().undoSplit();
      }

      // Handle copy with Ctrl/Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        useTrackStore.getState().copySelected();
      }

      // Handle cut with Ctrl/Cmd+X
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        useTrackStore.getState().cutSelected();
      }

      // Handle paste with Ctrl/Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { playheadBeats } = useTransportStore.getState();
        useTrackStore.getState().pasteAtPlayhead(playheadBeats);
      }

      // Handle delete with Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        useTrackStore.getState().deleteSelected();
      }

      // Handle Escape to clear clip selection
      if (e.key === 'Escape') {
        e.preventDefault();
        useTrackStore.getState().clearClipSelection();
      }

      // Handle duplicate with Ctrl/Cmd+D
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        useTrackStore.getState().duplicateSelected();
      }

      // Handle quantize with Q key
      if (e.key.toLowerCase() === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const gridBeats = useTransportStore.getState().gridDivisionBeats;
        useTrackStore.getState().quantizeSelected(gridBeats);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      <div className={styles.workspace}>
        <TrackHeaderList scrollRef={headerRef} onScroll={onHeaderScroll} />
        <ArrangeView scrollRef={arrangeRef} onScroll={onArrangeScroll} />
        <MasterFader />
      </div>
      {toast && <Toast message={toast.message} onClose={() => setToast(null)} key={toast.key} />}
    </div>
  );
}

export default App;