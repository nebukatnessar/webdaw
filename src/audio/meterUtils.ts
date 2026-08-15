const METER_FLOOR_DB = -50;

/** Instantaneous RMS level (0-1) read from an analyser's current time-domain data. */
export function rmsFromAnalyser(analyser: AnalyserNode): number {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/** Converts an RMS level (0-1) to a perceptually-scaled 0-100 VU meter percentage. */
export function levelToPercent(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  const clamped = Math.max(METER_FLOOR_DB, Math.min(0, db));
  return ((clamped - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
}
