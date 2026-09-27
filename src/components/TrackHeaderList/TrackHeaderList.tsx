import { useState } from 'react';
import type { RefObject } from 'react';
import styles from './TrackHeaderList.module.css';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';
import { BEATS_PER_BAR } from '../../constants';
import TrackMeter from './TrackMeter';
import EffectsDialog from '../EffectsDialog/EffectsDialog';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

function formatPan(pan: number): string {
  const pct = Math.round(Math.abs(pan) * 100);
  if (pct === 0) return 'C';
  return pan < 0 ? `${pct}L` : `${pct}R`;
}

export default function TrackHeaderList({ scrollRef, onScroll }: Props) {
  const { tracks, updateTrack, removeTrack } = useTrackStore();
  const createTracksForClips = useTrackStore((s) => s.createTracksForClips);
  const [isDropOver, setIsDropOver] = useState(false);
  
  // State for EffectsDialog
  const [openDialogTrackId, setOpenDialogTrackId] = useState<string | null>(null);
  const [dialogPosition, setDialogPosition] = useState({ x: 100, y: 100 });
  const [dialogSize, setDialogSize] = useState({ width: 500, height: 400 });

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDropOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDropOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDropOver(false);
    const audioFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.wav'),
    );
    if (audioFiles.length === 0) return;
    const startBeat =
      Math.round(useTransportStore.getState().playheadBeats / BEATS_PER_BAR) * BEATS_PER_BAR;
    void Promise.all(
      audioFiles.map(async (file) => {
        const buffer = await engine.decodeFile(file);
        const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        engine.storeBuffer(bufferId, buffer);
        const bpm = useTransportStore.getState().bpm;
        return {
          name: file.name.replace(/\.[^.]+$/, ''),
          durationBeats: (buffer.duration * bpm) / 60,
          audioBufferId: bufferId,
        };
      }),
    )
      .then((clipData) => createTracksForClips(clipData, startBeat))
      .catch(() => undefined);
  };

  // Toggle EffectsDialog for a track
  const toggleEffectsDialog = (trackId: string) => {
    setOpenDialogTrackId((prev) => (prev === trackId ? null : trackId));
  };

  // Close dialog
  const closeEffectsDialog = () => {
    setOpenDialogTrackId(null);
  };

  // Handle dialog position change
  const handlePositionChange = (x: number, y: number) => {
    setDialogPosition({ x, y });
  };

  // Handle dialog size change
  const handleSizeChange = (width: number, height: number) => {
    setDialogSize({ width, height });
  };

  // Get the track for the open dialog
  const openDialogTrack = tracks.find((t) => t.id === openDialogTrackId);

  return (
    <div
      className={`${styles.wrapper} ${isDropOver ? styles.wrapperDropOver : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.rulerSpacer} aria-hidden="true" />
      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        {tracks.map((track) => (
          <div key={track.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTop}>
                <span className={styles.colorSwatch} style={{ background: track.color }} />
                <span className={styles.name} title={track.name}>
                  {track.name}
                </span>
                <div className={styles.controls}>
                  <button
                    className={`${styles.iconBtn} ${track.armed ? styles.armed : ''}`}
                    onClick={() => updateTrack(track.id, { armed: !track.armed })}
                    title="Arm for recording"
                    aria-label={`${track.armed ? 'Disarm' : 'Arm'} ${track.name} for recording`}
                  >
                    ⏺
                  </button>
                  <button
                    className={`${styles.iconBtn} ${track.muted ? styles.toggled : ''}`}
                    onClick={() => updateTrack(track.id, { muted: !track.muted })}
                    title="Mute"
                  >
                    M
                  </button>
                  <button
                    className={`${styles.iconBtn} ${track.soloed ? styles.toggled : ''}`}
                    onClick={() => updateTrack(track.id, { soloed: !track.soloed })}
                    title="Solo"
                  >
                    S
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => toggleEffectsDialog(track.id)}
                    title="Track Effects"
                  >
                    FX
                  </button>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeTrack(track.id)}
                    title="Remove track"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.volume}
                onChange={(e) => updateTrack(track.id, { volume: Number(e.target.value) })}
                title={`Volume: ${Math.round(track.volume * 100)}%`}
                className={styles.volume}
                aria-label={`Volume for ${track.name}`}
              />
              <div className={styles.panRow}>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={track.pan}
                  onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) })}
                  title={`Pan: ${formatPan(track.pan)}`}
                  className={styles.pan}
                  aria-label={`Pan for ${track.name}`}
                />
                <span className={styles.panValue}>{formatPan(track.pan)}</span>
              </div>
            </div>
            <TrackMeter trackId={track.id} trackName={track.name} />
          </div>
        ))}
        {tracks.length === 0 && (
          <div className={styles.empty}>
            Drop audio files here · or use &ldquo;+ Track&rdquo;
          </div>
        )}
        <div className={styles.dropHint}>
          {isDropOver ? 'Release to add tracks' : '+ Drop audio files'}
        </div>
      </div>
      {openDialogTrack && (
        <EffectsDialog
          trackId={openDialogTrack.id}
          trackName={openDialogTrack.name}
          onClose={closeEffectsDialog}
          position={dialogPosition}
          onPositionChange={handlePositionChange}
          size={dialogSize}
          onSizeChange={handleSizeChange}
        />
      )}
    </div>
  );
}
