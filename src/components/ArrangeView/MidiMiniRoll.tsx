import { useEffect, useRef } from 'react';
import styles from './MidiMiniRoll.module.css';
import type { MidiNote } from '../../types/daw';

interface Props {
  notes: MidiNote[];
  color: string;
}

// Miniature piano-roll overview rendered inside a track lane when the track
// has MIDI notes but no audio clips. Horizontal span covers the notes' own
// extent (with a small margin) so the shape is always visible regardless of
// how long the timeline is; vertical span is pitch 0-127, same as the editor.
const MAX_PITCH = 127;
const PITCH_MARGIN = 2;

export default function MidiMiniRoll({ notes, color }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (notes.length === 0) return;

    const minStart = Math.min(...notes.map((n) => n.startBeat));
    const maxEnd = Math.max(...notes.map((n) => n.startBeat + n.durationBeats));
    const minPitch = Math.max(0, Math.min(...notes.map((n) => n.pitch)) - PITCH_MARGIN);
    const maxPitch = Math.min(MAX_PITCH, Math.max(...notes.map((n) => n.pitch)) + PITCH_MARGIN);

    const spanBeats = Math.max(maxEnd - minStart, 1);
    const spanPitch = Math.max(maxPitch - minPitch, 1);
    const x = (beat: number) => ((beat - minStart) / spanBeats) * (w - 4) + 2;
    const y = (pitch: number) => h - 2 - ((pitch - minPitch) / spanPitch) * (h - 4);
    const rowH = Math.max(2, (h - 4) / spanPitch);

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    for (const n of notes) {
      const nx = x(n.startBeat);
      const nw = Math.max(2, x(n.startBeat + n.durationBeats) - nx);
      const ny = y(n.pitch);
      ctx.fillRect(nx, ny - rowH / 2, nw, rowH);
    }
    ctx.globalAlpha = 1;
  }, [notes, color]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
