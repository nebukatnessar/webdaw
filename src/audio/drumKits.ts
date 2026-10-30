// Bundled factory kit loading for the drum machine (feature #194, task #196).
// Kits are versioned with the repo under public/kits/<kitId>/ (manifest +
// one-shot WAVs; closed set, no user sample loading in v1). Fetch + decode
// run in a Web Worker (public/workers/decode-kit-worker.js) per #89, so kit
// loading never blocks the main thread; decoded PCM is handed back as
// transferable Float32Arrays and rebuilt into AudioBuffers here.
import type { DrumKit, DrumKitLane } from '../types/daw';

export const BUNDLED_KIT_IDS = ['factory-808'] as const;

export const BUNDLED_KIT_LABELS: Record<string, string> = {
  'factory-808': 'Factory 808',
};

export interface LoadedDrumKit {
  kit: DrumKit;
  buffers: Map<string, AudioBuffer>; // lane id -> decoded one-shot
}

const kitCache = new Map<string, Promise<LoadedDrumKit>>();
const laneIndexCache = new Map<string, Map<number, DrumKitLane>>();

function kitBaseUrl(kitId: string): string {
  return `${import.meta.env.BASE_URL}kits/${kitId}`;
}

/**
 * Load (and cache) a bundled kit: manifest + one-shots fetched and decoded in
 * a worker, then rebuilt into AudioBuffers on the given context. Concurrent
 * calls for the same kit share one promise, so repeat loads are free.
 */
export function loadDrumKit(ctx: BaseAudioContext, kitId: string): Promise<LoadedDrumKit> {
  const cached = kitCache.get(kitId);
  if (cached) return cached;

  const baseUrl = kitBaseUrl(kitId);
  const promise = new Promise<LoadedDrumKit>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(`${import.meta.env.BASE_URL}workers/decode-kit-worker.js`);
    } catch (e) {
      reject(e);
      return;
    }
    const cleanup = () => worker.terminate();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'kitDecoded') {
        const buffers = new Map<string, AudioBuffer>();
        for (const lane of m.lanes) {
          const len = lane.channels[0]?.length ?? 0;
          const buffer = ctx.createBuffer(lane.channels.length, len, lane.sampleRate);
          lane.channels.forEach((data: Float32Array, c: number) => buffer.copyToChannel(data, c));
          buffers.set(lane.id, buffer);
        }
        cleanup();
        resolve({ kit: m.kit as DrumKit, buffers });
      } else if (m.type === 'rawKit') {
        // Fallback: decode on the main thread (worker had no OfflineAudioContext).
        void (async () => {
          const buffers = new Map<string, AudioBuffer>();
          for (const b of m.buffers) {
            buffers.set(b.id, await ctx.decodeAudioData(b.data));
          }
          cleanup();
          resolve({ kit: m.kit as DrumKit, buffers });
        })().catch((err) => { cleanup(); reject(err); });
      } else {
        cleanup();
        reject(new Error(m.message ?? 'kit decode failed'));
      }
    };
    worker.onerror = (e) => { cleanup(); reject(new Error(e.message)); };
    worker.postMessage({ type: 'decodeKit', baseUrl, manifestUrl: `${baseUrl}/kit.json` });
  });

  kitCache.set(kitId, promise);
  promise.catch(() => kitCache.delete(kitId));
  return promise;
}

/** Lane lookup by MIDI pitch for a kit id (cached after first load). */
export function getKitLaneByPitch(kitId: string, pitch: number): DrumKitLane | null {
  const index = laneIndexCache.get(kitId);
  if (!index) return null;
  return index.get(pitch) ?? null;
}

/** Build the pitch -> lane index once a kit is loaded. Call after loadDrumKit resolves. */
export function indexKitLanes(loaded: LoadedDrumKit): Map<number, DrumKitLane> {
  const index = new Map<number, DrumKitLane>();
  for (const lane of loaded.kit.lanes) index.set(lane.pitch, lane);
  laneIndexCache.set(loaded.kit.id, index);
  return index;
}

export function getCachedKit(kitId: string): Promise<LoadedDrumKit> | undefined {
  return kitCache.get(kitId);
}
