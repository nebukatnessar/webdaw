// MIDI note store for the piano roll (feature #26, tasks #63/#64).
// Notes live per track id, mirroring how clips live on tracks, and share the
// same beat clock as the arrange view. Undo/redo follows the same snapshot
// pattern as trackStore: each mutating action pushes the previous notes array.
import { create } from 'zustand';
import type { MidiNote } from '../types/daw';

export interface MidiState {
  notes: MidiNote[];
  selectedNoteIds: string[];
  // Track whose notes the piano roll is editing; null = follow the active
  // track from trackStore
  pianoRollTrackId: string | null;
  undoStack: MidiNote[][];
  redoStack: MidiNote[][];

  setNotes: (notes: MidiNote[]) => void;
  clearNotes: () => void;
  setPianoRollTrackId: (trackId: string | null) => void;
  addNote: (note: Omit<MidiNote, 'id'>) => string;
  updateNote: (noteId: string, updates: Partial<Omit<MidiNote, 'id' | 'trackId'>>) => void;
  removeNote: (noteId: string) => void;
  removeNotes: (noteIds: string[]) => void;
  moveNotes: (noteIds: string[], deltaBeats: number, deltaPitch: number) => void;
  resizeNote: (noteId: string, durationBeats: number) => void;
  setNotesVelocity: (noteIds: string[], velocity: number) => void;
  selectNote: (noteId: string, additive?: boolean) => void;
  selectOnlyNote: (noteId: string) => void;
  toggleNoteSelection: (noteId: string) => void;
  clearSelectedNotes: () => void;
  selectNotesInRange: (trackId: string, startBeat: number, endBeat: number, minPitch: number, maxPitch: number, additive?: boolean) => void;
  undo: () => void;
  redo: () => void;
}

type MidiSet = (partial: Partial<MidiState> | ((state: MidiState) => Partial<MidiState>)) => void;

const pushUndo = (set: MidiSet, state: MidiState) => {
  set({
    undoStack: [...state.undoStack, state.notes],
    redoStack: [],
  });
};

export const useMidiStore = create<MidiState>((set, get) => ({
  notes: [],
  selectedNoteIds: [],
  pianoRollTrackId: null,
  undoStack: [],
  redoStack: [],

  setNotes: (notes) => set({ notes, selectedNoteIds: [], undoStack: [], redoStack: [] }),
  clearNotes: () => set({ notes: [], selectedNoteIds: [], undoStack: [], redoStack: [] }),
  setPianoRollTrackId: (trackId) => set({ pianoRollTrackId: trackId }),

  addNote: (note) => {
    const state = get();
    pushUndo(set, state);
    const id = crypto.randomUUID();
    set((s) => ({
      notes: [...s.notes, { ...note, id }],
      selectedNoteIds: [id],
    }));
    return id;
  },

  updateNote: (noteId, updates) => {
    const state = get();
    if (!state.notes.some((n) => n.id === noteId)) return;
    pushUndo(set, state);
    set((s) => ({
      notes: s.notes.map((n) => (n.id === noteId ? { ...n, ...updates } : n)),
    }));
  },

  removeNote: (noteId) => {
    get().removeNotes([noteId]);
  },

  removeNotes: (noteIds) => {
    const state = get();
    if (!state.notes.some((n) => noteIds.includes(n.id))) return;
    pushUndo(set, state);
    const idSet = new Set(noteIds);
    set((s) => ({
      notes: s.notes.filter((n) => !idSet.has(n.id)),
      selectedNoteIds: s.selectedNoteIds.filter((id) => !idSet.has(id)),
    }));
  },

  moveNotes: (noteIds, deltaBeats, deltaPitch) => {
    const state = get();
    const idSet = new Set(noteIds);
    if (!state.notes.some((n) => idSet.has(n.id))) return;
    pushUndo(set, state);
    set((s) => ({
      notes: s.notes.map((n) =>
        idSet.has(n.id)
          ? {
              ...n,
              startBeat: Math.max(0, n.startBeat + deltaBeats),
              pitch: Math.min(127, Math.max(0, n.pitch + deltaPitch)),
            }
          : n,
      ),
    }));
  },

  resizeNote: (noteId, durationBeats) => {
    get().updateNote(noteId, { durationBeats: Math.max(1 / 16, durationBeats) });
  },

  setNotesVelocity: (noteIds, velocity) => {
    const state = get();
    const idSet = new Set(noteIds);
    if (!state.notes.some((n) => idSet.has(n.id))) return;
    pushUndo(set, state);
    const v = Math.min(127, Math.max(1, Math.round(velocity)));
    set((s) => ({
      notes: s.notes.map((n) => (idSet.has(n.id) ? { ...n, velocity: v } : n)),
    }));
  },

  selectNote: (noteId, additive = false) => {
    set((s) => ({
      selectedNoteIds: additive
        ? s.selectedNoteIds.includes(noteId)
          ? s.selectedNoteIds.filter((id) => id !== noteId)
          : [...s.selectedNoteIds, noteId]
        : [noteId],
    }));
  },

  selectOnlyNote: (noteId) => set({ selectedNoteIds: [noteId] }),

  toggleNoteSelection: (noteId) => get().selectNote(noteId, true),

  clearSelectedNotes: () => set({ selectedNoteIds: [] }),

  selectNotesInRange: (trackId, startBeat, endBeat, minPitch, maxPitch, additive = false) => {
    const lo = Math.min(startBeat, endBeat);
    const hi = Math.max(startBeat, endBeat);
    const matched = get().notes.filter(
      (n) =>
        n.trackId === trackId &&
        n.startBeat < hi &&
        n.startBeat + n.durationBeats > lo &&
        n.pitch >= minPitch &&
        n.pitch <= maxPitch,
    );
    set((s) => ({
      selectedNoteIds: additive
        ? [...new Set([...s.selectedNoteIds, ...matched.map((n) => n.id)])]
        : matched.map((n) => n.id),
    }));
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    set({
      notes: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, state.notes],
      selectedNoteIds: state.selectedNoteIds.filter((id) => previous.some((n) => n.id === id)),
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    set({
      notes: next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, state.notes],
      selectedNoteIds: state.selectedNoteIds.filter((id) => next.some((n) => n.id === id)),
    });
  },
}));
