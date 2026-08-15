import { forwardRef } from 'react';
import styles from './VuMeterBar.module.css';

interface Props {
  className?: string;
  title?: string;
}

// Purely presentational: a vertical green/yellow/red gradient track with a
// mask overlay that shrinks from the bottom up to reveal the current level.
// The mask's height is driven imperatively (via the forwarded ref) rather
// than through a level prop, so callers can update it on a rAF loop without
// triggering a React re-render on every frame.
const VuMeterBar = forwardRef<HTMLDivElement, Props>(function VuMeterBar(
  { className, title },
  maskRef,
) {
  return (
    <div className={`${styles.track} ${className ?? ''}`} title={title}>
      <div className={styles.mask} ref={maskRef} />
    </div>
  );
});

export default VuMeterBar;
