// Task-style items shared by To-Dos, Errands, To Buy and custom lists.
// Items can be typed or handwritten; both get real checkboxes.
import { h, menu, pickDate, sheet, toast, colorRow, debounce, confirmSheet } from '../ui.js';
import { InkSurface, cropStrokes, recognize } from '../ink.js';
import * as store from '../store.js';
import * as model from '../model.js';
import { todayKey, relLabel, fmtShort } from '../dates.js';
import { bus } from '../bus.js';

const PRIORITY = ['None', 'Low', 'Medium', 'High'];
const live = new Map(); // item id -> InkSurface (to refresh on sync)

export function styleVars(style = {}, base = {}) {
  const s = { ...base, ...style };
  const css = {};
  if (s.font) css.fontFamily = `'${s.font}', var(--font-body)`;
  if (s.size) css.fontSize = `${s.size}px`;
  if (s.color) css.color = s.color;
  if (s.b) css.fontWeight = '700';
  if (s.i) css.fontStyle = 'italic';
  if (s.u) css.textDecoration = 'underline';
  if (s.hl) css.background = `linear-gradient(transparent 55%, ${s.hl}88 55%)`;
  return css;
}

// ---------- a single row ----------
export function itemRow(item, ctx = {}) {
  const sectionStyle = model.sectionStyle(item.section);
  const kids = model.children(item.id);
  const carried = ctx.day ? model.carriedFrom(item, ctx.day) : 0;
  const overdue = model.isOverdue(item);

  const check = h('button', {
    class: `check ${item.done ? 'on' : ''}`, role: 'checkbox', 'aria-checked': String(item.done),
    'aria-label': item.done ? 'Mark not done' : 'Mark done',
    onclick: (e) => {
      e.stopPropagation();
      model.setDone(item, !item.done);
      if (!item.done) row.classList.add('just-done');
    },
  }, h('span', { class: 'tick' }, '✓'));

  let content;
  if (item.ink?.strokes?.length && !item.title) {
    content = h('div', { class: 'item-ink' });
    queueMicrotask(() => mountItemInk(content, item));
  } else {
    const input = h('input', {
      class: 'item-text', value: item.title || '', placeholder: 'Write or type…', 'data-fk': `item:${item.id}`,
      'aria-label': 'Item text', enterkeyhint: 'next',
      style: styleVars(item.style, { font: sectionStyle.font !== model.settings().fontBody ? sectionStyle.font : '', size: sectionStyle.size, color: sectionStyle.color }),
    });
    const save = debounce((v) => store.put('items', { id: item.id, title: v, gDirty: item.g ? true : undefined }, { quiet: true }), 400);
    input.addEventListener('input', () => save(input.value));
    input.addEventListener('blur', () => save.flush(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); save.flush(input.value);
        const n = model.newItem({ section: item.section, parentId: item.parentId, date: item.date, store: item.store, order: (item.order ?? 0) + 0.5 });
        bus.focusItem = n.id;
      } else if (e.key === 'Backspace' && !input.value) {
        e.preventDefault(); deleteItem(item, false);
      }
    });
    if (bus.focusItem === item.id) { bus.focusItem = null; setTimeout(() => input.focus(), 30); }
    content = input;
  }

  const metas = h('div', { class: 'item-meta' },
    carried ? h('span', { class: 'badge carry', title: `Carried forward from ${fmtShort(item.date)}` }, `↻ ${carried}d`) : null,
    item.priority ? h('span', { class: `badge pri p${item.priority}`, title: `${PRIORITY[item.priority]} priority` }, '!'.repeat(item.priority)) : null,
    item.due ? h('span', { class: `badge due ${overdue ? 'overdue' : ''}`, title: overdue ? 'Overdue' : 'Due' }, `${overdue ? 'Overdue ' : 'Due '}${relLabel(item.due)}`) : null,
    !ctx.day && item.date ? h('span', { class: 'badge date' }, relLabel(item.date)) : null,
    ctx.showSection ? h('span', { class: 'badge sec', style: { '--c': model.section(item.section)?.color } }, model.section(item.section)?.name) : null,
    ctx.showStore && item.store ? h('span', { class: 'badge sec' }, store.get('stores', item.store)?.name) : null,
    item.rollover === false ? h('span', { class: 'badge muted', title: 'Rollover off' }, '⇥') : null,
    item.eventLink ? h('span', { class: 'badge muted', title: 'Time blocked on calendar' }, '◷') : null,
    item.g ? h('span', { class: 'badge g', title: 'Linked to Google Tasks' }, 'G') : null,
    kids.length ? h('span', { class: 'badge muted' }, `${kids.filter((k) => k.done).length}/${kids.length}`) : null,
  );

  const more = h('button', { class: 'icon-btn sm more', 'aria-label': 'Item options', onclick: (e) => { e.stopPropagation(); itemMenu(e.currentTarget, item); } }, '⋯');
  const handle = h('span', { class: 'drag', 'aria-hidden': 'true' }, '⋮⋮');

  const row = h('div', { class: `item ${item.done ? 'done' : ''} ${item.parentId ? 'sub' : ''}`, 'data-id': item.id },
    handle, check, h('div', { class: 'item-body' }, content, metas), more);
  enableDrag(row, handle, item);

  if (!kids.length || item.parentId) return row;
  return h('div', { class: 'item-group' }, row, kids.map((k) => itemRow(k, { ...ctx, showSection: false })));
}

function mountItemInk(host, item) {
  const surf = new InkSurface(host, {
    strokes: item.ink.strokes,
    logicalH: Math.max(90, Math.min(600, (item.ink.h || 90) + 24)),
    label: 'Handwritten item',
    onChange: (strokes, info) => {
      const cur = store.get('items', item.id);
      if (!cur) return;
      store.put('items', { id: item.id, ink: { ...cur.ink, strokes } }, { quiet: !info?.loud });
    },
    onConvert: (text) => {
      store.put('items', { id: item.id, title: text, ink: null, gDirty: item.g ? true : undefined });
      toast(`Converted to “${text}”`);
    },
  });
  live.set(item.id, surf);
  // clean up when the row leaves the page
  const obs = new MutationObserver(() => { if (!host.isConnected) { surf.destroy(); live.delete(item.id); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
}

// ---------- drag to reorder (finger, Pencil or mouse on the ⋮⋮ handle) ----------
function enableDrag(row, handle, item) {
  handle.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const list = row.closest('.items');
    if (!list) return;
    handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
    const startY = e.clientY;
    const move = (ev) => { row.style.transform = `translateY(${ev.clientY - startY}px)`; };
    const up = (ev) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      row.style.transform = '';
      const siblings = [...list.querySelectorAll(':scope > .item, :scope > .item-group > .item:first-child')]
        .map((el) => store.get('items', el.dataset.id)).filter((it) => it && it.parentId === item.parentId && it.id !== item.id);
      const rows = siblings.map((it) => list.querySelector(`[data-id="${it.id}"]`));
      let idx = rows.findIndex((r) => ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (idx < 0) idx = rows.length;
      siblings.splice(idx, 0, item);
      siblings.forEach((it, i) => { if (it.order !== i + 1) store.put('items', { id: it.id, order: i + 1 }, { silent: true }); });
      store.put('items', { id: item.id, order: idx + 1 });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

// ---------- options menu ----------
export function itemMenu(anchor, item) {
  const listSections = model.sections({ includeHidden: true }).filter((s) => ['todos', 'errands', 'tobuy', 'list'].includes(s.type));
  menu(anchor, [
    { label: item.date ? `Planned: ${relLabel(item.date)}` : 'Plan for a day', icon: '◷', run: () => pickDate(anchor, item.date, (d) => store.put('items', { id: item.id, date: d, gDirty: item.g && !item.due ? true : undefined })) },
    { label: item.due ? `Due: ${relLabel(item.due)}` : 'Set due date', icon: '⚑', run: () => pickDate(anchor, item.due, (d) => store.put('items', { id: item.id, due: d, gDirty: item.g ? true : undefined })) },
    { label: `Priority: ${PRIORITY[item.priority || 0]}`, icon: '!', run: () => menu(anchor, PRIORITY.map((p, i) => ({ label: p, run: () => store.put('items', { id: item.id, priority: i }) }))) },
    { label: item.rollover === false ? 'Turn rollover on' : 'Turn rollover off', icon: '↻', run: () => store.put('items', { id: item.id, rollover: item.rollover === false }) },
    { label: 'Format text', icon: 'Aa', run: () => formatSheet(item) },
    !item.parentId && { label: 'Add subtask', icon: '↳', run: () => { const n = model.newItem({ section: item.section, parentId: item.id, date: item.date }); bus.focusItem = n.id; } },
    item.ink?.strokes?.length && !item.title ? { label: 'Convert handwriting to text', icon: 'T', run: () => convertItem(item) } : null,
    { label: 'Move to…', icon: '→', run: () => menu(anchor, listSections.filter((s) => s.id !== item.section).map((s) => ({ label: s.name, run: () => moveItem(item, s.id) }))) },
    item.section && model.section(item.section)?.type === 'tobuy' && { label: 'Change store', icon: '◍', run: () => menu(anchor, model.storesSorted().map((st) => ({ label: st.name, run: () => store.put('items', { id: item.id, store: st.id }) }))) },
    { label: item.eventLink ? 'Edit time block' : 'Time block on calendar', icon: '▦', run: () => bus.timeBlock?.(item) },
    '-',
    { label: 'Delete', icon: '✕', danger: true, run: () => deleteItem(item, true) },
  ]);
}

function moveItem(item, sectionId) {
  const sec = model.section(sectionId);
  const patch = { id: item.id, section: sectionId };
  if (sec.type === 'tobuy' && !item.store) patch.store = model.storesSorted()[0]?.id || null;
  store.put('items', patch);
  model.children(item.id).forEach((k) => store.put('items', { id: k.id, section: sectionId }));
  toast(`Moved to ${sec.name}`);
}

async function convertItem(item) {
  try {
    const text = await recognize(item.ink.strokes);
    if (!text) return toast('Could not read that one.');
    store.put('items', { id: item.id, title: text, ink: null, gDirty: item.g ? true : undefined });
    toast(`Converted to “${text}”`);
  } catch { toast('Handwriting to text needs an internet connection.'); }
}

export function deleteItem(item, withUndo) {
  const kids = model.children(item.id);
  store.remove('items', item.id);
  kids.forEach((k) => store.remove('items', k.id));
  if (withUndo) toast('Item deleted', { action: 'Undo', onAction: () => {
    store.put('items', { id: item.id, deleted: false });
    kids.forEach((k) => store.put('items', { id: k.id, deleted: false }));
  } });
}

function formatSheet(item) {
  const st = model.settings();
  let style = { ...(item.style || {}) };
  const save = () => store.put('items', { id: item.id, style });
  const toggle = (k) => h('button', { class: `chip ${style[k] ? 'on' : ''}`, onclick: (e) => { style[k] = !style[k]; e.currentTarget.classList.toggle('on'); save(); } },
    { b: 'Bold', i: 'Italic', u: 'Underline' }[k]);
  const palette = model.PALETTES[st.palette] || model.PALETTES.winner;
  sheet('Format item', h('div', { class: 'form' },
    h('div', { class: 'row gap' }, toggle('b'), toggle('i'), toggle('u')),
    h('label', {}, 'Font', h('select', { onchange: (e) => { style.font = e.target.value; save(); } },
      h('option', { value: '' }, 'Section default'),
      model.FONTS.body.map((f) => h('option', { value: f, selected: style.font === f, style: { fontFamily: f } }, f)))),
    h('label', {}, 'Size', h('select', { onchange: (e) => { style.size = Number(e.target.value) || undefined; save(); } },
      h('option', { value: '' }, 'Section default'),
      model.FONT_SIZES.map((s) => h('option', { value: s, selected: style.size === s }, `${s}px`)))),
    h('div', {}, h('div', { class: 'menu-label' }, 'Text color'), colorRow([st.favColors[0], ...palette.swatches], style.color, (c) => { style.color = c; save(); })),
    h('div', {}, h('div', { class: 'menu-label' }, 'Highlight'), colorRow(['#F4C542', '#F4B6C2', '#A9C4E2', '#B7E1A1', '#F39237'], style.hl, (c) => { style.hl = c; save(); })),
    h('button', { class: 'btn', onclick: () => { style = {}; save(); } }, 'Clear formatting'),
  ), { actions: [{ label: 'Done', kind: 'primary' }] });
}

// ---------- the "add an item" composer: type it, or just write with the Pencil ----------
export function composer({ section, date = null, storeId = null, placeholder = 'Add an item' }) {
  const wrap = h('div', { class: 'composer' });
  const input = h('input', { class: 'composer-input', placeholder: `${placeholder}…`, 'aria-label': placeholder, enterkeyhint: 'done', 'data-fk': `composer:${section}:${date}:${storeId}` });
  const add = () => {
    const v = input.value.trim();
    if (!v) return;
    model.newItem({ section, date, store: storeId, title: v, gNew: true });
    input.value = '';
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const pad = h('div', { class: 'composer-pad paper-lined' });
  const hint = h('span', { class: 'pad-hint' }, '✎ write here with your Pencil');
  pad.append(hint);
  let timer;
  const commitInk = () => {
    clearTimeout(timer);
    if (!surf.strokes.length) return;
    const { strokes, h: hh } = cropStrokes(surf.strokes, 10);
    model.newItem({ section, date, store: storeId, ink: { strokes, h: Math.max(90, hh) }, gNew: true });
    surf.strokes = []; surf.redraw();
    hint.hidden = false;
  };
  const surf = new InkSurface(pad, {
    logicalH: 170,
    label: 'Handwriting pad for a new item',
    onStrokeEnd: () => { hint.hidden = true; clearTimeout(timer); timer = setTimeout(commitInk, 1500); },
    onChange: () => {},
  });
  // keep the pad's own strokes out of the global undo stack after commit
  const obs = new MutationObserver(() => { if (!wrap.isConnected) { commitInk(); surf.destroy(); obs.disconnect(); } });
  setTimeout(() => obs.observe(document.body, { childList: true, subtree: true }), 0);
  wrap.append(h('div', { class: 'composer-row' }, h('span', { class: 'check ghost' }), input,
    h('button', { class: 'icon-btn sm', 'aria-label': 'Add', onclick: add }, '＋')), pad);
  return wrap;
}

export function refreshInk(id) {
  const surf = live.get(id);
  const item = store.get('items', id);
  if (surf && item?.ink) surf.setStrokes(item.ink.strokes);
}

export function itemList(items, ctx = {}) {
  return h('div', { class: 'items' }, items.length ? items.map((i) => itemRow(i, ctx)) : h('p', { class: 'empty' }, ctx.empty || 'Nothing here yet.'));
}
export { todayKey };
