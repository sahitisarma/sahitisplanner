// Settings: sections, look and feel, handwriting, Google, backup, install help.
import { h, sheet, toast, colorRow, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as G from '../google.js';
import * as E from '../events.js';
import * as sync from '../sync.js';
import { Pen } from '../ink.js';
import { bus } from '../bus.js';

export function renderSettings(host) {
  const s = model.settings();
  host.append(h('div', { class: 'settings' },
    h('h2', { class: 'page-title' }, 'Settings ✦'),
    sectionsCard(),
    lookCard(s),
    writingCard(s),
    googleCard(s),
    dataCard(),
    installCard()));
}

function card(title, ...kids) { return h('div', { class: 'card settings-card' }, h('h3', { class: 'block-h' }, title), ...kids); }

// ---------- sections ----------
function sectionsCard() {
  const secs = model.sections({ includeHidden: true });
  const pal = model.PALETTES[model.settings().palette] || model.PALETTES.retro;
  const reorder = (i, j) => {
    const a = secs[i], b = secs[j];
    store.put('sections', { id: a.id, order: j }); store.put('sections', { id: b.id, order: i });
    secs.forEach((x, k) => { if (k !== i && k !== j && x.order !== k) store.put('sections', { id: x.id, order: k }, { quiet: true }); });
  };
  return card('Sections',
    h('p', { class: 'hint' }, 'Rename, recolor, reorder, hide, or add sections. Tap the color dot to change it.'),
    h('div', { class: 'sec-rows' }, secs.map((sec, i) => h('div', { class: `sec-row ${sec.hidden ? 'hidden' : ''}` },
      h('button', { class: 'swatch', style: { background: sec.color }, 'aria-label': 'Section color', onclick: () => {
        sheet(`${sec.name} color`, colorRow(pal.swatches, sec.color, (c) => store.put('sections', { id: sec.id, color: c })), { actions: [{ label: 'Done', kind: 'primary' }] });
      } }),
      h('input', { value: sec.name, 'aria-label': 'Section name', onchange: (e) => store.put('sections', { id: sec.id, name: e.target.value.trim() || sec.name }) }),
      h('span', { class: 'sec-type' }, model.SECTION_TYPES[sec.type]?.label),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Move up', disabled: i === 0, onclick: () => reorder(i, i - 1) }, '↑'),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Move down', disabled: i === secs.length - 1, onclick: () => reorder(i, i + 1) }, '↓'),
      h('button', { class: 'chip', onclick: () => store.put('sections', { id: sec.id, hidden: !sec.hidden }) }, sec.hidden ? 'Show' : 'Hide'),
      sec.custom ? h('button', { class: 'icon-btn sm', 'aria-label': 'Delete section', onclick: async () => {
        if (await confirmSheet('Delete section?', `“${sec.name}” and its items will be removed.`, 'Delete')) {
          store.remove('sections', sec.id);
          store.all('items').filter((it) => it.section === sec.id).forEach((it) => store.remove('items', it.id));
        }
      } }, '✕') : null))),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn sm', onclick: () => addSection('list') }, '+ New list'),
      h('button', { class: 'btn sm', onclick: () => addSection('notes') }, '+ New notebook')));
}
function addSection(type) {
  const pal = model.PALETTES[model.settings().palette] || model.PALETTES.retro;
  const n = model.sections({ includeHidden: true }).length;
  const sec = store.put('sections', { id: store.uid(), type, name: type === 'list' ? 'New list' : 'Notebook', color: pal.swatches[n % pal.swatches.length], order: n, hidden: false, custom: true });
  toast(`${sec.name} added. Rename it below.`);
}

// ---------- look ----------
function lookCard(s) {
  const secs = model.sections({ includeHidden: true }).filter((x) => ['todos', 'errands', 'tobuy', 'list'].includes(x.type));
  return card('Look and feel',
    h('div', { class: 'menu-label' }, 'Palette (from your inspiration board)'),
    h('div', { class: 'palette-row' }, Object.entries(model.PALETTES).map(([id, p]) => h('button', {
      class: `palette ${s.palette === id ? 'on' : ''}`, onclick: () => model.saveSettings({ palette: id }),
    }, h('span', { class: `pal-swatch pat-${p.pattern}`, style: { '--b1': p.backdrop[0], '--b2': p.backdrop[1], '--b3': p.backdrop[2] || p.backdrop[0], '--b4': p.backdrop[3] || p.backdrop[1] } }),
      h('span', { class: 'pal-dots' }, p.swatches.slice(0, 5).map((c) => h('i', { style: { background: c } }))),
      h('span', {}, p.name)))),
    h('div', { class: 'grid2' },
      h('label', {}, 'Heading font', h('select', { onchange: (e) => model.saveSettings({ fontDisplay: e.target.value }) },
        model.FONTS.display.map((f) => h('option', { value: f, selected: s.fontDisplay === f }, f)))),
      h('label', {}, 'Text font', h('select', { onchange: (e) => model.saveSettings({ fontBody: e.target.value }) },
        model.FONTS.body.map((f) => h('option', { value: f, selected: s.fontBody === f }, f)))),
      h('label', {}, 'Text size', h('select', { onchange: (e) => model.saveSettings({ fontSize: Number(e.target.value) }) },
        model.FONT_SIZES.map((z) => h('option', { value: z, selected: s.fontSize === z }, `${z}px`)))),
      h('label', {}, 'Default paper for new pages', h('select', { onchange: (e) => model.saveSettings({ paper: e.target.value }) },
        model.PAPERS.map((p) => h('option', { value: p, selected: s.paper === p }, p[0].toUpperCase() + p.slice(1))))),
      h('label', {}, 'Day starts', h('select', { onchange: (e) => model.saveSettings({ hourStart: Number(e.target.value) }) },
        Array.from({ length: 12 }, (_, i) => h('option', { value: i + 4, selected: s.hourStart === i + 4 }, `${((i + 4) % 12) || 12}${i + 4 < 12 ? 'am' : 'pm'}`)))),
      h('label', {}, 'Day ends', h('select', { onchange: (e) => model.saveSettings({ hourEnd: Number(e.target.value) }) },
        Array.from({ length: 8 }, (_, i) => h('option', { value: i + 17, selected: s.hourEnd === i + 17 }, `${((i + 17) % 12) || 12}pm`))))),
    h('div', { class: 'menu-label' }, 'Default typed style per section'),
    secs.map((sec) => {
      const st = s.sectionStyles[sec.id] || {};
      const save = (patch) => model.saveSettings({ sectionStyles: { ...model.settings().sectionStyles, [sec.id]: { ...st, ...patch } } });
      return h('div', { class: 'row gap wrap sec-style' },
        h('span', { class: 'sec-name', style: { '--c': sec.color } }, sec.name),
        h('select', { 'aria-label': `${sec.name} font`, onchange: (e) => save({ font: e.target.value || undefined }) },
          h('option', { value: '' }, 'Text font'), model.FONTS.body.map((f) => h('option', { value: f, selected: st.font === f }, f))),
        h('select', { 'aria-label': `${sec.name} size`, onchange: (e) => save({ size: Number(e.target.value) || undefined }) },
          h('option', { value: '' }, 'Size'), model.FONT_SIZES.map((z) => h('option', { value: z, selected: st.size === z }, `${z}px`))),
        h('label', { class: 'swatch custom', title: 'Text color' }, h('input', { type: 'color', value: st.color || '#2b2320', onchange: (e) => save({ color: e.target.value }) }), 'A'));
    }));
}

// ---------- handwriting ----------
function writingCard(s) {
  return card('Handwriting',
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!s.fingerDraw, onchange: (e) => { model.saveSettings({ fingerDraw: e.target.checked }); Pen.set({ fingerDraw: e.target.checked }); } }),
      h('span', {}, 'Let fingers draw too (off = Pencil writes, fingers scroll)')),
    h('div', { class: 'menu-label' }, 'Favorite colors'),
    colorRow(s.favColors, null, (c) => {
      const fav = model.settings().favColors;
      if (fav.includes(c)) model.saveSettings({ favColors: fav.filter((x) => x !== c) });
      else model.saveSettings({ favColors: [...fav, c].slice(-10) });
    }),
    h('p', { class: 'hint' }, 'Tap a favorite to remove it. Use ＋ to add a new one. Pen presets live in the pen dock: set a pen up, then choose “Save as pen preset”.'));
}

// ---------- Google ----------
function googleCard(s) {
  const connected = G.isConnected();
  const always = G.alwaysOn();
  const lists = store.meta('gtasklists', []) || [];
  const serverInput = h('input', { value: s.authServer || '', placeholder: 'https://sahitis-planner-auth.yourname.workers.dev', 'aria-label': 'Connection server URL', inputmode: 'url' });
  const idInput = h('input', { value: s.googleClientId || '', placeholder: 'xxxxxxxx.apps.googleusercontent.com', 'aria-label': 'Google OAuth client ID' });
  const connect = () => {
    const server = serverInput.value.trim().replace(/\/$/, '');
    const id = idInput.value.trim();
    if (server && !/^https:\/\//.test(server)) { toast('The server address should start with https://'); return; }
    if (!server && !id.endsWith('.apps.googleusercontent.com')) { toast('Add your connection server address (recommended) or a Google client ID.'); return; }
    model.saveSettings({ authServer: server, googleClientId: id });
    setTimeout(() => G.connect(), 150);
  };
  return card('Google Calendar and Tasks',
    connected
      ? h('p', { class: 'ok' }, always ? `✓ Always connected${G.email() ? ` as ${G.email()}` : ''}` : `✓ Connected${G.email() ? ` as ${G.email()}` : ''} (renews when you open the app)`)
      : h('p', { class: 'hint' }, 'Connect once to sync Google Calendar, Google Tasks, and keep the planner the same on your iPad and computer.'),
    h('label', {}, 'Connection server (keeps Google always connected)', serverInput),
    h('p', { class: 'hint' }, 'Your free Cloudflare server from the README. With it, Google stays connected for good. Without it, Google access lasts about an hour and renews when you open the app.'),
    h('details', { class: 'advanced' },
      h('summary', {}, 'No server? Use a client ID instead'),
      h('label', {}, 'OAuth client ID', idInput),
      h('p', { class: 'hint' }, `JavaScript origin to add in Google Cloud: ${location.origin}`)),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: connect }, connected ? 'Reconnect Google' : 'Connect Google'),
      connected ? h('button', { class: 'btn', onclick: () => sync.soon(0) }, 'Sync now') : null,
      G.wasConnected() ? h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmSheet('Disconnect Google?', 'Your planner stays on this device. Syncing stops until you reconnect.', 'Disconnect')) { G.disconnect(); bus.rerender(); }
      } }, 'Disconnect') : null),
    connected ? h('div', { class: 'grid2' },
      h('label', {}, 'New events go to', h('select', { onchange: (e) => model.saveSettings({ defaultCalendar: e.target.value }) },
        E.writableCalendars().map((c) => h('option', { value: c.id, selected: E.defaultCalendarId() === c.id }, c.summary)))),
      h('label', {}, 'New to-dos also go to Google Tasks list', h('select', { onchange: (e) => model.saveSettings({ newTaskList: e.target.value }) },
        h('option', { value: '' }, 'Keep in planner only'),
        lists.map((l) => h('option', { value: l.id, selected: s.newTaskList === l.id }, l.title))))) : null);
}

// ---------- data ----------
function dataCard() {
  return card('Backup',
    h('p', { class: 'hint' }, 'Everything saves automatically. A backup file is extra peace of mind.'),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn', onclick: exportData }, 'Download backup'),
      h('label', { class: 'btn' }, 'Restore backup', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: (e) => importData(e.target.files[0]) }))));
}
function exportData() {
  const snap = store.snapshot();
  const blob = new Blob([JSON.stringify({ app: 'sahitis-planner', v: 1, at: new Date().toISOString(), data: snap })], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `sahitis-planner-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
}
async function importData(file) {
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    if (json.app !== 'sahitis-planner') throw new Error('not ours');
    if (!(await confirmSheet('Restore backup?', 'Items in the backup will be merged into your planner. Newer versions win.', 'Restore', 'primary'))) return;
    for (const [col, recs] of Object.entries(json.data)) {
      for (const r of recs) {
        const cur = store.getRaw(col, r.id);
        if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) store.replace(col, r, { silent: true });
      }
    }
    await store.flushNow();
    toast('Backup restored');
    bus.rerender();
  } catch { toast('That file is not a planner backup.'); }
}

// ---------- install ----------
function installCard() {
  return card('Add to your iPad Home Screen',
    h('ol', { class: 'steps' },
      h('li', {}, 'Open this planner’s link in Safari on your iPad.'),
      h('li', {}, 'Tap the Share button (square with an arrow).'),
      h('li', {}, 'Choose “Add to Home Screen”, keep the name “Sahiti’s Planner”, tap Add.'),
      h('li', {}, 'Open it from the new icon. It opens full screen and remembers everything.')));
}
