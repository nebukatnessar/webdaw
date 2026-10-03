import { create } from 'zustand';
import type { MasterEffects } from '../types/daw';

interface TransportState {
  bpm: number;
  isPlaying: boolean;
  playheadBeats: number;
  isRepeat: boolean;
  isSnapEnabled: boolean;
  gridDivisionBeats: number;
  zoomLevel: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  masterVolume: number;
  masterEffects: MasterEffects;
  setBpm: (bpm: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlayheadBeats: (beats: number) => void;
  toggleRepeat: () => void;
  toggleSnap: () => void;
  setGridDivisionBeats: (division: number) => void;
  setZoomLevel: (zoomLevel: number) => void;
  setSelection: (start: number | null, end: number | null) => void;
  clearSelection: () => void;
  setMasterVolume: (volume: number) => void;
  setMasterEffect: <K extends keyof MasterEffects>(effect: K, settings: MasterEffects[K]) => void;
  setTransportState: (state: {
    bpm: number;
    playheadBeats: number;
    isRepeat: boolean;
    isSnapEnabled?: boolean;
    gridDivisionBeats?: number;
    zoomLevel: number;
    selectionStart: number | null;
    selectionEnd: number | null;
    masterVolume?: number;
    masterEffects?: MasterEffects;
  }) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  bpm: 120,
  isPlaying: false,
  playheadBeats: 0,
  isRepeat: false,
  isSnapEnabled: true,
  gridDivisionBeats: 1,
  zoomLevel: 1,
  selectionStart: null,
  selectionEnd: null,
  masterVolume: 1,
  masterEffects: {},
  setBpm: (bpm) => set({ bpm }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, playheadBeats: 0 }),
  setPlayheadBeats: (playheadBeats) => set({ playheadBeats }),
  toggleRepeat: () => set((state) => ({ isRepeat: !state.isRepeat })),
  toggleSnap: () => set((state) => ({ isSnapEnabled: !state.isSnapEnabled })),
  setGridDivisionBeats: (gridDivisionBeats) => set({ gridDivisionBeats }),
  setZoomLevel: (zoomLevel) => set({ zoomLevel: Math.max(0.1, Math.min(10, zoomLevel)) }),
  setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),
  clearSelection: () => set({ selectionStart: null, selectionEnd: null }),
  setMasterVolume: (masterVolume) => set({ masterVolume: Math.max(0, Math.min(2, masterVolume)) }),
  setMasterEffect: (effect, settings) => set((state) => {
    const masterEffects = { ...state.masterEffects };
    masterEffects[effect] = settings;
    return { masterEffects };
  }),
  setTransportState: (state) => set({
    bpm: state.bpm,
    playheadBeats: state.playheadBeats,
    isRepeat: state.isRepeat,
    isSnapEnabled: state.isSnapEnabled ?? true,
    gridDivisionBeats: state.gridDivisionBeats ?? 1,
    zoomLevel: state.zoomLevel,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    // Older saved projects won't have this field - default to unity gain.
    masterVolume: Math.max(0, Math.min(2, state.masterVolume ?? 1)),
    // Older saved projects won't have master effects - default to all bypassed.
    masterEffects: state.masterEffects ?? {},
  }),
}));

// Base pixels per beat (at zoom level 1)
export const BASE_PIXELS_PER_BEAT = 40;

// Get the effective pixels per beat based on current zoom level
export const usePixelsPerBeat = () => {
  const zoomLevel = useTransportStore((s) => s.zoomLevel);
  return BASE_PIXELS_PER_BEAT * zoomLevel;
};
