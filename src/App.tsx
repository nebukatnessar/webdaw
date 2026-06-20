import { useRef } from 'react';
import styles from './App.module.css';
import TransportBar from './components/TransportBar/TransportBar';
import TrackHeaderList from './components/TrackHeaderList/TrackHeaderList';
import ArrangeView from './components/ArrangeView/ArrangeView';

function App() {
  const headerRef = useRef<HTMLDivElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  // Mutex flag to prevent infinite scroll-sync loops
  const syncingRef = useRef(false);

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
