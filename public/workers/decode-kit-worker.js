// Kit prefetch/decode worker (feature #194, task #196). Per #89, sample
// decode/prefetch is offline work for Web Workers: this worker fetches the
// kit manifest and all one-shot WAVs off the main thread and decodes them
// into PCM channel data. Where the worker scope exposes OfflineAudioContext
// it decodes there; otherwise it returns the raw ArrayBuffers and the caller
// decodes on an OfflineAudioContext on the main thread.
//
// Message in:  { type: 'decodeKit', baseUrl, manifestUrl }
// Message out: { type: 'kitDecoded', kit, lanes: [{ id, sampleRate, channels: [Float32Array...] }] }
//           or { type: 'rawKit', kit, buffers: [{ id, data: ArrayBuffer }] }  (fallback)
//           or { type: 'error', message }

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'decodeKit') return;
  try {
    const manifestRes = await fetch(m.manifestUrl);
    if (!manifestRes.ok) throw new Error(`kit manifest ${manifestRes.status}`);
    const kit = await manifestRes.json();

    const buffers = [];
    for (const lane of kit.lanes) {
      const res = await fetch(`${m.baseUrl}/${lane.file}`);
      if (!res.ok) throw new Error(`sample ${lane.file} ${res.status}`);
      buffers.push({ id: lane.id, data: await res.arrayBuffer() });
    }

    if (typeof OfflineAudioContext !== 'undefined') {
      const lanes = [];
      for (const b of buffers) {
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audio = await ctx.decodeAudioData(b.data.slice(0));
        const channels = [];
        for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c).slice(0));
        lanes.push({ id: b.id, sampleRate: audio.sampleRate, channels });
      }
      self.postMessage({ type: 'kitDecoded', kit, lanes });
    } else {
      self.postMessage({ type: 'rawKit', kit, buffers }, buffers.map((b) => b.data));
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
