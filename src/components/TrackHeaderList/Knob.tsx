import { useRef } from 'react';
import styles from './TrackHeaderList.module.css';

interface Props {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

// Pixels of vertical drag to sweep the full range; Shift drags 4x finer.
const DRAG_RANGE_PX = 150;
const STEP = 0.01;

export default function Knob({ value, min, max, defaultValue, label, formatValue, onChange, onDragStateChange }: Props) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);
  const angle = -135 + ((value - min) / (max - min)) * 270;

  const setValue = (next: number) => {
    onChange(Math.round(Math.min(max, Math.max(min, next)) / STEP) * STEP);
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onDragStateChange?.(false);
  };

  return (
    <button
      type="button"
      className={styles.knob}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatValue(value)}
      title={`${label}: ${formatValue(value)} (double-click to reset)`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { startY: e.clientY, startValue: value };
        onDragStateChange?.(true);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const px = DRAG_RANGE_PX * (e.shiftKey ? 4 : 1);
        setValue(drag.startValue + ((drag.startY - e.clientY) / px) * (max - min));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setValue(defaultValue);
      }}
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        setValue(value + delta * (max - min) * (e.shiftKey ? 0.01 : 0.05));
      }}
    >
      <span className={styles.knobIndicator} style={{ transform: `rotate(${angle}deg)` }} />
    </button>
  );
}
