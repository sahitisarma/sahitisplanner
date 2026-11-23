// Outbox of changes waiting to go to Google. Saved on this device, so nothing is
// lost if the connection drops or the app closes. Processed in order.
import * as store from './store.js';

const KEY = 'local:gqueue';
let kick = () => {};
export function onEnqueue(fn) { kick = fn; }

export function list() { return store.meta(KEY, []) || []; }
function save(q) { store.setMeta(KEY, q, { quiet: true }); }

export function enqueue(op) {
  const q = list();
  op = { ...op, qid: store.uid(), at: Date.now(), tries: 0 };
  // Coalesce repeated patches to the same thing
  if (op.kind === 'cal.patch' || op.kind === 'task.patch') {
    const same = q.find((o) => o.kind === op.kind && (o.recId || o.itemId) === (op.recId || op.itemId) && !o.inflight);
    if (same) { save(q); kick(); return; }
  }
  if (op.kind === 'task.patch' && q.some((o) => o.kind === 'task.insert' && o.itemId === op.itemId)) { kick(); return; }
  if (op.kind === 'cal.patch' && q.some((o) => o.kind === 'cal.insert' && o.recId === op.recId)) { kick(); return; }
  if (op.kind === 'cal.delete') {
    // a delete cancels a pending insert of the same event
    const ins = q.findIndex((o) => o.kind === 'cal.insert' && o.gid === op.gid && !o.attempted);
    if (ins >= 0) { q.splice(ins, 1); save(q.filter((o) => o.gid !== op.gid)); return; }
  }
  q.push(op);
  save(q);
  kick();
}
export function remove(qid) { save(list().filter((o) => o.qid !== qid)); }
export function update(qid, patch) { save(list().map((o) => (o.qid === qid ? { ...o, ...patch } : o))); }
export function pendingCount() { return list().length; }
