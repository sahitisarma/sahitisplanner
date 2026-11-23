// Quick capture: type, dictate, or write, then review suggestions before anything is created.
import { h, sheet, toast, dateButton, fill } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import * as E from '../events.js';
import { organize } from '../organize.js';
import { recorderWidget } from './voice.js';
import { InkSurface, recognize } from '../ink.js';
import { newNote } from './notes.js';
import * as sync from '../sync.js';

const TYPES = [['tobuy', 'To Buy'], ['errand', 'Errand'], ['todo', 'To-Do'], ['event', 'Event'], ['skip', 'Skip']];

export function openCapture(initialText = '', fromVoice = null) {
  let voice = fromVoice;
  const ta = h('textarea', { class: 'capture-text', rows: 4, placeholder: 'e.g. Buy milk at Target, call the dentist tomorrow, and dinner Friday at seven', 'aria-label': 'Quick capture' }, initialText);
  const pad = h('div', { class: 'capture-pad paper-lined' });
  const results = h('div', { class: 'capture-results' });
  let surf;
  const rec = recorderWidget({
    link: { date: D.todayKey() },
    onSaved: (v) => { voice = v; ta.value = [ta.value, v.transcript].filter(Boolean).join(ta.value ? ', ' : ''); run(); },
  });
  const run = async () => {
    let text = ta.value.trim();
    if (surf?.strokes.length) {
      try { const t = await recognize(surf.strokes); if (t) text = [text, t].filter(Boolean).join(', '); } catch { toast('Reading handwriting needs a connection. Using typed text only.'); }
    }
    if (!text) { toast('Type, write or record something first'); return; }
    review(text);
  };

  const body = h('div', { class: 'capture' },
    
    ta,
    fromVoice ? null : h('details', {}, h('summary', {}, 'Or write it with your Pencil'), pad),
    fromVoice ? null : rec,
    h('button', { class: 'btn primary', onclick: run }, 'Sort it into my planner'),
    results);
  const s = sheet('Quick capture', body, { wide: true });
  setTimeout(() => {
    if (!fromVoice) surf = new InkSurface(pad, { logicalH: 220, label: 'Write to capture', onChange: () => {} });
    if (initialText) run(); else ta.focus();
  }, 30);

  function review(text) {
    const stores = model.storesSorted();
    const suggestions = organize(text, { today: D.todayKey(), stores: stores.map((x) => x.name) });
    const rows = suggestions.map((sg) => ({ ...sg, on: true }));
    const keepNote = { on: !voice };
    const draw = () => {
      fill(results, 
        h('h3', { class: 'block-h' }, 'Here is where things go'),
        rows.length ? null : h('p', { class: 'empty' }, 'Nothing to suggest.'),
        ...rows.map((r) => {
          const typeSel = h('select', { 'aria-label': 'Type', onchange: (e) => { r.type = e.target.value; draw(); } },
            TYPES.map(([v, l]) => h('option', { value: v, selected: r.type === v }, l)));
          return h('div', { class: `sugg ${r.type === 'skip' ? 'off' : ''}` },
            typeSel,
            h('input', { value: r.title, 'aria-label': 'Title', oninput: (e) => { r.title = e.target.value; } }),
            r.type === 'tobuy' ? h('select', { 'aria-label': 'Store', onchange: (e) => { r.store = e.target.value; } },
              h('option', { value: '' }, 'No store'),
              stores.map((st) => h('option', { value: st.name, selected: (r.store || '').toLowerCase() === st.name.toLowerCase() }, st.name)),
              r.store && !stores.some((st) => st.name.toLowerCase() === r.store.toLowerCase()) ? h('option', { value: r.store, selected: true }, `${r.store} (new store)`) : null) : null,
            r.type !== 'tobuy' ? dateButton(r.date, (d) => { r.date = d; }, { placeholder: 'No date', allowClear: r.type !== 'event' }) : null,
            r.type === 'event' ? h('input', { type: 'time', value: r.time || '', 'aria-label': 'Time', onchange: (e) => { r.time = e.target.value; } }) : null,
            null);
        }),
        !voice ? h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: keepNote.on, onchange: (e) => { keepNote.on = e.target.checked; } }), h('span', {}, 'Keep the original as a note')) : null,
        h('div', { class: 'row gap' }, h('button', { class: 'btn primary', onclick: () => apply(rows, text, keepNote.on) }, 'Add to planner')));
    };
    draw();
  }

  function apply(rows, text, keep) {
    const sec = (t) => model.sectionByType(t);
    let n = 0;
    for (const r of rows) {
      if (r.type === 'skip' || !r.title.trim()) continue;
      if (r.type === 'event') {
        E.createEvent({ summary: r.title, startKey: r.date || D.todayKey(), startTime: r.time || '09:00', allDay: !r.time, endKey: r.date || D.todayKey(), endTime: r.time ? addHour(r.time) : '10:00' });
      } else if (r.type === 'tobuy') {
        let st = model.storesSorted().find((x) => x.name.toLowerCase() === (r.store || '').toLowerCase());
        if (!st && r.store) st = store.put('stores', { id: store.uid(), name: r.store, order: model.storesSorted().length });
        model.newItem({ section: sec('tobuy')?.id, title: r.title, store: st?.id || null });
      } else {
        const target = r.type === 'errand' ? sec('errands') : sec('todos');
        model.newItem({ section: target?.id, title: r.title, date: r.date, due: r.due || null, gNew: true });
      }
      n++;
    }
    if (keep) newNote('notes', { title: `Quick capture · ${D.fmtShort(D.todayKey())}`, text: text.replace(/</g, '&lt;') });
    sync.soon(500);
    toast(`Added ${n} item${n === 1 ? '' : 's'}`);
    s.close();
  }
}

function addHour(t) { const [hh, mm] = t.split(':').map(Number); return `${String(Math.min(23, hh + 1)).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
