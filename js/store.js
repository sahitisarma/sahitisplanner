// Local-first storage. Every record lives in IndexedDB and is saved automatically
// a moment after it changes. Records carry updatedAt + deleted (tombstones) so
// devices can merge safely without duplicating anything.

const DB_NAME = 'sahitis-planner';
const DB_VERSION = 1;
export const COLLECTIONS = ['meta', 'sections', 'items', 'stores', 'notes', 'voice', 'events', 'ink'];
// Collections that sync between devices through Google Drive app data.
// ('events' come from Google Calendar itself; local-only events are synced too.)
export const SYNCED = ['meta', 'sections', 'items', 'stores', 'notes', 'voice', 'events', 'ink'];

let db;
const state = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
const listeners = new Set();
const pending = new Map(); // "col:id" -> record waiting to be written
let flushTimer = null;
export const deviceId = (() => {
  try {
    let id = localStorage.getItem('sp-device');
    if (!id) { id = uid(); localStorage.setItem('sp-device', id); }
    return id;
  } catch { return uid(); }
})();

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records');
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function init() {
  try {
    db = await Promise.race([openDB(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
  } catch (e) {
    // Storage blocked (for example inside a preview frame): keep working in memory.
    console.warn('Saving is unavailable here; working in memory.', e);
    db = null;
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const req = tx.objectStore('records').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      const [col, ...rest] = String(cur.key).split(':');
      const id = rest.join(':');
      if (state[col]) state[col].set(id, cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  // Ask the browser to keep our data (helps on iPad Safari).
  try { await navigator.storage?.persist?.(); } catch {}
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
}

// ---------- status ----------
let status = { save: 'saved', sync: 'idle', message: '' };
export function getStatus() { return status; }
export function setStatus(patch) {
  status = { ...status, ...patch };
  emit({ type: 'status' });
}

// ---------- read ----------
export function get(col, id) {
  const r = state[col].get(id);
  return r && !r.deleted ? r : undefined;
}
export function getRaw(col, id) { return state[col].get(id); }
export function all(col, includeDeleted = false) {
  const out = [];
  for (const r of state[col].values()) if (includeDeleted || !r.deleted) out.push(r);
  return out;
}
export function meta(id, fallback) {
  const r = get('meta', id);
  return r ? r.value : fallback;
}

// ---------- write ----------
// put() merges a patch into a record, stamps it, and schedules an automatic save.
export function put(col, rec, { silent = false, quiet = false, fromSync = false, keepStamp = false } = {}) {
  const prev = state[col].get(rec.id);
  const next = { ...(prev || {}), ...rec };
  if (!keepStamp) {
    next.updatedAt = Date.now();
    next.dev = deviceId;
  }
  if (!fromSync) next.localDirty = true; // needs to go to Drive
  state[col].set(rec.id, next);
  queueWrite(col, next);
  emit({ type: 'change', col, id: rec.id, fromSync, quiet: quiet || silent });
  return next;
}
export function setMeta(id, value, opts) { return put('meta', { id, value }, opts); }
export function remove(col, id, opts) {
  const prev = state[col].get(id);
  if (!prev) return;
  return put(col, { id, deleted: true }, opts);
}
// Write a record exactly as given (used by the sync engine when merging).
export function replace(col, rec, { silent = false } = {}) {
  state[col].set(rec.id, rec);
  queueWrite(col, rec);
  if (!silent) emit({ type: 'change', col, id: rec.id, fromSync: true });
}

function queueWrite(col, rec) {
  pending.set(`${col}:${rec.id}`, rec);
  if (status.save !== 'saving') setStatus({ save: 'saving' });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, 250);
}

export function flushNow() {
  clearTimeout(flushTimer);
  if (!db) { pending.clear(); if (status.save === 'saving') setStatus({ save: 'saved' }); return Promise.resolve(); }
  if (!pending.size) { if (status.save === 'saving') setStatus({ save: 'saved' }); return Promise.resolve(); }
  const batch = [...pending.entries()];
  pending.clear();
  return new Promise((resolve) => {
    const tx = db.transaction('records', 'readwrite');
    const os = tx.objectStore('records');
    for (const [k, v] of batch) os.put(v, k);
    tx.oncomplete = () => { setStatus({ save: pending.size ? 'saving' : 'saved' }); resolve(); };
    tx.onerror = () => {
      // put them back so nothing is lost; retry soon
      for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
      setStatus({ save: 'error', message: 'Could not save on this device. Retrying.' });
      setTimeout(flushNow, 2000);
      resolve();
    };
  });
}

// ---------- blobs (voice audio) ----------
const memBlobs = new Map();
export function putBlob(id, blob) {
  if (!db) { memBlobs.set(id, blob); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export function getBlob(id) {
  if (!db) return Promise.resolve(memBlobs.get(id) || null);
  return new Promise((resolve) => {
    const tx = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

// ---------- events ----------
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }

// For tests / export
export function snapshot() {
  const out = {};
  for (const c of COLLECTIONS) out[c] = [...state[c].values()];
  return out;
}
