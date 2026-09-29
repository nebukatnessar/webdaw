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
  addTrack: () => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  setTracks: (tracks: Track[]) => void;
  clearTracks: () => void;
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
  splitClipsAt: (beats: number[]) => void;
  undoSplit: () => void;
}

let trackCounter = 0;

// Undo stack for split operations only
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

// Helper function to split clips at a single boundary
function splitClipsAtBoundary(tracks: Track[], boundaryBeat: number): Track[] {
  return tracks.map((track) => {
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

export const useTrackStore = create<TrackState>((set) => ({
  tracks: [],

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
      return { tracks: [...state.tracks, newTrack] };
    }),

  removeTrack: (id) =>
    set((state) => ({ tracks: state.tracks.filter((t) => t.id !== id) })),

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
      return { tracks: [...state.tracks, ...newTracks] };
    }),

  splitClipsAt: (beats: number[]) =>
    set((state) => {
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      // Apply splits sequentially for each boundary
      let newTracks = [...state.tracks];
      for (const boundary of beats) {
        newTracks = splitClipsAtBoundary(newTracks, boundary);
      }
      return { tracks: newTracks };
    }),

  undoSplit: () =>
    set((state) => {
      if (undoStack.length === 0) return state;
      const previousTracks = undoStack.pop()!;
      return { tracks: previousTracks };
    }),

  setTracks: (tracks) => set({ tracks }),

  clearTracks: () => set({ tracks: [] }),
}));
