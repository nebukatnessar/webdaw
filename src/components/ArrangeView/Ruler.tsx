import type { RefObject } from 'react';
import styles from './ArrangeView.module.css';
import { useTransportStore } from '../../store/transportStore';
import { PIXELS_PER_BEAT, BEATS_PER_BAR, TOTAL_BARS } from '../../constants';
import * as engine from '../../audio/engine';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
}

export default function Ruler({ scrollRef }: Props) {
  const bars = Array.from({ length: TOTAL_BARS }, (_, i) => i);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const setPlayheadBeats = useTransportStore((s) => s.setPlayheadBeats);
  const pause = useTransportStore((s) => s.pause);

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = e.clientX - rect.left + scroll.scrollLeft;
    const rawBeat = contentX / PIXELS_PER_BEAT;
    const snappedBeat = Math.max(0, Math.round(rawBeat));
    if (isPlaying) {
      engine.stopAllSources();
      pause();
    }
    setPlayheadBeats(snappedBeat);
  };

  return (
    <div className={styles.ruler} onClick={handleRulerClick} style={{ cursor: 'pointer' }}>
      {bars.map((bar) => (
        <div
          key={bar}
          className={styles.rulerCell}
          style={{ left: bar * BEATS_PER_BAR * PIXELS_PER_BEAT }}
        >
          {bar + 1}
        </div>
      ))}
    </div>
  );
}
