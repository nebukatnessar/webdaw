import { useEffect, useRef } from 'react';
import type { Clip } from '../../types/daw';
import { getBuffer } from '../../audio/engine';
import { usePixelsPerBeat } from '../../store/transportStore';
import { useTransportStore } from '../../store/transportStore';
import styles from './ClipBlock.module.css';

interface Props {
  clip: Clip;
}

export default function ClipBlock({ clip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelsPerBeat = usePixelsPerBeat();
  const bpm = useTransportStore((s) => s.bpm);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !clip.audioBufferId) return;
    const buffer = getBuffer(clip.audioBufferId);
    if (!buffer) return;
    drawWaveform(canvas, buffer, clip, bpm);
  }, [clip.audioBufferId, width, clip.bufferOffsetBeats, clip.durationBeats, bpm]);

  return (
    <div
      className={styles.clip}
      style={{ left: clip.startBeat * pixelsPerBeat, width, background: clip.color }}
      draggable
      onDragStart={handleDragStart}
    >
      <span className={styles.name}>{clip.name}</span>
      <canvas ref={canvasRef} className={styles.canvas} width={width} height={40} />
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
