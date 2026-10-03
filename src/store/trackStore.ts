// Track Store with undo/redo functionality
import { create } from 'zustand';
import { Track, Clip } from '../types/daw';
import { generateClipId } from '../utils/idGenerator';

export interface TrackState {
  tracks: Track[];
  selectedTrackIds: string[];
  activeTrackId: string | null;
  selectedClipIds: string[];
  undoStack: Track[][];
  redoStack: Track[][];
  clipboard: Clip[];  // Added clipboard to TrackState
  clipGainSessionActive: boolean;  // True between the first +/-/0 gain keypress and the keyup that ends the burst

  // Track and Clip Management
  addTrack: (track: Omit<Track, 'id' | 'clips'>) => void;
  createTracksForClips: (clips: { name: string; durationBeats: number; audioBufferId: string }[], startBeat: number) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  setTracks: (tracks: Track[]) => void;
  clearTracks: () => void;
  removeTrack: (trackId: string) => void;
  setActiveTrack: (trackId: string | null) => void;
  selectTrack: (trackId: string, mode?: 'toggle' | 'range' | 'replace') => void;
  deselectTrack: (trackId: string) => void;
  selectOnlyTrack: (trackId: string) => void;
  toggleTrackSelection: (trackId: string) => void;
  clearSelectedTracks: () => void;
  addClipToTrack: (trackId: string, clip: Omit<Clip, 'id' | 'trackId' | 'color'> & Partial<Pick<Clip, 'trackId' | 'color'>>) => void;
  removeClipFromTrack: (trackId: string, clipId: string) => void;
  updateClip: (trackId: string, clipId: string, updates: Partial<Clip>) => void;
  selectClip: (clipId: string, additive?: boolean) => void;
  deselectClip: (clipId: string) => void;
  selectOnlyClip: (clipId: string) => void;
  toggleClipSelection: (clipId: string) => void;
  clearSelectedClips: () => void;
  splitClip: (trackId: string, clipId: string, splitBeat: number) => void;
  splitClipsAt: (splitBeats: number[], trackIds?: string[]) => void;
  quantizeSelected: (gridBeats: number) => void;
  trimClip: (clipId: string, updates: Pick<Clip, 'startBeat' | 'durationBeats'> & Partial<Pick<Clip, 'bufferOffsetBeats'>>) => void;
  addClip: {
    (trackId: string, clip: Omit<Clip, 'id' | 'trackId' | 'color'> & Partial<Pick<Clip, 'trackId' | 'color'>>): void;
    (trackId: string, startBeat: number, durationBeats: number, name: string, audioBufferId: string): void;
  };
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
  adjustSelectedClipGain: (deltaDb: number) => void;
  resetSelectedClipGain: () => void;
  endClipGainSession: () => void;

  // New functions for multi-track controls
  toggleArmSelected: () => void;
  toggleMuteSelected: () => void;
  toggleSoloSelected: () => void;
  deleteSelectedTracks: () => void;
  duplicateSelected: () => void;
  
  // Clip-level mute function
  toggleMuteSelectedClips: () => void;

  // Reorder tracks by moving a track from one index to another
  reorderTrack: (fromIndex: number, toIndex: number) => void;
}

// Clip gain adjustment bounds (issue #147). Values live on each clip as linear
// amplitude multipliers; the +/-/0 shortcuts work in dB and convert here.
const MIN_CLIP_GAIN_DB = -30;
const MAX_CLIP_GAIN_DB = 12;
const clipGainToDb = (clipGain: number | undefined): number =>
  Math.round(20 * Math.log10(clipGain ?? 1) * 10) / 10;
const dbToClipGain = (db: number): number => Math.pow(10, db / 20);

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

export const useTrackStore = create<TrackState>((set) => ({
  tracks: [],
  selectedTrackIds: [],
  activeTrackId: null,
  selectedClipIds: [],
  undoStack: [],
  redoStack: [],
  clipboard: [],
  clipGainSessionActive: false,

  // Track and Clip Management
  addTrack: (track) => {
    const id = Date.now().toString();
    set((state) => ({
      tracks: [...state.tracks, { ...track, id, clips: [] }],
      activeTrackId: state.activeTrackId || id,
      selectedTrackIds: state.selectedTrackIds.length === 0 ? [id] : state.selectedTrackIds,
    }));
  },

  createTracksForClips: (clips, startBeat) => {
    set((state) => {
      const newTracks: Track[] = clips.map((clip, index) => {
        const id = `${Date.now()}-${index}`;
        return {
          id,
          name: clip.name,
          muted: false,
          soloed: false,
          armed: false,
          volume: 1,
          pan: 0,
          color: '#4f46e5',
          clips: [{
            ...clip,
            id: generateClipId(),
            trackId: id,
            color: '#4f46e5',
            startBeat,
          }],
        };
      });

      return {
        tracks: [...state.tracks, ...newTracks],
        activeTrackId: newTracks[0]?.id ?? state.activeTrackId,
        selectedTrackIds: newTracks.length > 0 ? [newTracks[0].id] : state.selectedTrackIds,
      };
    });
  },

  updateTrack: (trackId, updates) => {
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId ? { ...track, ...updates } : track
      ),
    }));
  },

  setTracks: (tracks) => {
    set({
      tracks,
      selectedTrackIds: [],
      activeTrackId: null,
      selectedClipIds: [],
      undoStack: [],
      redoStack: [],
    });
  },

  clearTracks: () => {
    set({
      tracks: [],
      selectedTrackIds: [],
      activeTrackId: null,
      selectedClipIds: [],
      undoStack: [],
      redoStack: [],
    });
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

  selectTrack: (trackId, mode) => {
    set((state) => {
      if (mode === 'replace') {
        return { selectedTrackIds: [trackId], activeTrackId: trackId };
      }
      if (mode === 'toggle') {
        return {
          selectedTrackIds: state.selectedTrackIds.includes(trackId)
            ? state.selectedTrackIds.filter((id) => id !== trackId)
            : [...state.selectedTrackIds, trackId],
        };
      }
      if (mode === 'range' && state.activeTrackId) {
        const anchor = state.tracks.findIndex((track) => track.id === state.activeTrackId);
        const target = state.tracks.findIndex((track) => track.id === trackId);
        if (anchor !== -1 && target !== -1) {
          return {
            selectedTrackIds: state.tracks
              .slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
              .map((track) => track.id),
          };
        }
      }
      return {
        selectedTrackIds: state.selectedTrackIds.includes(trackId)
          ? state.selectedTrackIds
          : [...state.selectedTrackIds, trackId],
      };
    });
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
          ? {
              ...track,
              clips: [...track.clips, {
                ...clip,
                id: generateClipId(),
                trackId,
                color: clip.color ?? track.color,
              }],
            }
          : track
      ),
    }));
  },

  addClip: ((trackId: string, clipOrStartBeat: number | (Omit<Clip, 'id' | 'trackId' | 'color'> & Partial<Pick<Clip, 'trackId' | 'color'>>), durationBeats?: number, name?: string, audioBufferId?: string) => {
    const clip = typeof clipOrStartBeat === 'number'
      ? {
          startBeat: clipOrStartBeat,
          durationBeats: durationBeats ?? 0,
          name: name ?? 'Audio',
          audioBufferId,
        }
      : clipOrStartBeat;
    useTrackStore.getState().addClipToTrack(trackId, clip);
  }) as TrackState['addClip'],

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

  selectClip: (clipId, additive = false) => {
    set((state) => ({
      selectedClipIds: additive
        ? state.selectedClipIds.includes(clipId)
          ? state.selectedClipIds
          : [...state.selectedClipIds, clipId]
        : [clipId],
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
        bufferOffsetBeats: (clip.bufferOffsetBeats ?? 0) + splitBeat - clip.startBeat,
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

  trimClip: (clipId, updates) => {
    set((state) => {
      let found = false;
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          found = true;
          return { ...clip, ...updates };
        }),
      }));
      return found ? { tracks } : state;
    });
  },

  splitClipsAt: (splitBeats, trackIds) => {
    set((state) => {
      const boundaries = [...new Set(splitBeats.filter(Number.isFinite))].sort((a, b) => a - b);

      // Split only on the target tracks (issue #152): explicit trackIds if
      // given, otherwise the selected tracks, falling back to the active
      // track, and defensively to all tracks.
      let targetTrackIds: string[];
      if (trackIds) {
        targetTrackIds = trackIds;
      } else if (state.selectedTrackIds.length > 0) {
        targetTrackIds = state.selectedTrackIds;
      } else if (state.activeTrackId) {
        targetTrackIds = [state.activeTrackId];
      } else {
        targetTrackIds = state.tracks.map((t) => t.id);
      }
      const target = new Set(targetTrackIds);

      let didSplit = false;
      const tracks = state.tracks.map((track) => {
        // Untouched tracks keep their object identity (issue #152)
        if (!target.has(track.id)) return track;
        return {
          ...track,
          clips: track.clips.flatMap((clip) => {
            const clipBoundaries = boundaries.filter(
              (beat) => beat > clip.startBeat && beat < clip.startBeat + clip.durationBeats
            );
            if (clipBoundaries.length === 0) return [clip];

            didSplit = true;
            const splitPoints = [clip.startBeat, ...clipBoundaries, clip.startBeat + clip.durationBeats];
            return splitPoints.slice(1).map((endBeat, index) => ({
              ...clip,
              id: index === 0 ? clip.id : generateClipId(),
              startBeat: splitPoints[index],
              durationBeats: endBeat - splitPoints[index],
              bufferOffsetBeats: (clip.bufferOffsetBeats ?? 0) + splitPoints[index] - clip.startBeat,
            }));
          }),
        };
      });

      if (!didSplit) return state;
      return {
        tracks,
        undoStack: [...state.undoStack, state.tracks],
        redoStack: [],
      };
    });
  },

  quantizeSelected: (gridBeats) => {
    set((state) => {
      if (!Number.isFinite(gridBeats) || gridBeats <= 0) return state;

      let didQuantize = false;
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!state.selectedClipIds.includes(clip.id)) return clip;
          const startBeat = Math.round(clip.startBeat / gridBeats) * gridBeats;
          if (startBeat === clip.startBeat) return clip;
          didQuantize = true;
          return { ...clip, startBeat };
        }),
      }));

      if (!didQuantize) return state;
      return {
        tracks,
        undoStack: [...state.undoStack, state.tracks],
        redoStack: [],
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
            if (track.id === newTrackId) {
              // Same track: update the clip in place instead of remove-then-add
              return {
                ...track,
                clips: track.clips.map((c) =>
                  c.id === clipId ? { ...c, startBeat: newStartBeat } : c
                ),
              };
            }
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
        clipGainSessionActive: false,
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
        clipGainSessionActive: false,
      };
    });
  },

  adjustSelectedClipGain: (deltaDb) => {
    set((state) => {
      const selected = new Set(state.selectedClipIds);
      if (selected.size === 0) return state;

      let didAdjust = false;
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!selected.has(clip.id)) return clip;
          const nextDb = Math.round((clipGainToDb(clip.clipGain) + deltaDb) * 10) / 10;
          // At the bounds the adjustment no-ops for that clip
          if (nextDb > MAX_CLIP_GAIN_DB || nextDb < MIN_CLIP_GAIN_DB) return clip;
          didAdjust = true;
          return { ...clip, clipGain: dbToClipGain(nextDb) };
        }),
      }));

      if (!didAdjust) return state;
      // One undo snapshot per consecutive adjustment session, pushed on the
      // first keypress; later keypresses in the same burst only move gains.
      return {
        tracks,
        undoStack: state.clipGainSessionActive ? state.undoStack : [...state.undoStack, state.tracks],
        redoStack: state.clipGainSessionActive ? state.redoStack : [],
        clipGainSessionActive: true,
      };
    });
  },

  resetSelectedClipGain: () => {
    set((state) => {
      const selected = new Set(state.selectedClipIds);
      if (selected.size === 0) return state;

      let didReset = false;
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!selected.has(clip.id)) return clip;
          if ((clip.clipGain ?? 1) === 1) return clip;
          didReset = true;
          return { ...clip, clipGain: 1 };
        }),
      }));

      if (!didReset) return state;
      return {
        tracks,
        undoStack: state.clipGainSessionActive ? state.undoStack : [...state.undoStack, state.tracks],
        redoStack: state.clipGainSessionActive ? state.redoStack : [],
        clipGainSessionActive: true,
      };
    });
  },

  endClipGainSession: () => {
    set((state) => (state.clipGainSessionActive ? { clipGainSessionActive: false } : state));
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

  toggleMuteSelectedClips: () => {
    set((state) => {
      const selectedClipIds = new Set(state.selectedClipIds);
      if (selectedClipIds.size === 0) return state;

      let didToggle = false;
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!selectedClipIds.has(clip.id)) return clip;
          didToggle = true;
          return { ...clip, muted: !clip.muted };
        }),
      }));

      if (!didToggle) return state;
      return { tracks };
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