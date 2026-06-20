import { create } from 'zustand';

interface TransportState {
  bpm: number;
  isPlaying: boolean;
  playheadBeats: number;
  isRepeat: boolean;
  zoomLevel: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  setBpm: (bpm: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlayheadBeats: (beats: number) => void;
  toggleRepeat: () => void;
  setZoomLevel: (zoomLevel: number) => void;
  setSelection: (start: number | null, end: number | null) => void;
  clearSelection: () => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  bpm: 120,
  isPlaying: false,
  playheadBeats: 0,
  isRepeat: false,
  zoomLevel: 1,
  selectionStart: null,
  selectionEnd: null,
  setBpm: (bpm) => set({ bpm }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, playheadBeats: 0 }),
  setPlayheadBeats: (playheadBeats) => set({ playheadBeats }),
  toggleRepeat: () => set((state) => ({ isRepeat: !state.isRepeat })),
  setZoomLevel: (zoomLevel) => set({ zoomLevel: Math.max(0.1, Math.min(10, zoomLevel)) }),
  setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),
  clearSelection: () => set({ selectionStart: null, selectionEnd: null }),
}));

// Base pixels per beat (at zoom level 1)
export const BASE_PIXELS_PER_BEAT = 40;

// Get the effective pixels per beat based on current zoom level
export const usePixelsPerBeat = () => {
  const zoomLevel = useTransportStore((s) => s.zoomLevel);
  return BASE_PIXELS_PER_BEAT * zoomLevel;
};
