// Date helpers. Every week in this planner starts on SUNDAY (day 0).
export const WEEK_START = 0;
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');

// "YYYY-MM-DD" keys in local time
export function key(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function todayKey() { return key(new Date()); }
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return key(d);
}
export function addMonths(k, n) {
  const d = parseKey(k);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return key(d);
}
export function diffDays(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 86400000);
}
export function startOfWeek(k) {
  const d = parseKey(k);
  d.setDate(d.getDate() - ((d.getDay() - WEEK_START + 7) % 7));
  return key(d);
}
export function weekDays(k) {
  const s = startOfWeek(k);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
export function startOfMonth(k) { const d = parseKey(k); d.setDate(1); return key(d); }

// Full month grid: always starts on a Sunday, always 6 rows so the layout never jumps.
export function monthGrid(k) {
  const first = startOfMonth(k);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export function sameMonth(a, b) { return a.slice(0, 7) === b.slice(0, 7); }

export function fmtLong(k) {
  const d = parseKey(k);
  return `${DOW_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}
export function fmtFull(k) {
  const d = parseKey(k);
  return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function fmtShort(k) {
  const d = parseKey(k);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}
export function fmtMonth(k) { const d = parseKey(k); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
export function fmtTime(date) {
  let h = date.getHours(); const m = date.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${pad(m)} ${ap}` : `${h} ${ap}`;
}
export function relLabel(k) {
  const t = todayKey();
  const d = diffDays(t, k);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return fmtShort(k);
}

// Local datetime helpers for events
export function toLocalInput(date) {
  return `${key(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function fromKeyTime(k, hhmm) {
  const d = parseKey(k);
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
export function hhmm(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }
