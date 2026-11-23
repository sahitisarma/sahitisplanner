// The Everything view: an open planner spread. Calendar on one page, lists and
// notes on the other. Panels resize, move, collapse, and open in a bigger view.
import { h, menu } from '../ui.js';
import * as model from '../model.js';
import { renderSection } from './section.js';
import { bus } from '../bus.js';

export function renderEverything(host) {
  const L = model.layout();
  const valid = (id) => { const s = model.section(id); return s && !s.hidden; };
  const left = L.left.filter(valid), right = L.right.filter(valid);
  const used = new Set([...left, ...right]);
  const unused = model.sections().filter((s) => !used.has(s.id));

  const spread = h('div', { class: 'everything spread', style: { '--split': L.split } });
  const page = (side, ids) => {
    const p = h('div', { class: `page ${side}`, 'data-side': side },
      ids.map((id, i) => panel(id, side, i, ids.length, L)));
    if (!ids.length) p.append(h('p', { class: 'empty' }, 'Empty page. Use Add section.'));
    return p;
  };
  const gutter = h('div', { class: 'spine', role: 'separator', 'aria-label': 'Drag to resize pages' }, h('span', { class: 'rings' }));
  spread.append(page('left', left), gutter, page('right', right));
  enableSpineDrag(gutter, spread);

  host.append(h('div', { class: 'everything-wrap' },
    h('div', { class: 'everything-bar' },
      h('h2', { class: 'every-title' }, 'Everything ✦'),
      unused.length ? h('button', { class: 'chip', onclick: (e) => menu(e.currentTarget, unused.map((s) => ({
        label: `Add ${s.name}`, run: () => model.saveLayout({ right: [...model.layout().right, s.id] }),
      }))) }, 'Add section') : null,
      h('button', { class: 'chip', onclick: () => model.saveLayout({ ...model.DEFAULT_LAYOUT }) }, 'Reset layout')),
    spread));
}

function panel(id, side, idx, count, L) {
  const sec = model.section(id);
  const collapsed = !!L.collapsed[id];
  const grow = L.sizes[id] || 1;
  const body = h('div', { class: 'panel-body', 'data-scroll-key': `panel:${id}` });
  if (!collapsed) renderSection(body, sec, { compact: true });
  const el = h('section', { class: `panel ${collapsed ? 'collapsed' : ''}`, style: { '--c': sec.color, flexGrow: collapsed ? 0 : grow }, 'data-id': id },
    h('header', { class: 'panel-head' },
      h('button', { class: 'panel-name', onclick: () => toggle(id) , 'aria-expanded': String(!collapsed) }, h('span', { class: 'caret' }, collapsed ? '▸' : '▾'), sec.name),
      h('div', { class: 'panel-tools' },
        h('button', { class: 'icon-btn sm', title: 'Open larger', 'aria-label': `Open ${sec.name}`, onclick: () => bus.navigate(id) }, '⤢'),
        h('button', { class: 'icon-btn sm', title: 'Arrange', 'aria-label': `Arrange ${sec.name}`, onclick: (e) => arrangeMenu(e.currentTarget, id, side, idx, count) }, '⋯'))),
    body);
  if (!collapsed && idx < count - 1) {
    const handle = h('div', { class: 'panel-resize', role: 'separator', 'aria-label': 'Drag to resize' });
    el.append(handle);
    enablePanelResize(handle, el, id);
  }
  return el;
}

function toggle(id) {
  const L = model.layout();
  model.saveLayout({ collapsed: { ...L.collapsed, [id]: !L.collapsed[id] } });
}

function arrangeMenu(anchor, id, side, idx, count) {
  const L = model.layout();
  const other = side === 'left' ? 'right' : 'left';
  const move = (fn) => { const next = { left: [...L.left], right: [...L.right] }; fn(next); model.saveLayout(next); };
  menu(anchor, [
    idx > 0 && { label: 'Move up', icon: '↑', run: () => move((n) => { const a = n[side]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; }) },
    idx < count - 1 && { label: 'Move down', icon: '↓', run: () => move((n) => { const a = n[side]; [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]; }) },
    { label: `Move to ${other} page`, icon: side === 'left' ? '→' : '←', run: () => move((n) => { n[side] = n[side].filter((x) => x !== id); n[other].push(id); }) },
    { label: 'Make bigger', icon: '↕', run: () => model.saveLayout({ sizes: { ...L.sizes, [id]: Math.min(5, (L.sizes[id] || 1) + 0.5) } }) },
    { label: 'Make smaller', icon: '↕', run: () => model.saveLayout({ sizes: { ...L.sizes, [id]: Math.max(0.4, (L.sizes[id] || 1) - 0.4) } }) },
    { label: L.collapsed[id] ? 'Expand' : 'Collapse', icon: '▾', run: () => toggle(id) },
    '-',
    { label: 'Remove from Everything', icon: '✕', run: () => move((n) => { n[side] = n[side].filter((x) => x !== id); }) },
  ]);
}

function enableSpineDrag(gutter, spread) {
  gutter.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  gutter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    gutter.setPointerCapture(e.pointerId);
    const r = spread.getBoundingClientRect();
    let val = model.layout().split;
    const move = (ev) => { val = Math.min(0.75, Math.max(0.25, (ev.clientX - r.left) / r.width)); spread.style.setProperty('--split', val); };
    const up = () => { gutter.removeEventListener('pointermove', move); gutter.removeEventListener('pointerup', up); model.saveLayout({ split: Math.round(val * 100) / 100 }); };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
  });
}

function enablePanelResize(handle, el, id) {
  handle.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const next = el.nextElementSibling;
    if (!next) return;
    const nextId = next.dataset.id;
    const h0 = el.offsetHeight, n0 = next.offsetHeight, y0 = e.clientY;
    const g0 = parseFloat(el.style.flexGrow) || 1, ng0 = parseFloat(next.style.flexGrow) || 1;
    const total = g0 + ng0;
    let g = g0, ng = ng0;
    const move = (ev) => {
      const dy = ev.clientY - y0;
      const a = Math.max(80, h0 + dy), b = Math.max(80, n0 - dy);
      g = (a / (a + b)) * total; ng = total - g;
      el.style.flexGrow = g; next.style.flexGrow = ng;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
      const L = model.layout();
      model.saveLayout({ sizes: { ...L.sizes, [id]: Math.round(g * 100) / 100, [nextId]: Math.round(ng * 100) / 100 } });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
