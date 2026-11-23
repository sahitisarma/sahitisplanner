import { icon } from '../icons.js';
// Calendar: month, week and day (daily planning page). Weeks always start Sunday.
import { h, sheet, menu, closeMenu, dateButton, toast, confirmSheet, fill } from '../ui.js';
import * as D from '../dates.js';
import * as E from '../events.js';
import * as model from '../model.js';
import * as store from '../store.js';
import { inkPad, zoomPage } from './inkpad.js';
import { itemList } from './items.js';
import { checklistPage, carriedLines } from './checklist.js';
import { bus } from '../bus.js';
import * as sync from '../sync.js';

export const calState = { view: 'month', day: D.todayKey() };
try { Object.assign(calState, JSON.parse(localStorage.getItem('sp-cal') || '{}')); calState.day = D.todayKey(); } catch {}
const saveCal = () => { try { localStorage.setItem('sp-cal', JSON.stringify({ view: calState.view })); } catch {} };

export function renderCalendar(host, { compact = false } = {}) {
  const view = calState.view;
  const wrap = h('div', { class: `cal cal-${view} ${compact ? 'compact' : ''}` });
  const title = view === 'month' ? D.fmtMonth(calState.day)
    : view === 'week' ? weekTitle(calState.day) : D.fmtMonth(calState.day);
  const step = (n) => {
    calState.day = view === 'month' ? D.addMonths(calState.day, n) : D.addDays(calState.day, n * (view === 'week' ? 7 : 1));
    bus.rerender();
  };
  wrap.append(h('div', { class: 'cal-head' },
    h('h2', { class: 'cal-title' }, h('button', { class: 'cal-title-btn', 'aria-label': 'Choose a month', onclick: (e) => monthPicker(e.currentTarget) }, title, icon('down', 18))),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous', onclick: () => step(-1) }, icon('left')),
      h('button', { class: 'chip', onclick: () => { calState.day = D.todayKey(); bus.rerender(); } }, 'Today'),
      h('button', { class: 'icon-btn', 'aria-label': 'Next', onclick: () => step(1) }, icon('right'))),
    h('div', { class: 'seg', role: 'tablist' }, ['month', 'week', 'day'].map((v) =>
      h('button', { class: view === v ? 'on' : '', role: 'tab', 'aria-selected': String(view === v), onclick: () => { calState.view = v; saveCal(); bus.rerender(); } }, v[0].toUpperCase() + v.slice(1)))),
    h('button', { class: 'chip', title: 'Show or hide calendars', onclick: (e) => calendarsMenu(e.currentTarget) }, 'Calendars'),
    h('button', { class: 'btn primary sm', onclick: () => openEventEditor(null, { day: calState.day }) }, 'New event')));

  if (view === 'month') wrap.append(monthView(calState.day));
  else if (view === 'week') wrap.append(weekView(calState.day));
  else wrap.append(dayPage(calState.day, { compact }));
  host.append(wrap);
}

function weekTitle(k) {
  const days = D.weekDays(k);
  return `${D.fmtShort(days[0])} – ${D.fmtShort(days[6])}`.replace(' – ', ' to ');
}

function calendarsMenu(anchor) {
  const s = model.settings();
  const hidden = new Set(s.hiddenCalendars || []);
  menu(anchor, [
    { el: h('div', { class: 'menu-label' }, 'Show calendars') },
    ...E.calendars().map((c) => ({ el: h('label', { class: 'menu-check' },
      h('input', { type: 'checkbox', checked: !hidden.has(c.id), onchange: (e) => {
        const set = new Set(model.settings().hiddenCalendars || []);
        e.target.checked ? set.delete(c.id) : set.add(c.id);
        model.saveSettings({ hiddenCalendars: [...set] });
        sync.soon(200);
      } }),
      h('span', { class: 'cal-dot', style: { background: c.color } }), c.summary) })),
  ]);
}

// ---------- event chip ----------
function eventChip(o, { showTime = true, day } = {}) {
  const ev = o.ev;
  const color = E.eventColor(ev);
  const time = ev.allDay ? '' : D.fmtTime(o.start);
  return h('button', {
    class: `ev ${ev.allDay ? 'allday' : ''} ${ev.pending ? 'pending' : ''}`, style: { '--c': color },
    title: `${ev.summary}${time ? ` at ${time}` : ''}`,
    onclick: (e) => { e.stopPropagation(); openEventEditor(o); },
  }, showTime && time ? h('span', { class: 'ev-time' }, time) : null, h('span', { class: 'ev-title' }, ev.summary));
}

// ---------- month ----------
function monthView(k) {
  const grid = D.monthGrid(k);
  sync.setWindow(grid[0], grid[41]);
  const occ = E.occurrences(grid[0], grid[41]);
  const todos = store.all('items').filter((i) => !i.parentId);
  const body = h('div', { class: 'month-grid' },
    grid.map((day) => {
      const ds = D.parseKey(day), de = D.parseKey(D.addDays(day, 1));
      const evs = occ.filter((o) => o.end > ds && o.start < de);
      const tasks = todos.filter((i) => model.showsOnDay(i, day) && !i.done);
      const cell = h('div', {
        class: ['mcell', D.sameMonth(day, k) ? '' : 'out', day === D.todayKey() ? 'today' : '', day === calState.day ? 'sel' : ''].join(' '),
        role: 'button', tabindex: 0, 'aria-label': D.fmtFull(day),
        onclick: () => openDaySheet(day),
      },
      h('span', { class: 'mnum' }, String(ds.getDate())),
      h('div', { class: 'mevents' }, evs.slice(0, 3).map((o) => eventChip(o, { day })),
        evs.length > 3 ? h('span', { class: 'more' }, `${evs.length - 3} more`) : null),
      null);
      return cell;
    }));
  const wrap = h('div', { class: 'month' },
    h('div', { class: 'dow-row' }, D.DOW_SHORT.map((d) => h('span', {}, d))),
    h('div', { class: 'month-body' }, body, h('div', { class: 'ink-overlay' })));
  queueMicrotask(() => {
    const ov = wrap.querySelector('.ink-overlay');
    inkPad(ov, `month:${k.slice(0, 7)}`, { mode: 'fill', penOnly: true, eventTarget: wrap.querySelector('.month-body'), label: 'Month notes' });
  });
  return wrap;
}

// Tap a date: see that day's events, tasks, errands and notes.
export function openDaySheet(day) {
  const body = h('div', { class: 'day-sheet' });
  const draw = () => {
    fill(body, 
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary sm', onclick: () => { s.close(); openEventEditor(null, { day }); } }, 'New event'),
        h('button', { class: 'btn sm', onclick: () => { s.close(); calState.day = day; calState.view = 'day'; bus.navigate('calendar'); } }, 'Open day page')),
      dayAgenda(day));
  };
  const s = sheet(D.fmtFull(day), body, { wide: true });
  draw();
  const off = store.on((ev) => { if (ev.type === 'change' && !ev.quiet && body.isConnected) draw(); else if (!body.isConnected) off(); });
}

function dayAgenda(day) {
  const evs = E.occurrencesOn(day);
  const lists = model.sections().filter((s) => ['todos', 'errands', 'tobuy', 'list'].includes(s.type));
  const notes = store.all('notes').filter((n) => n.date === day);
  const voices = store.all('voice').filter((v) => v.link?.date === day);
  return h('div', { class: 'agenda' },
    h('h3', { class: 'agenda-h' }, 'Schedule'),
    evs.length ? h('div', { class: 'agenda-events' }, evs.map((o) => eventChip(o))) : h('p', { class: 'empty' }, 'No events'),
    lists.map((sec) => {
      const items = model.itemsForDay(sec.id, day);
      return h('div', {}, h('h3', { class: 'agenda-h', style: { '--c': sec.color } }, sec.name),
        itemList(items, { day, empty: '', showStore: sec.type === 'tobuy' }));
    }),
    notes.length ? h('div', {}, h('h3', { class: 'agenda-h' }, 'Notes'), notes.map((n) => h('button', { class: 'link-row', onclick: () => bus.navigate(`notes/${n.id}`) }, n.title || 'Untitled note'))) : null,
    voices.length ? h('div', {}, h('h3', { class: 'agenda-h' }, 'Voice notes'), voices.map((v) => h('button', { class: 'link-row', onclick: () => bus.navigate('voice') }, v.transcript?.slice(0, 60) || 'Recording'))) : null,
  );
}

// ---------- week (spread: Sun-Wed left page, Thu-Sat + notes right page) ----------
function weekView(k) {
  const days = D.weekDays(k);
  sync.setWindow(days[0], days[6]);
  const dayBox = (day) => {
    const ds = D.parseKey(day);
    const evs = E.occurrencesOn(day);
    const items = model.itemsForDay(null, day).filter((i) => {
      const t = model.section(i.section)?.type;
      return t && t !== 'tobuy';
    });
    const box = h('div', { class: `wday ${day === D.todayKey() ? 'today' : ''}` },
      h('button', { class: 'wday-head', onclick: () => { calState.day = day; calState.view = 'day'; saveCal(); bus.rerender(); } },
        h('span', { class: 'wdow' }, D.DOW_SHORT[ds.getDay()]), h('span', { class: 'wnum' }, String(ds.getDate()))),
      h('div', { class: 'wevents' }, evs.map((o) => eventChip(o))),
      itemList(items, { day, empty: '', showSection: true }),
      h('div', { class: 'wink paper-lined' }));
    queueMicrotask(() => inkPad(box.querySelector('.wink'), `daybox:${day}`, { logicalH: 420, grow: true, minH: 420, label: `Notes for ${D.fmtFull(day)}` }));
    return box;
  };
  const notesBox = h('div', { class: 'wday notes' }, h('div', { class: 'wday-head static' }, h('span', { class: 'wdow' }, 'Notes')), h('div', { class: 'wink paper-dotted' }));
  queueMicrotask(() => inkPad(notesBox.querySelector('.wink'), `week:${days[0]}`, { logicalH: 900, grow: true, minH: 900, label: 'Week notes' }));
  return h('div', { class: 'week spread' },
    h('div', { class: 'page left' }, days.slice(0, 4).map(dayBox)),
    h('div', { class: 'page right' }, days.slice(4).map(dayBox), notesBox));
}

// ---------- day page ----------
export function dayPage(day, { compact = false } = {}) {
  sync.setWindow(day, day);
  const s = model.settings();
  const evs = E.occurrencesOn(day);
  const allDay = evs.filter((o) => o.ev.allDay);
  const timed = evs.filter((o) => !o.ev.allDay);
  const hours = [];
  for (let hr = s.hourStart; hr <= s.hourEnd; hr++) hours.push(hr);
  const ds = D.parseKey(day);

  const timeline = h('div', { class: 'timeline', style: { '--hours': hours.length } },
    hours.map((hr) => h('div', { class: 'hour', onclick: () => openEventEditor(null, { day, time: `${String(hr).padStart(2, '0')}:00` }) },
      h('span', { class: 'hour-label' }, D.fmtTime(new Date(2000, 0, 1, hr))))),
    h('div', { class: 'tl-events' }, layoutTimed(timed, ds, s.hourStart, hours.length).map(({ o, top, height, col, cols }) => {
      const chip = eventChip(o);
      chip.classList.add('tl-ev');
      Object.assign(chip.style, { top: `${top}%`, height: `${height}%`, left: `calc(var(--tl-gutter) + (100% - var(--tl-gutter)) * ${col / cols})`, width: `calc((100% - var(--tl-gutter)) / ${cols} - 4px)` });
      return chip;
    })),
    nowLine(day, s.hourStart, hours.length),
    h('div', { class: 'ink-overlay' }));
  queueMicrotask(() => inkPad(timeline.querySelector('.ink-overlay'), `day:${day}:schedule`, { mode: 'fill', penOnly: true, eventTarget: timeline, label: 'Schedule annotations' }));

  const sections = model.sections().filter((x) => ['todos', 'errands', 'list'].includes(x.type));
  const todos = model.sectionByType('todos');
  const top3 = todos ? model.itemsForDay(todos.id, day).filter((i) => i.priority >= 3 && !i.done) : [];
  const notes = zoomPage(`day:${day}:notes`, { paper: 'lined', height: '62vh', logicalH: 1400, grow: true, minH: 1400, label: 'Notes for the day' });

  return h('div', { class: `daypage spread ${compact ? 'compact' : ''}` },
    h('div', { class: 'page left' },
      h('div', { class: 'day-hero' },
        h('span', { class: 'day-num' }, String(ds.getDate())),
        h('div', { class: 'day-dow' }, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][ds.getDay()])),
      h('h3', { class: 'block-h' }, 'Schedule'),
      allDay.length ? h('div', { class: 'allday-row' }, allDay.map((o) => eventChip(o))) : null,
      timeline),
    compact ? null : h('div', { class: 'page right' },
      top3.length ? h('div', { class: 'card' }, h('h3', { class: 'block-h' }, 'Top priorities'), itemList(top3, { day })) : null,
      sections.map((sec) => {
        const typed = model.itemsForDay(sec.id, day);
        return h('div', { class: 'card', style: { '--c': sec.color } },
          h('h3', { class: 'block-h' }, sec.name),
          carriedLines(sec.id, day),
          typed.length ? itemList(typed, { day }) : null,
          checklistPage(`day:${day}:${sec.id}`, { minRows: 7, label: `${sec.name} for ${D.fmtFull(day)}` }));
      }),
      h('div', { class: 'card' }, h('h3', { class: 'block-h' }, 'Notes'), notes),
      voiceForDay(day)));
}

function voiceForDay(day) {
  const v = store.all('voice').filter((x) => x.link?.date === day);
  if (!v.length) return null;
  return h('div', { class: 'card' }, h('h3', { class: 'block-h' }, 'Voice notes'),
    v.map((x) => h('button', { class: 'link-row', onclick: () => bus.navigate('voice') }, x.transcript?.slice(0, 80) || 'Recording')));
}

function nowLine(day, startHr, nHours) {
  if (day !== D.todayKey()) return null;
  const now = new Date();
  const pct = (((now.getHours() - startHr) * 60 + now.getMinutes()) / (nHours * 60)) * 100;
  if (pct < 0 || pct > 100) return null;
  return h('div', { class: 'now-line', style: { top: `${pct}%` } });
}

// Side-by-side columns for overlapping events
function layoutTimed(list, dayStart, startHr, nHours) {
  const total = nHours * 60;
  const items = list.map((o) => {
    const s = Math.max(0, (o.start - dayStart) / 60000 - startHr * 60);
    const e = Math.min(total, (o.end - dayStart) / 60000 - startHr * 60);
    return { o, s, e: Math.max(e, s + 20) };
  }).filter((x) => x.e > 0 && x.s < total).sort((a, b) => a.s - b.s);
  const out = [];
  let group = [], groupEnd = -1;
  const flush = () => {
    const colsEnd = [];
    for (const it of group) {
      let c = colsEnd.findIndex((end) => end <= it.s);
      if (c < 0) { c = colsEnd.length; colsEnd.push(0); }
      colsEnd[c] = it.e; it.col = c;
    }
    for (const it of group) out.push({ o: it.o, top: (it.s / total) * 100, height: ((it.e - it.s) / total) * 100, col: it.col, cols: colsEnd.length });
    group = []; groupEnd = -1;
  };
  for (const it of items) {
    if (it.s >= groupEnd && group.length) flush();
    group.push(it); groupEnd = Math.max(groupEnd, it.e);
  }
  if (group.length) flush();
  return out;
}

// ---------- event editor ----------
export function openEventEditor(o, defaults = {}) {
  const ev = o?.ev;
  const isNew = !ev;
  const day = defaults.day || D.todayKey();
  const startD = o ? o.start : D.fromKeyTime(day, defaults.time || nextHalfHour());
  const endD = o ? o.end : new Date(startD.getTime() + 60 * 60000);
  const allDayInit = ev ? ev.allDay : !!defaults.allDay;
  const f = {
    summary: ev?.summary ?? defaults.summary ?? '',
    description: ev?.description ?? defaults.description ?? '',
    location: ev?.location ?? '',
    allDay: allDayInit,
    startKey: D.key(startD),
    startTime: D.hhmm(startD),
    endKey: allDayInit ? D.addDays(D.key(endD), -1) : D.key(endD),
    endTime: D.hhmm(endD),
    calId: ev?.calId || defaults.calId || E.defaultCalendarId(),
    taskId: ev?.taskId || defaults.taskId || null,
  };
  // recurrence state
  const rr = E.parseRule(ev?.recurringEventId ? (store.all('events').find((x) => x.gid === ev.recurringEventId)?.recurrence) : ev?.recurrence);
  const rec = {
    freq: rr?.freq || 'none', interval: rr?.interval || 1,
    byday: rr?.byday || [E.BYDAY[startD.getDay()]],
    endType: rr?.until ? 'until' : rr?.count ? 'count' : 'never', until: rr?.until || D.addMonths(f.startKey, 3), count: rr?.count || 10,
  };
  const isInstance = !!ev?.recurringEventId || (ev?.recurrence?.length && ev.calId === 'local');

  const title = h('input', { class: 'big-input', value: f.summary, placeholder: 'Event title', 'aria-label': 'Title', oninput: (e) => { f.summary = e.target.value; } });
  const cals = E.writableCalendars();
  const calSel = h('select', { 'aria-label': 'Calendar', onchange: (e) => { f.calId = e.target.value; dot.style.background = E.calendar(f.calId).color; } },
    cals.map((c) => h('option', { value: c.id, selected: c.id === f.calId }, c.summary)));
  const dot = h('span', { class: 'cal-dot', style: { background: E.calendar(f.calId).color } });
  const timesRow = h('div', { class: 'times' });
  const drawTimes = () => {
    fill(timesRow, 
      h('div', { class: 'time-line' }, h('span', { class: 'lbl' }, 'Starts'),
        dateButton(f.startKey, (v) => { const d = D.diffDays(f.startKey, f.endKey); f.startKey = v || f.startKey; f.endKey = D.addDays(f.startKey, Math.max(0, d)); drawTimes(); }, { allowClear: false }),
        !f.allDay && h('input', { type: 'time', value: f.startTime, step: 300, 'aria-label': 'Start time', onchange: (e) => {
          const old = D.fromKeyTime(f.startKey, f.startTime), oe = D.fromKeyTime(f.endKey, f.endTime);
          f.startTime = e.target.value;
          const ne = new Date(D.fromKeyTime(f.startKey, f.startTime).getTime() + (oe - old));
          f.endKey = D.key(ne); f.endTime = D.hhmm(ne); drawTimes();
        } })),
      h('div', { class: 'time-line' }, h('span', { class: 'lbl' }, 'Ends'),
        dateButton(f.endKey, (v) => { f.endKey = v || f.endKey; drawTimes(); }, { allowClear: false }),
        !f.allDay && h('input', { type: 'time', value: f.endTime, step: 300, 'aria-label': 'End time', onchange: (e) => { f.endTime = e.target.value; } })));
  };
  drawTimes();
  const allDayT = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: f.allDay, onchange: (e) => { f.allDay = e.target.checked; drawTimes(); } }), h('span', {}, 'All day'));

  const repeat = h('div', { class: 'repeat' });
  const drawRepeat = () => {
    fill(repeat, 
      h('div', { class: 'row gap wrap' },
        h('span', { class: 'lbl' }, 'Repeat'),
        h('select', { 'aria-label': 'Repeat', onchange: (e) => { rec.freq = e.target.value; drawRepeat(); } },
          [['none', 'Does not repeat'], ['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['YEARLY', 'Yearly']].map(([v, l]) => h('option', { value: v, selected: rec.freq === v }, l))),
        rec.freq !== 'none' && h('label', { class: 'inline' }, 'every', h('input', { type: 'number', min: 1, max: 30, value: rec.interval, class: 'num', onchange: (e) => { rec.interval = Math.max(1, Number(e.target.value)); } }),
          { DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', YEARLY: 'year(s)' }[rec.freq])),
      rec.freq === 'WEEKLY' && h('div', { class: 'weekday-chips' }, E.BYDAY.map((d, i) => h('button', {
        class: `chip round ${rec.byday.includes(d) ? 'on' : ''}`, 'aria-label': D.DOW_SHORT[i],
        onclick: () => { rec.byday = rec.byday.includes(d) ? rec.byday.filter((x) => x !== d) : [...rec.byday, d]; if (!rec.byday.length) rec.byday = [d]; drawRepeat(); },
      }, D.DOW_LETTER[i]))),
      rec.freq !== 'none' && h('div', { class: 'row gap wrap' },
        h('span', { class: 'lbl' }, 'Ends'),
        h('select', { onchange: (e) => { rec.endType = e.target.value; drawRepeat(); } },
          [['never', 'Never'], ['until', 'On a date'], ['count', 'After a number of times']].map(([v, l]) => h('option', { value: v, selected: rec.endType === v }, l))),
        rec.endType === 'until' && dateButton(rec.until, (v) => { rec.until = v || rec.until; }, { allowClear: false }),
        rec.endType === 'count' && h('input', { type: 'number', class: 'num', min: 1, value: rec.count, onchange: (e) => { rec.count = Number(e.target.value); } })));
  };
  drawRepeat();

  const task = f.taskId ? store.get('items', f.taskId) : null;
  const body = h('div', { class: 'form event-form' },
    title,
    h('div', { class: 'row gap' }, dot, calSel, allDayT),
    timesRow,
    repeat,
    h('label', {}, 'Location', h('input', { value: f.location, placeholder: 'Add a place', oninput: (e) => { f.location = e.target.value; } })),
    h('label', {}, 'Description', h('textarea', { rows: 3, placeholder: 'Notes for this event', oninput: (e) => { f.description = e.target.value; } }, f.description)),
    task ? h('div', { class: 'linked-task' }, 'Time block for ', h('b', {}, task.title || 'a handwritten task'),
      h('button', { class: 'chip', onclick: () => { model.setDone(task, !task.done); toast(task.done ? 'Task reopened' : 'Task done'); } }, task.done ? 'Reopen task' : 'Mark task done')) : null,
    ev?.htmlLink ? h('a', { class: 'small-link', href: ev.htmlLink, target: '_blank', rel: 'noopener' }, 'Open in Google Calendar') : null,
  );

  const save = async () => {
    f.recurrence = E.buildRRule(rec);
    if (isNew) {
      const r = E.createEvent(f);
      if (f.taskId) store.put('items', { id: f.taskId, eventLink: r.id });
      toast(r.calId === 'local' ? 'Event saved' : 'Event saved. Sending to Google…');
    } else {
      let scope = 'one';
      if (isInstance) {
        scope = await askScope('Edit repeating event');
        if (!scope) return false;
      }
      if (ev.calId === 'local' && ev.recurrence?.length && scope === 'one' && o.occ) {
        // detach this occurrence into its own event
        E.deleteEvent(ev, 'one', o.occ);
        E.createEvent({ ...f, recurrence: null });
      } else {
        E.updateEvent(ev, f, scope);
      }
      toast('Event updated');
    }
    sync.soon(300);
  };
  const del = async () => {
    let scope = 'one';
    if (isInstance) { scope = await askScope('Delete repeating event'); if (!scope) return false; }
    else if (!(await confirmSheet('Delete event?', `“${ev.summary}” will be removed${ev.calId !== 'local' ? ' from Google Calendar too' : ''}.`, 'Delete'))) return false;
    E.deleteEvent(ev, scope, o.occ);
    if (ev.taskId) store.put('items', { id: ev.taskId, eventLink: null });
    toast('Event deleted');
  };
  sheet(isNew ? 'New event' : 'Edit event', body, {
    wide: true,
    actions: [
      !isNew && { label: 'Delete', kind: 'danger', run: del },
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', run: save },
    ].filter(Boolean),
  });
  if (isNew) setTimeout(() => title.focus(), 50);
}

function askScope(t) {
  return new Promise((resolve) => {
    sheet(t, h('p', {}, 'Change only this event, or every event in the series?'), {
      actions: [
        { label: 'Cancel', run: () => resolve(null) },
        { label: 'This event', run: () => resolve('one') },
        { label: 'All events', kind: 'primary', run: () => resolve('all') },
      ],
      onClose: () => resolve(null),
    });
  });
}

function nextHalfHour() {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return D.hhmm(d);
}

// Turn a task into a calendar time block (stays linked to the task).
export function timeBlock(item) {
  if (item.eventLink) {
    const ev = store.get('events', item.eventLink);
    if (ev) return openEventEditor({ ev, start: E.evStart(ev), end: E.evEnd(ev) });
  }
  openEventEditor(null, { day: item.date || D.todayKey(), summary: item.title || 'Focus time', taskId: item.id });
}

// Tap the month name to jump to any month
function monthPicker(anchor) {
  let year = D.parseKey(calState.day).getFullYear();
  const curY = D.parseKey(calState.day).getFullYear(), curM = D.parseKey(calState.day).getMonth();
  const today = new Date();
  const box = h('div', { class: 'month-picker' });
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'mp-head' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Previous year', onclick: () => { year--; draw(); } }, icon('left', 18)),
        h('span', { class: 'mp-year' }, String(year)),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Next year', onclick: () => { year++; draw(); } }, icon('right', 18))),
      h('div', { class: 'mp-grid' }, D.MONTHS.map((m, i) => h('button', {
        class: ['mp-month', year === curY && i === curM ? 'on' : '', year === today.getFullYear() && i === today.getMonth() ? 'now' : ''].join(' '),
        onclick: () => { calState.day = D.key(new Date(year, i, 1)); calState.view = 'month'; saveCal(); closeMenu(); bus.rerender(); },
      }, m.slice(0, 3)))));
  };
  draw();
  menu(anchor, [{ el: box }]);
}
