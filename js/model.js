// Planner data model: defaults, palettes, fonts, and the task rules (rollover etc).
import * as store from './store.js';
import { todayKey, diffDays } from './dates.js';

// ---------- palettes pulled from the inspiration board ----------
export const PALETTES = {
  retro: {
    name: 'Modern Retro', pattern: 'checker',
    paper: '#FAF6EF', ink: '#2F2B27', line: '#ECE4D6', backdrop: ['#C9D3C0', '#E6DCCB'],
    swatches: ['#D9663F', '#7E9C76', '#E2A93B', '#6F8FB3', '#D98B9C', '#7A4B6B', '#A9A3CF', '#8A8F4A'],
  },
  vibrant: {
    name: 'Vibrant', pattern: 'checker',
    paper: '#FBF4E6', ink: '#2B2320', line: '#E7D9C1', backdrop: ['#6F9A74', '#A9C4E2'],
    swatches: ['#E4572E', '#3E8E3E', '#EC6AA0', '#F39237', '#3D5DA8', '#7B1E2E', '#B9B4DE', '#F4C542'],
  },
  candy: {
    name: 'Candy Stripe', pattern: 'stripes',
    paper: '#FCF5EA', ink: '#3A1219', line: '#EED9CF', backdrop: ['#F4B6C2', '#B3263A'],
    swatches: ['#B3263A', '#7B1E2E', '#F4B6C2', '#E87A5D', '#F2C14E', '#5C7F4E', '#6C8EBF', '#2F2A44'],
  },
  pistachio: {
    name: 'Pistachio Pink', pattern: 'wobble',
    paper: '#FDF6EF', ink: '#2F3524', line: '#E9DCCD', backdrop: ['#F7CAD5', '#779A55'],
    swatches: ['#779A55', '#E78AA2', '#D9534F', '#F0A04B', '#4F7CAC', '#8E5BA6', '#3D4A2E', '#F2D16B'],
  },
  patchwork: {
    name: 'Papier Patchwork', pattern: 'patchwork',
    paper: '#FAF3E1', ink: '#2A2230', line: '#E8DCC4', backdrop: ['#BCB7E0', '#E8A0AC', '#EE8B3A', '#F5EDD6'],
    swatches: ['#EE8B3A', '#8E2C6B', '#D9415B', '#6A62B8', '#E8A0AC', '#5E8C4A', '#F2B33D', '#3B3355'],
  },
  dusty: {
    name: 'Dusty Blue', pattern: 'pinstripe',
    paper: '#F8F1E6', ink: '#4A2A24', line: '#E6D8C6', backdrop: ['#93A8BE', '#F3EADB', '#A0453A'],
    swatches: ['#A0453A', '#C9A24A', '#6E86A1', '#7F9C7A', '#D98A7A', '#5B4B7A', '#3E3A36', '#E0B7A8'],
  },
};

export const FONTS = {
  display: ['Playfair Display', 'Bodoni Moda', 'Fraunces', 'DM Serif Display', 'Gloock', 'Shrikhand'],
  body: ['Inter', 'DM Sans', 'Outfit', 'Fraunces', 'Space Grotesk', 'Caveat', 'Patrick Hand', 'Kalam', 'Gaegu'],
};
export const FONT_SIZES = [14, 16, 18, 20, 24, 28];
export const PAPERS = ['blank', 'lined', 'dotted', 'grid'];

export const SECTION_TYPES = {
  calendar: { label: 'Calendar', icon: '◷' },
  todos: { label: 'To-Dos', icon: '☑' },
  errands: { label: 'Errands', icon: '➜' },
  tobuy: { label: 'To Buy', icon: '◍' },
  notes: { label: 'Notes', icon: '✎' },
  voice: { label: 'Voice Notes', icon: '◉' },
  list: { label: 'List', icon: '☰' },
};

const DEFAULT_SECTIONS = [
  { id: 'calendar', type: 'calendar', name: 'Calendar', color: '#6F8FB3' },
  { id: 'todos', type: 'todos', name: 'To-Dos', color: '#D9663F' },
  { id: 'errands', type: 'errands', name: 'Errands', color: '#7E9C76' },
  { id: 'tobuy', type: 'tobuy', name: 'To Buy', color: '#E2A93B' },
  { id: 'notes', type: 'notes', name: 'Notes', color: '#D98B9C' },
  { id: 'voice', type: 'voice', name: 'Voice Notes', color: '#7A4B6B' },
];

export const DEFAULT_SETTINGS = {
  palette: 'retro',
  fontDisplay: 'Playfair Display',
  fontBody: 'Inter',
  fontSize: 18,
  paper: 'lined',
  fingerDraw: false,
  favColors: ['#2F2B27', '#D9663F', '#6F8FB3', '#7E9C76', '#D98B9C', '#E2A93B'],
  penPresets: [
    { id: 'p1', tool: 'pen', color: '#2F2B27', w: 2.2, name: 'Fine black' },
    { id: 'p2', tool: 'pen', color: '#6F8FB3', w: 3, name: 'Blue' },
    { id: 'p3', tool: 'pen', color: '#D9663F', w: 3.6, name: 'Terracotta' },
    { id: 'p4', tool: 'hl', color: '#F2CF6B', w: 14, name: 'Yellow highlight' },
    { id: 'p5', tool: 'hl', color: '#F1C3CC', w: 14, name: 'Pink highlight' },
  ],
  pen: { tool: 'pen', color: '#2F2B27', w: 2.2 },
  sectionStyles: {}, // sectionId -> {font,size,color,b,i}
  googleClientId: '',
  authServer: '', // always-connected server URL (see /server)
  hiddenCalendars: [],
  defaultCalendar: '',
  newTaskList: '', // Google Tasks list for new to-dos ('' = keep in planner only)
  hourStart: 7,
  hourEnd: 22,
};

export const DEFAULT_LAYOUT = {
  // Everything view: two pages like an open planner.
  left: ['calendar'],
  right: ['todos', 'errands', 'tobuy', 'notes'],
  split: 0.48, // left page width share (landscape)
  sizes: {}, // panelId -> flex-grow weight
  collapsed: {}, // panelId -> true
};

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(store.meta('settings', {}) || {}) };
}
export function saveSettings(patch) {
  store.setMeta('settings', { ...(store.meta('settings', {}) || {}), ...patch });
}
export function layout() {
  return { ...DEFAULT_LAYOUT, ...(store.meta('layout', {}) || {}) };
}
export function saveLayout(patch) {
  store.setMeta('layout', { ...(store.meta('layout', {}) || {}), ...patch });
}

export function seed() {
  if (!store.all('sections', true).length) {
    DEFAULT_SECTIONS.forEach((s, i) => store.put('sections', { ...s, order: i, hidden: false }, { silent: true }));
  }
  if (!store.all('stores', true).length) {
    ['Target', 'Trader Joe’s', 'Pharmacy'].forEach((name, i) =>
      store.put('stores', { id: store.uid(), name, order: i }, { silent: true }));
  }
}

export function sections({ includeHidden = false } = {}) {
  return store.all('sections')
    .filter((s) => includeHidden || !s.hidden)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export function section(id) { return store.get('sections', id); }
export function sectionByType(type) { return sections({ includeHidden: true }).find((s) => s.type === type); }
export function sectionStyle(sectionId) {
  const s = settings();
  return { font: s.fontBody, size: s.fontSize, color: '', ...(s.sectionStyles[sectionId] || {}) };
}

// ---------- items (to-dos, errands, to-buy, custom lists) ----------
export function newItem(fields) {
  const siblings = store.all('items').filter((i) => i.section === fields.section && !i.parentId);
  return store.put('items', {
    id: store.uid(),
    title: '',
    ink: null,
    style: {},
    date: null, // planned day "YYYY-MM-DD" (drives rollover)
    due: null, // due date (stays visible when overdue)
    priority: 0,
    parentId: null,
    done: false,
    completedAt: null,
    rollover: true,
    store: null,
    order: (siblings.reduce((m, i) => Math.max(m, i.order ?? 0), 0) || 0) + 1,
    notes: '',
    createdAt: Date.now(),
    ...fields,
  });
}

export function setDone(item, done) {
  store.put('items', {
    id: item.id,
    done,
    completedAt: done ? todayKey() : null,
    gDirty: item.g ? true : undefined,
  });
}

export function children(id) {
  return store.all('items').filter((i) => i.parentId === id).sort(byOrder);
}
export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// Rollover rule, computed (never copied), so an item can't duplicate:
//  - an unfinished item planned for an earlier day shows on every day from its
//    planned date up to today, until it is completed or rescheduled
//  - finished items show only on the day they were completed (history)
//  - items with rollover turned off stay on their own day
export function itemsForDay(sectionId, day, today = todayKey()) {
  return store.all('items').filter((i) => {
    if (i.parentId) return false;
    if (sectionId && i.section !== sectionId) return false;
    return showsOnDay(i, day, today);
  }).sort(dayOrder);
}
export function showsOnDay(i, day, today = todayKey()) {
  if (i.done) return i.completedAt === day;
  if (!i.date) return false;
  if (i.date === day) return true;
  if (i.rollover === false) return false;
  return i.date < day && day <= today;
}
export function carriedFrom(i, day) {
  if (!i.done && i.date && i.date < day) return diffDays(i.date, day);
  return 0;
}
export function isOverdue(i, today = todayKey()) {
  return !i.done && !!i.due && i.due < today;
}
function dayOrder(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
  return byOrder(a, b);
}

// Main list of a section: everything unfinished, plus things finished in the last 2 days.
export function sectionItems(sectionId, today = todayKey()) {
  return store.all('items').filter((i) => {
    if (i.section !== sectionId || i.parentId) return false;
    if (!i.done) return true;
    return i.completedAt && diffDays(i.completedAt, today) <= 1;
  }).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return byOrder(a, b);
  });
}

export function storesSorted() {
  return store.all('stores').sort(byOrder);
}
