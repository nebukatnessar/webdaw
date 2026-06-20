import { create } from 'zustand';
import type { Track } from '../types/daw';

const TRACK_COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2'];

interface TrackState {
  tracks: Track[];
  addTrack: () => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
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
}

let trackCounter = 0;

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
        volume: 0.8,
        pan: 0,
        color,
        clips: [],
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
                  id: `clip-${Date.now()}`,
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
          volume: 0.8,
          pan: 0,
          color,
          clips: [
            {
              id: `clip-${now}-${i}`,
              trackId,
              startBeat,
              durationBeats: data.durationBeats,
              name: data.name,
              color,
              audioBufferId: data.audioBufferId,
            },
          ],
        };
      });
      return { tracks: [...state.tracks, ...newTracks] };
    }),
}));
