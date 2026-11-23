// Notes: freeform pages. Handwriting first, with an optional typed area.
import { h, menu, debounce, confirmSheet, dateButton, toast, colorRow } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import { inkPad } from './inkpad.js';
import { thumbnail } from '../ink.js';
import { bus } from '../bus.js';

export function notesSorted(sectionId) {
  return store.all('notes').filter((n) => (n.section || 'notes') === sectionId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export function newNote(sectionId = 'notes', extra = {}) {
  return store.put('notes', { id: store.uid(), section: sectionId, title: '', paper: model.settings().paper, text: '', createdAt: Date.now(), ...extra });
}

export function renderNotes(host, sec, { compact = false, noteId } = {}) {
  let list = notesSorted(sec.id);
  let current = noteId ? store.get('notes', noteId) : null;
  if (!current) {
    const last = localStorage.getItem(`sp-note-${sec.id}`);
    current = (last && store.get('notes', last)) || list[0];
  }
  if (!current) { current = newNote(sec.id); list = notesSorted(sec.id); }
  try { localStorage.setItem(`sp-note-${sec.id}`, current.id); } catch {}

  const side = h('div', { class: 'note-list' },
    h('button', { class: 'btn primary sm block', onclick: () => { const n = newNote(sec.id); localStorage.setItem(`sp-note-${sec.id}`, n.id); bus.rerender(); } }, '+ New page'),
    list.map((n) => {
      const ink = store.get('ink', `note:${n.id}`);
      const card = h('button', { class: `note-card ${n.id === current.id ? 'on' : ''}`, onclick: () => { localStorage.setItem(`sp-note-${sec.id}`, n.id); bus.rerender(); } },
        h('div', { class: 'note-thumb' }),
        h('div', { class: 'note-card-title' }, n.title || 'Untitled'),
        h('div', { class: 'note-card-date' }, D.fmtShort(D.key(new Date(n.createdAt || Date.now())))));
      if (ink?.strokes?.length) queueMicrotask(() => card.querySelector('.note-thumb').append(thumbnail(ink.strokes.slice(0, 400), 120, 1000, 260)));
      return card;
    }));

  host.append(h('div', { class: `notes ${compact ? 'compact' : ''}` }, compact ? null : side, notePage(current, sec, { compact })));
}

export function notePage(n, sec, { compact = false } = {}) {
  const saveTitle = debounce((v) => store.put('notes', { id: n.id, title: v }, { quiet: true }), 400);
  const title = h('input', { class: 'note-title', 'data-fk': `note-title:${n.id}`, value: n.title || '', placeholder: 'Untitled page', 'aria-label': 'Page title', oninput: (e) => saveTitle(e.target.value), onblur: (e) => saveTitle.flush(e.target.value) });

  const text = h('div', { class: 'note-text', contenteditable: 'true', 'aria-label': 'Typed notes', 'data-placeholder': 'Type here (optional)…', html: n.text || '' });
  const saveText = debounce(() => store.put('notes', { id: n.id, text: text.innerHTML }, { quiet: true }), 500);
  text.addEventListener('input', saveText);
  text.addEventListener('blur', () => saveText.flush());
  const fmt = (cmd, val) => { text.focus(); document.execCommand(cmd, false, val); saveText(); };
  const pal = model.PALETTES[model.settings().palette] || model.PALETTES.retro;
  const toolbar = h('div', { class: 'text-toolbar' },
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('bold') }, h('b', {}, 'B')),
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('italic') }, h('i', {}, 'I')),
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('underline') }, h('u', {}, 'U')),
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: (e) => menu(e.currentTarget, [{ el: colorRow(['#F4C542', '#F4B6C2', '#A9C4E2', '#B7E1A1', 'transparent'], null, (c) => fmt('hiliteColor', c), { custom: false }) }]) }, '▮ Highlight'),
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: (e) => menu(e.currentTarget, [{ el: colorRow([pal.ink, ...pal.swatches], null, (c) => fmt('foreColor', c)) }]) }, 'A Color'),
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: (e) => menu(e.currentTarget, [['Small', 2], ['Normal', 3], ['Large', 5], ['Huge', 6]].map(([l, v]) => ({ label: l, run: () => fmt('fontSize', v) }))) }, 'Size'),
    h('button', { class: 'tb', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('insertUnorderedList') }, '• List'));

  const page = h('div', { class: `note-ink paper-${n.paper || 'lined'}` });
  queueMicrotask(() => inkPad(page, `note:${n.id}`, {
    logicalH: 1300, grow: true, minH: 1300, label: 'Handwriting page',
    onConvert: (t, surf) => {
      text.innerHTML += `${text.innerHTML ? '<br>' : ''}${t.replace(/</g, '&lt;')}`;
      saveText.flush();
      surf.deleteSelection();
      toast('Added to typed notes');
    },
  }));

  const metaRow = h('div', { class: 'note-meta' },
    h('select', { 'aria-label': 'Paper', onchange: (e) => { store.put('notes', { id: n.id, paper: e.target.value }, { quiet: true }); page.className = `note-ink ink-host paper-${e.target.value}`; } },
      model.PAPERS.map((p) => h('option', { value: p, selected: (n.paper || 'lined') === p }, p[0].toUpperCase() + p.slice(1)))),
    h('span', { class: 'lbl' }, 'Day:'),
    dateButton(n.date, (d) => store.put('notes', { id: n.id, date: d }, { quiet: true }), { placeholder: 'Link to a day' }),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Page options', onclick: (e) => menu(e.currentTarget, [
      { label: 'Clear handwriting', icon: '⌫', run: async () => { if (await confirmSheet('Clear handwriting?', 'You can undo this right after.', 'Clear')) { store.put('ink', { id: `note:${n.id}`, strokes: [] }); } } },
      { label: 'Delete page', icon: '✕', danger: true, run: async () => {
        if (!(await confirmSheet('Delete this page?', 'The page and its handwriting will be removed.', 'Delete'))) return;
        store.remove('notes', n.id); store.remove('ink', `note:${n.id}`);
      } },
    ]) }, '⋯'));

  return h('div', { class: 'note-page' }, title, compact ? null : metaRow,
    h('details', { class: 'typed', open: !!(n.text && n.text.replace(/<[^>]+>/g, '').trim()) },
      h('summary', {}, 'Typed text'), toolbar, text),
    page);
}
