// To-Dos, Errands, custom lists, and To Buy (organized by store).
import { h, menu, sheet, toast, colorRow, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import { itemList, composer } from './items.js';
import { bus } from '../bus.js';

const add = (el, ...kids) => el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const tabKey = (id) => `sp-tab-${id}`;
const getTab = (id, def) => { try { return localStorage.getItem(tabKey(id)) || def; } catch { return def; } };
const setTab = (id, v) => { try { localStorage.setItem(tabKey(id), v); } catch {} };

export function renderList(host, sec, { compact = false } = {}) {
  const today = D.todayKey();
  const tab = getTab(sec.id, 'today');
  const tabs = [['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All'], ['done', 'Done']];
  const head = h('div', { class: 'list-tabs seg' }, tabs.map(([v, l]) =>
    h('button', { class: tab === v ? 'on' : '', onclick: () => { setTab(sec.id, v); bus.rerender(); } }, l)));
  const body = h('div', { class: 'list-body' });

  if (tab === 'today') {
    const items = model.itemsForDay(sec.id, today);
    const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);
    const overdueElsewhere = store.all('items').filter((i) => i.section === sec.id && !i.parentId && model.isOverdue(i) && !model.showsOnDay(i, today));
    add(body, 
      itemList(open, { day: today, empty: 'All clear for today. Add something, or plan it for later.' }),
      composer({ section: sec.id, date: today, placeholder: `Add to today’s ${sec.name}` }),
      overdueElsewhere.length ? h('div', {}, h('h4', { class: 'sub-h warn' }, 'Overdue'), itemList(overdueElsewhere)) : null,
      done.length ? h('div', {}, h('h4', { class: 'sub-h' }, `Done today (${done.length})`), itemList(done, { day: today })) : null);
  } else if (tab === 'upcoming') {
    const upcoming = store.all('items').filter((i) => i.section === sec.id && !i.parentId && !i.done && i.date && i.date > today)
      .sort((a, b) => a.date.localeCompare(b.date) || model.byOrder(a, b));
    const groups = new Map();
    for (const i of upcoming) { if (!groups.has(i.date)) groups.set(i.date, []); groups.get(i.date).push(i); }
    add(body, groups.size ? [...groups].map(([d, list]) => h('div', {}, h('h4', { class: 'sub-h' }, D.fmtLong(d)), itemList(list, { day: d })))
      : h('p', { class: 'empty' }, 'Nothing scheduled ahead. Use ⋯ on an item to plan it for a day.'),
    composer({ section: sec.id, date: D.addDays(today, 1), placeholder: 'Add for tomorrow' }));
  } else if (tab === 'all') {
    const items = model.sectionItems(sec.id);
    const lists = store.meta('gtasklists', []) || [];
    const linked = items.some((i) => i.g);
    if (linked && sec.type === 'todos') {
      const groups = [['', 'Planner only'], ...lists.map((l) => [l.id, `Google · ${l.title}`])];
      for (const [id, label] of groups) {
        const g = items.filter((i) => (i.g?.listId || '') === id);
        if (g.length) add(body, h('h4', { class: 'sub-h' }, label), itemList(g));
      }
    } else {
      add(body, itemList(items, { empty: 'No items yet.' }));
    }
    add(body, composer({ section: sec.id, placeholder: `Add to ${sec.name} (no date)` }));
  } else {
    const done = store.all('items').filter((i) => i.section === sec.id && i.done && !i.parentId)
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    const groups = new Map();
    for (const i of done.slice(0, 300)) { const k = i.completedAt || 'Earlier'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    add(body, groups.size ? [...groups].map(([d, list]) => h('div', {}, h('h4', { class: 'sub-h' }, d === 'Earlier' ? d : D.fmtLong(d)), itemList(list, { day: d === 'Earlier' ? null : d })))
      : h('p', { class: 'empty' }, 'Completed items will collect here, on the day you finished them.'));
  }
  host.append(h('div', { class: `listview ${compact ? 'compact' : ''}`, style: { '--c': sec.color } }, head, body));
}

// ---------- To Buy ----------
export function renderToBuy(host, sec, { compact = false } = {}) {
  const stores = model.storesSorted();
  let tab = getTab(sec.id, 'all');
  if (tab !== 'all' && !stores.some((s) => s.id === tab)) tab = 'all';
  const open = (sid) => store.all('items').filter((i) => i.section === sec.id && !i.parentId && (sid === null ? !i.store || !stores.some((s) => s.id === i.store) : i.store === sid))
    .filter((i) => !i.done || (i.completedAt && D.diffDays(i.completedAt, D.todayKey()) <= 0))
    .sort((a, b) => (a.done - b.done) || model.byOrder(a, b));

  const tabs = h('div', { class: 'store-tabs' },
    h('button', { class: `store-tab ${tab === 'all' ? 'on' : ''}`, onclick: () => { setTab(sec.id, 'all'); bus.rerender(); } }, 'All stores'),
    stores.map((s) => h('button', {
      class: `store-tab ${tab === s.id ? 'on' : ''}`, style: { '--c': s.color || sec.color },
      onclick: () => { setTab(sec.id, s.id); bus.rerender(); },
      oncontextmenu: (e) => { e.preventDefault(); storeMenu(e.currentTarget, s); },
    }, s.name, h('span', { class: 'count' }, String(open(s.id).filter((i) => !i.done).length)))),
    h('button', { class: 'store-tab add', onclick: () => editStore(null) }, '+ Store'));

  const card = (s) => h('div', { class: 'store-card', style: { '--c': s?.color || sec.color } },
    h('div', { class: 'store-card-head' },
      h('h3', {}, s ? s.name : 'No store'),
      s && h('button', { class: 'icon-btn sm', 'aria-label': `${s.name} options`, onclick: (e) => storeMenu(e.currentTarget, s) }, '⋯')),
    itemList(open(s ? s.id : null), { empty: 'Nothing on this list.' }),
    composer({ section: sec.id, storeId: s?.id || null, placeholder: s ? `Add to ${s.name}` : 'Add item' }));

  const body = tab === 'all'
    ? h('div', { class: 'store-grid' }, stores.map(card), open(null).length ? card(null) : null)
    : card(stores.find((s) => s.id === tab));
  host.append(h('div', { class: `tobuy ${compact ? 'compact' : ''}`, style: { '--c': sec.color } }, tabs, body));
}

function storeMenu(anchor, s) {
  const stores = model.storesSorted();
  const i = stores.findIndex((x) => x.id === s.id);
  menu(anchor, [
    { label: 'Rename or recolor', icon: '✎', run: () => editStore(s) },
    i > 0 && { label: 'Move left', icon: '←', run: () => swap(stores, i, i - 1) },
    i < stores.length - 1 && { label: 'Move right', icon: '→', run: () => swap(stores, i, i + 1) },
    { label: 'Clear checked items', icon: '✓', run: () => {
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
  const pal = model.PALETTES[model.settings().palette] || model.PALETTES.retro;
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
