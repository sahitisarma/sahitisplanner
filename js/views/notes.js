import { icon } from '../icons.js';
// Notes: freeform pages. Handwriting first, with an optional typed area.
import { h, menu, debounce, confirmSheet, dateButton, toast, colorRow, fill } from '../ui.js';
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

  const side = h('div', { class: 'note-strip' },
    h('div', { class: 'note-new-col' },
      h('button', { class: 'note-new', onclick: () => { const n = newNote(sec.id); localStorage.setItem(`sp-note-${sec.id}`, n.id); bus.rerender(); } }, 'New page'),
      h('button', { class: 'note-new', onclick: () => { const n = newNote(sec.id, { kind: 'board', title: '' }); localStorage.setItem(`sp-note-${sec.id}`, n.id); bus.rerender(); } }, 'New whiteboard')),
    list.map((n) => {
      const ink = store.get('ink', `note:${n.id}`);
      const card = h('button', { class: `note-card ${n.id === current.id ? 'on' : ''}`, onclick: () => { localStorage.setItem(`sp-note-${sec.id}`, n.id); bus.rerender(); } },
        h('div', { class: 'note-thumb' }),
        h('div', { class: 'note-card-title' }, n.title || (n.kind === 'board' ? 'Whiteboard' : 'Untitled')),
        h('div', { class: 'note-card-date' }, `${n.kind === 'board' ? 'Whiteboard, ' : ''}${D.fmtShort(D.key(new Date(n.createdAt || Date.now())))}`));
      if (ink?.strokes?.length) queueMicrotask(() => card.querySelector('.note-thumb').append(thumbnail(ink.strokes.slice(0, 400), 96, ink.w || 1000, (ink.w || 1000) * 1.3)));
      return card;
    }));

  host.append(h('div', { class: `notes ${compact ? 'compact' : ''}` }, compact ? null : side, notePage(current, sec, { compact })));
}

export function notePage(n, sec, { compact = false } = {}) {
  const saveTitle = debounce((v) => store.put('notes', { id: n.id, title: v }, { quiet: true }), 400);
  const title = h('input', { class: 'note-title', 'data-fk': `note-title:${n.id}`, value: n.title || '', placeholder: n.kind === 'board' ? 'Untitled whiteboard' : 'Untitled page', 'aria-label': 'Page title', oninput: (e) => saveTitle(e.target.value), onblur: (e) => saveTitle.flush(e.target.value) });

  const metaRow = h('div', { class: 'note-meta' },
    dateButton(n.date, (d) => store.put('notes', { id: n.id, date: d }, { quiet: true }), { placeholder: 'Link to a day' }),
    h('button', { class: 'chip', onclick: (e) => linkMenu(e.currentTarget, n) }, 'Link a note'),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Page options', onclick: (e) => menu(e.currentTarget, [
      { label: 'Clear handwriting', run: async () => { if (await confirmSheet('Clear handwriting?', 'You can undo this right after.', 'Clear')) { store.put('ink', { id: `note:${n.id}`, strokes: [] }); } } },
      { label: n.kind === 'board' ? 'Delete whiteboard' : 'Delete page', danger: true, run: async () => {
        if (!(await confirmSheet('Delete this page?', 'The page and its handwriting will be removed.', 'Delete'))) return;
        store.remove('notes', n.id); store.remove('ink', `note:${n.id}`);
        for (const o of store.all('notes')) if ((o.links || []).includes(n.id)) store.put('notes', { id: o.id, links: o.links.filter((x) => x !== n.id) }, { quiet: true });
      } },
    ]) }, icon('more')));

  if (n.kind === 'board') {
    return h('div', { class: 'note-page board' }, title, compact ? null : metaRow, compact ? null : linksRow(n), boardPage(n, { compact }));
  }

  // ----- typed text with outline tools -----
  const text = h('div', { class: 'note-text', contenteditable: 'true', 'aria-label': 'Typed notes', 'data-placeholder': 'Type here', html: n.text || '' });
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
  return h('div', { class: 'note-page' }, title, compact ? null : metaRow, compact ? null : linksRow(n),
    h('details', { class: 'typed', open: hasText },
      h('summary', {}, 'Typed text and outline'), toolbar, h('div', { class: 'typed-wrap' }, text, outline)),
    page);
}

// ----- links between notes -----
function linksRow(n) {
  const all = store.all('notes');
  const out = (n.links || []).map((id) => store.get('notes', id)).filter(Boolean);
  const back = all.filter((o) => o.id !== n.id && (o.links || []).includes(n.id) && !(n.links || []).includes(o.id));
  if (!out.length && !back.length) return null;
  const go = (o) => () => { localStorage.setItem(`sp-note-${o.section || 'notes'}`, o.id); bus.navigate(`notes/${o.id}`); };
  return h('div', { class: 'note-links' },
    out.length ? h('div', { class: 'note-links-row' }, h('span', { class: 'lbl' }, 'Linked'),
      out.map((o) => h('button', { class: 'note-link', onclick: go(o) }, o.title || (o.kind === 'board' ? 'Whiteboard' : 'Untitled')))) : null,
    back.length ? h('div', { class: 'note-links-row' }, h('span', { class: 'lbl' }, 'Linked from'),
      back.map((o) => h('button', { class: 'note-link', onclick: go(o) }, o.title || 'Untitled'))) : null);
}

function linkMenu(anchor, n) {
  const others = store.all('notes').filter((o) => o.id !== n.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const links = new Set(n.links || []);
  if (!others.length) { toast('Make another page first, then link them'); return; }
  menu(anchor, [
    { el: h('div', { class: 'menu-label' }, 'Link to') },
    ...others.map((o) => ({
      label: `${links.has(o.id) ? 'Unlink ' : ''}${o.title || (o.kind === 'board' ? 'Whiteboard' : 'Untitled')}`,
      run: () => {
        const cur = new Set(store.get('notes', n.id)?.links || []);
        cur.has(o.id) ? cur.delete(o.id) : cur.add(o.id);
        store.put('notes', { id: n.id, links: [...cur] });
      },
    })),
  ]);
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
