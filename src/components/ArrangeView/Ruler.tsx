import { useState, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import styles from './ArrangeView.module.css';
import { useTransportStore } from '../../store/transportStore';
import { useTrackStore } from '../../store/trackStore';
import { BEATS_PER_BAR } from '../../constants';
import * as engine from '../../audio/engine';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  pixelsPerBeat: number;
  totalBars: number;
}

export default function Ruler({ scrollRef, pixelsPerBeat, totalBars }: Props) {
  const bars = Array.from({ length: totalBars }, (_, i) => i);
  const setPlayheadBeats = useTransportStore((s) => s.setPlayheadBeats);
  const setSelection = useTransportStore((s) => s.setSelection);
  const clearSelection = useTransportStore((s) => s.clearSelection);
  const gridDivisionBeats = useTransportStore((s) => s.gridDivisionBeats);

  // Relocating the playhead used to always pause playback. Instead, if
  // something's already playing, reschedule from the new position so
  // playback carries on uninterrupted; setPlayheadBeats always runs so the
  // UI reflects the new position either way.
  const relocatePlayhead = useCallback((beat: number) => {
    if (useTransportStore.getState().isPlaying) {
      engine.seekDuringPlayback(
        useTrackStore.getState().tracks,
        beat,
        useTransportStore.getState().bpm,
      );
    }
    setPlayheadBeats(beat);
  }, [setPlayheadBeats]);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const initialPlayheadRef = useRef(0);
  const justDraggedRef = useRef(false);
  const hasMovedRef = useRef(false);

  const getBeatFromClientX = useCallback((clientX: number): number => {
    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = clientX - rect.left + scroll.scrollLeft;
    return Math.max(0, contentX / pixelsPerBeat);
  }, [scrollRef, pixelsPerBeat]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const beat = getBeatFromClientX(e.clientX);
    const snappedBeat = Math.round(beat);

    // Start potential drag
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    initialPlayheadRef.current = snappedBeat;  // Remember the clicked position
    hasMovedRef.current = false;  // Reset movement flag

    relocatePlayhead(snappedBeat);

    // Don't create selection yet - wait for actual drag movement

    e.preventDefault();
  }, [getBeatFromClientX, relocatePlayhead]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const currentBeat = getBeatFromClientX(e.clientX);
    const snappedBeat = Math.round(currentBeat);
    const startPos = initialPlayheadRef.current;
    const initialX = dragStartXRef.current;
    const currentX = e.clientX;
    
    // Mark that we've moved - this is now a drag, not just a click
    hasMovedRef.current = true;
    
    // Determine if dragging left or right of the drag start position
    if (currentX < initialX) {
      // Dragging left: start time moves with cursor, end stays at startPos
      const start = Math.min(snappedBeat, startPos);
      const end = startPos;
      setSelection(start, end);
      // Move playhead to the new start (leftmost) position
      setPlayheadBeats(start);
    } else {
      // Dragging right: end time moves with cursor, start stays at startPos
      const start = startPos;
      const end = Math.max(snappedBeat, startPos);
      setSelection(start, end);
      // Keep playhead at the start (leftmost) position
      setPlayheadBeats(start);
    }
    
    e.preventDefault();
  }, [isDragging, getBeatFromClientX, setSelection, setPlayheadBeats]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      const currentBeat = getBeatFromClientX(e.clientX);
      const snappedBeat = Math.round(currentBeat);
      const startPos = initialPlayheadRef.current;
      const initialX = dragStartXRef.current;
      const currentX = e.clientX;
      
      // Only finalize selection if the mouse actually moved
      if (hasMovedRef.current) {
        // Finalize selection based on drag direction
        if (currentX < initialX) {
          const start = Math.min(snappedBeat, startPos);
          setSelection(start, startPos);
          relocatePlayhead(start);
        } else {
          setSelection(startPos, Math.max(snappedBeat, startPos));
          relocatePlayhead(startPos);
        }
        justDraggedRef.current = true;
      }

      setIsDragging(false);
      e.preventDefault();
    }
  }, [isDragging, getBeatFromClientX, setSelection, relocatePlayhead]);

  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      clearSelection();
    }
  }, [isDragging, clearSelection]);

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Skip if this click was part of a drag operation
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    
    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = e.clientX - rect.left + scroll.scrollLeft;
    const rawBeat = contentX / pixelsPerBeat;
    const snappedBeat = Math.max(0, Math.round(rawBeat));
    relocatePlayhead(snappedBeat);
    // Don't create or clear selection on simple click
  }, [scrollRef, pixelsPerBeat, relocatePlayhead]);

  // Compute the width of a bar in pixels
  const barWidth = BEATS_PER_BAR * pixelsPerBeat;

  // Number of subdivisions per beat
  const subdivisionsPerBeat = 1 / gridDivisionBeats;

  return (
    <div 
      className={styles.ruler}
      onClick={handleRulerClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: isDragging ? 'ew-resize' : 'pointer' }}
    >
      {/* Bar labels */}
      {bars.map((bar) => (
        <div 
          key={`bar-label-${bar}`}
          className={styles.rulerCell}
          style={{ left: bar * barWidth }}
        >
          {bar + 1}
        </div>
      ))}

      {/* Beat ticks */}
      {bars.map((bar) => (
        Array.from({ length: BEATS_PER_BAR }, (_, beat) => {
          // Skip the first beat of each bar (it's covered by the bar tick)
          if (beat === 0) return null;
          const left = (bar * BEATS_PER_BAR + beat) * pixelsPerBeat;
          return (
            <div 
              key={`beat-tick-${bar}-${beat}`}
              className={styles.rulerTickBeat}
              style={{ left }}
            />
          );
        })
      ))}

      {/* Subdivision ticks */}
      {bars.map((bar) => (
        Array.from({ length: BEATS_PER_BAR }, (_, beat) => {
          const subTicks = [];
          // Only render subdivision ticks if gridDivisionBeats is finer than a beat
          if (gridDivisionBeats < 1) {
            for (let sub = 1; sub < subdivisionsPerBeat; sub++) {
              const subBeat = beat + sub * gridDivisionBeats;
              const left = (bar * BEATS_PER_BAR + subBeat) * pixelsPerBeat;
              subTicks.push(
                <div 
                  key={`sub-tick-${bar}-${beat}-${sub}`}
                  className={styles.rulerTickSub}
                  style={{ left }}
                />
              );
            }
          }
          return subTicks;
        })
      ))}

      {/* Bar start ticks (tallest) */}
      {bars.map((bar) => (
        <div 
          key={`bar-tick-${bar}`}
          className={styles.rulerTickBar}
          style={{ left: bar * barWidth }}
        />
      ))}
    </div>
  );
}