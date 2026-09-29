import { useState, useCallback, useEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import styles from './ArrangeView.module.css';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore, usePixelsPerBeat } from '../../store/transportStore';
import { BEATS_PER_BAR, MIN_TOTAL_BARS, TIMELINE_MARGIN_BARS } from '../../constants';
import * as engine from '../../audio/engine';
import ClipBlock from './ClipBlock';
import Ruler from './Ruler';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

// How close (in px) the playhead can get to the visible edge before the
// arrange view auto-scrolls to keep it in view during playback.
const AUTO_SCROLL_MARGIN = 60;

export default function ArrangeView({ scrollRef, onScroll }: Props) {
  const tracks = useTrackStore((s) => s.tracks);
  const addClip = useTrackStore((s) => s.addClip);
  const moveClip = useTrackStore((s) => s.moveClip);
  const createTracksForClips = useTrackStore((s) => s.createTracksForClips);
  const playheadBeats = useTransportStore((s) => s.playheadBeats);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const isSnapEnabled = useTransportStore((s) => s.isSnapEnabled);
  const gridDivisionBeats = useTransportStore((s) => s.gridDivisionBeats);
  const pixelsPerBeat = usePixelsPerBeat();
  const setZoomLevel = useTransportStore((s) => s.setZoomLevel);
  const selectionStart = useTransportStore((s) => s.selectionStart);
  const selectionEnd = useTransportStore((s) => s.selectionEnd);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);

  // Timeline length grows to fit the furthest clip instead of truncating at
  // a fixed bar count - short/empty projects still get a sane minimum.
  const totalBars = useMemo(() => {
    const furthestBeat = tracks.reduce((max, track) => {
      const trackMax = track.clips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0);
      return Math.max(max, trackMax);
    }, 0);
    const neededBars = Math.ceil(furthestBeat / BEATS_PER_BAR) + TIMELINE_MARGIN_BARS;
    return Math.max(MIN_TOTAL_BARS, neededBars);
  }, [tracks]);
  const totalWidth = totalBars * BEATS_PER_BAR * pixelsPerBeat;

  // Auto-scroll to keep the playhead in view while playing, without
  // fighting a manual scroll: only nudge scrollLeft once the playhead
  // actually nears/exceeds the visible edge, rather than recentering it.
  useEffect(() => {
    if (!isPlaying) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const playheadX = playheadBeats * pixelsPerBeat;
    const viewLeft = scroll.scrollLeft;
    const viewRight = viewLeft + scroll.clientWidth;

    if (playheadX > viewRight - AUTO_SCROLL_MARGIN) {
      scroll.scrollLeft = playheadX - AUTO_SCROLL_MARGIN;
    } else if (playheadX < viewLeft) {
      scroll.scrollLeft = playheadX;
    }
  }, [isPlaying, playheadBeats, pixelsPerBeat, scrollRef]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.altKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1; // Scroll down = zoom out, scroll up = zoom in
      const newZoom = useTransportStore.getState().zoomLevel * delta;
      setZoomLevel(newZoom);
    }
  }, [setZoomLevel]);

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
    // Use x position on the timeline
    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = e.clientX - rect.left + scroll.scrollLeft;
    let startBeat = contentX / pixelsPerBeat;
    
    // Apply snapping if enabled
    if (isSnapEnabled) {
      startBeat = Math.round(startBeat / gridDivisionBeats) * gridDivisionBeats;
    }
    
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

    // Snap current playhead to nearest grid division if snap is enabled
    let startBeat = playheadBeats;
    if (isSnapEnabled) {
      startBeat = Math.round(startBeat / gridDivisionBeats) * gridDivisionBeats;
    }

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
      let rawBeat = Math.max(0, contentX / pixelsPerBeat - beatOffset);
      
      // Apply snapping if enabled
      if (isSnapEnabled) {
        rawBeat = Math.round(rawBeat / gridDivisionBeats) * gridDivisionBeats;
      }
      
      moveClip(clipId, sourceTrackId, trackId, rawBeat);
      return;
    }

    // ── File import ─────────────────────────────────────────────────────────
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.wav')) return;

    // Apply snapping if enabled
    let startBeat = contentX / pixelsPerBeat;
    if (isSnapEnabled) {
      startBeat = Math.round(startBeat / gridDivisionBeats) * gridDivisionBeats;
    }

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
        <div className={styles.inner} style={{ width: totalWidth }} onWheel={handleWheel}>

          {/* Ruler: sticky vertically, scrolls horizontally with content */}
          <Ruler pixelsPerBeat={pixelsPerBeat} scrollRef={scrollRef} totalBars={totalBars} />

          {/* Time selection overlay */}
          {selectionStart !== null && selectionEnd !== null && (
            <div
              className={styles.selectionOverlay}
              style={{
                left: selectionStart * pixelsPerBeat,
                width: (selectionEnd - selectionStart) * pixelsPerBeat,
              }}
            />
          )}

          {/* Track lanes */}
          <div className={styles.lanes}>
            {/* Playhead */}
            <div
              className={styles.playhead}
              style={{ left: playheadBeats * pixelsPerBeat }}
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
                  : 'Drop audio files here to create tracks · or use "+ Track" above'}
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
