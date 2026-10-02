import styles from './ProgressModal.module.css';
import { useProjectStore } from '../../store/projectStore';

// Full-screen modal progress indicator for project save/load operations
// (issue #168). Renders nothing unless the project store reports an
// operation in flight. While it is up, the overlay blocks interaction with
// the app behind it, so users can't fire conflicting actions at a project
// that is only half loaded or saved.
export default function ProgressModal() {
  const progress = useProjectStore((s) => s.progress);

  if (!progress) return null;

  const hasTotal = progress.total > 0;
  const fraction = hasTotal ? Math.min(progress.current / progress.total, 1) : 0;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-busy="true">
      <div className={styles.modal}>
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.message} aria-live="polite">
          {progress.message}
        </p>
        {hasTotal && (
          <>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressBar}
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
            <p className={styles.detail}>
              {Math.min(progress.current, progress.total)} / {progress.total}
            </p>
          </>
        )}
      </div>
    </div>
  );
}