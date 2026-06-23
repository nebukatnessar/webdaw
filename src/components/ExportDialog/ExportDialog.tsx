import { useState, useRef } from 'react';
import styles from './ExportDialog.module.css';
import type { Track, Project } from '../../types/daw';
import { exportAndDownloadTrack, exportAndDownloadProject, ExportOptions } from '../../audio/export';

interface ExportDialogProps {
  onClose: () => void;
  project: Project;
  tracks: Track[];
}

export default function ExportDialog({ onClose, project, tracks }: ExportDialogProps) {
  const [exportType, setExportType] = useState<'project' | 'track'>('project');
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [sampleRate, setSampleRate] = useState<number>(44100);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if (isExporting) return;
    
    setIsExporting(true);
    setProgress(0);
    setError(null);

    try {
      const options: ExportOptions = {
        sampleRate,
        onProgress: setProgress,
      };

      if (exportType === 'project') {
        await exportAndDownloadProject(project, options);
      } else if (selectedTrackId) {
        const track = tracks.find((t) => t.id === selectedTrackId);
        if (track) {
          await exportAndDownloadTrack(track, project.bpm, project.name, options);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  };

  const trackOptions = tracks.filter((t) => t.clips.length > 0);
  const canExport = exportType === 'project' || (exportType === 'track' && selectedTrackId);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Export as WAV</h2>
        
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.optionGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="exportType"
              value="project"
              checked={exportType === 'project'}
              onChange={() => setExportType('project')}
            />
            <span>Export Entire Project (Mixdown)</span>
          </label>
          
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="exportType"
              value="track"
              checked={exportType === 'track'}
              onChange={() => setExportType('track')}
            />
            <span>Export Single Track</span>
          </label>
          
          {exportType === 'track' && (
            <select
              className={styles.trackSelect}
              value={selectedTrackId}
              onChange={(e) => setSelectedTrackId(e.target.value)}
            >
              <option value="">Select a track...</option>
              {trackOptions.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={styles.optionGroup}>
          <label className={styles.label}>
            Sample Rate
            <select
              className={styles.select}
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
            >
              <option value={44100}>44100 Hz (CD Quality)</option>
              <option value={48000}>48000 Hz</option>
              <option value={96000}>96000 Hz</option>
            </select>
          </label>
        </div>

        {isExporting && (
          <div className={styles.progressContainer}>
            <div className={styles.progressBar} style={{ width: `${progress * 100}%` }} />
            <span>Exporting... {Math.round(progress * 100)}%</span>
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button
            className={styles.exportBtn}
            onClick={handleExport}
            disabled={!canExport || isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
