import { useState, useRef, useEffect } from 'react';
import styles from './EffectsDialog.module.css';
import CompressorControls from './CompressorControls';
import GateControls from './GateControls';
import EQControls from './EQControls';
import ReverbControls from './ReverbControls';

interface EffectsDialogProps {
  trackId: string;
  trackName: string;
  onClose: () => void;
  position: { x: number; y: number };
  onPositionChange: (x: number, y: number) => void;
  size: { width: number; height: number };
  onSizeChange: (width: number, height: number) => void;
}

const EFFECTS_LIST = ['Gate', 'Equalizer', 'Compressor', 'Reverb'];

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

type EffectType = 'Gate' | 'Equalizer' | 'Compressor' | 'Reverb';

export default function EffectsDialog({
  trackId,
  trackName,
  onClose,
  position,
  onPositionChange,
  size,
  onSizeChange,
}: EffectsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ width: 0, height: 0, x: 0, y: 0 });
  const [selectedEffect, setSelectedEffect] = useState<EffectType | null>('Compressor');

  // Handle dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === dialogRef.current || (e.target as HTMLElement).classList.contains(styles.title)) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      onPositionChange(newX, newY);
    }
    if (isResizing) {
      const newWidth = Math.max(MIN_WIDTH, resizeStart.width + (e.clientX - resizeStart.x));
      const newHeight = Math.max(MIN_HEIGHT, resizeStart.height + (e.clientY - resizeStart.y));
      onSizeChange(newWidth, newHeight);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
  };

  // Handle resizing
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    setResizeStart({
      width: size.width,
      height: size.height,
      x: e.clientX,
      y: e.clientY,
    });
    e.preventDefault();
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleMouseMoveWrapper = (e: MouseEvent) => handleMouseMove(e);
    const handleMouseUpWrapper = () => handleMouseUp();

    document.addEventListener('mousemove', handleMouseMoveWrapper);
    document.addEventListener('mouseup', handleMouseUpWrapper);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousemove', handleMouseMoveWrapper);
      document.removeEventListener('mouseup', handleMouseUpWrapper);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDragging, isResizing, onClose]);

  return (
    <div
      ref={dialogRef}
      className={styles.dialog}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={styles.title}>
        <span>Effects - {trackName}</span>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className={styles.content}>
        <div className={styles.leftPane}>
          <h3>Effects</h3>
          <ul className={styles.effectsList}>
            {EFFECTS_LIST.map((effect) => (
              <li
                key={effect}
                className={`${styles.effectItem} ${selectedEffect === effect ? styles.selected : ''}`}
                onClick={() => setSelectedEffect(effect as EffectType)}
              >
                {effect}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.rightPane}>
          {selectedEffect === 'Compressor' && <CompressorControls trackId={trackId} />}
          {selectedEffect === 'Gate' && <GateControls trackId={trackId} />}
          {selectedEffect === 'Equalizer' && <EQControls trackId={trackId} />}
          {selectedEffect === 'Reverb' && <ReverbControls trackId={trackId} />}
        </div>
      </div>
      <div className={styles.resizeHandle} onMouseDown={handleResizeMouseDown} />
    </div>
  );
}
