import { icon } from './icons.js';
// Small DOM helpers + shared UI pieces (sheets, menus, toasts, Sunday-first date picker).
import { monthGrid, DOW_LETTER, fmtMonth, addMonths, todayKey, sameMonth, startOfMonth, relLabel } from './dates.js';

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
// replaceChildren that skips null/false and flattens arrays
export function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); }

// ---------- toast ----------
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const host = $('#toasts');
  const t = h('div', { class: 'toast' }, h('span', {}, msg),
    action && h('button', { class: 'toast-btn', onclick: () => { onAction?.(); t.remove(); } }, action));
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- sheet (modal) ----------
export function sheet(title, body, { actions = [], wide = false, onClose } = {}) {
  const close = () => { wrap.remove(); onClose?.(); };
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' },
        h('h2', {}, title),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
      h('div', { class: 'sheet-body' }, body),
      actions.length ? h('div', { class: 'sheet-actions' }, actions.map((a) =>
        h('button', { class: `btn ${a.kind || ''}`, onclick: async () => { const r = await a.run?.(); if (r !== false) close(); } }, a.label))) : null));
  document.body.append(wrap);
  return { close, el: wrap };
}

export function confirmSheet(title, text, okLabel = 'OK', kind = 'danger') {
  return new Promise((resolve) => {
    sheet(title, h('p', {}, text), {
      actions: [
        { label: 'Cancel', run: () => resolve(false) },
        { label: okLabel, kind, run: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

// ---------- popover menu ----------
let openMenu = null;
export function menu(anchor, items) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu' }, items.filter(Boolean).map((it) =>
    it === '-' ? h('hr') :
      it.el ? it.el :
        h('button', { class: `menu-item ${it.danger ? 'danger' : ''}`, onclick: () => { closeMenu(); it.run(); } },
          it.label)));
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  m.style.left = `${Math.max(8, left)}px`;
  m.style.top = `${top}px`;
  openMenu = m;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
export function closeMenu() {
  openMenu?.remove(); openMenu = null;
  document.removeEventListener('pointerdown', outside, true);
}

// ---------- mini calendar / date picker (always Sunday first) ----------
export function miniCalendar({ value, month, onPick, marks = () => false, compact = false }) {
  let cur = startOfMonth(month || value || todayKey());
  const root = h('div', { class: `minical ${compact ? 'compact' : ''}` });
  const draw = () => {
    fill(root, 
      h('div', { class: 'minical-head' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Previous month', onclick: () => { cur = addMonths(cur, -1); draw(); } }, icon('left', 18)),
        h('span', {}, fmtMonth(cur)),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Next month', onclick: () => { cur = addMonths(cur, 1); draw(); } }, icon('right', 18))),
      h('div', { class: 'minical-grid' },
        DOW_LETTER.map((d) => h('span', { class: 'dow' }, d)),
        monthGrid(cur).map((k) => h('button', {
          class: ['day', sameMonth(k, cur) ? '' : 'out', k === todayKey() ? 'today' : '', k === value ? 'sel' : '', marks(k) ? 'mark' : ''].join(' '),
          onclick: () => onPick(k),
        }, String(Number(k.slice(8)))))));
  };
  draw();
  return root;
}

export function pickDate(anchor, value, onPick, { allowClear = true } = {}) {
  const m = menu(anchor, []);
  m.classList.add('menu-date');
  const quick = h('div', { class: 'quick-dates' },
    [['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([l, n]) =>
      h('button', { class: 'chip', onclick: () => { closeMenu(); const d = new Date(); d.setDate(d.getDate() + n); onPick(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); } }, l)),
    allowClear && h('button', { class: 'chip', onclick: () => { closeMenu(); onPick(null); } }, 'No date'));
  m.append(quick, miniCalendar({ value, onPick: (k) => { closeMenu(); onPick(k); } }));
  // reposition after content
  const r = anchor.getBoundingClientRect();
  const mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - mw - 8))}px`;
  m.style.top = `${r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
}

// A button that shows a date and opens the Sunday-first picker
export function dateButton(value, onChange, { placeholder = 'Date', allowClear = true, cls = '' } = {}) {
  const b = h('button', { class: `date-btn ${cls}`, type: 'button' });
  const set = (v) => { value = v; b.textContent = v ? relLabel(v) : placeholder; b.classList.toggle('empty', !v); };
  set(value);
  b.onclick = () => pickDate(b, value, (v) => { set(v); onChange(v); }, { allowClear });
  b.getValue = () => value;
  return b;
}

// ---------- color picker ----------
export function colorRow(colors, value, onPick, { custom = true } = {}) {
  const row = h('div', { class: 'color-row' });
  const draw = () => {
    fill(row, 
      ...colors.map((c) => h('button', {
        class: `swatch ${c.toLowerCase() === (value || '').toLowerCase() ? 'sel' : ''}`,
        style: { background: c }, 'aria-label': `Color ${c}`,
        onclick: () => { value = c; onPick(c); draw(); },
      })),
      custom && h('button', { class: 'swatch custom', 'aria-label': 'Mix a custom color', onclick: async () => {
        const { colorMixer } = await import('./colorpicker.js');
        let picked = value || '#2F2B27';
        sheet('Mix a color', colorMixer(picked, (c) => { picked = c; }), {
          actions: [{ label: 'Cancel' }, { label: 'Use color', kind: 'primary', run: () => { value = picked; onPick(picked); draw(); } }],
        });
      } }, icon('sliders', 18)));
  };
  draw();
  return row;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
