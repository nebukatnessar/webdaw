const fs = require('fs');
function loadEol(p) {
  const s = fs.readFileSync(p, 'utf8');
  return { s, crlf: s.includes('\r\n') };
}
function rep(st, oldStr, newStr, count) {
  let o = oldStr, n = newStr;
  if (st.crlf) { o = o.replace(/\n/g, '\r\n'); n = n.replace(/\n/g, '\r\n'); }
  const parts = st.s.split(o);
  if (parts.length !== count + 1) throw new Error('match count ' + (parts.length - 1) + ' for: ' + JSON.stringify(oldStr.slice(0, 70)));
  st.s = parts.join(n);
}

// --- src/types/daw.ts: Clip.clipGain ---
{
  const st = loadEol('src/types/daw.ts');
  rep(st, "  bufferOffsetBeats?: number; // Beats into the source AudioBuffer where this clip's window begins. 0/undefined = play from buffer start.\n}", "  bufferOffsetBeats?: number; // Beats into the source AudioBuffer where this clip's window begins. 0/undefined = play from buffer start.\n  clipGain?: number; // Linear amplitude multiplier applied to this clip (1 = unity). Stored linear; UI converts from dB via 10^(dB/20).\n}", 1);
  fs.writeFileSync('src/types/daw.ts', st.s);
}

// --- src/audio/engine.ts: per-source clip gain node in schedulePlayback ---
{
  const st = loadEol('src/audio/engine.ts');
  rep(st, "      const source = ctx.createBufferSource();\n      source.buffer = buffer;\n      source.connect(gainNode);\n      source.start(when, offset, duration);", "      const source = ctx.createBufferSource();\n      source.buffer = buffer;\n      // Per-clip gain stage: source -> clipGainNode -> gainNode, so clip gain\n      // multiplies before track gain and unity-gain clips behave exactly as\n      // before. Created per scheduled source, so it dies with the source.\n      const clipGainNode = ctx.createGain();\n      clipGainNode.gain.value = clip.clipGain ?? 1;\n      source.connect(clipGainNode);\n      clipGainNode.connect(gainNode);\n      source.start(when, offset, duration);", 1);
  fs.writeFileSync('src/audio/engine.ts', st.s);
}

// --- src/store/trackStore.ts: gain actions + session-scoped undo ---
{
  const st = loadEol('src/store/trackStore.ts');
  rep(st, "  clipboard: Clip[];  // Added clipboard to TrackState\n", "  clipboard: Clip[];  // Added clipboard to TrackState\n  clipGainSessionActive: boolean;  // True between the first +/-/0 gain keypress and the keyup that ends the burst\n", 1);
  rep(st, "  undo: () => void;\n  redo: () => void;\n", "  undo: () => void;\n  redo: () => void;\n  adjustSelectedClipGain: (deltaDb: number) => void;\n  resetSelectedClipGain: () => void;\n  endClipGainSession: () => void;\n", 1);
  rep(st, "const getSelectedClips = ", "// Clip gain adjustment bounds (issue #147). Values live on each clip as linear\n// amplitude multipliers; the +/-/0 shortcuts work in dB and convert here.\nconst MIN_CLIP_GAIN_DB = -30;\nconst MAX_CLIP_GAIN_DB = 12;\nconst clipGainToDb = (clipGain: number | undefined): number =>\n  Math.round(20 * Math.log10(clipGain ?? 1) * 10) / 10;\nconst dbToClipGain = (db: number): number => Math.pow(10, db / 20);\n\n// Helper function to get selected clips\nconst getSelectedClips = ", 1);
  rep(st, "  undoStack: [],\n  redoStack: [],\n  clipboard: [],\n", "  undoStack: [],\n  redoStack: [],\n  clipboard: [],\n  clipGainSessionActive: false,\n", 1);
  rep(st, "        tracks: previousState,\n        undoStack: state.undoStack.slice(0, -1),\n        redoStack: [...state.redoStack, state.tracks],\n      };", "        tracks: previousState,\n        undoStack: state.undoStack.slice(0, -1),\n        redoStack: [...state.redoStack, state.tracks],\n        clipGainSessionActive: false,\n      };", 1);
  rep(st, "        tracks: nextState,\n        undoStack: [...state.undoStack, state.tracks],\n        redoStack: state.redoStack.slice(0, -1),\n      };", "        tracks: nextState,\n        undoStack: [...state.undoStack, state.tracks],\n        redoStack: state.redoStack.slice(0, -1),\n        clipGainSessionActive: false,\n      };", 1);
  rep(st, "  // New functions for multi-track controls\n  toggleArmSelected: () => {", "  adjustSelectedClipGain: (deltaDb) => {\n    set((state) => {\n      const selected = new Set(state.selectedClipIds);\n      if (selected.size === 0) return state;\n\n      let didAdjust = false;\n      const tracks = state.tracks.map((track) => ({\n        ...track,\n        clips: track.clips.map((clip) => {\n          if (!selected.has(clip.id)) return clip;\n          const nextDb = Math.round((clipGainToDb(clip.clipGain) + deltaDb) * 10) / 10;\n          // At the bounds the adjustment no-ops for that clip\n          if (nextDb > MAX_CLIP_GAIN_DB || nextDb < MIN_CLIP_GAIN_DB) return clip;\n          didAdjust = true;\n          return { ...clip, clipGain: dbToClipGain(nextDb) };\n        }),\n      }));\n\n      if (!didAdjust) return state;\n      // One undo snapshot per consecutive adjustment session, pushed on the\n      // first keypress; later keypresses in the same burst only move gains.\n      return {\n        tracks,\n        undoStack: state.clipGainSessionActive ? state.undoStack : [...state.undoStack, state.tracks],\n        redoStack: state.clipGainSessionActive ? state.redoStack : [],\n        clipGainSessionActive: true,\n      };\n    });\n  },\n\n  resetSelectedClipGain: () => {\n    set((state) => {\n      const selected = new Set(state.selectedClipIds);\n      if (selected.size === 0) return state;\n\n      let didReset = false;\n      const tracks = state.tracks.map((track) => ({\n        ...track,\n        clips: track.clips.map((clip) => {\n          if (!selected.has(clip.id)) return clip;\n          if ((clip.clipGain ?? 1) === 1) return clip;\n          didReset = true;\n          return { ...clip, clipGain: 1 };\n        }),\n      }));\n\n      if (!didReset) return state;\n      return {\n        tracks,\n        undoStack: state.clipGainSessionActive ? state.undoStack : [...state.undoStack, state.tracks],\n        redoStack: state.clipGainSessionActive ? state.redoStack : [],\n        clipGainSessionActive: true,\n      };\n    });\n  },\n\n  endClipGainSession: () => {\n    set((state) => (state.clipGainSessionActive ? { clipGainSessionActive: false } : state));\n  },\n\n  // New functions for multi-track controls\n  toggleArmSelected: () => {", 1);
  fs.writeFileSync('src/store/trackStore.ts', st.s);
}

// --- src/components/ArrangeView/ClipBlock.tsx: badge + waveform scaling ---
{
  const st = loadEol('src/components/ArrangeView/ClipBlock.tsx');
  rep(st, "  const isSelected = selectedClipIds.includes(clip.id);\n", "  const isSelected = selectedClipIds.includes(clip.id);\n\n  // Gain badge value in dB relative to unity; hidden when at 0 dB\n  const clipGainDb = Math.round(20 * Math.log10(clip.clipGain ?? 1));\n", 1);
  rep(st, "  }, [clip.audioBufferId, effectiveWidth, effectiveBufferOffsetBeats, effectiveDurationBeats, bpm, isTrimming]);", "  }, [clip.audioBufferId, clip.clipGain, effectiveWidth, effectiveBufferOffsetBeats, effectiveDurationBeats, bpm, isTrimming]);", 1);
  rep(st, "      <span className={styles.name}>{clip.name}</span>\n      <canvas ref={canvasRef} className={styles.canvas} width={effectiveWidth} height={40} />", "      <span className={styles.name}>{clip.name}</span>\n      <canvas ref={canvasRef} className={styles.canvas} width={effectiveWidth} height={40} />\n      {clip.clipGain !== undefined && clipGainDb !== 0 && (\n        <span className={styles.gainBadge}>\n          {clipGainDb > 0 ? '+' + clipGainDb + 'dB' : clipGainDb + 'dB'}\n        </span>\n      )}", 1);
  rep(st, "  const mid = height / 2;\n  for (let x = 0; x < width; x++) {", "  const mid = height / 2;\n  // Scale the drawn amplitude by the clip's gain so louder clips read louder;\n  // the canvas clips anything scaled past its bounds.\n  const gain = clip.clipGain ?? 1;\n  for (let x = 0; x < width; x++) {", 1);
  rep(st, "    const yTop = mid * (1 - maxVal);\n    const yBot = mid * (1 - minVal);", "    const yTop = mid * (1 - maxVal * gain);\n    const yBot = mid * (1 - minVal * gain);", 1);
  fs.writeFileSync('src/components/ArrangeView/ClipBlock.tsx', st.s);
}

// --- src/components/ArrangeView/ClipBlock.module.css: .gainBadge ---
{
  const st = loadEol('src/components/ArrangeView/ClipBlock.module.css');
  rep(st, ".trimHandleL {\n  left: 0;\n}", ".gainBadge {\n  position: absolute;\n  top: 2px;\n  right: 2px;\n  z-index: 5;\n  font-size: 10px;\n  font-family: 'Courier New', monospace;\n  color: var(--text);\n  background: rgba(0, 0, 0, 0.45);\n  border-radius: 3px;\n  padding: 1px 3px;\n  pointer-events: none;\n}\n\n.trimHandleL {\n  left: 0;\n}", 1);
  fs.writeFileSync('src/components/ArrangeView/ClipBlock.module.css', st.s);
}

// --- src/App.tsx: +/-/0 shortcuts + keyup session end ---
{
  const st = loadEol('src/App.tsx');
  rep(st, "      // Handle quantize with Q key\n      if (e.key.toLowerCase() === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {\n        e.preventDefault();\n        const gridBeats = useTransportStore.getState().gridDivisionBeats;\n        useTrackStore.getState().quantizeSelected(gridBeats);\n      }\n    };", "      // Handle quantize with Q key\n      if (e.key.toLowerCase() === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {\n        e.preventDefault();\n        const gridBeats = useTransportStore.getState().gridDivisionBeats;\n        useTrackStore.getState().quantizeSelected(gridBeats);\n      }\n\n      // Handle per-clip gain with +/- (incl. Shift+=) and 0 (reset), acting\n      // on all selected clips in 1 dB steps\n      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey && !e.altKey) {\n        e.preventDefault();\n        useTrackStore.getState().adjustSelectedClipGain(1);\n      }\n\n      if (e.key === '-' && !e.ctrlKey && !e.metaKey && !e.altKey) {\n        e.preventDefault();\n        useTrackStore.getState().adjustSelectedClipGain(-1);\n      }\n\n      if (e.key === '0' && !e.ctrlKey && !e.metaKey && !e.altKey) {\n        e.preventDefault();\n        useTrackStore.getState().resetSelectedClipGain();\n      }\n    };", 1);
  rep(st, "    window.addEventListener('keydown', handleKeyDown);\n    return () => window.removeEventListener('keydown', handleKeyDown);\n  }, []);", "    // A consecutive +/-/0 gain-adjustment burst shares one undo snapshot;\n    // releasing the key ends the session so the next burst gets a new one.\n    const handleKeyUp = () => {\n      useTrackStore.getState().endClipGainSession();\n    };\n\n    window.addEventListener('keydown', handleKeyDown);\n    window.addEventListener('keyup', handleKeyUp);\n    return () => {\n      window.removeEventListener('keydown', handleKeyDown);\n      window.removeEventListener('keyup', handleKeyUp);\n    };\n  }, []);", 1);
  fs.writeFileSync('src/App.tsx', st.s);
}

// --- persistence: SerializedClip.clipGain + round-trip ---
{
  const st = loadEol('src/types/project.ts');
  rep(st, "  bufferOffsetBeats: number;\n  audioFile: string | null;", "  bufferOffsetBeats: number;\n  clipGain?: number; // Linear amplitude multiplier (1 = unity); absent in older projects\n  audioFile: string | null;", 1);
  fs.writeFileSync('src/types/project.ts', st.s);
}
{
  const st = loadEol('src/utils/projectSerializer.ts');
  rep(st, "        bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,", "        bufferOffsetBeats: clip.bufferOffsetBeats ?? 0,\n        clipGain: clip.clipGain ?? 1,", 2);
  fs.writeFileSync('src/utils/projectSerializer.ts', st.s);
}

console.log('ok');
