import { useEffect, useRef } from 'react';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';
import { levelToPercent } from '../../audio/meterUtils';
import VuMeterBar from '../VuMeterBar/VuMeterBar';
import styles from './TrackHeaderList.module.css';

interface Props {
  trackId: string;
  trackName: string;
}

export default function TrackMeter({ trackId, trackName }: Props) {
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const maskRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (maskRef.current) maskRef.current.style.height = '100%';
      return;
    }

    const tick = () => {
      const level = engine.getTrackLevel(trackId);
      if (maskRef.current) maskRef.current.style.height = `${100 - levelToPercent(level)}%`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, trackId]);

  return <VuMeterBar ref={maskRef} className={styles.meterCol} title={`${trackName} level`} />;
}
