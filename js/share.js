// Send a list to your phone as a text.
// Handwritten lines are turned into text, checked-off lines are skipped,
// then you see the message, can fix it, and tap Send text.
import { h, sheet, toast } from './ui.js';
import * as store from './store.js';
import * as model from './model.js';
import { recognize } from './ink.js';
import { rowOfStroke } from './views/checklist.js';

// Unchecked handwritten lines on a checklist page, as text, in order.
async function inkLines(inkId) {
  const rec = store.get('ink', inkId);
  if (!rec?.strokes?.length) return [];
  const checked = rec.checked || {};
  const sub = rec.sub || {};
  const rows = new Map();
  for (const s of rec.strokes) {
    if (s.tool === 'hl') continue;
    const r = rowOfStroke(s);
    if (checked[r]) continue;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(s);
  }
  const order = [...rows.keys()].sort((a, b) => a - b);
  const texts = await Promise.all(order.map((r) => recognize(rows.get(r)).catch(() => '')));
  return order.map((r, i) => ({ text: texts[i].trim(), sub: !!sub[r] })).filter((l) => l.text);
}

const typedLines = (items) => items.filter((i) => !i.done).map((i) => ({ text: i.title || i.text || '', sub: !!i.parentId })).filter((l) => l.text);

const fmt = (lines) => lines.map((l) => `${l.sub ? '   - ' : '- '}${l.text}`).join('\n');

// groups: [{ title, inkId, items }]
export async function sendToPhone(title, groups) {
  toast('Getting your list ready…');
  const parts = [];
  for (const g of groups) {
    const lines = [...typedLines(g.items || []), ...(await inkLines(g.inkId))];
    if (!lines.length) continue;
    parts.push(groups.length > 1 ? `${g.title}\n${fmt(lines)}` : fmt(lines));
  }
  if (!parts.length) { toast('Nothing left to send. Everything is checked off.'); return; }
  openSheet(`${title}\n\n${parts.join('\n\n')}`);
}

function openSheet(initial) {
  const s = model.settings();
  const phone = h('input', { type: 'tel', value: s.phone || '', placeholder: 'Your phone number', 'aria-label': 'Your phone number', autocomplete: 'tel' });
  const text = h('textarea', { class: 'send-text', 'aria-label': 'Message' });
  text.value = initial;
  const link = h('a', { class: 'btn primary', role: 'button' }, 'Send text');
  const sync = () => {
    const num = phone.value.replace(/[^\d+]/g, '');
    // iPad and iPhone open Messages with this. Your number makes it go to you.
    link.href = `sms:${num}&body=${encodeURIComponent(text.value)}`;
  };
  phone.addEventListener('input', () => { sync(); model.saveSettings({ phone: phone.value.trim() }); });
  text.addEventListener('input', sync);
  link.addEventListener('click', () => { model.saveSettings({ phone: phone.value.trim() }); setTimeout(() => ui.close(), 300); });
  sync();

  const more = h('button', { class: 'btn', onclick: async () => {
    try {
      if (navigator.share) await navigator.share({ text: text.value });
      else { await navigator.clipboard.writeText(text.value); toast('Copied'); }
    } catch {}
  } }, navigator.share ? 'Share another way' : 'Copy');

  const ui = sheet('Text to my phone', h('div', { class: 'send-sheet' },
    h('label', {}, 'Send to', phone),
    h('label', {}, 'Message', text),
    h('div', { class: 'send-actions' }, more, link)));
}
