import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import styles from './TrackHeaderList.module.css';
import { useTrackStore } from '../../store/trackStore';
import { useRecordingStore } from '../../store/recordingStore';
import { useTransportStore } from '../../store/transportStore';
import { getActiveTakeNumber, getTrackDisplayHeight, groupTakes } from '../../audio/takes';
import * as engine from '../../audio/engine';
import { BEATS_PER_BAR } from '../../constants';
import TrackMeter from './TrackMeter';
import Knob from './Knob';
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
  const { tracks, updateTrack, selectedTrackIds, selectedClipIds, activeTrackId, selectTrack } = useTrackStore();
  const selectTake = useTrackStore((s) => s.selectTake);
  const createTakeComp = useTrackStore((s) => s.createTakeComp);
  const playTakeComp = useTrackStore((s) => s.playTakeComp);
  const toggleTakeLanes = useTrackStore((s) => s.toggleTakeLanes);
  const explodeTakeGroup = useTrackStore((s) => s.explodeTakeGroup);
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isMultiTakeRecording = isRecording && tracks.some(
    (track) => track.armed && track.recordingMode === 'multiTake',
  );
  const reorderTrack = useTrackStore((s) => s.reorderTrack);
  const createTracksForClips = useTrackStore((s) => s.createTracksForClips);
  const toggleArmSelected = useTrackStore((s) => s.toggleArmSelected);
  const toggleMuteSelected = useTrackStore((s) => s.toggleMuteSelected);
  const toggleSoloSelected = useTrackStore((s) => s.toggleSoloSelected);
  const deleteSelectedTracks = useTrackStore((s) => s.deleteSelectedTracks);
  const [isDropOver, setIsDropOver] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [rowDraggable, setRowDraggable] = useState(true);
  const DRAG_THRESHOLD = 15; // Pixels to distinguish intentional drags

  const [openMenu, setOpenMenu] = useState<{ trackId: string; top: number; left: number } | null>(null);

  // State for EffectsDialog
  const [openDialogTrackId, setOpenDialogTrackId] = useState<string | null>(null);
  const [dialogPosition, setDialogPosition] = useState({ x: 100, y: 100 });
  const [dialogSize, setDialogSize] = useState({ width: 500, height: 400 });

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDropOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDropOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDropOver(false);
    const audioFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.wav'),
    );
    if (audioFiles.length === 0) return;
    const startBeat =
      Math.round(useTransportStore.getState().playheadBeats / BEATS_PER_BAR) * BEATS_PER_BAR;
    void Promise.all(
      audioFiles.map(async (file) => {
        const buffer = await engine.decodeFile(file);
        const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        engine.storeBuffer(bufferId, buffer);
        const bpm = useTransportStore.getState().bpm;
        return {
          name: file.name.replace(/\.[^.]+$/, ''),
          durationBeats: (buffer.duration * bpm) / 60,
          audioBufferId: bufferId,
        };
      }),
    )
      .then((clipData) => createTracksForClips(clipData, startBeat))
      .catch(() => undefined);
  };

  // Drag and drop handlers for track reordering
  const handleDragStart = (e: React.DragEvent, trackId: string) => {
    e.dataTransfer.setData('text/x-track-id', trackId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTrackId(trackId);
    setDragStartX(e.clientX);
    setDragStartY(e.clientY);
  };

  const handleDragOverTrack = (e: React.DragEvent, trackId: string) => {
    if (!draggedTrackId || !dragStartX || !dragStartY) return;
    
    // Ignore horizontal drags (allow slider adjustments)
    const deltaX = Math.abs(e.clientX - dragStartX);
    const deltaY = Math.abs(e.clientY - dragStartY);
    if (deltaX > DRAG_THRESHOLD && deltaX > deltaY) {
      e.dataTransfer.effectAllowed = 'none';
      return;
    }
    
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTrackId(trackId);
  };

  const handleDragLeaveTrack = (e: React.DragEvent) => {
    // Only reset if leaving the entire component
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTrackId(null);
    }
  };

  const handleDropTrack = (e: React.DragEvent, dropTrackId: string) => {
    e.preventDefault();
    setDragOverTrackId(null);
    setDraggedTrackId(null);
    setDragStartX(null);
    setDragStartY(null);
    
    // Skip if drag was horizontal
    if (e.dataTransfer.effectAllowed === 'none') return;
    
    const draggedTrackId = e.dataTransfer.getData('text/x-track-id');
    if (!draggedTrackId || draggedTrackId === dropTrackId) return;
    
    const fromIndex = tracks.findIndex(t => t.id === draggedTrackId);
    const toIndex = tracks.findIndex(t => t.id === dropTrackId);
    
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderTrack(fromIndex, toIndex);
    }
  };

  const handleDragEnd = () => {
    setDraggedTrackId(null);
    setDragOverTrackId(null);
    setDragStartX(null);
    setDragStartY(null);
  };

  // Handle row click for track selection
  const handleRowClick = (e: React.MouseEvent, trackId: string) => {
    // Ignore clicks on buttons (they handle their own logic)
    if ((e.target as HTMLElement).closest('button')) return;
    
    if (e.ctrlKey || e.metaKey) {
      selectTrack(trackId, 'toggle');
    } else if (e.shiftKey) {
      selectTrack(trackId, 'range');
    } else {
      selectTrack(trackId, 'replace');
    }
  };

  // Track options menu. The panel is position: fixed so the scroll container
  // can't clip it; it closes on outside clicks and when the list scrolls.
  const toggleTrackMenu = (e: React.MouseEvent<HTMLButtonElement>, trackId: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenMenu((prev) => (prev?.trackId === trackId ? null : { trackId, top: rect.bottom + 3, left: rect.left }));
  };

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('[data-track-menu]')) return;
      setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  // Toggle EffectsDialog for a track
  const toggleEffectsDialog = (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation(); // Prevent row click from triggering
    setOpenDialogTrackId((prev) => (prev === trackId ? null : trackId));
  };

  // Close dialog
  const closeEffectsDialog = () => {
    setOpenDialogTrackId(null);
  };

  // Handle dialog position change
  const handlePositionChange = (x: number, y: number) => {
    setDialogPosition({ x, y });
  };

  // Handle dialog size change
  const handleSizeChange = (width: number, height: number) => {
    setDialogSize({ width, height });
  };

  // Get the track for the open dialog
  const openDialogTrack = tracks.find((t) => t.id === openDialogTrackId);

  return (
    <div
      className={`${styles.wrapper} ${isDropOver ? styles.wrapperDropOver : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.rulerSpacer} aria-hidden="true" />
      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll} role="listbox" aria-label="Track list">
        {tracks.map((track) => {
          const isSelected = selectedTrackIds.includes(track.id);
          const isActive = activeTrackId === track.id;
          const takeGroups = [...groupTakes(track.clips).entries()]
            .sort(([, first], [, second]) =>
              Math.max(...first.map((clip) => clip.startBeat)) - Math.max(...second.map((clip) => clip.startBeat)),
            );
          const [takeGroupId, takes] = takeGroups[takeGroups.length - 1] ?? [];
          const takeNumbers = takes
            ? [...new Set(takes.map((clip) => clip.takeNumber ?? 0))].sort((a, b) => a - b)
            : [];
          const activeTakeNumber = takes ? getActiveTakeNumber(takes) : 0;
          const hasComp = !!takes?.some((clip) => clip.comped);
          const compIsActive = hasComp && !takes?.some((clip) => clip.activeTake);
          const canCreateComp = !!takes?.some((clip) => selectedClipIds.includes(clip.id));
          
          return (
            <div
              key={track.id}
              className={`${styles.row} ${isSelected ? styles.selected : ''} ${isActive ? styles.active : ''} ${dragOverTrackId === track.id ? styles.rowDropTarget : ''} ${draggedTrackId === track.id ? styles.rowDragging : ''}`}
              style={{ height: getTrackDisplayHeight(track) }}
              onClick={(e) => handleRowClick(e, track.id)}
              draggable={rowDraggable}
              onDragStart={(e) => handleDragStart(e, track.id)}
              onDragOver={(e) => handleDragOverTrack(e, track.id)}
              onDragLeave={handleDragLeaveTrack}
              onDrop={(e) => handleDropTrack(e, track.id)}
              onDragEnd={handleDragEnd}
              role="option"
              aria-selected={isSelected}
              aria-label={`Track ${track.name}`}
            >
              <div className={styles.rowMain}>
                <span className={styles.colorSwatch} style={{ background: track.color }} />
                <button
                  className={`${styles.armBtn} ${track.armed ? styles.armed : ''}`}
                  disabled={isMultiTakeRecording}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleArmSelected();
                  }}
                  title="Arm for recording"
                  aria-label="Arm selected tracks for recording"
                >
                  <span className={styles.armDot} />
                </button>
                <span className={styles.name} title={track.name}>
                  {track.name}
                </span>
                <Knob
                  value={track.volume}
                  min={0}
                  max={1}
                  defaultValue={1}
                  label={`Volume for ${track.name}`}
                  formatValue={(v) => `${Math.round(v * 100)}%`}
                  onChange={(volume) => updateTrack(track.id, { volume })}
                  onDragStateChange={(dragging) => setRowDraggable(!dragging)}
                />
                <div className={styles.trackMenu} data-track-menu>
                  <button
                    type="button"
                    className={`${styles.menuBtn} ${openMenu?.trackId === track.id ? styles.menuBtnOpen : ''}`}
                    onClick={(e) => toggleTrackMenu(e, track.id)}
                    title="Track options"
                    aria-label={`Track options for ${track.name}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenu?.trackId === track.id}
                  >
                    {track.recordingMode === 'multiTake' && <span className={styles.menuBadge}>T</span>}
                    ▾
                  </button>
                  {openMenu?.trackId === track.id && (
                    <div
                      className={styles.trackMenuPanel}
                      style={{ top: openMenu.top, left: openMenu.left }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className={styles.menuField}>
                        Recording mode
                        <select
                          value={track.recordingMode ?? 'layered'}
                          disabled={isRecording}
                          onChange={(e) => updateTrack(track.id, { recordingMode: e.target.value as 'layered' | 'multiTake' })}
                          aria-label={`Recording mode for ${track.name}`}
                        >
                          <option value="layered">Layered</option>
                          <option value="multiTake">Multi-Take</option>
                        </select>
                      </label>
                      {takeGroupId && takes && (
                        <>
                          <div className={styles.menuSeparator} />
                          <label className={styles.menuCheck}>
                            <input
                              type="checkbox"
                              checked={!!track.showAllTakes}
                              onChange={() => toggleTakeLanes(track.id)}
                            />
                            Show all takes
                          </label>
                          <label className={styles.menuField}>
                            Active take
                            <select
                              value={compIsActive ? 'comp' : String(activeTakeNumber)}
                              onChange={(e) => {
                                if (e.target.value === 'comp') playTakeComp(track.id, takeGroupId);
                                else selectTake(track.id, takeGroupId, Number(e.target.value));
                                const transport = useTransportStore.getState();
                                if (transport.isPlaying) {
                                  engine.seekDuringPlayback(
                                    useTrackStore.getState().tracks,
                                    transport.playheadBeats,
                                    transport.bpm,
                                  );
                                }
                              }}
                              aria-label={`Active take for ${track.name}`}
                            >
                              {hasComp && <option value="comp">Comp</option>}
                              {takeNumbers.map((takeNumber) => (
                                <option key={takeNumber} value={takeNumber}>Take {takeNumber}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={!canCreateComp}
                            onClick={() => {
                              createTakeComp(track.id, takeGroupId);
                              const transport = useTransportStore.getState();
                              if (transport.isPlaying) {
                                engine.seekDuringPlayback(
                                  useTrackStore.getState().tracks,
                                  transport.playheadBeats,
                                  transport.bpm,
                                );
                              }
                            }}
                            title="Use selected take segments as the comp"
                          >
                            Create comp from selected segments
                          </button>
                          <button
                            type="button"
                            onClick={() => explodeTakeGroup(track.id, takeGroupId)}
                            title="Create one new track for each take"
                          >
                            Explode takes to tracks
                          </button>
                        </>
                      )}
                      <div className={styles.menuSeparator} />
                      <button
                        type="button"
                        className={styles.menuDanger}
                        onClick={() => {
                          setOpenMenu(null);
                          deleteSelectedTracks();
                        }}
                        disabled={selectedTrackIds.length === 0}
                        title="Remove the selected tracks"
                      >
                        Remove selected tracks
                      </button>
                    </div>
                  )}
                </div>
                <Knob
                  value={track.pan}
                  min={-1}
                  max={1}
                  defaultValue={0}
                  label={`Pan for ${track.name}`}
                  formatValue={formatPan}
                  onChange={(pan) => updateTrack(track.id, { pan })}
                  onDragStateChange={(dragging) => setRowDraggable(!dragging)}
                />
                <div className={styles.controls}>
                    <button
                      className={`${styles.iconBtn} ${track.muted ? styles.toggled : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMuteSelected();
                      }}
                      title="Mute"
                      aria-label="Mute selected tracks"
                    >
                      M
                    </button>
                    <button
                      className={`${styles.iconBtn} ${track.soloed ? styles.toggled : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSoloSelected();
                      }}
                      title="Solo"
                      aria-label="Solo selected tracks"
                    >
                      S
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => toggleEffectsDialog(e, track.id)}
                      title="Track Effects"
                    >
                      FX
                    </button>
                </div>
              </div>
              <TrackMeter trackId={track.id} trackName={track.name} />
            </div>
          );
        })}
        {tracks.length === 0 && (
          <div className={styles.empty}>
            Drop audio files here · or use &ldquo;+ Track&rdquo;
          </div>
        )}
        <div className={styles.dropHint}>
          {isDropOver ? 'Release to add tracks' : '+ Drop audio files'}
        </div>
      </div>
      {openDialogTrack && (
        <EffectsDialog
          trackId={openDialogTrack.id}
          trackName={openDialogTrack.name}
          onClose={closeEffectsDialog}
          position={dialogPosition}
          onPositionChange={handlePositionChange}
          size={dialogSize}
          onSizeChange={handleSizeChange}
        />
      )}
    </div>
  );
}
