import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './StepSequencer.module.css';
import useTrackStore from '../../store/trackStore';
import { useMidiStore } from '../../store/midiStore';
import { useTransportStore } from '../../store/transportStore';
import * as engine from '../../audio/engine';
import { startNotePreview } from '../../audio/midiSynth';
import { BUNDLED_KIT_IDS, BUNDLED_KIT_LABELS, getCachedKit, indexKitLanes, loadDrumKit } from '../../audio/drumKits';

// Step sequencer grid for drum tracks (feature #194, task #197): an 808/909
// style editor - one lane per drum voice/sample slot, 16 steps default (32/64
// selectable), per-step on/off + velocity/accent. Per the #194 data model
// decision the grid emits MIDI-style note events into the channel (one 1/16th
// note per active step) and stores no timeline format of its own, so
// recording, transport sync, and project save/restore reuse the existing
// MIDI machinery.

const STEP_OPTIONS = [16, 32, 64] as const;
type StepCount = (typeof STEP_OPTIONS)[number];
const STEPS_PER_BEAT = 4; // 16th-note steps
const LANE_PITCHES = [36, 38, 40, 42, 46, 45]; // kick, snare, clap, closed hat, open hat, tom (GM)
const LANE_LABELS = ['Kick', 'Snare', 'Clap', 'Hat', 'Open', 'Tom'];
const LANE_COLORS = ['#f87171', '#fbbf24', '#a78bfa', '#67e8f9', '#34d399', '#f472b6'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface LaneHit {
  noteId: string;
  velocity: number;
}

export default function StepSequencer() {
  const tracks = useTrackStore((s) => s.tracks);
  const notes = useMidiStore((s) => s.notes);
  const addNote = useMidiStore((s) => s.addNote);
  const removeNotes = useMidiStore((s) => s.removeNotes);
  const setNotesVelocity = useMidiStore((s) => s.setNotesVelocity);
  const setPianoRollTrackId = useMidiStore((s) => s.setPianoRollTrackId);
  const pianoRollTrackId = useMidiStore((s) => s.pianoRollTrackId);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const playheadBeats = useTransportStore((s) => s.playheadBeats);
  const [stepCount, setStepCount] = useState<StepCount>(16);

  // The grid edits the active drum track: the piano-roll track if set,
  // otherwise the first track whose synth is 'drum'.
  const trackId = useMemo(() => {
    if (pianoRollTrackId && tracks.some((t) => t.id === pianoRollTrackId)) return pianoRollTrackId;
    return tracks.find((t) => t.synth === 'drum')?.id ?? tracks[0]?.id ?? null;
  }, [pianoRollTrackId, tracks]);
  const track = tracks.find((t) => t.id === trackId);

  // Map lane pitch -> { step -> hit } for the edited track.
  const lanes = useMemo(() => {
    const map = new Map<number, Map<number, LaneHit>>();
    for (const p of LANE_PITCHES) map.set(p, new Map());
    if (!trackId) return map;
    for (const n of notes) {
      if (n.trackId !== trackId) continue;
      const lane = map.get(n.pitch);
      if (!lane) continue;
      const step = Math.round(n.startBeat * STEPS_PER_BEAT) % stepCount;
      lane.set(step, { noteId: n.id, velocity: n.velocity });
    }
    return map;
  }, [notes, trackId, stepCount]);

  // Preload the track's bundled kit so sample lanes preview correctly.
  useEffect(() => {
    if (!track || track.synth !== 'drum' || !track.drumKitId) return;
    const cached = getCachedKit(track.drumKitId);
    if (cached) {
      void cached.then((l) => indexKitLanes(l)).catch(() => undefined);
    } else {
      void loadDrumKit(engine.getAudioContext(), track.drumKitId)
        .then((l) => indexKitLanes(l))
        .catch(() => undefined);
    }
  }, [track]);

  const preview = useCallback((pitch: number, velocity = 100) => {
    if (!trackId) return;
    const dest = engine.getTrackDestination(trackId);
    if (!dest) return;
    void engine.resumeContext();
    startNotePreview(
      engine.getAudioContext(), dest, track?.synth ?? 'base',
      { pitch, velocity }, `seq-${pitch}-${Date.now()}`,
      trackId, track?.monarcParams, track?.drumParams, track?.drumKitId,
    );
  }, [trackId, track]);

  const toggleStep = useCallback((pitch: number, step: number, accent: boolean) => {
    if (!trackId) return;
    const existing = lanes.get(pitch)?.get(step);
    if (existing) {
      removeNotes([existing.noteId]);
    } else {
      const velocity = accent ? 127 : 100;
      addNote({
        trackId,
        pitch,
        startBeat: step / STEPS_PER_BEAT,
        durationBeats: 1 / STEPS_PER_BEAT,
        velocity,
      });
      preview(pitch, velocity);
    }
  }, [trackId, lanes, addNote, removeNotes, preview]);

  // Drag across active steps sets their velocity (vertical drag within a cell).
  const dragState = useRef<{ pitch: number } | null>(null);
  const onStepPointerDown = useCallback((e: React.PointerEvent, pitch: number, step: number) => {
    e.preventDefault();
    gridRef.current?.focus();
    toggleStep(pitch, step, e.shiftKey);
    dragState.current = { pitch };
  }, [toggleStep]);
  const onStepPointerEnter = useCallback((e: React.PointerEvent, pitch: number, step: number, cellTop: number, cellHeight: number) => {
    if (!dragState.current || e.buttons !== 1) return;
    const hit = lanes.get(pitch)?.get(step);
    if (!hit) return;
    const rel = clamp((e.clientY - cellTop) / cellHeight, 0, 1);
    setNotesVelocity([hit.noteId], Math.round(40 + rel * 87));
  }, [lanes, setNotesVelocity]);

  // Keyboard: 1-6 toggles lanes at the playhead step, arrows nudge the playhead.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!trackId || e.metaKey || e.ctrlKey || e.altKey) return;
      const laneIdx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
      if (laneIdx !== -1) {
        const step = clamp(Math.floor(playheadBeats * STEPS_PER_BEAT) % stepCount, 0, stepCount - 1);
        toggleStep(LANE_PITCHES[laneIdx], step, e.shiftKey);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const delta = (e.key === 'ArrowRight' ? 1 : -1) / STEPS_PER_BEAT;
        useTransportStore.getState().setPlayheadBeats(Math.max(0, playheadBeats + delta));
        e.preventDefault();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [trackId, playheadBeats, stepCount, toggleStep]);

  const playheadStep = isPlaying
    ? Math.floor(playheadBeats * STEPS_PER_BEAT) % stepCount
    : null;

  if (!trackId || !track) {
    return (
      <div className={styles.outer}>
        <div className={styles.empty}>No track - add a track to sequence drums.</div>
      </div>
    );
  }

  return (
    <div className={styles.outer}>
      <div className={styles.toolbar}>
        <select
          value={trackId}
          onChange={(e) => setPianoRollTrackId(e.target.value || null)}
          aria-label="Sequenced track"
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.synth === 'drum' ? ' (drums)' : ''}</option>
          ))}
        </select>
        <select
          value={stepCount}
          onChange={(e) => setStepCount(Number(e.target.value) as StepCount)}
          aria-label="Step count"
          title="Steps per pattern"
        >
          {STEP_OPTIONS.map((n) => <option key={n} value={n}>{n} steps</option>)}
        </select>
        {track.synth === 'drum' && (
          <>
            <span>Kit:</span>
            <select
              value={track.drumKitId ?? ''}
              onChange={(e) => {
                useTrackStore.getState().updateTrack(trackId, { drumKitId: e.target.value || undefined });
              }}
              aria-label="Drum kit"
              title="Bundled sample kit for the drum lanes (Synthesized = DSP voices)"
            >
              <option value="">Synthesized</option>
              {BUNDLED_KIT_IDS.map((id) => (
                <option key={id} value={id}>{BUNDLED_KIT_LABELS[id] ?? id}</option>
              ))}
            </select>
          </>
        )}
        <span className={styles.hint}>Click steps · Shift-click = accent · drag on lit steps for velocity · keys 1-6 toggle at playhead · ←/→ nudge</span>
      </div>
      <div
        className={styles.grid}
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Drum step sequencer"
        onPointerUp={() => { dragState.current = null; }}
        onPointerLeave={() => { dragState.current = null; }}
      >
        {LANE_PITCHES.map((pitch, laneIdx) => {
          const lane = lanes.get(pitch) ?? new Map<number, LaneHit>();
          return (
            <div className={styles.row} key={pitch} role="row">
              <div className={styles.laneLabel} style={{ color: LANE_COLORS[laneIdx] }}>
                {LANE_LABELS[laneIdx]}
              </div>
              <div className={styles.steps}>
                {Array.from({ length: stepCount }, (_, step) => {
                  const hit = lane.get(step);
                  const isPlayhead = playheadStep === step;
                  const isBar = step % 4 === 0;
                  const cls = [
                    styles.step,
                    hit ? styles.on : '',
                    hit && hit.velocity >= 120 ? styles.accent : '',
                    isPlayhead ? styles.playhead : '',
                    isBar ? styles.bar : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div
                      key={step}
                      className={cls}
                      style={hit ? { background: LANE_COLORS[laneIdx], height: `${30 + (hit.velocity / 127) * 70}%` } : undefined}
                      role="gridcell"
                      aria-selected={!!hit}
                      aria-label={`${LANE_LABELS[laneIdx]} step ${step + 1}${hit ? `, velocity ${hit.velocity}` : ''}`}
                      onPointerDown={(e) => onStepPointerDown(e, pitch, step)}
                      onPointerEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onStepPointerEnter(e, pitch, step, rect.top, rect.height);
                      }}
                      onDoubleClick={() => preview(pitch, 110)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
