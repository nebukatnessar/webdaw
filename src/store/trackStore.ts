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

  duplicateSelected: () => {
    set((state) => {
      const selectedClips = getSelectedClips(state.tracks, state.selectedClipIds);
      if (selectedClips.length === 0) return state;
      
      // Push current state to undo stack
      pushToUndoStack(state.tracks);
      
      // Calculate batchStart and batchEnd
      const batchStart = Math.min(...selectedClips.map(({ clip }) => clip.startBeat));
      const batchEnd = Math.max(...selectedClips.map(({ clip }) => clip.startBeat + clip.durationBeats));
      const offset = batchEnd - batchStart;
      
      // Create new clips with fresh IDs and offset positions
      const newClips: Clip[] = selectedClips.map(({ clip }) => ({
        ...clip,
        id: generateClipId(),
        startBeat: clip.startBeat + offset,
      }));
      
      // Build a map of trackId -> clips to duplicate
      const clipsByTrackId: Record<string, Clip[]> = {};
      for (const clip of newClips) {
        if (!clipsByTrackId[clip.trackId]) {
          clipsByTrackId[clip.trackId] = [];
        }
        clipsByTrackId[clip.trackId].push(clip);
      }
      
      // Add duplicated clips to their original tracks
      const newTracks = state.tracks.map((track) => {
        const clipsToAdd = clipsByTrackId[track.id];
        if (clipsToAdd && clipsToAdd.length > 0) {
          return { ...track, clips: [...track.clips, ...clipsToAdd] };
        }
        return track;
      });
      
      // Select the newly duplicated clips
      const newSelectedClipIds = newClips.map((clip) => clip.id);
      
      return {
        tracks: newTracks,
        selectedClipIds: newSelectedClipIds,
      };
    });
  },
  
  // Reorder tracks by moving a track from one index to another
  reorderTrack: (fromIndex: number, toIndex: number) => {
    set((state) => {
      const newTracks = [...state.tracks];
      const [trackToMove] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, trackToMove);
      return { tracks: newTracks };
    });
  },