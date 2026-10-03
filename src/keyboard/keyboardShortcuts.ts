import { useTrackStore } from '../store/trackStore';

export const handleKeyDown = (event: KeyboardEvent) => {
  const { toggleMuteSelectedClips } = useTrackStore.getState();
  
  // Only handle key presses when no input element is focused
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  
  switch (event.key) {
    case 'm':
    case 'M':
      toggleMuteSelectedClips();
      event.preventDefault();
      break;
    // Add other shortcuts here as needed
  }
};

// Call this function in the root component to enable keyboard shortcuts.