// Checklist pages: lined paper with printed checkboxes in the margin.
// Write anywhere; your writing stays exactly where you put it.
// Tap a box to check off that line. Unchecked lines from earlier days show up
// on today's page (same writing, never a copy) until you check them.
import { h } from '../ui.js';
import { InkSurface, makeZoomable, thumbnail } from '../ink.js';
import * as store from '../store.js';
import * as D from '../dates.js';
import { registerLive } from './inkpad.js';

export const ROW = 70; // logical units per line (page is 1000 wide)
const TOP = 12;

export function rowOfStroke(s) {
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 1; i < s.pts.length; i += 3) { if (s.pts[i] < y0) y0 = s.pts[i]; if (s.pts[i] > y1) y1 = s.pts[i]; }
  return Math.max(0, Math.floor(((y0 + y1) / 2 - TOP) / ROW));
}
export function usedRows(rec) {
  const rows = new Set();
  for (const s of rec?.strokes || []) if (s.tool !== 'hl') rows.add(rowOfStroke(s));
  return [...rows].sort((a, b) => a - b);
}

function toggle(inkId, r, el) {
  const rec = store.get('ink', inkId) || { id: inkId, strokes: [] };
  const checked = { ...(rec.checked || {}) };
  if (checked[r]) delete checked[r]; else checked[r] = D.todayKey();
  store.put('ink', { id: inkId, checked }, { quiet: true });
  el?.classList.toggle('on', !!checked[r]);
  el?.closest('.cl-host')?.querySelector(`.cl-done[data-r="${r}"]`)?.classList.toggle('on', !!checked[r]);
  return !!checked[r];
}

// A full checklist page (zoomable). opts: height (css), minRows, compact
export function checklistPage(inkId, { height = 'auto', minRows = 12, label = 'Checklist page' } = {}) {
  const rec = store.get('ink', inkId);
  const host = h('div', { class: 'cl-host paper-checklist' });
  const viewport = h('div', { style: { '--vh': height } }, host);
  const chip = h('button', { class: 'zoom-chip', hidden: true });
  const wrap = h('div', { class: `zoom-wrap checklist ${height === 'auto' ? 'auto' : ''}` }, viewport, chip);
  const marks = h('div', { class: 'cl-marks' });
  host.append(marks);

  const drawMarks = (surf) => {
    const cur = store.get('ink', inkId);
    const checked = cur?.checked || {};
    const rows = Math.ceil((surf.logicalH - TOP) / ROW);
    marks.replaceChildren();
    for (let r = 0; r < rows; r++) {
      const box = h('button', {
        class: `cl-box ${checked[r] ? 'on' : ''}`, 'aria-label': `Check line ${r + 1}`,
        style: { top: `calc(var(--u) * ${TOP + r * ROW + ROW / 2 - 15})` },
        onclick: (e) => { e.stopPropagation(); toggle(inkId, r, e.currentTarget); },
      });
      const done = h('div', { class: `cl-done ${checked[r] ? 'on' : ''}`, 'data-r': r, style: { top: `calc(var(--u) * ${TOP + r * ROW})`, height: `calc(var(--u) * ${ROW})` } });
      marks.append(box, done);
    }
  };

  queueMicrotask(() => {
    const surf = new InkSurface(host, {
      strokes: rec?.strokes || [],
      logicalH: Math.max(rec?.h || 0, TOP + ROW * minRows + 10),
      grow: true, minH: TOP + ROW * minRows + 10,
      label,
      onResize: (sf) => drawMarks(sf),
      onChange: (strokes, info) => store.put('ink', { id: inkId, strokes, h: Math.round(surf.logicalH) }, { quiet: !info?.loud }),
    });
    registerLive(inkId, surf, host);
    drawMarks(surf);
    const z = makeZoomable(viewport, host, { onZoom: (sc) => { chip.hidden = sc <= 1.01; chip.textContent = `${Math.round(sc * 100)}%  ·  Reset`; } });
    chip.onclick = () => z.set(1);
  });
  return wrap;
}

// "Still open from earlier": unchecked lines from previous day pages, shown as
// they were written. Checking one here checks the original line.
export function carriedLines(prefix, day, { lookback = 30 } = {}) {
  const today = D.todayKey();
  if (day > today) return null;
  const out = [];
  for (let i = lookback; i >= 1; i--) {
    const d = D.addDays(day, -i);
    const id = `day:${d}:${prefix}`;
    const rec = store.get('ink', id);
    if (!rec?.strokes?.length) continue;
    for (const r of usedRows(rec)) {
      const doneOn = rec.checked?.[r];
      if (doneOn && doneOn <= day) continue; // finished by then
      out.push({ id, r, d, rec });
    }
  }
  if (!out.length) return null;
  const list = h('div', { class: 'carried' },
    h('div', { class: 'carried-h' }, `Still open from earlier · ${out.length}`),
    out.map(({ id, r, d, rec }) => {
      const strokes = rec.strokes.filter((s) => rowOfStroke(s) === r).map((s) => ({ ...s, pts: s.pts.map((v, k) => (k % 3 === 1 ? v - (TOP + r * ROW) : v)) }));
      const line = h('div', { class: 'carried-line' },
        h('button', { class: 'cl-box static', 'aria-label': 'Check off', onclick: (e) => { const on = toggle(id, r, e.currentTarget); line.classList.toggle('done', on); } }),
        h('div', { class: 'carried-ink' }),
        h('span', { class: 'carried-from' }, D.relLabel(d)));
      queueMicrotask(() => {
        const w = line.querySelector('.carried-ink');
        w.append(thumbnail(strokes, Math.max(200, w.clientWidth || 500), 1000, ROW));
      });
      return line;
    }));
  return list;
}
