import { useState } from 'react';
import type { RefObject } from 'react';
import styles from './TrackHeaderList.module.css';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';
import { BEATS_PER_BAR } from '../../constants';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

export default function TrackHeaderList({ scrollRef, onScroll }: Props) {
  const { tracks, updateTrack, removeTrack } = useTrackStore();
  const createTracksForClips = useTrackStore((s) => s.createTracksForClips);
  const [isDropOver, setIsDropOver] = useState(false);

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
            <div className={styles.rowTop}>
              <span className={styles.colorSwatch} style={{ background: track.color }} />
              <span className={styles.name} title={track.name}>
                {track.name}
              </span>
              <div className={styles.controls}>
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
    </div>
  );
}
