import { icon } from '../icons.js';
// To-Dos, Errands, custom lists, and To Buy (organized by store).
import { h, menu, sheet, toast, colorRow, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import { itemList } from './items.js';
import { checklistPage } from './checklist.js';
import { bus } from '../bus.js';

const add = (el, ...kids) => el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const tabKey = (id) => `sp-tab-${id}`;
const getTab = (id, def) => { try { return localStorage.getItem(tabKey(id)) || def; } catch { return def; } };
const setTab = (id, v) => { try { localStorage.setItem(tabKey(id), v); } catch {} };

export function renderList(host, sec, { compact = false } = {}) {
  // Typed items (from quick capture or Google Tasks) show above the paper, if there are any.
  const typed = model.sectionItems(sec.id);
  add(host, h('div', { class: `listview ${compact ? 'compact' : ''}`, style: { '--c': sec.color } },
    typed.length ? h('div', { class: 'typed-items' }, itemList(typed, { day: D.todayKey() })) : null,
    checklistPage(`list:${sec.id}`, { height: compact ? 'auto' : 'auto', minRows: compact ? 8 : 16, label: `${sec.name} page` })));
}

// ---------- To Buy: one paper list per store ----------
export function renderToBuy(host, sec, { compact = false } = {}) {
  const stores = model.storesSorted();
  let tab = getTab(sec.id, 'all');
  if (tab !== 'all' && !stores.some((s) => s.id === tab)) tab = 'all';
  const typedFor = (sid) => store.all('items').filter((i) => i.section === sec.id && !i.parentId && i.store === sid && (!i.done || i.completedAt === D.todayKey()));

  const tabs = h('div', { class: 'store-tabs' },
    h('button', { class: `store-tab ${tab === 'all' ? 'on' : ''}`, onclick: () => { setTab(sec.id, 'all'); bus.rerender(); } }, 'All stores'),
    stores.map((s) => h('button', {
      class: `store-tab ${tab === s.id ? 'on' : ''}`, style: { '--c': s.color || sec.color },
      onclick: () => { setTab(sec.id, s.id); bus.rerender(); },
    }, s.name)),
    h('button', { class: 'store-tab add', onclick: () => editStore(null) }, 'New store'));

  const card = (s) => h('div', { class: 'store-card', style: { '--c': s.color || sec.color } },
    h('div', { class: 'store-card-head' },
      h('h3', {}, s.name),
      h('button', { class: 'icon-btn sm', 'aria-label': `${s.name} options`, onclick: (e) => storeMenu(e.currentTarget, s) }, icon('more'))),
    typedFor(s.id).length ? itemList(typedFor(s.id)) : null,
    checklistPage(`list:tobuy:${s.id}`, { minRows: tab === 'all' ? 7 : 16, label: `${s.name} list` }));

  const body = tab === 'all'
    ? h('div', { class: 'store-grid' }, stores.map(card))
    : card(stores.find((s) => s.id === tab));
  add(host, h('div', { class: `tobuy ${compact ? 'compact' : ''}`, style: { '--c': sec.color } }, tabs, body));
}

function storeMenu(anchor, s) {
  const stores = model.storesSorted();
  const i = stores.findIndex((x) => x.id === s.id);
  menu(anchor, [
    { label: 'Rename or recolor', icon: '✎', run: () => editStore(s) },
    i > 0 && { label: 'Move left', icon: '←', run: () => swap(stores, i, i - 1) },
    i < stores.length - 1 && { label: 'Move right', icon: '→', run: () => swap(stores, i, i + 1) },
    { label: 'Clear the page', icon: '⌫', run: async () => {
      if (!(await confirmSheet('Clear this list?', 'All writing on this store’s page will be erased.', 'Clear'))) return;
      store.put('ink', { id: `list:tobuy:${s.id}`, strokes: [], checked: {} });
      store.all('items').filter((it) => it.store === s.id && it.done).forEach((it) => store.remove('items', it.id));
    } },
    '-',
    { label: 'Delete store', icon: '✕', danger: true, run: async () => {
      if (!(await confirmSheet('Delete store?', `Items in ${s.name} will move to “No store”.`, 'Delete'))) return;
      store.all('items').filter((it) => it.store === s.id).forEach((it) => store.put('items', { id: it.id, store: null }));
      store.remove('stores', s.id);
    } },
  ]);
}
function swap(list, a, b) {
  const x = list[a], y = list[b];
  store.put('stores', { id: x.id, order: b }); store.put('stores', { id: y.id, order: a });
  list.forEach((s, i) => { if (i !== a && i !== b && s.order !== i) store.put('stores', { id: s.id, order: i }, { quiet: true }); });
}

function editStore(s) {
  let name = s?.name || '';
  let color = s?.color || '';
  const pal = model.PALETTES[model.settings().palette] || model.PALETTES.winner;
  sheet(s ? 'Edit store' : 'New store', h('div', { class: 'form' },
    h('label', {}, 'Store name', h('input', { value: name, placeholder: 'e.g. Costco', oninput: (e) => { name = e.target.value; }, autofocus: true })),
    h('div', {}, h('div', { class: 'menu-label' }, 'Color'), colorRow(pal.swatches, color, (c) => { color = c; }))), {
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
      if (!name.trim()) { toast('Give the store a name'); return false; }
      if (s) store.put('stores', { id: s.id, name: name.trim(), color });
      else store.put('stores', { id: store.uid(), name: name.trim(), color, order: model.storesSorted().length });
    } }],
  });
}
