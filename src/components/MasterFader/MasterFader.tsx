import { useEffect } from 'react';
import styles from './MasterFader.module.css';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';

export default function MasterFader() {
  const masterVolume = useTransportStore((s) => s.masterVolume);
  const setMasterVolume = useTransportStore((s) => s.setMasterVolume);

  // Push to the engine whenever the value changes for any reason - a drag
  // on this slider, or a project load/restore setting it programmatically.
  useEffect(() => {
    engine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>Master</span>
      <div className={styles.track}>
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
      <span className={styles.value}>{Math.round(masterVolume * 100)}%</span>
    </div>
  );
}
