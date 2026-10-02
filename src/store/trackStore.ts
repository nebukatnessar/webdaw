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
  quantizeSelected: (gridBeats: number) => void;
  // New functions for multi-track controls
  toggleArmSelected: () => void;
  toggleMuteSelected: () => void;
  toggleSoloSelected: () => void;
  deleteSelectedTracks: () => void;
  duplicateSelected: () => void;
  // Reorder tracks by moving a track from one index to another
  reorderTrack: (fromIndex: number, toIndex: number) => void;
}