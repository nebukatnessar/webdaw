import { create } from 'zustand';

interface TransportState {
  bpm: number;
  isPlaying: boolean;
  playheadBeats: number;
  isRepeat: boolean;
  zoomLevel: number;
  setBpm: (bpm: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlayheadBeats: (beats: number) => void;
  toggleRepeat: () => void;
  setZoomLevel: (zoomLevel: number) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  bpm: 120,
  isPlaying: false,
  playheadBeats: 0,
  isRepeat: false,
  zoomLevel: 1,
  setBpm: (bpm) => set({ bpm }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, playheadBeats: 0 }),
  setPlayheadBeats: (playheadBeats) => set({ playheadBeats }),
  toggleRepeat: () => set((state) => ({ isRepeat: !state.isRepeat })),
  setZoomLevel: (zoomLevel) => set({ zoomLevel: Math.max(0.1, Math.min(10, zoomLevel)) }),
}));

// Base pixels per beat (at zoom level 1)
export const BASE_PIXELS_PER_BEAT = 40;

// Get the effective pixels per beat based on current zoom level
export const usePixelsPerBeat = () => {
  const zoomLevel = useTransportStore((s) => s.zoomLevel);
  return BASE_PIXELS_PER_BEAT * zoomLevel;
};
