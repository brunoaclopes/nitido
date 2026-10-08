// @ts-check
/** IndexedDB: analysis cache (reopening a folder is instant) and per-folder sessions
 *  (manual decisions, group names and edits). */
const DB = "nitido", VERSION = 1;
export const CACHE_VERSION = 7;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  try {
    const db = await open();
    return await new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => res(req && "result" in req ? req.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  } catch { return undefined; }
}
export const getCache = (key) => tx("cache", "readonly", (s) => s.get(key));
export const putCache = (key, value) => tx("cache", "readwrite", (s) => s.put(value, key));
export const clearCache = () => tx("cache", "readwrite", (s) => s.clear());
/** Forgets the analysis of these keys, so the photos are measured again. */
export const dropCache = (keys) => tx("cache", "readwrite", (s) => { for (const k of keys) s.delete(k); });
export const getSession = (key) => tx("sessions", "readonly", (s) => s.get(key));
export const putSession = (key, value) => tx("sessions", "readwrite", (s) => s.put(value, key));

/** Small values kept across sessions (the destination folder handle, the taste model). */
export const getMeta = (key) => tx("sessions", "readonly", (s) => s.get("__" + key));
export const putMeta = (key, value) => tx("sessions", "readwrite", (s) => s.put(value, "__" + key));

/** Stable key for a file's analysis. */
export const cacheKey = (path, file) => `${path}|${file.size}|${file.lastModified}|v${CACHE_VERSION}`;
