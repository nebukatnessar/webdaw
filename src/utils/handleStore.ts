// Persists FileSystemHandle objects (which are structured-clone-able, so
// IndexedDB can store them directly - unlike localStorage) so a previously
// granted folder can be reconnected to after a refresh via
// queryPermission()/requestPermission(), instead of re-prompting the user
// with showDirectoryPicker() from scratch.

const DB_NAME = 'webdaw-handles';
const STORE_NAME = 'handles';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Without this, a stuck connection from another tab/reload would leave
    // this promise pending forever instead of failing loudly.
    request.onblocked = () => reject(new Error(`IndexedDB open("${DB_NAME}") blocked by another connection`));
  });
}

export async function saveHandle(key: string, handle: FileSystemHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn(`Failed to persist handle "${key}":`, e);
  }
}

export async function getHandle<T extends FileSystemHandle = FileSystemHandle>(
  key: string,
): Promise<T | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle ?? null;
  } catch (e) {
    console.warn(`Failed to read persisted handle "${key}":`, e);
    return null;
  }
}

export async function deleteHandle(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn(`Failed to delete persisted handle "${key}":`, e);
  }
}
