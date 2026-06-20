import { useEffect, useRef } from 'react';
import type { Clip } from '../../types/daw';
import { getBuffer } from '../../audio/engine';
import { PIXELS_PER_BEAT } from '../../constants';
import styles from './ClipBlock.module.css';

interface Props {
  clip: Clip;
}

export default function ClipBlock({ clip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round(clip.durationBeats * PIXELS_PER_BEAT));

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // Record where within the clip the user grabbed (in beats) so the drop
    // position can be offset correctly.
    const offsetPx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-clip-id', clip.id);
    e.dataTransfer.setData('text/x-clip-track-id', clip.trackId);
    e.dataTransfer.setData('text/x-clip-beat-offset', String(offsetPx / PIXELS_PER_BEAT));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !clip.audioBufferId) return;
    const buffer = getBuffer(clip.audioBufferId);
    if (!buffer) return;
    drawWaveform(canvas, buffer);
  }, [clip.audioBufferId, width]);

  return (
    <div
      className={styles.clip}
      style={{ left: clip.startBeat * PIXELS_PER_BEAT, width, background: clip.color }}
      draggable
      onDragStart={handleDragStart}
    >
      <span className={styles.name}>{clip.name}</span>
      <canvas ref={canvasRef} className={styles.canvas} width={width} height={40} />
    </div>
  );
}

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';

  const mid = height / 2;
  for (let x = 0; x < width; x++) {
    const sStart = Math.floor((x / width) * totalSamples);
    const sEnd = Math.floor(((x + 1) / width) * totalSamples);
    let minVal = 0;
    let maxVal = 0;
    for (let s = sStart; s < sEnd; s++) {
      const v = channelData[s] ?? 0;
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
    const yTop = mid * (1 - maxVal);
    const yBot = mid * (1 - minVal);
    ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
  }
}
