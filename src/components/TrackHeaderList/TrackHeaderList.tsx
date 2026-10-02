import { useState } from 'react';
import type { RefObject } from 'react';
import styles from './TrackHeaderList.module.css';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';
import { BEATS_PER_BAR } from '../../constants';
import TrackMeter from './TrackMeter';
import EffectsDialog from '../EffectsDialog/EffectsDialog';

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

function formatPan(pan: number): string {
  const pct = Math.round(Math.abs(pan) * 100);
  if (pct === 0) return 'C';
  return pan < 0 ? `${pct}L` : `${pct}R`;
}

export default function TrackHeaderList({ scrollRef, onScroll }: Props) {
  const { tracks, updateTrack, selectedTrackIds, activeTrackId, selectTrack } = useTrackStore();
  const reorderTrack = useTrackStore((s) => s.reorderTrack);
  const createTracksForClips = useTrackStore((s) => s.createTracksForClips);
  const toggleArmSelected = useTrackStore((s) => s.toggleArmSelected);
  const toggleMuteSelected = useTrackStore((s) => s.toggleMuteSelected);
  const toggleSoloSelected = useTrackStore((s) => s.toggleSoloSelected);
  const deleteSelectedTracks = useTrackStore((s) => s.deleteSelectedTracks);
  const [isDropOver, setIsDropOver] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);

  // State for EffectsDialog
  const [openDialogTrackId, setOpenDialogTrackId] = useState<string | null>(null);
  const [dialogPosition, setDialogPosition] = useState({ x: 100, y: 100 });
  const [dialogSize, setDialogSize] = useState({ width: 500, height: 400 });