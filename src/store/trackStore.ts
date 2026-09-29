import { create } from 'zustand';
import type { Track, Clip } from '../types/daw';
import { getDefaultCompressorSettings } from '../audio/compressor';
import { getDefaultGateSettings } from '../audio/gate';
import { getDefaultEQSettings } from '../audio/eq';
import { getDefaultReverbSettings } from '../audio/reverb';
import { getDefaultDelaySettings } from '../audio/delay';

const TRACK_COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2'];

interface TrackState {
  tracks: Track[];
  selectedTrackIds: string[];
  activeTrackId: string | null;
  selectedClipIds: string[];
  clipboard: Clip[];
  addTrack: () => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  setTracks: (tracks: Track[]) => void;
  clearTracks: () => void;
  selectTrack: (id: string, mode: 'replace' | 'toggle' | 'range') => void;
  setActiveTrack: (id: string) => void;
  addClip: (
    trackId: string,
    startBeat: number,
    durationBeats: number,
    name: string,
    audioBufferId: string,
  ) => void;
  moveClip: (clipId: string, fromTrackId: string, toTrackId: string, newStartBeat: number) => void;
  createTracksForClips: (
    clips: Array<{ name: string; durationBeats: number; audioBufferId: string }>,
    startBeat: number,
  ) => void;
  splitClipsAt: (beats: number[], trackIds?: string[]) => void;
  undoSplit: () => void;
  trimClip: (clipId: string, patch: { startBeat: number; bufferOffsetBeats: number; durationBeats: number }) => void;
  selectClip: (id: string, additive: boolean) => void;
  clearClipSelection: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  pasteAtPlayhead: (playheadBeats: number) => void;
  deleteSelected: () => void;
  // New functions for multi-track controls
  toggleArmSelected: () => void;
  toggleMuteSelected: () => void;
  toggleSoloSelected: () => void;
  deleteSelectedTracks: () => void;
}

let trackCounter = 0;

// Undo stack for split, trim, cut, paste, and delete operations
const undoStack: Track[][] = [];
const MAX_UNDO_STACK = 50;

function pushToUndoStack(tracks: Track[]): void {
  undoStack.push(JSON.parse(JSON.stringify(tracks)));
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift();
  }
}

function generateClipId(): string {
  return `clip-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// Helper function to split clips at a single boundary for specific tracks
function splitClipsAtBoundary(tracks: Track[], boundaryBeat: number, trackFilter: (trackId: string) => boolean): Track[] {
  return tracks.map((track) => {
    // Skip tracks that don't match the filter
    if (!trackFilter(track.id)) {
      return track;
    }
    
    const newClips: Clip[] = [];
    for (const clip of track.clips) {
      const clipStart = clip.startBeat;
      const clipEnd = clip.startBeat + clip.durationBeats;
      
      // Check if the boundary is strictly inside the clip
      if (clipStart < boundaryBeat && boundaryBeat < clipEnd) {
        // Create left clip
        const leftClip: Clip = {
          ...clip,
          durationBeats: boundaryBeat - clipStart,
        };
        newClips.push(leftClip);
        
        // Create right clip
        const rightClip: Clip = {
          ...clip,
          id: generateClipId(),
          startBeat: boundaryBeat,
          bufferOffsetBeats: (clip.bufferOffsetBeats ?? 0) + (boundaryBeat - clipStart),
          durationBeats: clipEnd - boundaryBeat,
        };
        newClips.push(rightClip);
      } else {
        // No split needed for this clip
        newClips.push(clip);
      }
    }
    return { ...track, clips: newClips };
  });
}

// Helper to find the index of a track in the tracks array
function findTrackIndex(tracks: Track[], trackId: string): number {
  return tracks.findIndex((t) => t.id === trackId);
}

// Helper to get the nearest track to the removed active track
function getNearestTrackIndex(tracks: Track[], removedIndex: number): number | null {
  if (tracks.length === 0) return null;
  // Prefer the track below (higher index)
  if (removedIndex < tracks.length - 1) {
    return removedIndex + 1;
  }
  // Otherwise, the track above (lower index)
  if (removedIndex > 0) {
    return removedIndex - 1;
  }
  // If it was the only track, return null (handled by clearTracks)
  return null;
}

// Helper to find a clip by ID across all tracks
function findClipAndTrack(tracks: Track[], clipId: string): { clip: Clip; track: Track; trackIndex: number } | null {
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) {
      return { clip, track, trackIndex: i };
    }
  }
  return null;
}

// Helper to find all selected clips across all tracks
function getSelectedClips(tracks: Track[], selectedClipIds: string[]): { clip: Clip; track: Track; trackIndex: number }[] {
  const selected: { clip: Clip; track: Track; trackIndex: number }[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    for (const clip of track.clips) {
      if (selectedClipIds.includes(clip.id)) {
        selected.push({ clip, track, trackIndex: i });
      }
    }
  }
  return selected;
}

// Minimum clip length in beats
const MIN_CLIP_BEATS = 0.05;

export const useTrackStore = create<TrackState>((set) => ({
  tracks: [],
  selectedTrackIds: [],
  activeTrackId: null,
  selectedClipIds: [],
  clipboard: [],

  selectTrack: (id, mode) => {
    set((state) => {
      const tracks = state.tracks;
      const trackIds = tracks.map((t) => t.id);
      const currentActiveIndex = state.activeTrackId ? findTrackIndex(tracks, state.activeTrackId) : -1;
      const clickedIndex = findTrackIndex(tracks, id);
      
      if (clickedIndex === -1) {
        // Clicked track doesn't exist, do nothing
        return state;
      }

      let newSelectedTrackIds: string[];
      let newActiveTrackId: string | null = id;

      switch (mode) {
        case 'replace':
          // Plain click: select only this track
          newSelectedTrackIds = [id];
          break;

        case 'toggle':
          // Ctrl/Cmd+click: toggle the track in/out of selection
          if (state.selectedTrackIds.includes(id)) {
            // If it's the active track, do not remove it (invariant: active is always selected)
            if (state.activeTrackId === id) {
              newSelectedTrackIds = [...state.selectedTrackIds];
            } else {
              newSelectedTrackIds = state.selectedTrackIds.filter((trackId) => trackId !== id);
            }
          } else {
            newSelectedTrackIds = [...state.selectedTrackIds, id];
          }
          break;

        case 'range':
          // Shift+click: select contiguous range from active to clicked
          if (currentActiveIndex === -1 || clickedIndex === -1) {
            newSelectedTrackIds = [id];
          } else {
            const startIndex = Math.min(currentActiveIndex, clickedIndex);
            const endIndex = Math.max(currentActiveIndex, clickedIndex);
            newSelectedTrackIds = trackIds.slice(startIndex, endIndex + 1);
          }
          break;
      }

      // Ensure active track is always in the selection
      if (newActiveTrackId && !newSelectedTrackIds.includes(newActiveTrackId)) {
        newSelectedTrackIds = [...newSelectedTrackIds, newActiveTrackId];
      }

      return {
        selectedTrackIds: newSelectedTrackIds,
        activeTrackId: newActiveTrackId,
      };
    });
  },

  setActiveTrack: (id) => {
    set((state) => {
      const tracks = state.tracks;
      const clickedIndex = findTrackIndex(tracks, id);
      
      if (clickedIndex === -1) {
        return state;
      }

      // Active track must always be in the selection
      let newSelectedTrackIds = [...state.selectedTrackIds];
      if (!newSelectedTrackIds.includes(id)) {
        newSelectedTrackIds = [id];
      }

      return {
        selectedTrackIds: newSelectedTrackIds,
        activeTrackId: id,
      };
    });
  },

  selectClip: (id, additive) => {
    set((state) => {
      if (additive) {
        // Shift+click: toggle selection
        const newSelectedClipIds = state.selectedClipIds.includes(id)
          ? state.selectedClipIds.filter((clipId) => clipId !== id)
          : [...state.selectedClipIds, id];
        return { selectedClipIds: newSelectedClipIds };
      } else {
        // Regular click: replace selection
        return { selectedClipIds: [id] };
      }
    });
  },

  clearClipSelection: () => {
    set({ selectedClipIds: [] });
  },

  copySelected: () => {
    set((state) => {
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      // Deep copy the selected clips for the clipboard
      const clipboard: Clip[] = selectedClips.map(({ clip }) => ({ ...clip }));
      return { clipboard };
    });
  },

  cutSelected: () => {
    set((state) => {
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      if (selectedClips.length === 0) return state;
      
      // Deep copy the selected clips for the clipboard
      const clipboard: Clip[] = selectedClips.map(({ clip }) => ({ ...clip }));
      
      // Remove selected clips from their tracks
      const newTracks = [...state.tracks];
      for (const { clip, trackIndex } of selectedClips) {
        newTracks[trackIndex] = {
          ...newTracks[trackIndex],
          clips: newTracks[trackIndex].clips.filter((c) => c.id !== clip.id),
        };
      }
      
      return {
        tracks: newTracks,
        clipboard,
        selectedClipIds: [],
      };
    });
  },

  pasteAtPlayhead: (playheadBeats: number) => {
    set((state) => {
      if (state.clipboard.length === 0) return state;
      
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      // Find the earliest clip in the clipboard to align with playhead
      const clipboardClips = [...state.clipboard];
      const earliestClip = clipboardClips.reduce((earliest, clip) =>
        (clip.startBeat < earliest.startBeat ? clip : earliest),
        clipboardClips[0]
      );
      const earliestStartBeat = earliestClip.startBeat;
      
      // Create new clips with fresh IDs and adjusted positions
      const newClips: Clip[] = clipboardClips.map((clip) => {
        // Calculate relative offset from the earliest clip
        const relativeOffset = clip.startBeat - earliestStartBeat;
        const newStartBeat = playheadBeats + relativeOffset;
        
        return {
          ...clip,
          id: generateClipId(),
          startBeat: newStartBeat,
        };
      });
      
      // Build a map of trackId -> clips to paste
      const clipsByTrackId: Record<string, Clip[]> = {};
      for (const clip of newClips) {
        if (!clipsByTrackId[clip.trackId]) {
          clipsByTrackId[clip.trackId] = [];
        }
        clipsByTrackId[clip.trackId].push(clip);
      }
      
      // Paste clips onto their original tracks if they still exist
      const newTracks = state.tracks.map((track) => {
        const clipsToPaste = clipsByTrackId[track.id];
        if (!clipsToPaste) return track;
        
        // Paste clips onto this track
        return {
          ...track,
          clips: [...track.clips, ...clipsToPaste],
        };
      });
      
      // Select the newly pasted clips
      const newSelectedClipIds = newClips.map((clip) => clip.id);
      
      return {
        tracks: newTracks,
        selectedClipIds: newSelectedClipIds,
      };
    });
  },

  deleteSelected: () => {
    set((state) => {
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      if (selectedClips.length === 0) return state;
      
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      // Remove selected clips from their tracks
      const newTracks = [...state.tracks];
      for (const { clip, trackIndex } of selectedClips) {
        newTracks[trackIndex] = {
          ...newTracks[trackIndex],
          clips: newTracks[trackIndex].clips.filter((c) => c.id !== clip.id),
        };
      }
      
      return {
        tracks: newTracks,
        selectedClipIds: [],
      };
    });
  },

  addTrack: () =>
    set((state) => {
      trackCounter += 1;
      const color = TRACK_COLORS[(trackCounter - 1) % TRACK_COLORS.length];
      const newTrack: Track = {
        id: `track-${Date.now()}`,
        name: `Track ${trackCounter}`,
        muted: false,
        soloed: false,
        armed: false,
        volume: 0.8,
        pan: 0,
        color,
        clips: [],
        compressor: getDefaultCompressorSettings(),
        gate: getDefaultGateSettings(),
        eq: getDefaultEQSettings(),
        reverb: getDefaultReverbSettings(),
        delay: getDefaultDelaySettings(),
      };
      const newTracks = [...state.tracks, newTrack];
      return {
        tracks: newTracks,
        selectedTrackIds: [newTrack.id],
        activeTrackId: newTrack.id,
      };
    }),

  removeTrack: (id) =>
    set((state) => {
      const tracks = state.tracks;
      const removedIndex = findTrackIndex(tracks, id);
      
      if (removedIndex === -1) {
        return state;
      }

      const newTracks = tracks.filter((t) => t.id !== id);
      
      // Update selection and active track
      let newSelectedTrackIds = state.selectedTrackIds.filter((trackId) => trackId !== id);
      let newActiveTrackId = state.activeTrackId;

      if (state.activeTrackId === id) {
        // If the removed track was active, promote the nearest remaining track
        const nearestIndex = getNearestTrackIndex(tracks, removedIndex);
        if (nearestIndex !== null && newTracks.length > 0) {
          newActiveTrackId = newTracks[nearestIndex].id;
          newSelectedTrackIds = [newActiveTrackId];
        } else {
          newActiveTrackId = null;
          newSelectedTrackIds = [];
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
    }),

  updateTrack: (id, patch) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  addClip: (trackId, startBeat, durationBeats, name, audioBufferId) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: [
                ...t.clips,
                {
                  id: generateClipId(),
                  trackId,
                  startBeat,
                  durationBeats,
                  name,
                  color: t.color,
                  audioBufferId,
                },
              ],
            },
      ),
    })),

  moveClip: (clipId, fromTrackId, toTrackId, newStartBeat) =>
    set((state) => {
      let moving = state.tracks
        .find((t) => t.id === fromTrackId)
        ?.clips.find((c) => c.id === clipId);
      if (!moving) return state;
      moving = { ...moving, trackId: toTrackId, startBeat: newStartBeat };

      // Dragging a clip to a *different* track makes that track active
      // (last-interacted track is active, per #151). Dragging within the
      // same track must NOT touch the selection at all.
      let newActiveTrackId = state.activeTrackId;
      let newSelectedTrackIds = state.selectedTrackIds;
      if (fromTrackId !== toTrackId && state.activeTrackId !== toTrackId) {
        newActiveTrackId = toTrackId;
        newSelectedTrackIds = state.selectedTrackIds.includes(toTrackId)
          ? state.selectedTrackIds
          : [...state.selectedTrackIds, toTrackId];
      }
      
      return {
        tracks: state.tracks.map((t) => {
          if (t.id === fromTrackId && t.id !== toTrackId) {
            return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          }
          if (t.id === toTrackId && t.id !== fromTrackId) {
            return { ...t, clips: [...t.clips, moving!] };
          }
          if (t.id === fromTrackId && t.id === toTrackId) {
            // Same track: replace in-place
            return { ...t, clips: t.clips.map((c) => (c.id === clipId ? moving! : c)) };
          }
          return t;
        }),
        selectedTrackIds: newSelectedTrackIds,
        activeTrackId: newActiveTrackId,
      };
    }),

  createTracksForClips: (clipData, startBeat) =>
    set((state) => {
      const now = Date.now();
      const newTracks = clipData.map((data, i) => {
        trackCounter += 1;
        const color = TRACK_COLORS[(trackCounter - 1) % TRACK_COLORS.length];
        const trackId = `track-${now}-${i}`;
        return {
          id: trackId,
          name: data.name,
          muted: false,
          soloed: false,
          armed: false,
          volume: 0.8,
          pan: 0,
          color,
          clips: [
            {
              id: generateClipId(),
              trackId,
              startBeat,
              durationBeats: data.durationBeats,
              name: data.name,
              color,
              audioBufferId: data.audioBufferId,
            },
          ],
          compressor: getDefaultCompressorSettings(),
          gate: getDefaultGateSettings(),
          eq: getDefaultEQSettings(),
          reverb: getDefaultReverbSettings(),
          delay: getDefaultDelaySettings(),
        };
      });
      
      const allTracks = [...state.tracks, ...newTracks];
      // Set the first new track as active and selected. Explicit string[]
      // typing keeps TS from widening newActiveTrackId to string | null and
      // inferring (string | null)[] for the selection.
      const newActiveTrackId: string | null =
        newTracks.length > 0 ? newTracks[0].id : state.activeTrackId;
      const newSelectedTrackIds: string[] =
        newTracks.length > 0 ? [newTracks[0].id] : state.selectedTrackIds;
      
      return {
        tracks: allTracks,
        selectedTrackIds: newSelectedTrackIds,
        activeTrackId: newActiveTrackId,
      };
    }),

  splitClipsAt: (beats: number[], trackIds?: string[]) =>
    set((state) => {
      // Determine which tracks to split on
      let targetTrackIds: string[];
      if (trackIds) {
        // Explicit trackIds provided
        targetTrackIds = trackIds;
      } else if (state.selectedTrackIds.length > 0) {
        // Use selected tracks (which includes active track by invariant)
        targetTrackIds = state.selectedTrackIds;
      } else if (state.activeTrackId) {
        // Fallback to active track
        targetTrackIds = [state.activeTrackId];
      } else {
        // Defensive: no selection and no active track - warn and use all tracks
        console.warn('splitClipsAt called with no selected tracks and no active track - splitting all tracks');
        targetTrackIds = state.tracks.map(t => t.id);
      }
      
      // Warn if no tracks would be affected
      if (targetTrackIds.length === 0) {
        console.warn('splitClipsAt called with empty track selection - no tracks will be split');
        return state;
      }
      
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      // Create a filter function for the target tracks
      const trackFilter = (trackId: string) => targetTrackIds.includes(trackId);
      
      // Apply splits sequentially for each boundary
      let newTracks = [...state.tracks];
      for (const boundary of beats) {
        newTracks = splitClipsAtBoundary(newTracks, boundary, trackFilter);
      }
      return { tracks: newTracks };
    }),

  undoSplit: () =>
    set((state) => {
      if (undoStack.length === 0) return state;
      const previousTracks = undoStack.pop()!;
      return { tracks: previousTracks };
    }),

  trimClip: (clipId, patch) =>
    set((state) => {
      // Find the clip and its track
      const result = findClipAndTrack(state.tracks, clipId);
      if (!result) {
        console.warn(`trimClip: clip ${clipId} not found`);
        return state;
      }
      
      const { clip, track, trackIndex } = result;
      
      // Check if the patch would result in an invalid clip
      const newDuration = patch.durationBeats;
      const newBufferOffset = patch.bufferOffsetBeats ?? clip.bufferOffsetBeats ?? 0;
      
      // Validate minimum duration
      if (newDuration < MIN_CLIP_BEATS) {
        console.warn(`trimClip: resulting duration ${newDuration} is below minimum ${MIN_CLIP_BEATS}`);
        return state;
      }
      
      // Validate buffer offset is non-negative
      if (newBufferOffset < 0) {
        console.warn(`trimClip: bufferOffsetBeats ${newBufferOffset} is negative`);
        return state;
      }
      
      // Check if the patch actually changes anything
      const noChange = 
        patch.startBeat === clip.startBeat &&
        (patch.bufferOffsetBeats ?? clip.bufferOffsetBeats) === (clip.bufferOffsetBeats ?? 0) &&
        patch.durationBeats === clip.durationBeats;
      
      if (noChange) {
        // No change, don't push to undo stack
        return state;
      }
      
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      // Apply the patch to the clip
      const newClip: Clip = {
        ...clip,
        startBeat: patch.startBeat,
        bufferOffsetBeats: patch.bufferOffsetBeats,
        durationBeats: patch.durationBeats,
      };
      
      // Create new tracks array with the updated clip
      const newTracks = [...state.tracks];
      const newTrack = {
        ...track,
        clips: track.clips.map((c) => (c.id === clipId ? newClip : c)),
      };
      newTracks[trackIndex] = newTrack;
      
      return { tracks: newTracks };
    }),

  setTracks: (tracks) => {
    set({
      tracks,
      selectedTrackIds: tracks.length > 0 ? [tracks[0].id] : [],
      activeTrackId: tracks.length > 0 ? tracks[0].id : null,
    });
  },

  clearTracks: () => set({ tracks: [], selectedTrackIds: [], activeTrackId: null, selectedClipIds: [], clipboard: [] }),

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
}));
