import { useEffect, useRef, useState } from 'react';
import type { Clip, FadeType } from '../../types/daw';
import { getBuffer } from '../../audio/engine';
import { fadeCurveValueAt } from '../../audio/clip';
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
  const slipClip = useTrackStore((s) => s.slipClip);
  const setClipFadeIn = useTrackStore((s) => s.setClipFadeIn);
  const setClipFadeOut = useTrackStore((s) => s.setClipFadeOut);
  const setClipFadeType = useTrackStore((s) => s.setClipFadeType);
  const selectClip = useTrackStore((s) => s.selectClip);
  const selectedClipIds = useTrackStore((s) => s.selectedClipIds);
  
  // State for trimming
  const [isTrimming, setIsTrimming] = useState(false);
  const [isSlipping, setIsSlipping] = useState(false);
  const [slipBufferOffsetBeats, setSlipBufferOffsetBeats] = useState(clip.bufferOffsetBeats ?? 0);
  
  // State for fade-handle drags (mirrors the trim flow: local values while
  // dragging, committed to the store once on pointer up)
  const [isFading, setIsFading] = useState(false);
  const [isFadingIn, setIsFadingIn] = useState(false);
  const [fadeDragValue, setFadeDragValue] = useState(0);
  const [isTrimmingLeft, setIsTrimmingLeft] = useState(false);
  const [isTrimmingRight, setIsTrimmingRight] = useState(false);
  const [trimStartBeat, setTrimStartBeat] = useState(clip.startBeat);
  const [trimBufferOffsetBeats, setTrimBufferOffsetBeats] = useState(clip.bufferOffsetBeats ?? 0);
  const [trimDurationBeats, setTrimDurationBeats] = useState(clip.durationBeats);
  
  // Ref to track the initial pointer position and clip state for the current drag
  const dragStartRef = useRef<{ x: number; y: number; startBeat: number; bufferOffsetBeats: number; durationBeats: number } | null>(null);
  
  // Ref to track if the current interaction is a drag (exceeded threshold)
  const isDraggingRef = useRef(false);
  
  // Ref for the fade drag: the clip's on-screen position, so the pointer
  // maps directly onto the fade length instead of accumulating deltas
  const fadeDragRef = useRef<{ leftPx: number; widthPx: number } | null>(null);

  const isSelected = selectedClipIds.includes(clip.id);

  // Gain badge value in dB relative to unity; hidden when at 0 dB
  const clipGainDb = Math.round(20 * Math.log10(clip.clipGain ?? 1));

  // Active fade curve shapes (shown in the fade handle tooltips)
  const fadeInCurve: FadeType = clip.fadeInType ?? 'exponential';
  const fadeOutCurve: FadeType = clip.fadeOutType ?? 'exponential';

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
    if (isTrimming || isFading) return;
    
    // Check if Alt key is pressed to enter slip mode
    if (e.altKey) {
      // Store initial pointer position and buffer offset
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startBeat: clip.startBeat,
        bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
        durationBeats: clip.durationBeats,
      };
      setIsSlipping(true);
      isDraggingRef.current = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
      return;
    }
    
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
    if (isTrimming || isFading || isSlipping) {
      if (isSlipping) {
        handleSlipMove(e);
      }
      return;
    }
    
    if (!dragStartRef.current) return;
    
    const dx = Math.abs(e.clientX - dragStartRef.current.x);
    const dy = Math.abs(e.clientY - dragStartRef.current.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // If we exceed the drag threshold, mark as dragging
    if (distance > DRAG_THRESHOLD) {
      isDraggingRef.current = true;
    }
  };
  
  // Handle slip move
  const handleSlipMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSlipping || !dragStartRef.current) return;
    
    const deltaPx = e.clientX - dragStartRef.current.x;
    const deltaBeats = deltaPx / pixelsPerBeat;
    
    // Calculate new buffer offset
    const newBufferOffset = dragStartRef.current.bufferOffsetBeats - deltaBeats;
    
    // Clamp to >= 0
    const clampedBufferOffset = Math.max(0, newBufferOffset);
    
    // Update local preview
    setSlipBufferOffsetBeats(clampedBufferOffset);
  };

  // Handle pointer up for selection
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isTrimming) return;
    if (isSlipping) {
      handleSlipEnd(e);
      return;
    }
    
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
  
  // Handle slip end
  const handleSlipEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSlipping || !dragStartRef.current) return;
    
    // Commit the slip to the store
    const newBufferOffset = Math.round(slipBufferOffsetBeats * 1000) / 1000;
    const originalBufferOffset = clip.bufferOffsetBeats ?? 0;
    
    if (newBufferOffset !== originalBufferOffset) {
      slipClip(clip.trackId, clip.id, newBufferOffset);
    }
    
    // Reset state
    setIsSlipping(false);
    dragStartRef.current = null;
    
    // Release pointer capture
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
    e.stopPropagation();
  };

  // Handle pointer down on a fade handle (fade-in left, fade-out right).
  // The handle rides the end of the fade line, so the drag positions the
  // fade tip directly under the pointer.
  const handleFadeStart = (e: React.PointerEvent<HTMLDivElement>, edge: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    const clipElement = e.currentTarget.parentElement;
    if (!clipElement) return;
    const rect = clipElement.getBoundingClientRect();
    fadeDragRef.current = { leftPx: rect.left, widthPx: rect.width };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsFadingIn(edge === 'in');
    setFadeDragValue(edge === 'in' ? (clip.fadeInDuration ?? 0) : (clip.fadeOutDuration ?? 0));
    setIsFading(true);
  };

  const handleFadeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isFading || !fadeDragRef.current) return;
    const xPx = e.clientX - fadeDragRef.current.leftPx;
    const raw = isFadingIn
      ? xPx / pixelsPerBeat
      : (fadeDragRef.current.widthPx - xPx) / pixelsPerBeat;
    setFadeDragValue(Math.max(0, Math.min(raw, clip.durationBeats)));
  };

  const handleFadeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isFading) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const value = Math.round(fadeDragValue * 1000) / 1000;
    const original = isFadingIn ? (clip.fadeInDuration ?? 0) : (clip.fadeOutDuration ?? 0);
    if (value !== original) {
      if (isFadingIn) setClipFadeIn(clip.id, value);
      else setClipFadeOut(clip.id, value);
    }
    fadeDragRef.current = null;
    setIsFading(false);
  };

  // Effective fade values (the dragged value during a fade drag)
  const effectiveFadeIn = isFading && isFadingIn ? fadeDragValue : (clip.fadeInDuration ?? 0);
  const effectiveFadeOut = isFading && !isFadingIn ? fadeDragValue : (clip.fadeOutDuration ?? 0);

  // Double-clicking a fade handle cycles that edge's fade curve shape:
  // exponential (default) -> logarithmic (mirrored) -> linear.
  const handleFadeTypeCycle = (e: React.MouseEvent, edge: 'in' | 'out') => {
    e.stopPropagation();
    const order: FadeType[] = ['exponential', 'logarithmic', 'linear'];
    const current = edge === 'in' ? fadeInCurve : fadeOutCurve;
    const next = order[(order.indexOf(current) + 1) % order.length] ?? 'exponential';
    setClipFadeType(clip.id, edge, next);
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

  // Compute the effective clip properties for rendering (either the original or the trim/slip-in-progress)
  const effectiveStartBeat = isTrimming ? trimStartBeat : clip.startBeat;
  const effectiveBufferOffsetBeats = isSlipping ? slipBufferOffsetBeats : (isTrimming ? trimBufferOffsetBeats : (clip.bufferOffsetBeats ?? 0));
  const effectiveDurationBeats = isTrimming ? trimDurationBeats : clip.durationBeats;
  const effectiveWidth = Math.max(1, Math.round(effectiveDurationBeats * pixelsPerBeat));

  // Fade handle positions: each handle rides the end of its fade line, so
  // once a fade is set its tip becomes the pickup point (the clip corner
  // when no fade is set).
  const fadeInPx = effectiveDurationBeats > 0 ? (effectiveFadeIn / effectiveDurationBeats) * effectiveWidth : 0;
  const fadeOutPx = effectiveDurationBeats > 0 ? (effectiveFadeOut / effectiveDurationBeats) * effectiveWidth : 0;

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
      fadeInDuration: effectiveFadeIn,
      fadeOutDuration: effectiveFadeOut,
    };
    
    drawWaveform(canvas, buffer, effectiveClip, bpm);
  }, [clip.audioBufferId, clip.clipGain, clip.fadeInType, clip.fadeOutType, effectiveFadeIn, effectiveFadeOut, effectiveWidth, effectiveBufferOffsetBeats, effectiveDurationBeats, bpm, isTrimming, isSlipping]);

  return (
    <div
      className={`${styles.clip} ${isSelected ? styles.selected : ''} ${clip.muted ? styles.muted : ''}`} data-clip
      style={{ 
        left: effectiveStartBeat * pixelsPerBeat, 
        width: effectiveWidth, 
        background: clip.color,
        cursor: isSlipping ? 'ew-resize' : undefined
      }}
      draggable={!isTrimming && !isFading && !isSlipping}
      onDragStart={isTrimming || isFading || isSlipping ? undefined : handleDragStart}
      onPointerDown={handlePointerDown}
      onPointerMove={isTrimming ? handleTrimMove : isSlipping ? handleSlipMove : handlePointerMove}
      onPointerUp={isTrimming ? handleTrimEnd : isSlipping ? handleSlipEnd : handlePointerUp}
      onPointerLeave={isTrimming ? handleTrimEnd : isSlipping ? handleSlipEnd : undefined}
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
      
      {/* Fade handles: ride the end of each fade (the corner when unset) */}
      <div
        className={`${styles.fadeHandle} ${effectiveFadeIn > 0 ? styles.fadeVisible : ''}`}
        style={{ left: fadeInPx }}
        onPointerDown={(e) => handleFadeStart(e, 'in')}
        onPointerMove={handleFadeMove}
        onPointerUp={handleFadeEnd}
        onDoubleClick={(e) => handleFadeTypeCycle(e, 'in')}
        title={`Fade in (${fadeInCurve}) - double-click to change shape`}
      />
      <div
        className={`${styles.fadeHandle} ${effectiveFadeOut > 0 ? styles.fadeVisible : ''}`}
        style={{ left: effectiveWidth - fadeOutPx }}
        onPointerDown={(e) => handleFadeStart(e, 'out')}
        onPointerMove={handleFadeMove}
        onPointerUp={handleFadeEnd}
        onDoubleClick={(e) => handleFadeTypeCycle(e, 'out')}
        title={`Fade out (${fadeOutCurve}) - double-click to change shape`}
      />
      
      <span className={styles.name}>{clip.name}</span>
      <canvas ref={canvasRef} className={styles.canvas} width={effectiveWidth} height={40} />
      {clip.clipGain !== undefined && clipGainDb !== 0 && (
        <span className={styles.gainBadge}>
          {clipGainDb > 0 ? '+' + clipGainDb + 'dB' : clipGainDb + 'dB'}
        </span>
      )}
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
  // Scale the drawn amplitude by the clip's gain so louder clips read louder;
  // the canvas clips anything scaled past its bounds.
  const gain = clip.clipGain ?? 1;
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
    const yTop = mid * (1 - maxVal * gain);
    const yBot = mid * (1 - minVal * gain);
    ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
  }

  // Fade overlays: the shaded region under the fade curve plus the curve
  // line itself, drawn with the same shape the audio envelope plays.
  const fadeInBeats = Math.min(clip.fadeInDuration ?? 0, clip.durationBeats);
  const fadeOutBeats = Math.min(clip.fadeOutDuration ?? 0, clip.durationBeats);
  const fadeInCurve: FadeType = clip.fadeInType ?? 'exponential';
  const fadeOutCurve: FadeType = clip.fadeOutType ?? 'exponential';
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  if (fadeInBeats > 0 && clip.durationBeats > 0) {
    const fadeWidth = Math.max(1, (fadeInBeats / clip.durationBeats) * width);
    const points: [number, number][] = [];
    for (let x = 0; x <= fadeWidth; x++) {
      const v = fadeCurveValueAt(fadeInCurve, 'in', x / fadeWidth);
      points.push([x, height * (1 - v)]);
    }
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.stroke();
  }
  if (fadeOutBeats > 0 && clip.durationBeats > 0) {
    const fadeWidth = Math.max(1, (fadeOutBeats / clip.durationBeats) * width);
    const points: [number, number][] = [];
    for (let i = 0; i <= fadeWidth; i++) {
      const v = fadeCurveValueAt(fadeOutCurve, 'out', i / fadeWidth);
      points.push([width - fadeWidth + i, height * (1 - v)]);
    }
    ctx.beginPath();
    ctx.moveTo(width - fadeWidth, 0);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(width, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.stroke();
  }
}