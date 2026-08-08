import { create } from 'zustand';

interface RecordingState {
  inputDevices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  permissionGranted: boolean;
  isRecording: boolean;
  isCountingIn: boolean;
  countInEnabled: boolean;
  countInBars: number;
  setInputDevices: (devices: MediaDeviceInfo[]) => void;
  setSelectedDeviceId: (id: string | null) => void;
  setPermissionGranted: (granted: boolean) => void;
  setIsRecording: (recording: boolean) => void;
  setIsCountingIn: (countingIn: boolean) => void;
  toggleCountIn: () => void;
  setCountInBars: (bars: number) => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  inputDevices: [],
  selectedDeviceId: null,
  permissionGranted: false,
  isRecording: false,
  isCountingIn: false,
  countInEnabled: true,
  countInBars: 1,

  setInputDevices: (inputDevices) =>
    set((state) => ({
      inputDevices,
      selectedDeviceId:
        state.selectedDeviceId && inputDevices.some((d) => d.deviceId === state.selectedDeviceId)
          ? state.selectedDeviceId
          : inputDevices[0]?.deviceId ?? null,
    })),
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  setPermissionGranted: (permissionGranted) => set({ permissionGranted }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setIsCountingIn: (isCountingIn) => set({ isCountingIn }),
  toggleCountIn: () => set((state) => ({ countInEnabled: !state.countInEnabled })),
  setCountInBars: (bars) => set({ countInBars: Math.max(1, Math.min(8, Math.round(bars))) }),
}));
