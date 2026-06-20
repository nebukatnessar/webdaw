import { create } from 'zustand';

interface TransportState {
  bpm: number;
  isPlaying: boolean;
  playheadBeats: number;
  setBpm: (bpm: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlayheadBeats: (beats: number) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  bpm: 120,
  isPlaying: false,
  playheadBeats: 0,
  setBpm: (bpm) => set({ bpm }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, playheadBeats: 0 }),
  setPlayheadBeats: (playheadBeats) => set({ playheadBeats }),
}));
