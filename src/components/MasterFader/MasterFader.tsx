import { useEffect, useRef } from 'react';
import styles from './MasterFader.module.css';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';

const METER_FLOOR_DB = -50;

function levelToPercent(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  const clamped = Math.max(METER_FLOOR_DB, Math.min(0, db));
  return ((clamped - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
}

export default function MasterFader() {
  const masterVolume = useTransportStore((s) => s.masterVolume);
  const setMasterVolume = useTransportStore((s) => s.setMasterVolume);
  const isPlaying = useTransportStore((s) => s.isPlaying);

  const leftMaskRef = useRef<HTMLDivElement>(null);
  const rightMaskRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Push to the engine whenever the value changes for any reason - a drag
  // on this slider, or a project load/restore setting it programmatically.
  // Must run before the meter-polling effect below so the master node (and
  // its analysers) exist by the time the first frame polls them.
  useEffect(() => {
    engine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    const applyMaskHeight = (ref: React.RefObject<HTMLDivElement | null>, level: number) => {
      if (ref.current) ref.current.style.height = `${100 - levelToPercent(level)}%`;
    };

    if (!isPlaying) {
      applyMaskHeight(leftMaskRef, 0);
      applyMaskHeight(rightMaskRef, 0);
      return;
    }

    const tick = () => {
      const { left, right } = engine.getMasterLevels();
      applyMaskHeight(leftMaskRef, left);
      applyMaskHeight(rightMaskRef, right);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>Master</span>
      <div className={styles.faderRow}>
        <div className={styles.meterTrack} title="Left channel level">
          <div className={styles.meterMask} ref={leftMaskRef} />
        </div>
        <div className={styles.sliderTrack}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            className={styles.slider}
            aria-label="Master volume"
            title={`Master volume: ${Math.round(masterVolume * 100)}%`}
          />
        </div>
        <div className={styles.meterTrack} title="Right channel level">
          <div className={styles.meterMask} ref={rightMaskRef} />
        </div>
      </div>
      <span className={styles.value}>{Math.round(masterVolume * 100)}%</span>
    </div>
  );
}
