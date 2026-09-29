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

export default function ClipBlock({ clip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelsPerBeat = usePixelsPerBeat();
  const bpm = useTransportStore((s) => s.bpm);
  const trimClip = useTrackStore((s) => s.trimClip);
  
  // State for trimming
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimStartBeat, setTrimStartBeat] = useState(clip.startBeat);
  const [trimBufferOffsetBeats, setTrimBufferOffsetBeats] = useState(clip.bufferOffsetBeats ?? 0);
  const [trimDurationBeats, setTrimDurationBeats] = useState(clip.durationBeats);
  
  // Ref to track the initial pointer position and clip state for the current drag
  const dragStartRef = useRef<{ x: number; startBeat: number; bufferOffsetBeats: number; durationBeats: number } | null>(null);
  
  const width = Math.max(1, Math.round(clip.durationBeats * pixelsPerBeat));

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // Record where within the clip the user grabbed (in beats) so the drop
    // position can be offset correctly.
    const offsetPx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-clip-id', clip.id);
    e.dataTransfer.setData('text/x-clip-track-id', clip.trackId);
    e.dataTransfer.setData('text/x-clip-beat-offset', String(offsetPx / pixelsPerBeat));
  };

  // Get the audio buffer for this clip to compute buffer duration
  function getBufferDurationBeats(): number {
    if (!clip.audioBufferId) return 0;
    const buffer = getBuffer(clip.audioBufferId);
    if (!buffer) return 0;
    return buffer.duration * bpm / 60;
  }

  // Handle pointer down on trim handles
  const handleTrimStart = (e: React.PointerEvent<HTMLDivElement>, isLeftHandle: boolean) => {
    if (!clip.audioBufferId) return;
    
    const clipRect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!clipRect) return;
    
    // Store initial state
    dragStartRef.current = {
      x: e.clientX,
      startBeat: clip.startBeat,
      bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,
      durationBeats: clip.durationBeats,
    };
    
    setIsTrimming(true);
    
    // Capture pointer events
    (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
    
    // Initialize trim state
    setTrimStartBeat(clip.startBeat);
    setTrimBufferOffsetBeats(clip.bufferOffsetBeats ?? 0);
    setTrimDurationBeats(clip.durationBeats);
  };

  // Handle pointer move during trim
  const handleTrimMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTrimming || !dragStartRef.current || !clip.audioBufferId) return;
    
    const deltaPx = e.clientX - dragStartRef.current.x;
    const deltaBeats = deltaPx / pixelsPerBeat;
    
    const bufferDurationBeats = getBufferDurationBeats();
    const initialState = dragStartRef.current;
    
    // Calculate new values based on which handle is being dragged
    // We need to determine which handle based on the cursor position relative to the clip
    const clipRect = e.currentTarget.getBoundingClientRect();
    const handleWidth = 6; // Width of the trim handle
    const isLeftHandle = e.clientX - clipRect.left < handleWidth;
    const isRightHandle = e.clientX - clipRect.right > -handleWidth;
    
    if (isLeftHandle) {
      // Dragging left handle
      const newStartBeat = initialState.startBeat + deltaBeats;
      const newBufferOffset = initialState.bufferOffsetBeats + deltaBeats;
      const newDuration = initialState.durationBeats - deltaBeats;
      
      // Clamp buffer offset to >= 0
      const clampedBufferOffset = Math.max(0, newBufferOffset);
      // Adjust startBeat to maintain the relationship: startBeat + bufferOffset should be constant during left trim
      const startBeatAdjustment = newBufferOffset - clampedBufferOffset;
      const clampedStartBeat = newStartBeat - startBeatAdjustment;
      
      // Clamp duration to minimum
      const clampedDuration = Math.max(MIN_CLIP_BEATS, newDuration);
      
      // If we hit the minimum duration, adjust the start position
      const finalStartBeat = clampedDuration === MIN_CLIP_BEATS 
        ? initialState.startBeat + (initialState.durationBeats - MIN_CLIP_BEATS)
        : clampedStartBeat;
      const finalBufferOffset = clampedDuration === MIN_CLIP_BEATS
        ? initialState.bufferOffsetBeats + (initialState.durationBeats - MIN_CLIP_BEATS)
        : clampedBufferOffset;
      const finalDuration = clampedDuration;
      
      setTrimStartBeat(finalStartBeat);
      setTrimBufferOffsetBeats(finalBufferOffset);
      setTrimDurationBeats(finalDuration);
    } else if (isRightHandle) {
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
      className={styles.clip}
      style={{ left: effectiveStartBeat * pixelsPerBeat, width: effectiveWidth, background: clip.color }}
      draggable={!isTrimming}
      onDragStart={isTrimming ? undefined : handleDragStart}
      onPointerMove={isTrimming ? handleTrimMove : undefined}
      onPointerUp={isTrimming ? handleTrimEnd : undefined}
      onPointerLeave={isTrimming ? handleTrimEnd : undefined}
    >
      {/* Left trim handle */}
      <div
        className={styles.trimHandleL}
        onPointerDown={(e) => handleTrimStart(e, true)}
      />
      
      {/* Right trim handle */}
      <div
        className={styles.trimHandleR}
        onPointerDown={(e) => handleTrimStart(e, false)}
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
