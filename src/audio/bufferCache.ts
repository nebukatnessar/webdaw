import { getAudioContext } from './engine';
import { encodeWav } from './wav';

const DB_NAME = 'webdaw-audio-cache';
const STORE_NAME = 'buffers';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Durably caches an audio buffer in IndexedDB, keyed by id, so it can survive
 * a page refresh without needing filesystem permission or a re-prompt.
 */
export async function cacheBuffer(id: string, buffer: AudioBuffer): Promise<void> {
  try {
    const blob = encodeWav(buffer);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn(`Failed to cache audio buffer ${id}:`, e);
  }
}

export async function getCachedBuffer(id: string): Promise<AudioBuffer | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!blob) return null;
    const arrayBuffer = await blob.arrayBuffer();
    return await getAudioContext().decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn(`Failed to read cached audio buffer ${id}:`, e);
    return null;
  }
}

export async function clearBufferCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('Failed to clear audio buffer cache:', e);
  }
}
