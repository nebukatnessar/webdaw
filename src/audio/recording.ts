import { getAudioContext } from './engine';
import { BEATS_PER_BAR } from '../constants';

let activeStream: MediaStream | null = null;
let activeRecorder: MediaRecorder | null = null;
let recordedChunks: BlobPart[] = [];
let countInCancelled = false;
let monitorSource: MediaStreamAudioSourceNode | null = null;
let monitorGain: GainNode | null = null;

function teardownMonitor(): void {
  monitorSource?.disconnect();
  monitorGain?.disconnect();
  monitorSource = null;
  monitorGain = null;
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export async function requestMicPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

function playClick(ctx: AudioContext, time: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

export function cancelCountIn(): void {
  countInCancelled = true;
}

/**
 * Plays `bars` bars of metronome clicks and resolves once they've finished.
 * Resolves to false if cancelCountIn() was called before completion, so the
 * caller can bail out of starting the actual recording.
 */
export async function scheduleCountIn(bars: number, bpm: number): Promise<boolean> {
  countInCancelled = false;
  const ctx = getAudioContext();
  const beatsToSecs = 60 / bpm;
  const totalBeats = bars * BEATS_PER_BAR;
  const startTime = ctx.currentTime + 0.05;

  for (let i = 0; i < totalBeats; i++) {
    playClick(ctx, startTime + i * beatsToSecs, i % BEATS_PER_BAR === 0);
  }

  const totalMs = (startTime - ctx.currentTime + totalBeats * beatsToSecs) * 1000;
  await new Promise((resolve) => setTimeout(resolve, totalMs));
  return !countInCancelled;
}

export async function startRecording(deviceId: string | null): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  activeStream = stream;
  recordedChunks = [];

  // Route the mic to output for immediate record monitoring.
  const ctx = getAudioContext();
  teardownMonitor();
  monitorSource = ctx.createMediaStreamSource(stream);
  monitorGain = ctx.createGain();
  monitorGain.gain.value = 1;
  monitorSource.connect(monitorGain);
  monitorGain.connect(ctx.destination);

  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  activeRecorder = recorder;
  // Emit chunks while recording to make stop/finalization more robust.
  recorder.start(100);
}

/**
 * Stops the active recording and decodes the captured audio into an
 * AudioBuffer. Returns null if nothing was captured (e.g. stopped
 * immediately, or the recorder produced no data).
 */
export async function stopRecording(): Promise<AudioBuffer | null> {
  const recorder = activeRecorder;
  const stream = activeStream;
  if (!recorder) return null;

  const blob: Blob = await new Promise((resolve) => {
    if (recorder.state === 'inactive') {
      resolve(new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
      return;
    }

    recorder.onstop = () => resolve(new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
    try {
      recorder.requestData();
    } catch {
      // requestData may throw on some implementations; stop still finalizes.
    }
    recorder.stop();
  });

  stream?.getTracks().forEach((track) => track.stop());
  teardownMonitor();
  activeRecorder = null;
  activeStream = null;
  recordedChunks = [];

  if (blob.size === 0) return null;

  const arrayBuffer = await blob.arrayBuffer();
  const ctx = getAudioContext();
  return ctx.decodeAudioData(arrayBuffer);
}
