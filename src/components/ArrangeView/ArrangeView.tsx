import { useState } from 'react';
import type { RefObject } from 'react';
import styles from './ArrangeView.module.css';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import { PIXELS_PER_BEAT, BEATS_PER_BAR, TOTAL_WIDTH } from '../../constants';
import * as engine from '../../audio/engine';
import ClipBlock from './ClipBlock';
import Ruler from './Ruler';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

export default function ArrangeView({ scrollRef, onScroll }: Props) {
  const tracks = useTrackStore((s) => s.tracks);
  const addClip = useTrackStore((s) => s.addClip);
  const moveClip = useTrackStore((s) => s.moveClip);
  const createTracksForClips = useTrackStore((s) => s.createTracksForClips);
  const playheadBeats = useTransportStore((s) => s.playheadBeats);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);

  const handleBelowDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverTrackId('__below__');
  };

  const handleBelowDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverTrackId(null);
    const audioFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.wav'),
    );
    if (audioFiles.length === 0) return;
    // Use x position on the timeline (snapped to bar)
    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = e.clientX - rect.left + scroll.scrollLeft;
    const startBeat = Math.round((contentX / PIXELS_PER_BEAT) / BEATS_PER_BAR) * BEATS_PER_BAR;
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

  const handleEmptyDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverTrackId('__empty__');
  };

  const handleEmptyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverTrackId(null);

    const audioFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.wav'),
    );
    if (audioFiles.length === 0) return;

    // Snap current playhead to nearest bar — this is the shared start for all clips
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

  const handleDragOver = (e: React.DragEvent, trackId: string) => {
    const hasFile = e.dataTransfer.types.includes('Files');
    const hasClip = e.dataTransfer.types.includes('text/x-clip-id');
    if (!hasFile && !hasClip) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasFile ? 'copy' : 'move';
    setDragOverTrackId(trackId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Ignore events that are just the cursor moving into a child element
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverTrackId(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, trackId: string) => {
    e.preventDefault();
    setDragOverTrackId(null);

    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = e.clientX - rect.left + scroll.scrollLeft;

    // ── Internal clip move ──────────────────────────────────────────────────
    const clipId = e.dataTransfer.getData('text/x-clip-id');
    if (clipId) {
      const sourceTrackId = e.dataTransfer.getData('text/x-clip-track-id');
      const beatOffset = parseFloat(e.dataTransfer.getData('text/x-clip-beat-offset') || '0');
      const rawBeat = Math.max(0, contentX / PIXELS_PER_BEAT - beatOffset);
      // Snap to nearest bar
      const newStartBeat = Math.round(rawBeat / BEATS_PER_BAR) * BEATS_PER_BAR;
      moveClip(clipId, sourceTrackId, trackId, newStartBeat);
      return;
    }

    // ── File import ─────────────────────────────────────────────────────────
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.wav')) return;

    // Snap to nearest bar
    const startBeat = Math.round((contentX / PIXELS_PER_BEAT) / BEATS_PER_BAR) * BEATS_PER_BAR;

    void engine.decodeFile(file).then((buffer) => {
      const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      engine.storeBuffer(bufferId, buffer);
      const bpm = useTransportStore.getState().bpm;
      const durationBeats = (buffer.duration * bpm) / 60;
      addClip(trackId, startBeat, durationBeats, file.name.replace(/\.[^.]+$/, ''), bufferId);
    });
  };

  return (
    <div className={styles.outer}>
      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        {/* Content container — full timeline width */}
        <div className={styles.inner} style={{ width: TOTAL_WIDTH }}>

          {/* Ruler: sticky vertically, scrolls horizontally with content */}
          <Ruler scrollRef={scrollRef} />

          {/* Track lanes */}
          <div className={styles.lanes}>
            {/* Playhead */}
            <div
              className={styles.playhead}
              style={{ left: playheadBeats * PIXELS_PER_BEAT }}
            />

            {tracks.map((track, i) => (
              <div
                key={track.id}
                className={`${styles.lane} ${i % 2 === 1 ? styles.laneAlt : ''} ${
                  dragOverTrackId === track.id ? styles.laneDropTarget : ''
                }`}
                onDragOver={(e) => handleDragOver(e, track.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, track.id)}
              >
                {track.clips.map((clip) => (
                  <ClipBlock key={clip.id} clip={clip} />
                ))}
              </div>
            ))}

            {tracks.length === 0 && (
              <div
                className={`${styles.emptyDropZone} ${
                  dragOverTrackId === '__empty__' ? styles.emptyDropZoneOver : ''
                }`}
                onDragOver={handleEmptyDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleEmptyDrop}
              >
                {dragOverTrackId === '__empty__'
                  ? 'Release to create tracks'
                  : 'Drop audio files here to create tracks · or use “+ Track” above'}
              </div>
            )}

            {/* Always-visible drop zone below existing tracks */}
            {tracks.length > 0 && (
              <div
                className={`${styles.addTrackZone} ${
                  dragOverTrackId === '__below__' ? styles.addTrackZoneOver : ''
                }`}
                onDragOver={handleBelowDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleBelowDrop}
              >
                {dragOverTrackId === '__below__' ? 'Release to add track' : '+ Drop audio files to add track'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
