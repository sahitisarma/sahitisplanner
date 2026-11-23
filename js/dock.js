// The floating pen dock: tools, presets, colors, thickness, undo/redo,
// and selection actions (recolor, resize, convert to text, delete).
import { h, toast, menu, colorRow, debounce, fill } from './ui.js';
import { Pen, History, onSelection, recognize } from './ink.js';
import { colorMixer } from './colorpicker.js';
import * as model from './model.js';

const TOOLS = [
  { id: 'pen', label: 'Pen', icon: penIcon() },
  { id: 'hl', label: 'Highlighter', icon: hlIcon() },
  { id: 'eraser', label: 'Eraser', icon: eraserIcon() },
  { id: 'select', label: 'Lasso select', icon: lassoIcon() },
];

const savePen = debounce(() => {
  model.saveSettings({ pen: { tool: Pen.tool === 'eraser' || Pen.tool === 'select' ? 'pen' : Pen.tool, color: Pen.color, w: Pen.w } });
}, 800);

const SIZES = { pen: [1.2, 2, 3, 4.5, 7], hl: [8, 12, 16, 22, 30] };

export function mountDock(host, { onCapture, onFocus }) {
  const s = model.settings();
  Pen.set({ ...s.pen, fingerDraw: !!s.fingerDraw });

  const root = h('div', { class: 'dock', role: 'toolbar', 'aria-label': 'Pen tools' });
  host.append(root);

  const draw = () => {
    const st = model.settings();
    const sel = currentSel;
    if (sel) {
      fill(root,
        h('span', { class: 'dock-label' }, 'Selection'),
        colorRow(st.favColors, null, (c) => sel.surface.recolorSelection(c)),
        h('span', { class: 'dock-sep' }),
        h('button', { class: 'dock-btn', 'aria-label': 'Smaller', onclick: () => sel.surface.resizeSelection(0.85) }, 'A−'),
        h('button', { class: 'dock-btn', 'aria-label': 'Larger', onclick: () => sel.surface.resizeSelection(1.18) }, 'A+'),
        h('button', { class: 'dock-btn text', onclick: () => convert(sel.surface) }, 'To text'),
        h('button', { class: 'dock-btn text danger', onclick: () => sel.surface.deleteSelection() }, 'Delete'),
        h('button', { class: 'dock-btn text', onclick: () => sel.surface.clearSelection() }, 'Done'),
      );
      return;
    }
    const kind = Pen.tool === 'hl' ? 'hl' : 'pen';
    const showSizes = Pen.tool === 'pen' || Pen.tool === 'hl' || Pen.tool === 'eraser';
    const sizes = Pen.tool === 'eraser' ? SIZES.pen : SIZES[kind];
    fill(root,
      h('div', { class: 'dock-group' }, TOOLS.map((t) => h('button', {
        class: `dock-btn tool ${Pen.tool === t.id ? 'on' : ''}`, 'aria-label': t.label, title: t.label,
        onclick: () => { Pen.set({ tool: t.id, ...(t.id === 'hl' && Pen.w < 6 ? { w: 14 } : {}), ...(t.id === 'pen' && Pen.w > 10 ? { w: 2.2 } : {}) }); savePen(); draw(); },
      }, t.icon))),
      h('span', { class: 'dock-sep' }),
      showSizes ? h('div', { class: 'dock-group sizes', role: 'radiogroup', 'aria-label': 'Pencil size' }, sizes.map((w, i) => h('button', {
        class: `size-dot ${Math.abs(Pen.w - w) < 0.05 ? 'on' : ''}`, 'aria-label': `Size ${i + 1}`, title: `Size ${i + 1}`,
        onclick: () => { Pen.set({ w }); savePen(); draw(); },
      }, h('i', { style: { width: `${6 + i * 3.5}px`, height: `${6 + i * 3.5}px`, background: Pen.tool === 'eraser' ? 'var(--muted)' : Pen.color, opacity: kind === 'hl' ? 0.55 : 1 } })))) : null,
      h('span', { class: 'dock-sep' }),
      h('div', { class: 'dock-group colors' },
        st.favColors.slice(0, 5).map((c) => h('button', {
          class: `color-dot ${Pen.color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`, style: { '--dot': c }, 'aria-label': `Color ${c}`,
          onclick: () => { Pen.set({ color: c, ...(Pen.tool === 'eraser' || Pen.tool === 'select' ? { tool: 'pen' } : {}) }); savePen(); draw(); },
        })),
        h('button', { class: 'color-dot mix', 'aria-label': 'More colors and sizes', title: 'More colors and sizes', onclick: (e) => penMenu(e.currentTarget, draw) })),
      h('span', { class: 'dock-sep' }),
      h('button', { class: 'dock-btn', 'aria-label': 'Undo', title: 'Undo', disabled: !History.undoStack.length, onclick: () => History.undo() }, undoIcon()),
      h('button', { class: 'dock-btn', 'aria-label': 'Redo', title: 'Redo', disabled: !History.redoStack.length, onclick: () => History.redo() }, redoIcon()),
      h('span', { class: 'dock-sep' }),
      h('button', { class: 'dock-btn capture', 'aria-label': 'Quick capture', title: 'Quick capture', onclick: () => onCapture() }, micIcon()),
      onFocus ? h('button', { class: 'dock-btn', 'aria-label': 'Focus mode', title: 'Focus mode: hide everything but the page', onclick: () => onFocus() }, focusIcon()) : null,
    );
  };

  let currentSel = null;
  onSelection((sl) => { currentSel = sl; draw(); });
  History.on(draw);
  draw();
  return { redraw: draw };
}

function penMenu(anchor, redraw) {
  const st = model.settings();
  const isHl = Pen.tool === 'hl';
  const pv = h('div', { class: 'pen-preview' });
  const preview = () => { pv.style.background = Pen.color; pv.style.height = `${Math.max(2, Pen.w * (isHl ? 0.8 : 1.4))}px`; pv.style.opacity = isHl ? 0.45 : 1; };
  const width = h('input', { type: 'range', min: isHl ? 6 : 0.6, max: isHl ? 40 : 14, step: 0.2, value: Pen.w, 'aria-label': 'Size',
    oninput: (e) => { Pen.set({ w: Number(e.target.value) }); savePen(); preview(); redraw(); } });
  width.style.setProperty('--track', 'linear-gradient(90deg, var(--line), var(--edge-strong))');
  preview();
  const palette = model.PALETTES[st.palette] || model.PALETTES.winner;
  const setColor = (c) => { Pen.set({ color: c, ...(Pen.tool === 'eraser' || Pen.tool === 'select' ? { tool: 'pen' } : {}) }); savePen(); preview(); redraw(); };
  menu(anchor, [
    { el: h('div', { class: 'menu-block' }, h('div', { class: 'menu-label' }, 'Size'), width, pv) },
    { el: h('div', { class: 'menu-block' }, h('div', { class: 'menu-label' }, 'Favorites'), colorRow(st.favColors, Pen.color, setColor, { custom: false })) },
    { el: h('div', { class: 'menu-block' }, h('div', { class: 'menu-label' }, palette.name), colorRow(palette.swatches, Pen.color, setColor, { custom: false })) },
    { el: h('div', { class: 'menu-block' }, h('div', { class: 'menu-label' }, 'Mix any color'), colorMixer(Pen.color, setColor)) },
    '-',
    { label: 'Add this color to favorites', icon: '♥', run: () => {
      const fav = [...new Set([Pen.color, ...st.favColors])].slice(0, 10);
      model.saveSettings({ favColors: fav }); toast('Saved to favorites'); redraw();
    } },
    { label: 'Save this pen as a preset', icon: '★', run: () => {
      const tool = Pen.tool === 'hl' ? 'hl' : 'pen';
      const p = { id: `p${Date.now()}`, tool, color: Pen.color, w: Pen.w, name: `${tool === 'hl' ? 'Highlighter' : 'Pen'} ${Pen.color}` };
      model.saveSettings({ penPresets: [...st.penPresets, p].slice(-8) }); toast('Preset saved'); redraw();
    } },
    st.penPresets.length ? { el: h('div', { class: 'menu-block' }, h('div', { class: 'menu-label' }, 'Presets'),
      h('div', { class: 'preset-row' }, st.penPresets.map((p) => h('button', { class: 'preset', title: p.name, 'aria-label': p.name,
        onclick: () => { Pen.set({ tool: p.tool, color: p.color, w: p.w }); savePen(); redraw(); preview(); } },
      h('span', { class: `preset-ink ${p.tool}`, style: { background: p.color, height: `${Math.min(14, Math.max(3, p.w * (p.tool === 'hl' ? 0.8 : 1.4)))}px` } }))))) } : null,
  ]);
}

function presetMenu(anchor, p, redraw) {
  menu(anchor, [
    { label: 'Remove preset', danger: true, run: () => {
      model.saveSettings({ penPresets: model.settings().penPresets.filter((x) => x.id !== p.id) }); redraw();
    } },
  ]);
}

async function convert(surface) {
  const strokes = surface.selectedStrokes();
  toast('Converting handwriting…', { ms: 1500 });
  try {
    const text = await recognize(strokes);
    if (!text) { toast('Could not read that. Try writing a little larger.'); return; }
    if (surface.opts.onConvert) {
      surface.opts.onConvert(text, surface);
    } else {
      try { await navigator.clipboard.writeText(text); } catch {}
      toast(`“${text}” copied`);
    }
  } catch {
    toast('Handwriting to text needs an internet connection.');
  }
}

// ---------- icons (inline SVG) ----------
function svg(path, vb = '0 0 24 24') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', vb); s.setAttribute('width', '22'); s.setAttribute('height', '22');
  s.innerHTML = path;
  return s;
}
function penIcon() { return svg('<path d="M4 20l1.2-4.6L15.5 5.1a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 7l3.5 3.5" stroke="currentColor" stroke-width="1.8"/>'); }
function hlIcon() { return svg('<path d="M6 15l7-11 6 4-7 11z" fill="currentColor" opacity=".25"/><path d="M6 15l7-11 6 4-7 11zM6 15l-2 5h5l3-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'); }
function eraserIcon() { return svg('<path d="M8 20h12M4.5 15.5l9-9a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19H8.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'); }
function lassoIcon() { return svg('<ellipse cx="12" cy="9.5" rx="8" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.5"/><path d="M7 14c-1 2 0 4 2 5" fill="none" stroke="currentColor" stroke-width="1.8"/>'); }
function undoIcon() { return svg('<path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -3)"/>'); }
function redoIcon() { return svg('<path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -3)"/>'); }
function focusIcon() { return svg('<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'); }
export function micIcon() { return svg('<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'); }
