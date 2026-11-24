// Send a list to your phone as a text.
// Handwritten lines are turned into text, checked-off lines are skipped,
// then you see the message, can fix it, and tap Send text.
import { h, sheet, toast } from './ui.js';
import * as store from './store.js';
import * as model from './model.js';
import { recognize } from './ink.js';
import * as G from './google.js';
import { ROW } from './views/checklist.js';

// Unchecked handwritten lines on a checklist page, as text, in order.
function bboxOf(st) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < st.pts.length; i += 3) { const x = st.pts[i], y = st.pts[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

async function inkLines(inkId) {
  const rec = store.get('ink', inkId);
  if (!rec?.strokes?.length) return [];
  const checked = rec.checked || {};
  const sub = rec.sub || {};
  // Group strokes into lines by where most of the ink sits (not the stroke's
  // top or bottom), so tails on g/y/p and tall letters stay on their line.
  const yMid = (st) => { const ys = []; for (let i = 1; i < st.pts.length; i += 3) ys.push(st.pts[i]); ys.sort((a, b) => a - b); return ys[ys.length >> 1]; };
  const rowOf = (st) => Math.max(0, Math.floor((yMid(st) - 12) / ROW));
  const ink = rec.strokes.filter((st) => st.tool !== 'hl' && st.pts.length >= 3);
  const big = [], small = [];
  for (const st of ink) { const bx = bboxOf(st); (bx.w < 14 && bx.h < 14 ? small : big).push([st, bx]); }
  const rows = new Map();
  const put = (r, st) => { if (checked[r]) return; if (!rows.has(r)) rows.set(r, []); rows.get(r).push(st); };
  const bigRows = big.map(([st, bx]) => [rowOf(st), bx]);
  big.forEach(([st], i) => put(bigRows[i][0], st));
  // Dots and crosses (i, j, t) belong to the closest word next to them, even if they sit over the line.
  for (const [st, bx] of small) {
    const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
    let best = rowOf(st), bestD = Infinity;
    for (const [r, b2] of bigRows) {
      if (cx < b2.x - 20 || cx > b2.x + b2.w + 20) continue;
      const d = Math.abs(cy - (b2.y + b2.h / 2));
      if (d < bestD) { bestD = d; best = r; }
    }
    put(best, st);
  }
  const order = [...rows.keys()].sort((a, b) => a - b);
  // Best: the AI reader looks at a picture of the lines. Fallback: the basic reader, line by line.
  let texts = await aiRead(order.map((r) => ({ r, strokes: rows.get(r) }))).catch(() => null);
  if (!texts) texts = await Promise.all(order.map((r) => recognize(rows.get(r)).catch(() => '')));
  return order.map((r, i) => ({ text: texts[i].trim(), sub: !!sub[r] })).filter((l) => l.text);
}

// Draws each line on its own white strip, stacked, and asks the AI reader.
const PAD = 18, SCALE = 1.4, X0 = 60;
function linesImage(list) {
  const stripH = Math.round((ROW + PAD * 2) * SCALE), gap = 10;
  const W = Math.round((1000 - X0) * SCALE);
  const c = document.createElement('canvas');
  c.width = W; c.height = list.length * (stripH + gap);
  const g = c.getContext('2d');
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, c.width, c.height);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
  list.forEach(({ r, strokes }, k) => {
    const top = k * (stripH + gap);
    g.fillStyle = '#fff'; g.fillRect(0, top, W, stripH);
    const y0 = 12 + r * ROW - PAD;
    for (const st of strokes) {
      g.lineWidth = Math.max(2.5, (st.w || 3) * SCALE * 0.9);
      g.beginPath();
      for (let i = 0; i < st.pts.length; i += 3) {
        const x = (st.pts[i] - X0) * SCALE, y = top + (st.pts[i + 1] - y0) * SCALE;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      if (st.pts.length === 3) g.lineTo((st.pts[0] - X0) * SCALE + 0.5, top + (st.pts[1] - y0) * SCALE);
      g.stroke();
    }
  });
  return c.toDataURL('image/png').split(',')[1];
}

async function aiRead(list) {
  const session = G.session();
  if (!session || !list.length) return null;
  const out = [];
  for (let i = 0; i < list.length; i += 20) { // 20 lines per picture keeps the text readable
    const part = list.slice(i, i + 20);
    const res = await fetch(`${G.authServer()}/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, image: linesImage(part), lines: part.length }),
    });
    if (!res.ok) return null;
    const { lines } = await res.json();
    if (!Array.isArray(lines) || lines.length !== part.length) return null;
    out.push(...lines);
  }
  return out;
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
