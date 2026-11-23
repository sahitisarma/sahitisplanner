// Calendar events: one model for Google events and planner-only events.
import * as store from './store.js';
import * as model from './model.js';
import { key, parseKey, addDays, fromKeyTime } from './dates.js';
import { newEventId } from './google.js';
import { enqueue } from './queue.js';

export const LOCAL_CAL = { id: 'local', summary: 'Planner', color: '#E4572E', accessRole: 'owner' };

export function calendars() {
  const g = store.meta('gcals', []) || [];
  return [...g, LOCAL_CAL];
}
export function writableCalendars() {
  return calendars().filter((c) => ['owner', 'writer'].includes(c.accessRole));
}
export function calendar(id) { return calendars().find((c) => c.id === id) || LOCAL_CAL; }
export function visibleCalendarIds() {
  const hidden = new Set(model.settings().hiddenCalendars || []);
  return new Set(calendars().map((c) => c.id).filter((id) => !hidden.has(id)));
}
export function defaultCalendarId() {
  const s = model.settings();
  const cals = writableCalendars();
  if (s.defaultCalendar && cals.some((c) => c.id === s.defaultCalendar)) return s.defaultCalendar;
  return (cals.find((c) => c.primary) || cals[0] || LOCAL_CAL).id;
}
export function eventColor(ev) { return ev.color || calendar(ev.calId).color || '#3D5DA8'; }

// ---------- time helpers ----------
export function evStart(ev) { return ev.allDay ? parseKey(ev.start) : new Date(ev.start); }
export function evEnd(ev) { return ev.allDay ? parseKey(ev.end || addDays(ev.start, 1)) : new Date(ev.end || ev.start); }

// ---------- recurrence (for planner-only events and not-yet-synced Google events) ----------
function parseRule(recurrence) {
  const line = (recurrence || []).find((r) => r.startsWith('RRULE:'));
  if (!line) return null;
  const parts = Object.fromEntries(line.slice(6).split(';').map((p) => p.split('=')));
  return {
    freq: parts.FREQ, interval: Number(parts.INTERVAL || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until: parts.UNTIL ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` : null,
    byday: parts.BYDAY ? parts.BYDAY.split(',') : null,
  };
}
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function expand(ev, rangeStart, rangeEnd) {
  const rule = parseRule(ev.recurrence);
  const s0 = evStart(ev), e0 = evEnd(ev);
  const dur = e0 - s0;
  if (!rule) return [{ ev, start: s0, end: e0 }];
  const out = [];
  const startKey = key(s0);
  const exdates = new Set(ev.exdates || []);
  let n = 0;
  const push = (k) => {
    if (rule.until && k > rule.until) return false;
    if (rule.count && n >= rule.count) return false;
    n++;
    const st = ev.allDay ? parseKey(k) : fromKeyTime(k, `${s0.getHours()}:${s0.getMinutes()}`);
    const en = new Date(st.getTime() + dur);
    if (!exdates.has(k) && en > rangeStart && st < rangeEnd) out.push({ ev, start: st, end: en, occ: k });
    return st < rangeEnd;
  };
  for (let i = 0, guard = 0; guard < 3000; i++, guard++) {
    if (rule.freq === 'DAILY') { if (!push(addDays(startKey, i * rule.interval))) break; }
    else if (rule.freq === 'WEEKLY') {
      const days = rule.byday ? rule.byday.map((d) => BYDAY.indexOf(d)).sort() : [s0.getDay()];
      const wk = addDays(startKey, -s0.getDay() + i * 7 * rule.interval); // Sunday of that week
      let cont = true;
      for (const d of days) {
        const k = addDays(wk, d);
        if (k < startKey) continue;
        if (!push(k)) { cont = false; break; }
      }
      if (!cont) break;
    } else if (rule.freq === 'MONTHLY') {
      const d = parseKey(startKey); d.setMonth(d.getMonth() + i * rule.interval);
      if (d.getDate() !== s0.getDate()) continue;
      if (!push(key(d))) break;
    } else if (rule.freq === 'YEARLY') {
      const d = parseKey(startKey); d.setFullYear(d.getFullYear() + i * rule.interval);
      if (!push(key(d))) break;
    } else break;
  }
  return out;
}

// All event occurrences that touch [startKey, endKey] (inclusive days), visible calendars only.
export function occurrences(startKey, endKey) {
  const rs = parseKey(startKey), re = parseKey(addDays(endKey, 1));
  const vis = visibleCalendarIds();
  const out = [];
  for (const ev of store.all('events')) {
    if (!vis.has(ev.calId)) continue;
    if (ev.recurrence?.length) {
      // Synced Google series show as their real instances (pulled from Google)
      if (ev.calId !== 'local' && ev.synced) continue;
      out.push(...expand(ev, rs, re));
    } else {
      const s = evStart(ev), e = evEnd(ev);
      if (e > rs && s < re) out.push({ ev, start: s, end: e });
    }
  }
  return out.sort((a, b) => (b.ev.allDay - a.ev.allDay) || (a.start - b.start));
}
export function occurrencesOn(dayKey) {
  const ds = parseKey(dayKey), de = parseKey(addDays(dayKey, 1));
  return occurrences(dayKey, dayKey).filter((o) => o.end > ds && o.start < de && !(o.ev.allDay && o.end <= ds));
}

// ---------- create / edit / delete ----------
// form: { summary, description, location, allDay, startKey, startTime, endKey, endTime, recurrence, calId, taskId }
export function buildTimes(form) {
  if (form.allDay) {
    const end = addDays(form.endKey && form.endKey >= form.startKey ? form.endKey : form.startKey, 1);
    return { start: form.startKey, end };
  }
  const s = fromKeyTime(form.startKey, form.startTime || '09:00');
  let e = fromKeyTime(form.endKey || form.startKey, form.endTime || form.startTime || '10:00');
  if (e <= s) e = new Date(s.getTime() + 60 * 60 * 1000);
  return { start: s.toISOString(), end: e.toISOString() };
}

export function createEvent(form) {
  const calId = form.calId || defaultCalendarId();
  const times = buildTimes(form);
  const base = {
    summary: form.summary || 'New event', description: form.description || '', location: form.location || '',
    allDay: !!form.allDay, ...times, recurrence: form.recurrence?.length ? form.recurrence : null,
    calId, taskId: form.taskId || null,
  };
  if (calId === 'local') {
    return store.put('events', { id: `local:${store.uid()}`, ...base });
  }
  const gid = newEventId();
  const rec = store.put('events', { id: `g:${calId}:${gid}`, gid, ...base, synced: false, pending: true });
  enqueue({ kind: 'cal.insert', calId, gid, recId: rec.id });
  return rec;
}

// scope: 'one' (just this occurrence) | 'all' (whole series)
export function updateEvent(ev, form, scope = 'one') {
  const times = buildTimes(form);
  const patch = {
    summary: form.summary, description: form.description || '', location: form.location || '',
    allDay: !!form.allDay, ...times,
  };
  const newCal = form.calId || ev.calId;
  if (ev.calId === 'local') {
    if (newCal !== 'local') { // move a planner event into Google
      store.remove('events', ev.id);
      return createEvent({ ...form, calId: newCal });
    }
    return store.put('events', { id: ev.id, ...patch, recurrence: form.recurrence?.length ? form.recurrence : null });
  }
  if (newCal === 'local') { // move a Google event to planner-only
    deleteEvent(ev, scope);
    return createEvent({ ...form, calId: 'local' });
  }
  if (scope === 'all' && ev.recurringEventId) {
    // Edit the series master. Times keep each instance's own date: only clock times change.
    enqueue({ kind: 'cal.patchSeries', calId: ev.calId, gid: ev.recurringEventId, form: { ...form } });
    store.put('events', { id: ev.id, ...patch });
  } else {
    const rec = store.put('events', { id: ev.id, ...patch, recurrence: ev.recurringEventId ? undefined : (form.recurrence?.length ? form.recurrence : null), pending: true });
    enqueue({ kind: 'cal.patch', calId: ev.calId, gid: ev.gid, recId: rec.id });
  }
  if (newCal !== ev.calId) {
    enqueue({ kind: 'cal.move', calId: ev.calId, gid: scope === 'all' && ev.recurringEventId ? ev.recurringEventId : ev.gid, dest: newCal });
    const moved = { ...store.get('events', ev.id), calId: newCal, id: `g:${newCal}:${ev.gid}` };
    store.remove('events', ev.id);
    store.put('events', moved);
  }
}

export function deleteEvent(ev, scope = 'one', occ) {
  if (ev.calId === 'local') {
    if (ev.recurrence?.length && scope === 'one' && occ) {
      return store.put('events', { id: ev.id, exdates: [...(ev.exdates || []), occ] });
    }
    return store.remove('events', ev.id);
  }
  if (scope === 'all' && ev.recurringEventId) {
    enqueue({ kind: 'cal.delete', calId: ev.calId, gid: ev.recurringEventId });
    for (const e of store.all('events')) if (e.recurringEventId === ev.recurringEventId) store.remove('events', e.id);
  } else {
    enqueue({ kind: 'cal.delete', calId: ev.calId, gid: ev.gid });
    store.remove('events', ev.id);
  }
}

// ---------- Google <-> planner conversion ----------
export function toGoogle(rec) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: rec.summary, description: rec.description || '', location: rec.location || '',
    start: rec.allDay ? { date: rec.start } : { dateTime: rec.start, timeZone: tz },
    end: rec.allDay ? { date: rec.end } : { dateTime: rec.end, timeZone: tz },
  };
  if (rec.recurrence?.length) body.recurrence = rec.recurrence.map((r) => r.replace(/UNTIL=(\d{8})(?!T)/, 'UNTIL=$1T235959Z'));
  if (rec.taskId) body.extendedProperties = { private: { plannerTaskId: rec.taskId } };
  return body;
}

export function fromGoogle(g, calId) {
  const allDay = !!g.start?.date;
  return {
    id: `g:${calId}:${g.id}`, gid: g.id, calId,
    summary: g.summary || '(No title)', description: g.description || '', location: g.location || '',
    allDay,
    start: allDay ? g.start.date : new Date(g.start.dateTime).toISOString(),
    end: allDay ? g.end.date : new Date(g.end.dateTime).toISOString(),
    recurrence: g.recurrence || null,
    recurringEventId: g.recurringEventId || null,
    taskId: g.extendedProperties?.private?.plannerTaskId || null,
    color: null,
    htmlLink: g.htmlLink,
    etag: g.etag,
    gUpdated: g.updated,
    synced: true,
    pending: false,
  };
}

// RRULE builder used by the event editor
export function buildRRule({ freq, interval = 1, byday = [], endType = 'never', until, count }) {
  if (!freq || freq === 'none') return null;
  let r = `RRULE:FREQ=${freq}`;
  if (interval > 1) r += `;INTERVAL=${interval}`;
  if (freq === 'WEEKLY' && byday.length) r += `;BYDAY=${byday.join(',')}`;
  if (endType === 'until' && until) r += `;UNTIL=${until.replace(/-/g, '')}`;
  if (endType === 'count' && count) r += `;COUNT=${count}`;
  return [r];
}
export function describeRule(recurrence) {
  const r = parseRule(recurrence);
  if (!r) return 'Does not repeat';
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  let s = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  if (r.byday) s += ` on ${r.byday.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][BYDAY.indexOf(d)]).join(', ')}`;
  if (r.until) s += `, until ${r.until}`;
  if (r.count) s += `, ${r.count} times`;
  return s;
}
export { parseRule, BYDAY };
