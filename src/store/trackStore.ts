// Track Store with undo/redo functionality
import { create } from 'zustand';
import { Track, Clip } from '../types/daw';
import { generateClipId } from '../utils/idGenerator';

interface TrackState {
  tracks: Track[];
  selectedTrackIds: string[];
  activeTrackId: string | null;
  selectedClipIds: string[];
  undoStack: Track[][];
  redoStack: Track[][];
  clipboard: Clip[];  // Added clipboard to TrackState

  // Track and Clip Management
  addTrack: (track: Omit<Track, 'id' | 'clips'>) => void;
  removeTrack: (trackId: string) => void;
  setActiveTrack: (trackId: string | null) => void;
  selectTrack: (trackId: string) => void;
  deselectTrack: (trackId: string) => void;
  selectOnlyTrack: (trackId: string) => void;
  toggleTrackSelection: (trackId: string) => void;
  clearSelectedTracks: () => void;
  addClipToTrack: (trackId: string, clip: Omit<Clip, 'id'>) => void;
  removeClipFromTrack: (trackId: string, clipId: string) => void;
  updateClip: (trackId: string, clipId: string, updates: Partial<Clip>) => void;
  selectClip: (clipId: string) => void;
  deselectClip: (clipId: string) => void;
  selectOnlyClip: (clipId: string) => void;
  toggleClipSelection: (clipId: string) => void;
  clearSelectedClips: () => void;
  splitClip: (trackId: string, clipId: string, splitBeat: number) => void;
  trimClipStart: (trackId: string, clipId: string, newStartBeat: number) => void;
  trimClipEnd: (trackId: string, clipId: string, newEndBeat: number) => void;
  moveClip: (clipId: string, newTrackId: string, newStartBeat: number) => void;
  resizeClip: (trackId: string, clipId: string, newStartBeat: number, newDuration: number) => void;
  cutSelectedClips: () => void;
  copySelectedClips: () => void;
  pasteClips: (targetTrackId: string, targetStartBeat: number) => void;
  deleteSelectedClips: () => void;
  undo: () => void;
  redo: () => void;

  // New functions for multi-track controls
  toggleArmSelected: () => void;
  toggleMuteSelected: () => void;
  toggleSoloSelected: () => void;
  deleteSelectedTracks: () => void;
  duplicateSelected: () => void;

  // Reorder tracks by moving a track from one index to another
  reorderTrack: (fromIndex: number, toIndex: number) => void;
}

// Helper function to get selected clips
const getSelectedClips = (tracks: Track[], selectedClipIds: string[]): { clip: Clip; trackId: string }[] => {
  const selectedClips: { clip: Clip; trackId: string }[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (selectedClipIds.includes(clip.id)) {
        selectedClips.push({ clip, trackId: track.id });
      }
    }
  }
  return selectedClips;
};

// Helper to push state to undo stack
const pushToUndoStack = (state: TrackState, tracks: Track[]) => {
  state.undoStack = [...state.undoStack, state.tracks];
  state.redoStack = [];
  state.tracks = tracks;
};

const useTrackStore = create<TrackState>((set) => ({
  tracks: [],
  selectedTrackIds: [],
  activeTrackId: null,
  selectedClipIds: [],
  undoStack: [],
  redoStack: [],
  clipboard: [],

  // Track and Clip Management
  addTrack: (track) => {
    set((state) => ({
      tracks: [...state.tracks, { ...track, id: Date.now().toString(), clips: [] }],
      activeTrackId: state.activeTrackId || Date.now().toString(),
      selectedTrackIds: state.selectedTrackIds.length === 0 ? [Date.now().toString()] : state.selectedTrackIds,
    }));
  },

  removeTrack: (trackId) => {
    set((state) => ({
      tracks: state.tracks.filter((t) => t.id !== trackId),
      selectedTrackIds: state.selectedTrackIds.filter((id) => id !== trackId),
      activeTrackId: state.activeTrackId === trackId ? null : state.activeTrackId,
    }));
  },

  setActiveTrack: (trackId) => {
    set({ activeTrackId: trackId });
  },

  selectTrack: (trackId) => {
    set((state) => ({
      selectedTrackIds: [...state.selectedTrackIds, trackId],
    }));
  },

  deselectTrack: (trackId) => {
    set((state) => ({
      selectedTrackIds: state.selectedTrackIds.filter((id) => id !== trackId),
    }));
  },

  selectOnlyTrack: (trackId) => {
    set({
      selectedTrackIds: [trackId],
      activeTrackId: trackId,
    });
  },

  toggleTrackSelection: (trackId) => {
    set((state) => ({
      selectedTrackIds: state.selectedTrackIds.includes(trackId)
        ? state.selectedTrackIds.filter((id) => id !== trackId)
        : [...state.selectedTrackIds, trackId],
    }));
  },

  clearSelectedTracks: () => {
    set({ selectedTrackIds: [] });
  },

  addClipToTrack: (trackId, clip) => {
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? { ...track, clips: [...track.clips, { ...clip, id: generateClipId() }] }
          : track
      ),
    }));
  },

  removeClipFromTrack: (trackId, clipId) => {
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? { ...track, clips: track.clips.filter((c) => c.id !== clipId) }
          : track
      ),
    }));
  },

  updateClip: (trackId, clipId, updates) => {
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === clipId ? { ...clip, ...updates } : clip
              ),
            }
          : track
      ),
    }));
  },

  selectClip: (clipId) => {
    set((state) => ({
      selectedClipIds: [...state.selectedClipIds, clipId],
    }));
  },

  deselectClip: (clipId) => {
    set((state) => ({
      selectedClipIds: state.selectedClipIds.filter((id) => id !== clipId),
    }));
  },

  selectOnlyClip: (clipId) => {
    set({ selectedClipIds: [clipId] });
  },

  toggleClipSelection: (clipId) => {
    set((state) => ({
      selectedClipIds: state.selectedClipIds.includes(clipId)
        ? state.selectedClipIds.filter((id) => id !== clipId)
        : [...state.selectedClipIds, clipId],
    }));
  },

  clearSelectedClips: () => {
    set({ selectedClipIds: [] });
  },

  splitClip: (trackId, clipId, splitBeat) => {
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return state;

      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return state;

      if (splitBeat <= clip.startBeat || splitBeat >= clip.startBeat + clip.durationBeats) {
        return state;
      }

      const newClip = {
        ...clip,
        id: generateClipId(),
        startBeat: splitBeat,
        durationBeats: clip.startBeat + clip.durationBeats - splitBeat,
      };

      const updatedClip = {
        ...clip,
        durationBeats: splitBeat - clip.startBeat,
      };

      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips
                  .filter((c) => c.id !== clipId)
                  .concat([updatedClip, newClip]),
              }
            : t
        ),
      };
    });
  },

  trimClipStart: (trackId, clipId, newStartBeat) => {
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return state;

      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return state;

      if (newStartBeat >= clip.startBeat + clip.durationBeats) return state;

      const updatedClip = {
        ...clip,
        startBeat: newStartBeat,
        durationBeats: clip.startBeat + clip.durationBeats - newStartBeat,
      };

      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? updatedClip : c)),
              }
            : t
        ),
      };
    });
  },

  trimClipEnd: (trackId, clipId, newEndBeat) => {
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return state;

      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return state;

      if (newEndBeat <= clip.startBeat) return state;

      const updatedClip = {
        ...clip,
        durationBeats: newEndBeat - clip.startBeat,
      };

      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? updatedClip : c)),
              }
            : t
        ),
      };
    });
  },

  moveClip: (clipId, newTrackId, newStartBeat) => {
    set((state) => {
      const sourceTrack = state.tracks.find((t) => t.clips.some((c) => c.id === clipId));
      if (!sourceTrack) return state;

      const clip = sourceTrack.clips.find((c) => c.id === clipId);
      if (!clip) return state;

      return {
        tracks: state.tracks.map((track) => {
          if (track.id === sourceTrack.id) {
            return {
              ...track,
              clips: track.clips.filter((c) => c.id !== clipId),
            };
          }
          if (track.id === newTrackId) {
            return {
              ...track,
              clips: [...track.clips, { ...clip, startBeat: newStartBeat, trackId: newTrackId }],
            };
          }
          return track;
        }),
      };
    });
  },

  resizeClip: (trackId, clipId, newStartBeat, newDuration) => {
    set((state) => {
      return {
        tracks: state.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                clips: track.clips.map((clip) =>
                  clip.id === clipId
                    ? { ...clip, startBeat: newStartBeat, durationBeats: newDuration }
                    : clip
                ),
              }
            : track
        ),
      };
    });
  },

  cutSelectedClips: () => {
    set((state) => {
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      if (selectedClips.length === 0) return state;

      const newTracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => !state.selectedClipIds.includes(clip.id)),
      }));

      return {
        tracks: newTracks,
        clipboard: selectedClips.map(({ clip }) => clip),
        selectedClipIds: [],
      };
    });
  },

  copySelectedClips: () => {
    set((state) => {
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      if (selectedClips.length === 0) return state;

      return {
        clipboard: selectedClips.map(({ clip }) => clip),
      };
    });
  },

  pasteClips: (targetTrackId, targetStartBeat) => {
    set((state) => {
      if (state.clipboard.length === 0) return state;

      const batchStart = Math.min(...state.clipboard.map((clip) => clip.startBeat));
      const offset = targetStartBeat - batchStart;

      const newClips = state.clipboard.map((clip) => ({
        ...clip,
        id: generateClipId(),
        startBeat: clip.startBeat + offset,
        trackId: targetTrackId,
      }));

      return {
        tracks: state.tracks.map((track) =>
          track.id === targetTrackId
            ? { ...track, clips: [...track.clips, ...newClips] }
            : track
        ),
        selectedClipIds: newClips.map((clip) => clip.id),
      };
    });
  },

  deleteSelectedClips: () => {
    set((state) => {
      const newTracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => !state.selectedClipIds.includes(clip.id)),
      }));

      return {
        tracks: newTracks,
        selectedClipIds: [],
      };
    });
  },

  undo: () => {
    set((state) => {
      if (state.undoStack.length === 0) return state;

      const previousState = state.undoStack[state.undoStack.length - 1];
      return {
        tracks: previousState,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.tracks],
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.redoStack.length === 0) return state;

      const nextState = state.redoStack[state.redoStack.length - 1];
      return {
        tracks: nextState,
        undoStack: [...state.undoStack, state.tracks],
        redoStack: state.redoStack.slice(0, -1),
      };
    });
  },

  // New functions for multi-track controls
  toggleArmSelected: () => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        state.selectedTrackIds.includes(t.id)
          ? { ...t, armed: !t.armed }
          : t
      ),
    }));
  },

  toggleMuteSelected: () => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        state.selectedTrackIds.includes(t.id)
          ? { ...t, muted: !t.muted }
          : t
      ),
    }));
  },

  toggleSoloSelected: () => {
    set((state) => {
      // If any selected track is soloed, unsolo all selected tracks
      const anySoloed = state.selectedTrackIds.some((id) => {
        const track = state.tracks.find((t) => t.id === id);
        return track?.soloed;
      });
      return {
        tracks: state.tracks.map((t) =>
          state.selectedTrackIds.includes(t.id)
            ? { ...t, soloed: !anySoloed }
            : t
        ),
      };
    });
  },

  deleteSelectedTracks: () => {
    set((state) => {
      const selectedIds = new Set(state.selectedTrackIds);
      const newTracks = state.tracks.filter((t) => !selectedIds.has(t.id));
      
      // Update active track: if the active track was deleted, promote the nearest remaining track
      let newActiveTrackId = state.activeTrackId;
      let newSelectedTrackIds = state.selectedTrackIds.filter((id) => !selectedIds.has(id));
      
      if (state.activeTrackId !== null && selectedIds.has(state.activeTrackId)) {
        newActiveTrackId = null;
        newSelectedTrackIds = [];
        if (newTracks.length > 0) {
          // Prefer the first remaining track
          newActiveTrackId = newTracks[0].id;
          newSelectedTrackIds = [newActiveTrackId];
        }
      } else if (newSelectedTrackIds.length === 0 && newTracks.length > 0) {
        // If selection is empty but tracks remain, select the first track
        newActiveTrackId = newTracks[0].id;
        newSelectedTrackIds = [newActiveTrackId];
      }
      
      return {
        tracks: newTracks,
        selectedTrackIds: newSelectedTrackIds,
        activeTrackId: newActiveTrackId,
      };
    });
  },

  duplicateSelected: () => {
    set((state) => {
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      if (selectedClips.length === 0) return state;
      
      // Push current state to undo stack
      const newUndoStack = [...state.undoStack, state.tracks];
      
      // Calculate batchStart and batchEnd
      const batchStart = Math.min(...selectedClips.map(({ clip }) => clip.startBeat));
      const batchEnd = Math.max(...selectedClips.map(({ clip }) => clip.startBeat + clip.durationBeats));
      const offset = batchEnd - batchStart;
      
      // Create new clips with fresh IDs and offset positions
      const newClips: Clip[] = selectedClips.map(({ clip }) => ({
        ...clip,
        id: generateClipId(),
        startBeat: clip.startBeat + offset,
      }));
      
      // Build a map of trackId -> clips to duplicate
      const clipsByTrackId: Record<string, Clip[]> = {};
      for (const clip of newClips) {
        if (!clipsByTrackId[clip.trackId]) {
          clipsByTrackId[clip.trackId] = [];
        }
        clipsByTrackId[clip.trackId].push(clip);
      }
      
      // Add duplicated clips to their original tracks
      const newTracks = state.tracks.map((track) => {
        const clipsToAdd = clipsByTrackId[track.id];
        if (clipsToAdd && clipsToAdd.length > 0) {
          return { ...track, clips: [...track.clips, ...clipsToAdd] };
        }
        return track;
      });
      
      // Select the newly duplicated clips
      const newSelectedClipIds = newClips.map((clip) => clip.id);
      
      return {
        tracks: newTracks,
        selectedClipIds: newSelectedClipIds,
        undoStack: newUndoStack,
        redoStack: [],
      };
    });
  },
  
  // Reorder tracks by moving a track from one index to another
  reorderTrack: (fromIndex: number, toIndex: number) => {
    set((state) => {
      const newTracks = [...state.tracks];
      const [trackToMove] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, trackToMove);
      return { tracks: newTracks };
    });
  },
}));

export default useTrackStore;