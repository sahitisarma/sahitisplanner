// Checklist pages: lined paper with printed checkboxes in the margin.
// Write anywhere; your writing stays exactly where you put it.
// Tap a box to check off that line. Unchecked lines from earlier days show up
// on today's page (same writing, never a copy) until you check them.
import { h, menu } from '../ui.js';
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
  const sub = rec.sub || {};
  const on = !checked[r];
  // Checking a main task also checks the subtasks right under it.
  const rows = [r];
  if (!sub[r]) for (let k = r + 1; sub[k]; k++) rows.push(k);
  for (const k of rows) { if (on) checked[k] = checked[k] || D.todayKey(); else delete checked[k]; }
  store.put('ink', { id: inkId, checked }, { quiet: true });
  const host = el?.closest('.cl-host');
  for (const k of rows) {
    (k === r ? el : host?.querySelector(`.cl-box[data-r="${k}"]`))?.classList.toggle('on', on);
    host?.querySelector(`.cl-done[data-r="${k}"]`)?.classList.toggle('on', on);
  }
  return on;
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
    const sub = cur?.sub || {};
    const rows = Math.ceil((surf.logicalH - TOP) / ROW);
    marks.replaceChildren();
    for (let r = 0; r < rows; r++) {
      const isSub = !!sub[r];
      const box = h('button', {
        class: `cl-box ${isSub ? 'sub' : ''} ${checked[r] ? 'on' : ''}`, 'data-r': r,
        'aria-label': `${isSub ? 'Subtask' : 'Task'} on line ${r + 1}. Hold for subtask options`,
        style: { top: `calc(var(--u) * ${TOP + r * ROW + ROW / 2 - (isSub ? 12 : 15)})` },
        // The Pencil never sends a "click" on iPad (the page blocks it so writing
        // doesn't scroll), so pen taps are handled on pointerup instead.
        onclick: (e) => { e.stopPropagation(); if (held || penTapped) { held = false; penTapped = false; return; } toggle(inkId, r, e.currentTarget); },
        oncontextmenu: (e) => { e.preventDefault(); subMenu(e.currentTarget, r); },
      });
      // Press and hold a box to turn that line into a subtask (or back).
      let timer = null, held = false, penTapped = false;
      box.addEventListener('pointerdown', (e) => { e.stopPropagation(); held = false; timer = setTimeout(() => { held = true; subMenu(box, r); }, 450); });
      box.addEventListener('pointerup', (e) => {
        clearTimeout(timer);
        if (e.pointerType === 'pen' && !held) { e.stopPropagation(); penTapped = true; toggle(inkId, r, box); setTimeout(() => { penTapped = false; }, 400); }
      });
      ['pointerleave', 'pointercancel'].forEach((ev) => box.addEventListener(ev, () => clearTimeout(timer)));
      const done = h('div', { class: `cl-done ${isSub ? 'sub' : ''} ${checked[r] ? 'on' : ''}`, 'data-r': r, style: { top: `calc(var(--u) * ${TOP + r * ROW})`, height: `calc(var(--u) * ${ROW})` } });
      marks.append(box, done);
    }
  };

  let surfRef = null;
  const subMenu = (anchor, r) => {
    const cur = store.get('ink', inkId) || { id: inkId, strokes: [] };
    const sub = { ...(cur.sub || {}) };
    const isSub = !!sub[r];
    menu(anchor, [
      isSub ? { label: 'Make it a main task', run: () => { delete sub[r]; store.put('ink', { id: inkId, sub }, { quiet: true }); drawMarks(surfRef); } }
            : { label: 'Make it a subtask', run: () => { sub[r] = true; store.put('ink', { id: inkId, sub }, { quiet: true }); drawMarks(surfRef); } },
    ].filter(Boolean));
  };

  queueMicrotask(() => {
    const surf = surfRef = new InkSurface(host, {
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
    h('div', { class: 'carried-h' }, 'From earlier days'),
    out.map(({ id, r, d, rec }) => {
      const strokes = rec.strokes.filter((s) => rowOfStroke(s) === r).map((s) => ({ ...s, pts: s.pts.map((v, k) => (k % 3 === 1 ? v - (TOP + r * ROW) : v)) }));
      const line = h('div', { class: `carried-line ${rec.sub?.[r] ? 'sub' : ''}` },
        h('button', { class: 'cl-box static', 'aria-label': 'Check off',
          onpointerup: (e) => { if (e.pointerType === 'pen') { e.currentTarget.dataset.pen = '1'; const on = toggle(id, r, e.currentTarget); line.classList.toggle('done', on); } },
          onclick: (e) => { if (e.currentTarget.dataset.pen) { delete e.currentTarget.dataset.pen; return; } const on = toggle(id, r, e.currentTarget); line.classList.toggle('done', on); } }),
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

// Small pictures of each written line on a page (for the day overview)
export function lineThumbs(inkId, widthPx = 360) {
  const rec = store.get('ink', inkId);
  if (!rec?.strokes?.length) return [];
  return usedRows(rec).map((r) => {
    const strokes = rec.strokes.filter((s) => rowOfStroke(s) === r).map((s) => ({ ...s, pts: s.pts.map((v, k) => (k % 3 === 1 ? v - (TOP + r * ROW) : v)) }));
    const done = !!rec.checked?.[r];
    return h('div', { class: `ag-line ${done ? 'done' : ''} ${rec.sub?.[r] ? 'sub' : ''}` },
      h('span', { class: `cl-box static ${done ? 'on' : ''}` }),
      h('div', { class: 'carried-ink' }, thumbnail(strokes, widthPx, 1000, ROW)));
  });
}
