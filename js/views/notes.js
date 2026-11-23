import { icon } from '../icons.js';
// Notes: freeform pages. Handwriting first, with an optional typed area.
import { h, menu, debounce, confirmSheet, dateButton, toast, colorRow, fill, sheet } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import { inkPad, zoomPage, registerLive } from './inkpad.js';
import { thumbnail, InkSurface, makeZoomable } from '../ink.js';
import { bus } from '../bus.js';

export function notesSorted(sectionId) {
  return store.all('notes').filter((n) => (n.section || 'notes') === sectionId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export function newNote(sectionId = 'notes', extra = {}) {
  return store.put('notes', { id: store.uid(), section: sectionId, title: '', paper: 'dotted', kind: 'page', links: [], text: '', createdAt: Date.now(), ...extra });
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

  const open = (id) => { localStorage.setItem(`sp-note-${sec.id}`, id); bus.rerender(); };
  const side = h('aside', { class: 'note-side', 'aria-label': 'Pages' },
    h('div', { class: 'note-side-new' },
      h('button', { class: 'btn sm', onclick: () => open(newNote(sec.id).id) }, 'New page'),
      h('button', { class: 'btn sm', onclick: () => open(newNote(sec.id, { kind: 'board' }).id) }, 'New whiteboard')),
    h('div', { class: 'note-side-list' }, list.map((n) => h('button', {
      class: `note-row ${n.id === current.id ? 'on' : ''}`, onclick: () => open(n.id),
    },
      h('span', { class: 'note-row-title' }, noteName(n)),
      h('span', { class: 'note-row-meta' }, `${n.kind === 'board' ? 'Whiteboard' : 'Page'}  ${D.fmtShort(D.key(new Date(n.createdAt || Date.now())))}`)))));

  host.append(h('div', { class: `notes2 ${compact ? 'compact' : ''}` }, compact ? null : side, notePage(current, sec, { compact })));
}

export function notePage(n, sec, { compact = false } = {}) {
  const saveTitle = debounce((v) => store.put('notes', { id: n.id, title: v }, { quiet: true }), 400);
  const title = h('input', { class: 'note-title', 'data-fk': `note-title:${n.id}`, value: n.title || '', placeholder: n.kind === 'board' ? 'Untitled whiteboard' : 'Untitled page', 'aria-label': 'Page title', oninput: (e) => { saveTitle(e.target.value); const row = document.querySelector('.note-row.on .note-row-title'); if (row) row.textContent = e.target.value || (n.kind === 'board' ? 'Untitled whiteboard' : 'Untitled page'); }, onblur: (e) => saveTitle.flush(e.target.value) });

  const more = h('button', { class: 'icon-btn sm', 'aria-label': 'Page options', onclick: (e) => menu(e.currentTarget, [
    { label: 'Clear handwriting', run: async () => { if (await confirmSheet('Clear handwriting?', 'You can undo this right after.', 'Clear')) { store.put('ink', { id: `note:${n.id}`, strokes: [] }); } } },
    { label: n.kind === 'board' ? 'Delete whiteboard' : 'Delete page', danger: true, run: async () => {
      if (!(await confirmSheet('Delete this page?', 'The page and its handwriting will be removed.', 'Delete'))) return;
      store.remove('notes', n.id); store.remove('ink', `note:${n.id}`);
      for (const o of store.all('notes')) if ((o.links || []).includes(n.id)) store.put('notes', { id: o.id, links: o.links.filter((x) => x !== n.id) }, { quiet: true });
    } },
  ]) }, icon('more'));
  const head = h('div', { class: 'note-head' }, title, compact ? null : more);
  const metaRow = compact ? null : h('div', { class: 'note-facts' },
    h('div', { class: 'note-fact' }, h('span', { class: 'fact-l' }, 'Day'),
      dateButton(n.date, (d) => store.put('notes', { id: n.id, date: d }, { quiet: true }), { placeholder: 'Add to a day' })),
    linksRow(n));

  if (n.kind === 'board') {
    return h('div', { class: 'note-page board' }, head, metaRow, boardPage(n, { compact }));
  }

  // ----- typed text with outline tools -----
  const text = h('div', { class: 'note-text', contenteditable: 'true', 'aria-label': 'Typed notes', html: n.text || '' });
  const outline = h('nav', { class: 'note-outline', 'aria-label': 'Outline' });
  const drawOutline = () => {
    const heads = [...text.querySelectorAll('h2, h3')].filter((x) => x.textContent.trim());
    fill(outline, heads.length ? [h('div', { class: 'outline-h' }, 'Outline'), heads.map((hd) => h('button', {
      class: `outline-item ${hd.tagName === 'H3' ? 'sub' : ''}`, onclick: () => hd.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    }, hd.textContent.trim()))] : null);
  };
  const saveText = debounce(() => { store.put('notes', { id: n.id, text: text.innerHTML }, { quiet: true }); drawOutline(); }, 500);
  text.addEventListener('input', saveText);
  text.addEventListener('blur', () => saveText.flush());
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); saveText(); }
  });
  const fmt = (cmd, val) => { text.focus(); document.execCommand(cmd, false, val); saveText(); };
  const pal = model.PALETTES[model.settings().palette] || model.PALETTES.winner;
  const tb = (label, run, cls = '') => h('button', { class: `tb ${cls}`, onmousedown: (e) => e.preventDefault(), onclick: run }, label);
  const toolbar = h('div', { class: 'text-toolbar' },
    tb('Heading', () => fmt('formatBlock', 'h2')),
    tb('Subheading', () => fmt('formatBlock', 'h3')),
    tb('Text', () => fmt('formatBlock', 'p')),
    tb('Bullets', () => fmt('insertUnorderedList')),
    tb('Numbers', () => fmt('insertOrderedList')),
    tb('Indent', () => fmt('indent')),
    tb('Outdent', () => fmt('outdent')),
    tb(h('b', {}, 'B'), () => fmt('bold')),
    tb(h('u', {}, 'U'), () => fmt('underline')),
    tb('Highlight', (e) => menu(e.currentTarget, [{ el: colorRow(['#F3B7C6', '#F2CF6B', '#BFD3E6', '#CFE3C3'], null, (c) => fmt('hiliteColor', c), { custom: false }) }])),
    tb('Color', (e) => menu(e.currentTarget, [{ el: colorRow([pal.ink, ...pal.swatches], null, (c) => fmt('foreColor', c)) }])));
  queueMicrotask(drawOutline);

  const page = zoomPage(`note:${n.id}`, {
    paper: 'dotted', height: compact ? '52vh' : 'calc(100vh - 230px)',
    logicalH: 1600, grow: true, minH: 1600, label: 'Handwriting page',
    onConvert: (t, surf) => {
      text.innerHTML += `${text.innerHTML ? '<br>' : ''}${t.replace(/</g, '&lt;')}`;
      saveText.flush();
      surf.deleteSelection();
      toast('Added to typed notes');
    },
  });

  const hasText = !!(n.text && n.text.replace(/<[^>]+>/g, '').trim());
  const typedView = h('div', { class: 'typed-view' }, toolbar, h('div', { class: 'typed-wrap' }, text, outline));
  let mode = localStorage.getItem(`sp-note-mode-${n.id}`) || 'write';
  const seg = h('div', { class: 'seg note-mode', role: 'tablist' });
  const body = h('div', {});
  const show = () => {
    fill(seg,
      h('button', { class: mode === 'write' ? 'on' : '', onclick: () => { mode = 'write'; save(); show(); } }, 'Handwriting'),
      h('button', { class: mode === 'type' ? 'on' : '', onclick: () => { mode = 'type'; save(); show(); } }, hasText && mode !== 'type' ? 'Typed text (has notes)' : 'Typed text'));
    page.hidden = mode !== 'write'; typedView.hidden = mode !== 'type';
  };
  const save = () => { try { localStorage.setItem(`sp-note-mode-${n.id}`, mode); } catch {} };
  fill(body, page, typedView);
  show();
  return h('div', { class: 'note-page' }, head, metaRow, compact ? null : seg, body);
}

const noteName = (o) => o.title || (o.kind === 'board' ? 'Untitled whiteboard' : 'Untitled page');

// ----- links between notes -----
// "Linked pages" lets you jump between related pages, like a shortcut.
function linksRow(n) {
  const all = store.all('notes');
  const out = (n.links || []).map((id) => store.get('notes', id)).filter(Boolean);
  const back = all.filter((o) => o.id !== n.id && (o.links || []).includes(n.id) && !(n.links || []).includes(o.id));
  const go = (o) => () => { localStorage.setItem(`sp-note-${o.section || 'notes'}`, o.id); bus.navigate(`notes/${o.id}`); };
  return h('div', { class: 'note-fact' }, h('span', { class: 'fact-l' }, 'Linked pages'),
    h('div', { class: 'fact-v' },
      [...out, ...back].map((o) => h('button', { class: 'note-link', onclick: go(o) }, noteName(o))),
      h('button', { class: 'link-add', onclick: () => linkPicker(n) }, out.length || back.length ? 'Edit links' : 'Link another page')));
}

function linkPicker(n) {
  const others = store.all('notes').filter((o) => o.id !== n.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const chosen = new Set(n.links || []);
  const body = h('div', { class: 'link-picker' },
    h('p', { class: 'link-help' }, 'Pick pages that go with this one. They show up under Linked pages so you can jump between them.'),
    others.length ? others.map((o) => {
      const row = h('label', { class: 'link-opt' },
        h('input', { type: 'checkbox', checked: chosen.has(o.id), onchange: (e) => { e.target.checked ? chosen.add(o.id) : chosen.delete(o.id); } }),
        h('span', {}, noteName(o)));
      return row;
    }) : h('p', { class: 'link-help' }, 'Make another page first, then you can link them.'));
  sheet('Link pages', body, { actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => store.put('notes', { id: n.id, links: [...chosen] }) }] });
}

// ----- whiteboard: a page that keeps growing right and down as you write -----
function boardPage(n, { compact = false } = {}) {
  const inkId = `note:${n.id}`;
  const rec = store.get('ink', inkId);
  const host = h('div', { class: 'zoom-page board-page paper-dotted' });
  const viewport = h('div', { class: 'zoom-viewport', style: { '--vh': compact ? '52vh' : 'calc(100vh - 210px)' } }, host);
  const chip = h('button', { class: 'zoom-chip', hidden: true });
  const wrap = h('div', { class: 'zoom-wrap board-wrap' }, viewport, chip);
  let logicalW = Math.max(2000, rec?.w || 0);
  host.style.width = `${(logicalW / 1000) * 100}%`;
  queueMicrotask(() => {
    let z;
    const surf = new InkSurface(host, {
      strokes: rec?.strokes || [],
      logicalW, growX: true,
      logicalH: Math.max(2000, rec?.h || 0), grow: true, minH: 2000,
      label: 'Whiteboard',
      onGrowX: (w) => { logicalW = w; z?.refresh(); store.put('ink', { id: inkId, w }, { quiet: true }); },
      onChange: (strokes, info) => store.put('ink', { id: inkId, strokes, h: Math.round(surf.logicalH), w: Math.round(surf.logicalW) }, { quiet: !info?.loud }),
    });
    logicalW = surf.logicalW;
    registerLive(inkId, surf, host);
    z = makeZoomable(viewport, host, {
      min: 0.35, max: 3, factor: () => logicalW / 1000,
      onZoom: (sc) => { chip.hidden = Math.abs(sc - 1) < 0.01; chip.textContent = `${Math.round(sc * 100)}%  ·  Reset`; },
    });
    z.refresh();
    chip.onclick = () => z.set(1);
  });
  return wrap;
}
