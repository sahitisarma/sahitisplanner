// Sync engine.
//  - Google Calendar: two-way (changes go out through the outbox, Google changes are pulled)
//  - Google Tasks: two-way for linked tasks
//  - Your planner itself (handwriting, layout, lists, settings) syncs between your
//    iPad and computer through a private app-data file in your Google Drive.
import * as store from './store.js';
import * as model from './model.js';
import * as G from './google.js';
import * as Q from './queue.js';
import * as E from './events.js';
import { key, addDays, startOfMonth, startOfWeek, todayKey } from './dates.js';
import { toast } from './ui.js';

const DRIVE_FILE = 'planner-data.json';
const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let running = false;
let again = false;
let timer = null;
let lastCalListAt = 0;
let windowStart = addDays(startOfWeek(startOfMonth(todayKey())), -7);
let windowEnd = addDays(windowStart, 56);

export function setWindow(start, end) {
  const s = addDays(start, -7), e = addDays(end, 7);
  const changed = s < windowStart || e > windowEnd;
  windowStart = s < windowStart ? s : windowStart;
  windowEnd = e > windowEnd ? e : windowEnd;
  // don't let the window grow forever
  if (windowEnd > addDays(windowStart, 120)) { windowStart = s; windowEnd = e; }
  if (changed) soon(300);
}

function setSync(sync, message = '') { store.setStatus({ sync, message }); }

export async function start() {
  const r = G.handleRedirect();
  const wasSilent = sessionStorage.getItem('sp-oauth-silent') === '1';
  sessionStorage.removeItem('sp-oauth-silent');
  if (r?.error) {
    if (wasSilent) localStorage.setItem('sp-silent-failed', String(Date.now()));
    if (!wasSilent) toast(r.error === 'access_denied' ? 'Google connection was cancelled.' : r.error === 'no_refresh_token' ? 'Google did not grant lasting access. Remove the app at myaccount.google.com/permissions, then connect again.' : 'Google sign-in did not finish. Try again in Settings.');
    setSync('attention', 'Tap to reconnect Google');
  } else if (r?.ok) {
    localStorage.removeItem('sp-silent-failed');
    await G.loadEmail();
    if (!wasSilent) toast(r.alwaysOn ? 'Google connected. It stays connected now.' : 'Google connected');
  } else if (canSilent() && !sessionStorage.getItem('sp-silent-tried')) {
    // Token expired while the app was closed: renew quietly (takes a second).
    sessionStorage.setItem('sp-silent-tried', '1');
    G.connect({ silent: true });
    return;
  }
  sessionStorage.removeItem('sp-silent-tried');

  Q.onEnqueue(() => soon(400));
  store.on((ev) => {
    if (ev.type !== 'change' || ev.fromSync) return;
    if (ev.col === 'items') watchItem(ev.id);
    if (!ev.id?.startsWith?.('local:')) soon(4000); // send planner changes to Drive shortly after you stop
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (canSilent() && !document.querySelector('.ink-host.writing') && !document.querySelector('.sheet-wrap')) { G.connect({ silent: true }); return; }
    soon(200);
  });
  window.addEventListener('online', () => soon(200));
  window.addEventListener('offline', () => setSync('offline', 'Offline. Changes are saved and will sync later.'));
  // Check Google for changes every 30 seconds while the planner is open.
  setInterval(() => { if (!document.hidden) soon(0); }, 30_000);
  updateIdle();
  soon(500);
}

// Quietly renew Google access, but not again for 30 minutes after a failed try.
function canSilent() {
  if (G.authServer()) return false; // always-connected mode never needs a redirect
  const failed = Number(localStorage.getItem('sp-silent-failed') || 0);
  return !G.isConnected() && G.wasConnected() && !!G.clientId() && navigator.onLine && Date.now() - failed > 30 * 60_000;
}

export function soon(ms = 0) {
  clearTimeout(timer);
  timer = setTimeout(run, ms);
}

function updateIdle() {
  if (!G.configured()) setSync('local', 'Saved on this device. Connect Google in Settings to sync.');
  else if (!G.isConnected()) setSync(G.wasConnected() ? 'attention' : 'local', G.wasConnected() ? 'Tap to reconnect Google' : 'Saved on this device. Connect Google in Settings to sync.');
}

export async function run() {
  if (running) { again = true; return; }
  if (!G.isConnected()) { updateIdle(); return; }
  if (!navigator.onLine) { setSync('offline', 'Offline. Changes are saved and will sync later.'); return; }
  running = true;
  setSync('syncing');
  let problem = '';
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      if (e instanceof G.AuthError) throw e;
      console.warn(name, e);
      problem = problem || `${name}: ${e.message}`;
    }
  };
  try {
    await step('Drive', driveSync); // first, so other devices' links are known before pulling Google
    await step('Outbox', processQueue);
    if (Date.now() - lastCalListAt > 10 * 60_000) await step('Calendars', pullCalendarList);
    await step('Calendar', pullEvents);
    await step('Tasks', pullTasks);
    dedupe();
    const pending = Q.pendingCount();
    if (problem) setSync('attention', `Saved in planner. Not yet synced to Google (${problem}).`);
    else if (pending) setSync('attention', `${pending} change${pending > 1 ? 's' : ''} waiting to sync to Google`);
    else setSync('synced', `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  } catch (e) {
    if (e instanceof G.AuthError) setSync('attention', 'Tap to reconnect Google');
    else setSync('attention', e.message);
  } finally {
    running = false;
    if (again) { again = false; soon(500); }
  }
}

// ---------------- outbox -> Google ----------------
function itemToTask(item) {
  const due = item.due || item.date;
  return {
    title: item.title || '✎ Handwritten item (see Sahiti’s Planner)',
    notes: item.notes || '',
    due: due ? `${due}T00:00:00.000Z` : null,
    status: item.done ? 'completed' : 'needsAction',
    ...(item.done ? {} : { completed: null }),
  };
}

function watchItem(id) {
  const item = store.getRaw('items', id);
  if (!item) return;
  const s = model.settings();
  if (item.deleted) {
    if (item.g?.taskId && !item.gGone) {
      Q.enqueue({ kind: 'task.delete', listId: item.g.listId, taskId: item.g.taskId });
      store.put('items', { id, gGone: true }, { silent: true });
    }
    return;
  }
  if (item.gNew && !item.g) {
    const sec = model.section(item.section);
    const parent = item.parentId ? store.get('items', item.parentId) : null;
    const listId = parent?.g?.listId || s.newTaskList;
    store.put('items', { id, gNew: false }, { silent: true });
    if (listId && sec?.type === 'todos' && !Q.list().some((o) => o.kind === 'task.insert' && o.itemId === id)) {
      Q.enqueue({ kind: 'task.insert', itemId: id, listId });
    }
  } else if (item.gDirty && item.g) {
    store.put('items', { id, gDirty: false }, { silent: true });
    Q.enqueue({ kind: 'task.patch', itemId: id });
  }
}

export function linkItemToGoogle(item, listId) {
  store.put('items', { id: item.id, gNew: false }, { silent: true });
  Q.enqueue({ kind: 'task.insert', itemId: item.id, listId });
}

async function processQueue() {
  for (const op of Q.list()) {
    try {
      await runOp(op);
      Q.remove(op.qid);
    } catch (e) {
      if (e instanceof G.AuthError) throw e;
      if (e.status === 404 || e.status === 410) { Q.remove(op.qid); continue; } // already gone
      if (e.status === 400 || e.status === 403) {
        Q.remove(op.qid);
        toast(`Google did not accept a change: ${e.message}`);
        continue;
      }
      Q.update(op.qid, { tries: (op.tries || 0) + 1 });
      throw e; // keep order: try again next round
    }
  }
}

async function runOp(op) {
  switch (op.kind) {
    case 'cal.insert': {
      const rec = store.get('events', op.recId);
      if (!rec) return;
      try {
        await G.api(`${CAL}/calendars/${enc(op.calId)}/events`, { method: 'POST', body: { id: op.gid, ...E.toGoogle(rec) } });
      } catch (e) {
        if (e.status !== 409) throw e; // 409 = already created on an earlier try
      }
      store.put('events', { id: rec.id, synced: true, pending: false }, { fromSync: true });
      if (rec.taskId) store.put('items', { id: rec.taskId, eventLink: rec.id });
      return;
    }
    case 'cal.patch': {
      const rec = store.get('events', op.recId);
      if (!rec) return;
      const body = E.toGoogle(rec);
      if (rec.recurringEventId) delete body.recurrence;
      await G.api(`${CAL}/calendars/${enc(op.calId)}/events/${enc(op.gid)}`, { method: 'PATCH', body });
      store.put('events', { id: rec.id, pending: false }, { fromSync: true });
      return;
    }
    case 'cal.patchSeries': {
      const master = await G.api(`${CAL}/calendars/${enc(op.calId)}/events/${enc(op.gid)}`);
      const f = op.form;
      const body = { summary: f.summary, description: f.description || '', location: f.location || '' };
      if (f.recurrence) body.recurrence = f.recurrence;
      if (!f.allDay && master.start?.dateTime) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const keepDate = (iso, hhmm) => { const d = new Date(iso); const [h, m] = hhmm.split(':'); d.setHours(+h, +m, 0, 0); return d.toISOString(); };
        body.start = { dateTime: keepDate(master.start.dateTime, f.startTime), timeZone: tz };
        body.end = { dateTime: keepDate(master.start.dateTime, f.endTime || f.startTime), timeZone: tz };
      }
      await G.api(`${CAL}/calendars/${enc(op.calId)}/events/${enc(op.gid)}`, { method: 'PATCH', body });
      return;
    }
    case 'cal.delete':
      await G.api(`${CAL}/calendars/${enc(op.calId)}/events/${enc(op.gid)}`, { method: 'DELETE' });
      return;
    case 'cal.move':
      await G.api(`${CAL}/calendars/${enc(op.calId)}/events/${enc(op.gid)}/move`, { method: 'POST', query: { destination: op.dest } });
      return;
    case 'task.insert': {
      const item = store.get('items', op.itemId);
      if (!item || item.g) return;
      // If an earlier try may have reached Google, look before creating again.
      if (op.attempted) {
        const found = await findRecentTask(op.listId, item, op.at);
        if (found) { linkTask(item, op.listId, found); return; }
      }
      Q.update(op.qid, { attempted: true });
      const parent = item.parentId ? store.get('items', item.parentId) : null;
      const t = await G.api(`${TASKS}/lists/${enc(op.listId)}/tasks`, {
        method: 'POST', body: itemToTask(item), query: { parent: parent?.g?.taskId },
      });
      linkTask(item, op.listId, t);
      return;
    }
    case 'task.patch': {
      const item = store.get('items', op.itemId);
      if (!item?.g) return;
      const t = await G.api(`${TASKS}/lists/${enc(item.g.listId)}/tasks/${enc(item.g.taskId)}`, { method: 'PATCH', body: itemToTask(item) });
      store.put('items', { id: item.id, g: { ...item.g, updated: t.updated } }, { fromSync: true, quiet: true });
      return;
    }
    case 'task.delete':
      await G.api(`${TASKS}/lists/${enc(op.listId)}/tasks/${enc(op.taskId)}`, { method: 'DELETE' });
      return;
    default:
  }
}

function linkTask(item, listId, t) {
  store.put('items', { id: item.id, g: { listId, taskId: t.id, updated: t.updated } }, { fromSync: true });
  // keep this link even if Drive merges in an older copy: stamp it as a normal edit
  store.put('items', { id: item.id }, { quiet: true });
}

async function findRecentTask(listId, item, since) {
  const res = await G.api(`${TASKS}/lists/${enc(listId)}/tasks`, { query: { updatedMin: new Date(since - 120_000).toISOString(), showCompleted: true, showHidden: true, maxResults: 100 } });
  const want = itemToTask(item).title;
  const linked = new Set(store.all('items').map((i) => i.g?.taskId).filter(Boolean));
  return (res.items || []).find((t) => t.title === want && !linked.has(t.id));
}

// ---------------- Google -> planner ----------------
async function pullCalendarList() {
  const res = await G.api(`${CAL}/users/me/calendarList`, { query: { minAccessRole: 'reader', maxResults: 250 } });
  const cals = (res.items || []).map((c) => ({
    id: c.id, summary: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary, accessRole: c.accessRole,
  })).sort((a, b) => (b.primary - a.primary) || a.summary.localeCompare(b.summary));
  store.setMeta('gcals', cals, { fromSync: true });
  lastCalListAt = Date.now();
  const tl = await G.api(`${TASKS}/users/@me/lists`, { query: { maxResults: 100 } });
  store.setMeta('gtasklists', (tl.items || []).map((l) => ({ id: l.id, title: l.title })), { fromSync: true });
}

async function pullEvents() {
  const cals = (store.meta('gcals', []) || []);
  const hidden = new Set(model.settings().hiddenCalendars || []);
  const timeMin = new Date(`${windowStart}T00:00:00`).toISOString();
  const timeMax = new Date(`${windowEnd}T23:59:59`).toISOString();
  const pendingIds = new Set(Q.list().map((o) => o.recId).filter(Boolean));
  let changed = false;
  for (const cal of cals) {
    if (hidden.has(cal.id)) continue;
    const seen = new Set();
    let pageToken;
    do {
      const res = await G.api(`${CAL}/calendars/${enc(cal.id)}/events`, {
        query: { singleEvents: true, orderBy: 'startTime', timeMin, timeMax, maxResults: 2500, pageToken, showDeleted: false },
      });
      for (const g of res.items || []) {
        if (g.status === 'cancelled') continue;
        const rec = E.fromGoogle(g, cal.id);
        seen.add(rec.id);
        if (pendingIds.has(rec.id)) continue; // our own edit is on the way out
        const cur = store.getRaw('events', rec.id);
        if (cur && !cur.deleted && cur.etag === rec.etag && cur.calId === rec.calId) continue;
        if (cur?.deleted && Q.list().some((o) => o.kind === 'cal.delete' && (o.gid === rec.gid || o.gid === rec.recurringEventId))) continue;
        store.replace('events', { ...rec, updatedAt: Date.now() }, { silent: true });
        changed = true;
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    // events removed in Google
    const ws = new Date(timeMin), we = new Date(timeMax);
    for (const ev of store.all('events')) {
      if (ev.calId !== cal.id || !ev.synced || seen.has(ev.id) || pendingIds.has(ev.id) || ev.pending) continue;
      if (ev.recurrence?.length && !ev.recurringEventId) continue; // series master record
      const s = E.evStart(ev), e = E.evEnd(ev);
      if (e > ws && s < we) { store.replace('events', { ...ev, deleted: true, updatedAt: Date.now() }, { silent: true }); changed = true; }
    }
  }
  if (changed) store.setStatus({}); // nudge
  if (changed) store.put('meta', { id: 'local:eventsTick', value: Date.now() }, { fromSync: true });
}

async function pullTasks() {
  const lists = store.meta('gtasklists', []) || [];
  const todos = model.sectionByType('todos');
  if (!todos) return;
  const last = store.meta('local:tasksPulledAt', 0);
  const since = last ? new Date(last - 5 * 60_000).toISOString() : new Date(Date.now() - 60 * 86400000).toISOString();
  const startedAt = Date.now();
  const byTask = new Map(store.all('items', true).filter((i) => i.g?.taskId).map((i) => [i.g.taskId, i]));
  const pendingItems = new Set(Q.list().map((o) => o.itemId).filter(Boolean));
  for (const list of lists) {
    let pageToken;
    const parentsLater = [];
    do {
      const res = await G.api(`${TASKS}/lists/${enc(list.id)}/tasks`, {
        query: { showCompleted: true, showHidden: true, showDeleted: !!last, maxResults: 100, updatedMin: since, pageToken },
      });
      for (const t of res.items || []) {
        const cur = byTask.get(t.id);
        if (t.deleted) { if (cur && !cur.deleted) store.put('items', { id: cur.id, deleted: true, gGone: true }, { fromSync: true }); continue; }
        if (!t.title && !cur) continue; // Google's empty placeholder rows
        const dueKey = t.due ? t.due.slice(0, 10) : null;
        const doneKey = t.status === 'completed' ? (t.completed ? key(new Date(t.completed)) : todayKey()) : null;
        if (cur) {
          if (cur.deleted || pendingItems.has(cur.id) || cur.gDirty) continue;
          if (cur.g.updated && t.updated <= cur.g.updated) continue;
          const patch = { id: cur.id, g: { ...cur.g, listId: list.id, updated: t.updated } };
          const isPlaceholder = /^✎ Handwritten item/.test(t.title);
          if (!isPlaceholder && t.title !== cur.title && !(cur.ink && !cur.title && isPlaceholder)) patch.title = t.title;
          patch.notes = t.notes || '';
          patch.done = !!doneKey;
          patch.completedAt = doneKey ? (cur.done ? cur.completedAt : doneKey) : null;
          if (cur.due || !cur.date) patch.due = dueKey; else patch.date = dueKey || cur.date;
          store.put('items', patch, { fromSync: true });
        } else {
          const id = `gt:${t.id}`;
          if (store.getRaw('items', id)) continue;
          const item = store.put('items', {
            id, section: todos.id, title: t.title, notes: t.notes || '', ink: null, style: {},
            date: dueKey, due: dueKey, priority: 0, done: !!doneKey, completedAt: doneKey, rollover: true,
            parentId: null, order: Number(t.position || 0) / 1e12, createdAt: Date.now(),
            g: { listId: list.id, taskId: t.id, updated: t.updated },
          }, { fromSync: true });
          byTask.set(t.id, item);
          if (t.parent) parentsLater.push([id, t.parent]);
        }
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    for (const [id, parentTaskId] of parentsLater) {
      const p = byTask.get(parentTaskId);
      if (p) store.put('items', { id, parentId: p.id }, { fromSync: true });
    }
  }
  store.setMeta('local:tasksPulledAt', startedAt, { quiet: true });
}

// If two devices both linked the same Google task, keep one copy.
function dedupe() {
  const seen = new Map();
  for (const i of store.all('items').sort((a, b) => (a.id.startsWith('gt:') - b.id.startsWith('gt:')) || (a.createdAt - b.createdAt))) {
    const t = i.g?.taskId;
    if (!t) continue;
    if (seen.has(t)) store.put('items', { id: i.id, deleted: true, gGone: true }, { fromSync: true });
    else seen.set(t, i);
  }
}

// ---------------- planner data <-> Google Drive (between your devices) ----------------
function syncable(col, rec) {
  if (rec.id.startsWith?.('local:')) return false;
  if (col === 'events' && rec.id.startsWith('g:')) return false; // comes from Google Calendar
  return true;
}
function newer(a, b) { // is a newer than b?
  if (!b) return true;
  if ((a.updatedAt || 0) !== (b.updatedAt || 0)) return (a.updatedAt || 0) > (b.updatedAt || 0);
  return String(a.dev || '') > String(b.dev || '');
}

async function driveSync() {
  const found = await G.api(`${DRIVE}/files`, { query: { spaces: 'appDataFolder', q: `name='${DRIVE_FILE}'`, fields: 'files(id,modifiedTime)' } });
  let fileId = found.files?.[0]?.id;
  let remote = { records: {} };
  if (fileId) {
    const data = await G.api(`${DRIVE}/files/${fileId}`, { query: { alt: 'media' } });
    if (data && typeof data === 'object') remote = data;
  }
  // 1) merge remote into local
  let mergedAny = false;
  const remoteIndex = {};
  for (const col of store.SYNCED) {
    remoteIndex[col] = new Map();
    for (const rec of remote.records?.[col] || []) {
      remoteIndex[col].set(rec.id, rec);
      if (!syncable(col, rec)) continue;
      const local = store.getRaw(col, rec.id);
      if (newer(rec, local)) {
        // keep device-only fields
        store.replace(col, { ...rec, localDirty: false }, { silent: true });
        mergedAny = true;
      }
    }
  }
  // 2) upload if this device has anything newer
  let needUpload = !fileId;
  const out = {};
  const cutoff = Date.now() - 45 * 86400000;
  for (const col of store.SYNCED) {
    out[col] = [];
    for (const rec of store.all(col, true)) {
      if (!syncable(col, rec)) continue;
      if (rec.deleted && (rec.updatedAt || 0) < cutoff) continue; // old tombstones
      const { localDirty, ...clean } = rec;
      out[col].push(clean);
      if (newer(rec, remoteIndex[col].get(rec.id))) needUpload = true;
    }
  }
  if (needUpload) {
    const body = JSON.stringify({ v: 1, savedAt: Date.now(), by: store.deviceId, records: out });
    if (fileId) {
      await G.api(`${UPLOAD}/files/${fileId}`, { method: 'PATCH', query: { uploadType: 'media' }, body, raw: true, headers: { 'Content-Type': 'application/json' } });
    } else {
      const boundary = `sp${Date.now()}`;
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const created = await G.api(`${UPLOAD}/files`, { method: 'POST', query: { uploadType: 'multipart' }, body: multipart, raw: true, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
      fileId = created.id;
    }
  }
  if (mergedAny) store.put('meta', { id: 'local:mergeTick', value: Date.now() }, { fromSync: true });
  await syncAudio();
}

async function syncAudio() {
  for (const v of store.all('voice')) {
    if (v.driveFileId || !v.audioKey) continue;
    const blob = await store.getBlob(v.audioKey);
    if (!blob) continue;
    const boundary = `sp${Date.now()}`;
    const meta = JSON.stringify({ name: `audio-${v.id}`, parents: ['appDataFolder'], mimeType: blob.type || 'audio/mp4' });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'audio/mp4'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const created = await G.api(`${UPLOAD}/files`, { method: 'POST', query: { uploadType: 'multipart' }, body, raw: true, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
    store.put('voice', { id: v.id, driveFileId: created.id }, { quiet: true });
  }
}

export async function fetchAudio(v) {
  if (!v.driveFileId || !G.isConnected()) return null;
  let tok; try { tok = await G.ensureToken(); } catch { return null; }
  const res = await fetch(`${DRIVE}/files/${v.driveFileId}?alt=media`, { headers: { Authorization: `Bearer ${tok.access}` } });
  if (!res.ok) return null;
  const blob = await res.blob();
  await store.putBlob(v.audioKey, blob);
  return blob;
}

const enc = encodeURIComponent;
