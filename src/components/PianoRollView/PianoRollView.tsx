import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './PianoRollView.module.css';
import useTrackStore from '../../store/trackStore';
import { useMidiStore } from '../../store/midiStore';
import { useTransportStore, usePixelsPerBeat } from '../../store/transportStore';
import { BEATS_PER_BAR, MIN_TOTAL_BARS, TIMELINE_MARGIN_BARS } from '../../constants';
import * as engine from '../../audio/engine';
import { startNotePreview, stopNotePreview } from '../../audio/midiSynth';
import { SYNTH_LABELS, type SynthId } from '../../audio/workletSynth';
import SynthPanel from './SynthPanel';
import type { MidiNote, SynthId as TrackSynthId } from '../../types/daw';

// Piano roll editor for MIDI note editing (feature #26, tasks #63/#64).
// The grid is rendered on a canvas: horizontal axis is beats (shared zoom
// with the arrange view), vertical axis is MIDI pitch 127 (top) down to 0.

const MAX_PITCH = 127;
const RULER_HEIGHT = 24;
const BASE_NOTE_HEIGHT = 12;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const isBlackKey = (pitch: number): boolean => [1, 3, 6, 8, 10].includes(pitch % 12);
const noteName = (pitch: number): string => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

// Computer-keyboard piano mapping (two rows), semitones above the base pitch.
const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16,
};

type Tool = 'draw' | 'select' | 'erase';

type DragState =
  | { mode: 'draw'; pitch: number; startBeat: number; currentBeat: number }
  | { mode: 'move'; noteIds: string[]; originals: Map<string, { startBeat: number; pitch: number }>; deltaBeats: number; deltaPitch: number }
  | { mode: 'resize'; noteId: string; startBeat: number; currentBeat: number }
  | { mode: 'marquee'; startBeat: number; currentBeat: number; startPitch: number; currentPitch: number }
  | null;

interface ThemeColors {
  bg1: string;
  bg2: string;
  border: string;
  textDim: string;
  accent: string;
  note: string;
  noteSelected: string;
}

function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg1: v('--bg-1', '#1e1e1e'),
    bg2: v('--bg-2', '#252525'),
    border: v('--border', '#3a3a3a'),
    textDim: v('--text-dim', '#777777'),
    accent: v('--accent', '#61afef'),
    note: v('--accent', '#61afef'),
    noteSelected: '#ff9f43',
  };
}

export default function PianoRollView() {
  const tracks = useTrackStore((s) => s.tracks);
  const activeTrackId = useTrackStore((s) => s.activeTrackId);
  const notes = useMidiStore((s) => s.notes);
  const selectedNoteIds = useMidiStore((s) => s.selectedNoteIds);
  const pianoRollTrackId = useMidiStore((s) => s.pianoRollTrackId);
  const setPianoRollTrackId = useMidiStore((s) => s.setPianoRollTrackId);
  const addNote = useMidiStore((s) => s.addNote);
  const removeNote = useMidiStore((s) => s.removeNote);
  const removeNotes = useMidiStore((s) => s.removeNotes);
  const moveNotes = useMidiStore((s) => s.moveNotes);
  const resizeNote = useMidiStore((s) => s.resizeNote);
  const selectNote = useMidiStore((s) => s.selectNote);
  const clearSelectedNotes = useMidiStore((s) => s.clearSelectedNotes);
  const selectNotesInRange = useMidiStore((s) => s.selectNotesInRange);
  const midiUndo = useMidiStore((s) => s.undo);
  const midiRedo = useMidiStore((s) => s.redo);

  const playheadBeats = useTransportStore((s) => s.playheadBeats);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const isSnapEnabled = useTransportStore((s) => s.isSnapEnabled);
  const gridDivisionBeats = useTransportStore((s) => s.gridDivisionBeats);
  const setPlayheadBeats = useTransportStore((s) => s.setPlayheadBeats);
  const setZoomLevel = useTransportStore((s) => s.setZoomLevel);
  const pixelsPerBeat = usePixelsPerBeat();
  const zoomLevel = useTransportStore((s) => s.zoomLevel);

  const trackId = pianoRollTrackId ?? activeTrackId;
  const trackNotes = useMemo(
    () => (trackId ? notes.filter((n) => n.trackId === trackId) : []),
    [notes, trackId],
  );

  const noteHeight = Math.min(40, Math.max(8, BASE_NOTE_HEIGHT * zoomLevel));
  // The sticky ruler is a DOM element, so the canvas only holds the pitch
  // grid; total scroll height adds the ruler strip back on top.
  const contentHeight = (MAX_PITCH + 1) * noteHeight + RULER_HEIGHT;

  const totalBars = useMemo(() => {
    const furthestBeat = trackNotes.reduce((max, n) => Math.max(max, n.startBeat + n.durationBeats), 0);
    const neededBars = Math.ceil(furthestBeat / BEATS_PER_BAR) + TIMELINE_MARGIN_BARS;
    return Math.max(MIN_TOTAL_BARS, neededBars);
  }, [trackNotes]);
  const contentWidth = totalBars * BEATS_PER_BAR * pixelsPerBeat;

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [kbScrollTop, setKbScrollTop] = useState(0);
  const [tool, setTool] = useState<Tool>('draw');
  const [showSynthPanel, setShowSynthPanel] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);
  const [basePitch, setBasePitch] = useState(60);
  const [heldKeys, setHeldKeys] = useState<Set<string>>(new Set());
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;
  const colorsRef = useRef<ThemeColors>(readThemeColors());

  useEffect(() => {
    const onTheme = () => { colorsRef.current = readThemeColors(); };
    window.addEventListener('themechange', onTheme);
    return () => window.removeEventListener('themechange', onTheme);
  }, []);

  // Make sure the selected track has live audio nodes so note previews are
  // audible even before the transport has ever played.
  useEffect(() => {
    if (tracks.length > 0) engine.updateLiveTrackParams(tracks);
  }, [tracks]);

  const snapBeat = useCallback((beat: number): number => {
    if (!isSnapEnabled) return beat;
    return Math.round(beat / gridDivisionBeats) * gridDivisionBeats;
  }, [isSnapEnabled, gridDivisionBeats]);

  const minDuration = gridDivisionBeats;

  // Canvas coordinates: the canvas now sits below the sticky ruler, so its own
  // top edge is row 0 (pitch 127).
  const getPos = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    const y = e.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0) - RULER_HEIGHT;
    const beat = Math.max(0, x / pixelsPerBeat);
    const row = Math.floor(y / noteHeight);
    const pitch = Math.min(MAX_PITCH, Math.max(0, MAX_PITCH - row));
    return { beat, pitch, y };
  }, [pixelsPerBeat, noteHeight]);

  // Nearest note within a few px of the click, on any pitch row close to the
  // clicked one - makes grabbing short/thin notes reliable.
  const hitNote = useCallback((beat: number, pitch: number): MidiNote | null => {
    const rowTolerance = Math.max(1, Math.round(6 / noteHeight));
    let best: MidiNote | null = null;
    let bestDist = Infinity;
    for (const n of trackNotes) {
      if (beat < n.startBeat - 0.001 || beat > n.startBeat + n.durationBeats + 0.001) continue;
      const dist = Math.abs(n.pitch - pitch);
      if (dist <= rowTolerance && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    if (best) return best;
    // Exact-row fallback (previous behavior)
    for (let i = trackNotes.length - 1; i >= 0; i--) {
      const n = trackNotes[i];
      if (pitch === n.pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats) return n;
    }
    return null;
  }, [trackNotes, noteHeight]);

  const trackSynth: TrackSynthId = tracks.find((t) => t.id === trackId)?.synth ?? 'base';

  const trackMonarcParams = tracks.find((t) => t.id === trackId)?.monarcParams;

  const previewNote = useCallback((pitch: number, velocity = 100, key?: string) => {
    if (!trackId) return;
    const dest = engine.getTrackDestination(trackId);
    if (!dest) return;
    startNotePreview(engine.getAudioContext(), dest, trackSynth, { pitch, velocity }, key ?? `pitch-${pitch}-${Date.now()}`, trackId, trackMonarcParams);
  }, [trackId, trackSynth, trackMonarcParams]);

  const ensureAudio = useCallback(() => {
    void engine.resumeContext();
  }, []);

  // The ruler is now a sticky DOM strip (handleRulerMouseDown); the canvas
  // starts below it, so canvas clicks are always grid clicks.
  const scrubPlayheadTo = (clientX: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const contentX = clientX - rect.left + scroll.scrollLeft;
    const b = snapBeat(Math.max(0, contentX / pixelsPerBeat));
    if (isPlaying) {
      engine.seekDuringPlayback(useTrackStore.getState().tracks, b, useTransportStore.getState().bpm);
    }
    setPlayheadBeats(b);
  };

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackId) return;
    ensureAudio();
    scrubPlayheadTo(e.clientX);
    const move = (ev: MouseEvent) => scrubPlayheadTo(ev.clientX);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!trackId) return;
    ensureAudio();
    const { beat, pitch } = getPos(e);

    const hit = hitNote(beat, pitch);

    if (e.button === 2) {
      if (hit) removeNote(hit.id);
      e.preventDefault();
      return;
    }

    if (e.shiftKey) {
      setDrag({ mode: 'marquee', startBeat: beat, currentBeat: beat, startPitch: pitch, currentPitch: pitch });
      e.preventDefault();
      return;
    }

    if (tool === 'erase') {
      if (hit) removeNote(hit.id);
      return;
    }

    if (hit) {
      // Grab the note body to move it (in any tool), or its right edge to
      // resize. Ctrl/Cmd toggles selection instead of dragging.
      const nearRightEdge = beat > hit.startBeat + hit.durationBeats - Math.max(6 / pixelsPerBeat, 0.25 * hit.durationBeats);
      if (e.ctrlKey || e.metaKey) {
        selectNote(hit.id, true);
      } else {
        if (!selectedNoteIds.includes(hit.id)) selectNote(hit.id, false);
        const ids = selectedNoteIds.includes(hit.id) ? selectedNoteIds : [hit.id];
        if (nearRightEdge) {
          setDrag({ mode: 'resize', noteId: hit.id, startBeat: hit.startBeat, currentBeat: beat });
        } else {
          const originals = new Map<string, { startBeat: number; pitch: number }>();
          for (const n of trackNotes) if (ids.includes(n.id)) originals.set(n.id, { startBeat: n.startBeat, pitch: n.pitch });
          setDrag({ mode: 'move', noteIds: ids, originals, deltaBeats: 0, deltaPitch: 0 });
        }
        previewNote(hit.pitch, hit.velocity, `audition-${hit.id}`);
      }
    } else {
      clearSelectedNotes();
      if (tool === 'draw') {
        const start = snapBeat(beat);
        setDrag({ mode: 'draw', pitch, startBeat: start, currentBeat: start + minDuration });
      } else {
        setDrag({ mode: 'marquee', startBeat: beat, currentBeat: beat, startPitch: pitch, currentPitch: pitch });
      }
    }
    e.preventDefault();
  };

  const dragActive = drag !== null;

  useEffect(() => {
    if (!dragActive) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const { beat, pitch } = getPos(e);
      if (d.mode === 'draw') {
        setDrag({ ...d, currentBeat: Math.max(d.startBeat + minDuration, snapBeat(beat)) });
      } else if (d.mode === 'move') {
        const first = d.originals.get(d.noteIds[0]);
        if (!first) return;
        setDrag({
          ...d,
          deltaBeats: snapBeat(beat) - first.startBeat,
          deltaPitch: pitch - first.pitch,
        });
      } else if (d.mode === 'resize') {
        setDrag({ ...d, currentBeat: Math.max(d.startBeat + minDuration, snapBeat(beat)) });
      } else if (d.mode === 'marquee') {
        setDrag({ ...d, currentBeat: beat, currentPitch: pitch });
      }
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!d) { setDrag(null); return; }
      const { beat, pitch } = getPos(e);
      if (d.mode === 'draw') {
        const start = d.startBeat;
        const end = Math.max(d.startBeat + minDuration, snapBeat(beat));
        const id = addNote({
          trackId: trackId!,
          pitch: d.pitch,
          startBeat: start,
          durationBeats: end - start,
          velocity: 100,
        });
        previewNote(d.pitch, 100, `audition-${id}`);
      } else if (d.mode === 'move') {
        // Only commit if the note actually moved; a plain click on a note is
        // just a selection, not a zero-delta undo step.
        if (d.deltaBeats !== 0 || d.deltaPitch !== 0) {
          moveNotes(d.noteIds, d.deltaBeats, d.deltaPitch);
        }
      } else if (d.mode === 'resize') {
        resizeNote(d.noteId, Math.max(minDuration, snapBeat(beat) - d.startBeat));
      } else if (d.mode === 'marquee') {
        if (trackId) {
          selectNotesInRange(
            trackId,
            d.startBeat,
            beat,
            Math.min(d.startPitch, pitch),
            Math.max(d.startPitch, pitch),
            e.shiftKey,
          );
        }
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragActive, trackId, snapBeat, minDuration, addNote, moveNotes, resizeNote, selectNotesInRange, previewNote, getPos]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.altKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoomLevel(useTransportStore.getState().zoomLevel * delta);
    }
  }, [setZoomLevel]);

  // Computer-keyboard note input: a/w/s/... play a piano layout from the base
  // pitch; z/x shift the base octave. Only active while the piano roll is open.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.stopPropagation(); setBasePitch((p) => Math.max(0, p - 12)); return; }
      if (k === 'x') { e.preventDefault(); e.stopPropagation(); setBasePitch((p) => Math.min(MAX_PITCH - 16, p + 12)); return; }
      const semi = KEY_TO_SEMITONE[k];
      if (semi === undefined || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      ensureAudio();
      const pitch = Math.min(MAX_PITCH, basePitch + semi);
      setHeldKeys((s) => new Set(s).add(k));
      if (trackId) previewNote(pitch, 100, `kb-${k}`);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEY_TO_SEMITONE[k] !== undefined) {
        setHeldKeys((s) => { const n = new Set(s); n.delete(k); return n; });
        stopNotePreview(`kb-${k}`);
      }
    };
    const onDelete = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          removeNotes(selectedNoteIds);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) midiRedo(); else midiUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopPropagation();
        midiRedo();
      }
      if (e.key.startsWith('Arrow') && selectedNoteIds.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? BEATS_PER_BAR : gridDivisionBeats;
        if (e.key === 'ArrowLeft') moveNotes(selectedNoteIds, -step, 0);
        else if (e.key === 'ArrowRight') moveNotes(selectedNoteIds, step, 0);
        else if (e.key === 'ArrowUp') moveNotes(selectedNoteIds, 0, 1);
        else if (e.key === 'ArrowDown') moveNotes(selectedNoteIds, 0, -1);
      }
    };
    // Capture phase so these run before the app-level shortcuts registered on
    // window in the bubble phase (S = split, D = duplicate, etc.).
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('keydown', onDelete, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('keydown', onDelete, true);
    };
  }, [basePitch, trackId, trackSynth, selectedNoteIds, gridDivisionBeats, ensureAudio, previewNote, removeNotes, midiUndo, midiRedo, moveNotes]);

  // Canvas rendering (grid + notes only; the ruler strip is a separate sticky
  // DOM element so it stays visible while scrolling vertically)
  useEffect(() => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = contentWidth * dpr;
    canvas.height = contentHeight * dpr;
    canvas.style.width = `${contentWidth}px`;
    canvas.style.height = `${contentHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colorsRef.current;

    // Background (canvas covers just the grid area below the ruler)
    ctx.fillStyle = c.bg1;
    ctx.fillRect(0, 0, contentWidth, contentHeight - RULER_HEIGHT);

    // Horizontal pitch rows: black-key rows shaded, C rows marked
    for (let p = 0; p <= MAX_PITCH; p++) {
      const y = (MAX_PITCH - p) * noteHeight;
      if (isBlackKey(p)) {
        ctx.fillStyle = 'rgba(127, 127, 127, 0.08)';
        ctx.fillRect(0, y, contentWidth, noteHeight);
      }
      if (p % 12 === 0) {
        ctx.strokeStyle = c.border;
        ctx.beginPath();
        ctx.moveTo(0, y + noteHeight);
        ctx.lineTo(contentWidth, y + noteHeight);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(127, 127, 127, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, y + noteHeight);
      ctx.lineTo(contentWidth, y + noteHeight);
      ctx.stroke();
    }

    // Vertical grid lines: subdivisions, beats, bars (start below the ruler)
    const totalBeats = totalBars * BEATS_PER_BAR;
    const subBeats = Math.max(gridDivisionBeats, 1 / 16);
    for (let b = 0; b <= totalBeats; b += subBeats) {
      const x = b * pixelsPerBeat;
      const isBar = Math.abs(b % BEATS_PER_BAR) < 1e-6;
      const isBeat = Math.abs(b % 1) < 1e-6;
      ctx.strokeStyle = isBar ? c.border : isBeat ? 'rgba(127,127,127,0.35)' : 'rgba(127,127,127,0.12)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, contentHeight - RULER_HEIGHT);
      ctx.stroke();
    }

    // Notes
    const selected = new Set(selectedNoteIds);
    const drawNote = (n: MidiNote, override?: Partial<MidiNote>) => {
      const note = { ...n, ...override };
      const x = note.startBeat * pixelsPerBeat;
      const w = Math.max(2, note.durationBeats * pixelsPerBeat);
      const y = (MAX_PITCH - note.pitch) * noteHeight;
      const isSel = selected.has(n.id);
      const alpha = 0.45 + 0.55 * (note.velocity / 127);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isSel ? c.noteSelected : c.note;
      const h = Math.max(2, noteHeight - 1);
      const r = Math.min(3, h / 2);
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w - 1, h, r);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (isSel) {
        ctx.strokeStyle = c.noteSelected;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h);
      }
    };

    for (const n of trackNotes) {
      let override: Partial<MidiNote> | undefined;
      const d = dragRef.current;
      if (d?.mode === 'move' && d.noteIds.includes(n.id)) {
        const orig = d.originals.get(n.id);
        if (orig) override = { startBeat: Math.max(0, orig.startBeat + d.deltaBeats), pitch: Math.min(MAX_PITCH, Math.max(0, orig.pitch + d.deltaPitch)) };
      }
      drawNote(n, override);
    }
    if (drag?.mode === 'resize') {
      const n = trackNotes.find((t) => t.id === drag.noteId);
      if (n) drawNote(n, { durationBeats: Math.max(minDuration, drag.currentBeat - drag.startBeat) });
    }
    if (drag?.mode === 'draw') {
      drawNote(
        { id: '__draw__', trackId: trackId ?? '', pitch: drag.pitch, startBeat: drag.startBeat, durationBeats: Math.max(minDuration, drag.currentBeat - drag.startBeat), velocity: 100 },
      );
    }

    // Marquee selection rectangle
    if (drag?.mode === 'marquee') {
      const x0 = Math.min(drag.startBeat, drag.currentBeat) * pixelsPerBeat;
      const x1 = Math.max(drag.startBeat, drag.currentBeat) * pixelsPerBeat;
      const p0 = Math.max(drag.startPitch, drag.currentPitch);
      const p1 = Math.min(drag.startPitch, drag.currentPitch);
      const y0 = (MAX_PITCH - p0) * noteHeight;
      const y1 = (MAX_PITCH - p1 + 1) * noteHeight;
      ctx.fillStyle = 'rgba(97, 175, 239, 0.15)';
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      ctx.strokeStyle = c.accent;
      ctx.strokeRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }

    // Playhead
    const px = playheadBeats * pixelsPerBeat;
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(px - 1, 0, 2, contentHeight - RULER_HEIGHT);
  }, [trackNotes, selectedNoteIds, pixelsPerBeat, noteHeight, contentWidth, contentHeight, totalBars, gridDivisionBeats, playheadBeats, drag, trackId, minDuration]);

  // Piano keyboard strip (visible range only), synced to canvas scroll
  const visibleTopPitch = Math.min(MAX_PITCH, Math.max(0, MAX_PITCH - Math.floor((kbScrollTop - RULER_HEIGHT) / noteHeight)));
  const visibleBottomPitch = Math.max(0, MAX_PITCH - Math.floor((kbScrollTop + (scrollRef.current?.clientHeight ?? 600) - RULER_HEIGHT) / noteHeight));
  // Keyboard strip: keys start below the sticky ruler cell
  const kbKeysTop = RULER_HEIGHT;
  const keyPitches: number[] = [];
  for (let p = visibleTopPitch; p >= visibleBottomPitch; p--) keyPitches.push(p);

  const handleKeyMouseDown = (e: React.MouseEvent, pitch: number) => {
    e.preventDefault();
    e.stopPropagation();
    ensureAudio();
    previewNote(pitch, 100, `key-${pitch}`);
  };
  const handleKeyMouseUp = (pitch: number) => stopNotePreview(`key-${pitch}`);

  return (
    <div className={styles.outer}>
      <div className={styles.toolbar}>
        <span>Track:</span>
        <select
          value={trackId ?? ''}
          onChange={(e) => setPianoRollTrackId(e.target.value || null)}
          aria-label="Piano roll track"
        >
          {tracks.length === 0 && <option value="">No tracks</option>}
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <span>Sound:</span>
        <select
          value={trackSynth}
          onChange={(e) => {
            if (trackId) useTrackStore.getState().updateTrack(trackId, { synth: e.target.value as SynthId });
          }}
          disabled={!trackId}
          aria-label="Track synth"
          title="Synth prototype used for this track's MIDI notes"
        >
          {(Object.keys(SYNTH_LABELS) as SynthId[]).map((id) => (
            <option key={id} value={id}>{SYNTH_LABELS[id]}</option>
          ))}
        </select>
        <button
          className={tool === 'draw' ? styles.toolActive : ''}
          onClick={() => setTool('draw')}
          title="Draw notes (drag on the grid)"
        >
          ✏️ Draw
        </button>
        <button
          className={tool === 'select' ? styles.toolActive : ''}
          onClick={() => setTool('select')}
          title="Select and move notes (Shift+drag = marquee)"
        >
          ⬆️ Select
        </button>
        <button
          className={tool === 'erase' ? styles.toolActive : ''}
          onClick={() => setTool('erase')}
          title="Erase notes (right-click also deletes)"
        >
          🧽 Erase
        </button>
        <span>{isSnapEnabled ? `Snap: 1/${gridDivisionBeats === 4 ? '1' : String(4 / gridDivisionBeats * 4)}` : 'Snap: off'}</span>
        <span>Keys: A–K play notes, Z/X octave</span>
        <button
          className={showSynthPanel ? styles.toolActive : ''}
          onClick={() => setShowSynthPanel((v) => !v)}
          disabled={!trackId}
          title="Show/hide the synth parameter panel for this track"
        >
          🎛️ Synth
        </button>
        <span className={styles.spacer} />
        <span>Alt+scroll to zoom</span>
      </div>
      {showSynthPanel && trackId && (
        <SynthPanel
          trackId={trackId}
          synth={trackSynth}
          params={tracks.find((t) => t.id === trackId)?.monarcParams ?? {}}
        />
      )}
      <div className={styles.body}>
        <div className={styles.keyboard} style={{ height: '100%' }}>
          {/* Sticky ruler cell above the keys, stays put on vertical scroll */}
          <div className={styles.rulerCell} aria-hidden="true">Bar</div>
          <div style={{ transform: `translateY(${-kbScrollTop}px)`, position: 'absolute', top: kbKeysTop, left: 0, right: 0 }}>
            {keyPitches.map((p) => {
              const y = RULER_HEIGHT + (MAX_PITCH - p) * noteHeight;
              const active = [...heldKeys].some((k) => basePitch + (KEY_TO_SEMITONE[k] ?? -999) === p);
              return (
                <div
                  key={p}
                  className={`${styles.key} ${isBlackKey(p) ? styles.keyBlack : styles.keyWhite} ${active ? styles.keyActive : ''}`}
                  style={{ top: y, height: noteHeight }}
                  onMouseDown={(e) => handleKeyMouseDown(e, p)}
                  onMouseUp={() => handleKeyMouseUp(p)}
                  onMouseLeave={() => handleKeyMouseUp(p)}
                >
                  {p % 12 === 0 ? noteName(p) : ''}
                </div>
              );
            })}
          </div>
        </div>
        <div
          className={styles.scroll}
          ref={scrollRef}
          onScroll={(e) => setKbScrollTop(e.currentTarget.scrollTop)}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Sticky beats/bar ruler: scrolls horizontally with the grid but
              stays pinned to the top on vertical scroll */}
          <div
            className={styles.ruler}
            style={{ width: contentWidth }}
            onMouseDown={handleRulerMouseDown}
          >
            {Array.from({ length: totalBars + 1 }, (_, bar) => (
              <div
                key={bar}
                className={styles.rulerCellBar}
                style={{ left: bar * BEATS_PER_BAR * pixelsPerBeat }}
              >
                {bar < totalBars ? String(bar + 1) : ''}
              </div>
            ))}
            <div
              className={styles.rulerPlayhead}
              style={{ left: playheadBeats * pixelsPerBeat }}
            />
          </div>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={{ marginTop: RULER_HEIGHT }}
            onMouseDown={handleCanvasMouseDown}
          />
          {tracks.length === 0 && (
            <div className={styles.empty}>Add a track first, then pick it above to edit its MIDI notes.</div>
          )}
          {tracks.length > 0 && !trackId && (
            <div className={styles.empty}>Select a track above to edit its MIDI notes.</div>
          )}
        </div>
      </div>
    </div>
  );
}
