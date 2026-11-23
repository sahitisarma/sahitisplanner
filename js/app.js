// Sahiti's Planner: app shell.
import * as store from './store.js';
import * as model from './model.js';
import * as sync from './sync.js';
import * as G from './google.js';
import { h, $, toast, menu, fill } from './ui.js';
import { bus } from './bus.js';
import { mountDock } from './dock.js';
import { renderEverything } from './views/everything.js';
import { renderSection } from './views/section.js';
import { renderSettings } from './views/settings.js';
import { renderNotes } from './views/notes.js';
import { openCapture } from './views/capture.js';
import { openEventEditor, openDaySheet, timeBlock } from './views/calendar.js';
import { refreshInkPads } from './views/inkpad.js';
import { refreshInk } from './views/items.js';
import { History } from './ink.js';
import { todayKey } from './dates.js';

let route = 'everything';

async function boot() {
  await store.init();
  model.seed();
  applyTheme();
  route = (location.hash.startsWith('#/') ? location.hash.slice(2) : '') || localStorage.getItem('sp-route') || 'everything';

  document.body.append(
    h('div', { id: 'backdrop' }),
    h('div', { id: 'app' },
      h('header', { id: 'topbar' },
        h('button', { class: 'logo', onclick: () => navigate('everything'), 'aria-label': 'Everything view' }, 'Sahiti’s Planner'),
        h('span', { id: 'today-chip' }),
        h('div', { class: 'top-right' },
          h('button', { id: 'status', class: 'status', 'aria-live': 'polite', onclick: onStatusTap }),
          h('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', onclick: () => navigate('settings') }, '⚙'))),
      h('main', { id: 'main', 'data-scroll-key': 'main' })),
    h('nav', { id: 'tabs', 'aria-label': 'Sections' }),
    h('div', { id: 'dock-host' }),
    h('div', { id: 'toasts', 'aria-live': 'polite' }));

  bus.navigate = navigate;
  bus.rerender = () => render();
  bus.openDay = openDaySheet;
  bus.timeBlock = timeBlock;
  bus.editEvent = openEventEditor;
  bus.capture = (text, voice) => openCapture(text || '', voice || null);

  window.addEventListener('hashchange', () => {
    const r = location.hash.startsWith('#/') ? location.hash.slice(2) : '';
    if (r && r !== route) navigate(r);
  });
  mountDock($('#dock-host'), { onCapture: () => openCapture() });
  wireStoreEvents();
  render();
  renderStatus();
  keyboard();
  await sync.start();
  registerSW();
  // New day while the app stays open: rollover shows up without a refresh.
  let day = todayKey();
  setInterval(() => { if (todayKey() !== day) { day = todayKey(); render(); } }, 60_000);
}

// ---------- theme ----------
export function applyTheme() {
  const s = model.settings();
  const p = model.PALETTES[s.palette] || model.PALETTES.retro;
  const r = document.documentElement.style;
  r.setProperty('--paper', p.paper);
  r.setProperty('--ink', p.ink);
  r.setProperty('--line', p.line);
  r.setProperty('--b1', p.backdrop[0]);
  r.setProperty('--b2', p.backdrop[1]);
  r.setProperty('--b3', p.backdrop[2] || p.backdrop[0]);
  r.setProperty('--b4', p.backdrop[3] || p.backdrop[1]);
  p.swatches.forEach((c, i) => r.setProperty(`--s${i}`, c));
  r.setProperty('--accent', p.swatches[0]);
  r.setProperty('--accent2', p.swatches[1]);
  r.setProperty('--font-display', `'${s.fontDisplay}', 'Shrikhand', Georgia, serif`);
  r.setProperty('--font-body', `'${s.fontBody}', 'Outfit', system-ui, sans-serif`);
  r.setProperty('--fs', `${s.fontSize}px`);
  document.documentElement.dataset.pattern = p.pattern;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', p.backdrop[0]);
}

// ---------- routing ----------
function navigate(r) {
  route = r;
  try { localStorage.setItem('sp-route', r); } catch {}
  history.replaceState(null, '', `#/${r}`);
  render({ resetScroll: true });
}

// ---------- rendering ----------
let pendingRender = false;
function render({ resetScroll = false } = {}) {
  // Never re-render under your Pencil or while you are typing.
  const main = $('#main');
  // Defer only while the Pencil is down or you're typing in a rich-text note.
  const busy = () => {
    const a = document.activeElement;
    return !!document.querySelector('.ink-host.writing') || !!(a && main.contains(a) && (a.isContentEditable || (a.matches('input, textarea') && !a.dataset.fk)));
  };
  if (busy()) {
    if (!pendingRender) {
      pendingRender = true;
      const later = () => setTimeout(() => {
        if (busy()) return;
        pendingRender = false;
        document.removeEventListener('focusout', later);
        document.removeEventListener('pointerup', later);
        render();
      }, 40);
      document.addEventListener('focusout', later);
      document.addEventListener('pointerup', later);
    }
    return;
  }
  const scrolls = resetScroll ? {} : saveScroll();
  const act = document.activeElement;
  const focus = act?.dataset?.fk ? { fk: act.dataset.fk, s: act.selectionStart, e: act.selectionEnd } : null;
  renderTabs();
  $('#today-chip').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  fill(main);
  main.className = `route-${route.split('/')[0]}`;
  if (route === 'everything') renderEverything(main);
  else if (route === 'settings') renderSettings(main);
  else if (route.startsWith('notes/')) {
    const id = route.split('/')[1];
    const n = store.get('notes', id);
    const sec = model.section(n?.section || 'notes') || model.sectionByType('notes');
    renderNotes(main, sec, { noteId: id });
  } else {
    const sec = model.section(route);
    if (!sec || sec.hidden) { route = 'everything'; return render(); }
    main.append(h('h2', { class: 'page-title', style: { '--c': sec.color } }, sec.name));
    renderSection(main, sec);
  }
  if (focus && !bus.focusItem) {
    const el = main.querySelector(`[data-fk="${CSS.escape(focus.fk)}"]`);
    if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(focus.s, focus.e); } catch {} }
  }
  requestAnimationFrame(() => restoreScroll(scrolls));
}

function saveScroll() {
  const out = {};
  document.querySelectorAll('[data-scroll-key]').forEach((el) => { out[el.dataset.scrollKey] = el.scrollTop; });
  out.__win = window.scrollY;
  return out;
}
function restoreScroll(s) {
  document.querySelectorAll('[data-scroll-key]').forEach((el) => { if (s[el.dataset.scrollKey]) el.scrollTop = s[el.dataset.scrollKey]; });
  if (s.__win) window.scrollTo(0, s.__win);
}

function renderTabs() {
  const tabs = $('#tabs');
  const cur = route.split('/')[0] === 'notes' && route.includes('/') ? 'notes' : route;
  fill(tabs, 
    h('button', { class: `tab ${cur === 'everything' ? 'on' : ''}`, style: { '--c': 'var(--ink)' }, onclick: () => navigate('everything') }, h('span', {}, '✦ Everything')),
    ...model.sections().map((s) => h('button', { class: `tab ${cur === s.id ? 'on' : ''}`, style: { '--c': s.color }, onclick: () => navigate(s.id) }, h('span', {}, s.name))),
    h('button', { class: `tab add ${cur === 'settings' ? 'on' : ''}`, style: { '--c': 'var(--s6)' }, 'aria-label': 'Manage sections', onclick: () => navigate('settings') }, h('span', {}, '＋')));
}

// ---------- store -> UI ----------
let renderTimer;
function wireStoreEvents() {
  store.on((ev) => {
    if (ev.type === 'status') return renderStatus();
    if (ev.type !== 'change') return;
    if (ev.col === 'meta' && ev.id === 'settings') { applyTheme(); }
    if (ev.quiet) return;
    if (ev.col === 'ink') refreshInkPads();
    if (ev.col === 'items' && ev.fromSync) refreshInk(ev.id);
    if (ev.col === 'meta' && ev.id === 'local:gqueue') return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => render(), ev.fromSync ? 250 : 60);
  });
}

// ---------- status pill ----------
function renderStatus() {
  const st = store.getStatus();
  const el = $('#status');
  if (!el) return;
  let label, cls;
  if (st.save === 'saving') { label = 'Saving…'; cls = 'saving'; }
  else if (st.save === 'error') { label = 'Needs attention'; cls = 'attention'; }
  else if (st.sync === 'syncing') { label = 'Syncing…'; cls = 'syncing'; }
  else if (st.sync === 'attention') { label = 'Needs attention'; cls = 'attention'; }
  else if (st.sync === 'offline') { label = 'Saved · offline'; cls = 'offline'; }
  else if (st.sync === 'synced') { label = 'Saved · synced'; cls = 'saved'; }
  else { label = 'Saved'; cls = 'saved'; }
  el.className = `status ${cls}`;
  fill(el, h('i', { class: 'dot' }), h('span', {}, label));
  el.title = st.message || (st.sync === 'local' ? 'Saved on this device' : label);
}
function onStatusTap(e) {
  const st = store.getStatus();
  const items = [{ el: h('div', { class: 'menu-block status-detail' }, st.message || 'Everything is saved on this device.') }];
  if (!G.configured()) items.push({ label: 'Set up Google sync', icon: '⚙', run: () => navigate('settings') });
  else if (!G.isConnected()) items.push({ label: 'Reconnect Google', icon: '↻', run: () => G.connect({ silent: G.wasConnected() }).catch(() => navigate('settings')) });
  else items.push({ label: 'Sync now', icon: '↻', run: () => sync.soon(0) });
  menu(e.currentTarget, items);
}

// ---------- keyboard shortcuts (computer) ----------
function keyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches?.('input, textarea, [contenteditable]');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault(); e.shiftKey ? History.redo() : History.undo();
    }
    if (!typing && e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openCapture(); }
  });
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready', { action: 'Update', onAction: async () => { await store.flushNow(); location.reload(); }, ms: 10000 });
          }
        });
      });
    }).catch(() => {});
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('div', { class: 'fatal' }, h('h2', {}, 'The planner could not start'), h('p', {}, String(e?.message || e)),
    h('p', {}, 'Your saved data is safe. Try reloading. If you are in Private Browsing, open it in a normal Safari tab.')));
});
