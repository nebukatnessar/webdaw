import { useEffect, useRef, useState } from 'react';
import type { Clip } from '../../types/daw';
import { getBuffer } from '../../audio/engine';
import { usePixelsPerBeat } from '../../store/transportStore';
import { useTransportStore } from '../../store/transportStore';
import { useTrackStore } from '../../store/trackStore';
import styles from './ClipBlock.module.css';

interface Props {
  clip: Clip;
}

// Minimum clip length in beats (matches the constant in trackStore.ts)
const MIN_CLIP_BEATS = 0.05;

// Drag threshold in pixels to distinguish between click and drag
const DRAG_THRESHOLD = 4;

export default function ClipBlock({ clip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelsPerBeat = usePixelsPerBeat();
  const bpm = useTransportStore((s) => s.bpm);
  const trimClip = useTrackStore((s) => s.trimClip);
  const selectClip = useTrackStore((s) => s.selectClip);
  const selectedClipIds = useTrackStore((s) => s.selectedClipIds);
  
  // State for trimming
  const [isTrimming, setIsTrimming] = useState(false);
  const [isTrimmingLeft, setIsTrimmingLeft] = useState(false);
  const [isTrimmingRight, setIsTrimmingRight] = useState(false);
  const [trimStartBeat, setTrimStartBeat] = useState(clip.startBeat);
  const [trimBufferOffsetBeats, setTrimBufferOffsetBeats] = useState(clip.bufferOffsetBeats ?? 0);
  const [trimDurationBeats, setTrimDurationBeats] = useState(clip.durationBeats);
  
  // Ref to track the initial pointer position and clip state for the current drag
  const dragStartRef = useRef<{ x: number; y: number; startBeat: number; bufferOffsetBeats: number; durationBeats: number } | null>(null);
  
  // Ref to track if the current interaction is a drag (exceeded threshold)
  const isDraggingRef = useRef(false);

  const width = Math.max(1, Math.round(clip.durationBeats * pixelsPerBeat));
  console.log(`clip width: ${width}`);
  const isSelected = selectedClipIds.includes(clip.id);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // Record where within the clip the user grabbed (in beats) so the drop
    // position can be offset correctly.
    const offsetPx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-clip-id', clip.id);
    e.dataTransfer.setData('text/x-clip-track-id', clip.trackId);
    e.dataTransfer.setData('text/x-clip-beat-offset', String(offsetPx / pixelsPerBeat));
  };

  // Handle pointer down for selection and drag
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isTrimming) return;
    
    // Store initial pointer position
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startBeat: clip.startBeat,
      bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
      durationBeats: clip.durationBeats,
    };
    isDraggingRef.current = false;
    
    // Capture pointer events on the clip element
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    
    e.stopPropagation();
  };

  // Handle pointer move to detect drag threshold
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || isTrimming) return;
    
    const dx = Math.abs(e.clientX - dragStartRef.current.x);
    const dy = Math.abs(e.clientY - dragStartRef.current.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // If we exceed the drag threshold, mark as dragging
    if (distance > DRAG_THRESHOLD) {
      isDraggingRef.current = true;
    }
  };

  // Handle pointer up for selection
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isTrimming) return;
    
    // Only handle selection if we didn't drag
    if (!isDraggingRef.current && dragStartRef.current) {
      // Check if this is a shift+click for additive selection
      const additive = e.shiftKey;
      selectClip(clip.id, additive);
    }
    
    // Reset state
    dragStartRef.current = null;
    isDraggingRef.current = false;
    
    // Release pointer capture
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
    e.stopPropagation();
  };

  // Get the audio buffer for this clip to compute buffer duration
  function getBufferDurationBeats(): number {
    if (!clip.audioBufferId) return 0;
    const buffer = getBuffer(clip.audioBufferId);
    if (!buffer) return 0;
    return buffer.duration * bpm / 60;
  }

  // Handle pointer down on trim handles
  const handleTrimStartLeft = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!clip.audioBufferId) return;
    
    const clipElement = e.currentTarget.parentElement;
    if (!clipElement) return;
    
    // Store initial state
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startBeat: clip.startBeat,
      bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
      durationBeats: clip.durationBeats,
    };
    
    setIsTrimming(true);
    setIsTrimmingLeft(true);
    setIsTrimmingRight(false);
    
    // Capture pointer events on the clip element
    (clipElement as HTMLElement).setPointerCapture(e.pointerId);
    
    // Initialize trim state
    setTrimStartBeat(clip.startBeat);
    setTrimBufferOffsetBeats(clip.bufferOffsetBeats ?? 0);
    setTrimDurationBeats(clip.durationBeats);
    
    e.stopPropagation();
  };

  const handleTrimStartRight = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!clip.audioBufferId) return;
    
    const clipElement = e.currentTarget.parentElement;
    if (!clipElement) return;
    
    // Store initial state
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startBeat: clip.startBeat,
      bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
      durationBeats: clip.durationBeats,
    };
    
    setIsTrimming(true);
    setIsTrimmingLeft(false);
    setIsTrimmingRight(true);
    
    // Capture pointer events on the clip element
    (clipElement as HTMLElement).setPointerCapture(e.pointerId);
    
    // Initialize trim state
    setTrimStartBeat(clip.startBeat);
    setTrimBufferOffsetBeats(clip.bufferOffsetBeats ?? 0);
    setTrimDurationBeats(clip.durationBeats);
    
    e.stopPropagation();
  };

  // Handle pointer move during trim
  const handleTrimMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTrimming || !dragStartRef.current || !clip.audioBufferId) return;
    
    const deltaPx = e.clientX - dragStartRef.current.x;
    const deltaBeats = deltaPx / pixelsPerBeat;
    
    const bufferDurationBeats = getBufferDurationBeats();
    const initialState = dragStartRef.current;
    
    if (isTrimmingLeft) {
      // Dragging left handle
      const newBufferOffset = initialState.bufferOffsetBeats + deltaBeats;
      const newStartBeat = initialState.startBeat + deltaBeats;
      const newDuration = initialState.durationBeats - deltaBeats;
      
      // Clamp buffer offset to >= 0
      const clampedBufferOffset = Math.max(0, newBufferOffset);
      
      // If buffer offset is clamped, adjust startBeat to maintain the clip's visual position
      const bufferOffsetDelta = newBufferOffset - clampedBufferOffset;
      const clampedStartBeat = newStartBeat - bufferOffsetDelta;
      
      // Clamp duration to minimum
      const clampedDuration = Math.max(MIN_CLIP_BEATS, newDuration);
      
      // If we hit the minimum duration, don't allow further shrinking
      const finalBufferOffset = clampedDuration === MIN_CLIP_BEATS && newDuration < MIN_CLIP_BEATS
        ? initialState.bufferOffsetBeats + (initialState.durationBeats - MIN_CLIP_BEATS)
        : clampedBufferOffset;
      const finalStartBeat = clampedDuration === MIN_CLIP_BEATS && newDuration < MIN_CLIP_BEATS
        ? initialState.startBeat + (initialState.durationBeats - MIN_CLIP_BEATS)
        : clampedStartBeat;
      const finalDuration = Math.max(MIN_CLIP_BEATS, clampedDuration);
      
      setTrimStartBeat(finalStartBeat);
      setTrimBufferOffsetBeats(finalBufferOffset);
      setTrimDurationBeats(finalDuration);
    } else if (isTrimmingRight) {
      // Dragging right handle
      const newDuration = initialState.durationBeats + deltaBeats;
      
      // Clamp so the window doesn't extend past the buffer end
      const maxDuration = bufferDurationBeats - (initialState.bufferOffsetBeats ?? 0);
      const clampedDuration = Math.min(maxDuration, Math.max(MIN_CLIP_BEATS, newDuration));
      
      setTrimDurationBeats(clampedDuration);
    }
  };

  // Handle pointer up during trim
  const handleTrimEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTrimming || !dragStartRef.current) return;
    
    // Check if there was actually a change
    const noChange = (
      trimStartBeat === clip.startBeat &&
      trimBufferOffsetBeats === (clip.bufferOffsetBeats ?? 0) &&
      trimDurationBeats === clip.durationBeats
    );
    
    if (!noChange) {
      // Apply the trim
      trimClip(clip.id, {
        startBeat: trimStartBeat,
        bufferOffsetBeats: trimBufferOffsetBeats,
        durationBeats: trimDurationBeats,
      });
    }
    
    // Reset state
    setIsTrimming(false);
    setIsTrimmingLeft(false);
    setIsTrimmingRight(false);
    dragStartRef.current = null;
    
    // Release pointer capture
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // Compute the effective clip properties for rendering (either the original or the trim-in-progress)
  const effectiveStartBeat = isTrimming ? trimStartBeat : clip.startBeat;
  const effectiveBufferOffsetBeats = isTrimming ? trimBufferOffsetBeats : (clip.bufferOffsetBeats ?? 0);
  const effectiveDurationBeats = isTrimming ? trimDurationBeats : clip.durationBeats;
  const effectiveWidth = Math.max(1, Math.round(effectiveDurationBeats * pixelsPerBeat));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !clip.audioBufferId) return;
    const buffer = getBuffer(clip.audioBufferId);
    if (!buffer) return;
    
    // Create a temporary clip object with the effective values for drawing
    const effectiveClip: Clip = {
      ...clip,
      startBeat: effectiveStartBeat,
      bufferOffsetBeats: effectiveBufferOffsetBeats,
      durationBeats: effectiveDurationBeats,
    };
    
    drawWaveform(canvas, buffer, effectiveClip, bpm);
  }, [clip.audioBufferId, effectiveWidth, effectiveBufferOffsetBeats, effectiveDurationBeats, bpm, isTrimming]);

  return (
    <div
      className={`${styles.clip} ${isSelected ? styles.selected : ''}`}
      style={{ left: effectiveStartBeat * pixelsPerBeat, width: effectiveWidth, background: clip.color }}
      draggable={!isTrimming}
      onDragStart={isTrimming ? undefined : handleDragStart}
      onPointerDown={handlePointerDown}
      onPointerMove={isTrimming ? handleTrimMove : handlePointerMove}
      onPointerUp={isTrimming ? handleTrimEnd : handlePointerUp}
      onPointerLeave={isTrimming ? handleTrimEnd : undefined}
    >
      {/* Left trim handle */}
      <div
        className={styles.trimHandleL}
        onPointerDown={handleTrimStartLeft}
      />
      
      {/* Right trim handle */}
      <div
        className={styles.trimHandleR}
        onPointerDown={handleTrimStartRight}
      />
      
      <span className={styles.name}>{clip.name}</span>
      <canvas ref={canvasRef} className={styles.canvas} width={effectiveWidth} height={40} />
    </div>
  );
}

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer, clip: Clip, bpm: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;
  const sampleRate = buffer.sampleRate;

  // Calculate the sample range for this clip's window
  const beatsToSamples = (beats: number) => beats * (sampleRate * 60) / bpm;
  const bufferOffsetSamples = beatsToSamples(clip.bufferOffsetBeats ?? 0);
  const clipDurationSamples = beatsToSamples(clip.durationBeats);
  const sampleStart = Math.floor(bufferOffsetSamples);
  const sampleEnd = Math.min(totalSamples, Math.floor(bufferOffsetSamples + clipDurationSamples));
  const clipSampleLength = sampleEnd - sampleStart;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';

  const mid = height / 2;
  for (let x = 0; x < width; x++) {
    // Map canvas x position to sample range
    const samplePosStart = sampleStart + Math.floor((x / width) * clipSampleLength);
    const samplePosEnd = sampleStart + Math.floor(((x + 1) / width) * clipSampleLength);
    
    let minVal = 0;
    let maxVal = 0;
    for (let s = samplePosStart; s < samplePosEnd && s < totalSamples; s++) {
      const v = channelData[s] ?? 0;
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
    const yTop = mid * (1 - maxVal);
    const yBot = mid * (1 - minVal);
    ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
  }
}
