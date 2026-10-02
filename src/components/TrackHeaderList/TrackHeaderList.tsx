  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDropOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDropOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDropOver(false);
    const audioFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.wav'),
    );
    if (audioFiles.length === 0) return;
    const startBeat =
      Math.round(useTransportStore.getState().playheadBeats / BEATS_PER_BAR) * BEATS_PER_BAR;
    void Promise.all(
      audioFiles.map(async (file) => {
        const buffer = await engine.decodeFile(file);
        const bufferId = `buf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        engine.storeBuffer(bufferId, buffer);
        const bpm = useTransportStore.getState().bpm;
        return {
          name: file.name.replace(/\.[^.]+$/, ''),
          durationBeats: (buffer.duration * bpm) / 60,
          audioBufferId: bufferId,
        };
      }),
    )
      .then((clipData) => createTracksForClips(clipData, startBeat))
      .catch(() => undefined);
  };

  // Drag and drop handlers for track reordering
  const handleDragStart = (e: React.DragEvent, trackId: string) => {
    e.dataTransfer.setData('text/x-track-id', trackId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTrackId(trackId);
  };

  const handleDragOverTrack = (e: React.DragEvent, trackId: string) => {
    if (!draggedTrackId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTrackId(trackId);
  };

  const handleDragLeaveTrack = (e: React.DragEvent) => {
    // Only reset if leaving the entire component
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTrackId(null);
    }
  };

  const handleDropTrack = (e: React.DragEvent, dropTrackId: string) => {
    e.preventDefault();
    setDragOverTrackId(null);
    setDraggedTrackId(null);
    
    const draggedTrackId = e.dataTransfer.getData('text/x-track-id');
    if (!draggedTrackId || draggedTrackId === dropTrackId) return;
    
    const fromIndex = tracks.findIndex(t => t.id === draggedTrackId);
    const toIndex = tracks.findIndex(t => t.id === dropTrackId);
    
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderTrack(fromIndex, toIndex);
    }
  };

  const handleDragEnd = () => {
    setDraggedTrackId(null);
    setDragOverTrackId(null);
  };