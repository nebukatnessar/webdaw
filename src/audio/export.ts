import { getBuffer } from './engine';
import { encodeWav } from './wav';
import type { Track, Project } from '../types/daw';

export interface ExportOptions {
  sampleRate?: number;
  onProgress?: (progress: number) => void;
}

export interface ExportResult {
  blob: Blob;
  duration: number;
}

export async function exportTrackAsWAV(
  track: Track,
  bpm: number,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { sampleRate = 44100 } = options;
  
  const sortedClips = [...track.clips].sort((a, b) => a.startBeat - b.startBeat);
  
  if (sortedClips.length === 0) {
    throw new Error('No clips to export');
  }
  
  const beatsToSecs = 60 / bpm;
  const lastClip = sortedClips[sortedClips.length - 1];
  const endBeat = lastClip.startBeat + lastClip.durationBeats;
  const totalDurationSecs = endBeat * beatsToSecs;
  
  const offlineCtx = new OfflineAudioContext(
    2,
    Math.ceil(totalDurationSecs * sampleRate),
    sampleRate,
  );
  
  const gainNode = offlineCtx.createGain();
  gainNode.gain.value = track.volume;
  gainNode.connect(offlineCtx.destination);
  
  for (const clip of sortedClips) {
    if (!clip.audioBufferId) continue;
    const buffer = getBuffer(clip.audioBufferId);
    if (!buffer) continue;
    
    const clipStartSecs = clip.startBeat * beatsToSecs;
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = track.pan;
    source.connect(panner);
    panner.connect(gainNode);
    source.start(clipStartSecs);
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  const blob = encodeWav(renderedBuffer, sampleRate);

  return { blob, duration: totalDurationSecs };
}

export async function exportProjectAsWAV(
  project: Project,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { sampleRate = 44100 } = options;
  const { tracks, bpm } = project;
  
  const hasSoloed = tracks.some((t) => t.soloed);
  const tracksToExport = hasSoloed
    ? tracks.filter((t) => t.soloed && t.clips.length > 0)
    : tracks.filter((t) => !t.muted && t.clips.length > 0 && !t.soloed);
  
  if (tracksToExport.length === 0) {
    throw new Error('No tracks to export');
  }
  
  const beatsToSecs = 60 / bpm;
  let maxEndBeat = 0;
  for (const track of tracksToExport) {
    for (const clip of track.clips) {
      const endBeat = clip.startBeat + clip.durationBeats;
      if (endBeat > maxEndBeat) maxEndBeat = endBeat;
    }
  }
  const totalDurationSecs = maxEndBeat * beatsToSecs;
  
  const offlineCtx = new OfflineAudioContext(
    2,
    Math.ceil(totalDurationSecs * sampleRate),
    sampleRate,
  );
  
  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(offlineCtx.destination);
  
  for (const track of tracksToExport) {
    const trackGain = offlineCtx.createGain();
    trackGain.gain.value = track.volume;
    trackGain.connect(masterGain);
    
    const panner = offlineCtx.createStereoPanner();
    panner.pan.value = track.pan;
    panner.connect(trackGain);
    
    const sortedClips = [...track.clips].sort((a, b) => a.startBeat - b.startBeat);
    for (const clip of sortedClips) {
      if (!clip.audioBufferId) continue;
      const buffer = getBuffer(clip.audioBufferId);
      if (!buffer) continue;
      
      const clipStartSecs = clip.startBeat * beatsToSecs;
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(panner);
      source.start(clipStartSecs);
    }
  }
  
  const renderedBuffer = await offlineCtx.startRendering();
  const blob = encodeWav(renderedBuffer, sampleRate);

  return { blob, duration: totalDurationSecs };
}

export function downloadWAV(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export async function exportAndDownloadTrack(
  track: Track,
  bpm: number,
  projectName: string,
  options: ExportOptions = {},
): Promise<void> {
  const { blob } = await exportTrackAsWAV(track, bpm, options);
  const filename = (projectName || 'Untitled') + '_' + track.name + '.wav';
  downloadWAV(blob, filename);
}

export async function exportAndDownloadProject(
  project: Project,
  options: ExportOptions = {},
): Promise<void> {
  const { blob } = await exportProjectAsWAV(project, options);
  const filename = (project.name || 'Untitled') + '_mixdown.wav';
  downloadWAV(blob, filename);
}
