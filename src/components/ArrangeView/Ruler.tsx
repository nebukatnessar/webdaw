import { useState, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import styles from './ArrangeView.module.css';
import { useTransportStore } from '../../store/transportStore';
import { BEATS_PER_BAR, TOTAL_BARS } from '../../constants';
import * as engine from '../../audio/engine';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  pixelsPerBeat: number;
}

export default function Ruler({ scrollRef, pixelsPerBeat }: Props) {
  const bars = Array.from({ length: TOTAL_BARS }, (_, i) => i);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const setPlayheadBeats = useTransportStore((s) => s.setPlayheadBeats);
  const setSelection = useTransportStore((s) => s.setSelection);
  const clearSelection = useTransportStore((s) => s.clearSelection);
  const pause = useTransportStore((s) => s.pause);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const initialPlayheadRef = useRef(0);
  const justDraggedRef = useRef(false);

  const getBeatFromClientX = useCallback((clientX: number): number => {
    const scroll = scrollRef.current!;
    const rect = scroll.getBoundingClientRect();
    const contentX = clientX - rect.left + scroll.scrollLeft;
    return Math.max(0, contentX / pixelsPerBeat);
  }, [scrollRef, pixelsPerBeat]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const beat = getBeatFromClientX(e.clientX);
    const snappedBeat = Math.round(beat);
    
    if (isPlaying) {
      engine.stopAllSources();
      pause();
    }
    
    // Start dragging for selection
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    initialPlayheadRef.current = snappedBeat;  // Remember the clicked position
    
    // Don't create selection yet - wait for actual drag movement
    // Don't move playhead yet - wait to see if it's a drag or click
    
    e.preventDefault();
  }, [isPlaying, pause, getBeatFromClientX]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const currentBeat = getBeatFromClientX(e.clientX);
    const snappedBeat = Math.round(currentBeat);
    const startPos = initialPlayheadRef.current;
    const initialX = dragStartXRef.current;
    const currentX = e.clientX;
    
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
      
      // Finalize selection based on drag direction
      if (currentX < initialX) {
        const start = Math.min(snappedBeat, startPos);
        setSelection(start, startPos);
        setPlayheadBeats(start);
      } else {
        setSelection(startPos, Math.max(snappedBeat, startPos));
        setPlayheadBeats(startPos);
      }
      
      justDraggedRef.current = true;
      setIsDragging(false);
      e.preventDefault();
    }
  }, [isDragging, getBeatFromClientX, setSelection, setPlayheadBeats]);

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
    if (isPlaying) {
      engine.stopAllSources();
      pause();
    }
    setPlayheadBeats(snappedBeat);
    // Don't create or clear selection on simple click
  }, [scrollRef, pixelsPerBeat, isPlaying, pause, setPlayheadBeats]);

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
      {bars.map((bar) => (
        <div
          key={bar}
          className={styles.rulerCell}
          style={{ left: bar * BEATS_PER_BAR * pixelsPerBeat }}
        >
          {bar + 1}
        </div>
      ))}
    </div>
  );
}
