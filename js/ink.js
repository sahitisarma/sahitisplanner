// Handwriting engine.
// - Apple Pencil writes immediately (no mode button). Fingers scroll and tap.
// - Ink is stored as vectors in a 1000-unit-wide coordinate space, so it stays
//   attached to its page or item when the iPad rotates, zooms, or resizes.
// - Pen, highlighter, eraser, lasso select (move, resize, recolor), undo/redo.

export const LOGICAL_W = 1000;

// ---------- shared pen state ----------
const penListeners = new Set();
export const Pen = {
  tool: 'pen', // pen | hl | eraser | select
  color: '#2B2320',
  w: 2.2,
  ew: 14, // eraser size (logical units)
  fingerDraw: false,
  set(patch) { Object.assign(this, patch); penListeners.forEach((f) => f(this)); },
  on(f) { penListeners.add(f); return () => penListeners.delete(f); },
};

// ---------- global undo / redo across all surfaces ----------
export const History = {
  undoStack: [], redoStack: [], listeners: new Set(),
  push(entry) { this.undoStack.push(entry); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; this.emit(); },
  undo() { const e = this.undoStack.pop(); if (!e) return; e.undo(); this.redoStack.push(e); this.emit(); },
  redo() { const e = this.redoStack.pop(); if (!e) return; e.redo(); this.undoStack.push(e); this.emit(); },
  emit() { this.listeners.forEach((f) => f(this)); },
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); },
};

const r1 = (n) => Math.round(n * 10) / 10;
let strokeSeq = 0;
const sid = () => `s${Date.now().toString(36)}${(strokeSeq++).toString(36)}`;
const clone = (strokes) => strokes.map((s) => ({ ...s, pts: s.pts.slice() }));

// ---------- rendering ----------
export function drawStroke(ctx, s, scale) {
  const p = s.pts;
  if (!p || p.length < 3) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === 'hl') {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'butt';
    ctx.lineWidth = s.w * scale;
    ctx.beginPath();
    ctx.moveTo(p[0] * scale, p[1] * scale);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i] * scale, p[i + 1] * scale);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (p.length === 3) { // a dot
    ctx.beginPath();
    ctx.arc(p[0] * scale, p[1] * scale, Math.max(0.6, s.w * scale * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Variable width from Pencil pressure, smoothed with midpoint curves.
  const wAt = (i) => s.w * scale * (0.45 + 0.9 * (p[i + 2] ?? 0.5));
  let px = p[0] * scale, py = p[1] * scale;
  for (let i = 3; i < p.length; i += 3) {
    const x = p[i] * scale, y = p[i + 1] * scale;
    const mx = (px + x) / 2, my = (py + y) / 2;
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.5, wAt(i));
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px, py, mx, my);
    ctx.lineTo(x, y);
    ctx.stroke();
    px = x; py = y;
  }
  ctx.restore();
}

export function bbox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const pad = s.w / 2 + 1;
    for (let i = 0; i < s.pts.length; i += 3) {
      const x = s.pts[i], y = s.pts[i + 1];
      if (x - pad < x0) x0 = x - pad; if (y - pad < y0) y0 = y - pad;
      if (x + pad > x1) x1 = x + pad; if (y + pad > y1) y1 = y + pad;
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Render strokes into a fresh canvas (for previews / thumbnails)
export function thumbnail(strokes, widthPx, logicalW = LOGICAL_W, logicalH) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = widthPx / logicalW;
  const hPx = (logicalH ?? ((bbox(strokes)?.y || 0) + (bbox(strokes)?.h || 40))) * scale;
  const c = document.createElement('canvas');
  c.width = Math.ceil(widthPx * dpr); c.height = Math.ceil(hPx * dpr);
  c.style.width = `${widthPx}px`; c.style.height = `${hPx}px`;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  for (const s of strokes) drawStroke(ctx, s, scale);
  return c;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Keep track of every live surface so the dock can act on the active selection.
const surfaces = new Set();
export let activeSelection = null; // { surface }
const selListeners = new Set();
export function onSelection(f) { selListeners.add(f); return () => selListeners.delete(f); }
function emitSel() { selListeners.forEach((f) => f(activeSelection)); }

// ---------- InkSurface ----------
// opts:
//   strokes: initial strokes
//   onChange(strokes): called after every change (autosave hook)
//   mode: 'aspect' (height follows width * logicalH) | 'fill' (host decides size)
//   logicalH: logical height for 'aspect' mode
//   grow: auto-extend height as you write near the bottom ('aspect' mode)
//   minH: minimum logical height when growing
//   onStrokeEnd(surface): after each stroke
//   label: accessible name
export class InkSurface {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = { mode: 'aspect', logicalH: 120, grow: false, minH: 120, ...opts };
    this.strokes = clone(opts.strokes || []);
    this.logicalH = this.opts.logicalH;
    if (this.opts.grow) this.logicalH = Math.max(this.opts.minH, this.contentBottom() + 160);
    // Whiteboards can also grow sideways: the page is logicalW units wide.
    this.logicalW = this.opts.logicalW || LOGICAL_W;
    if (this.opts.growX) { const b = bbox(this.strokes); if (b) this.logicalW = Math.max(this.logicalW, b.x + b.w + 400); }
    host.classList.add('ink-host');
    if (this.opts.label) host.setAttribute('aria-label', this.opts.label);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ink-canvas';
    this.live = document.createElement('canvas');
    this.live.className = 'ink-canvas live';
    host.append(this.canvas, this.live);
    this.ctx = this.canvas.getContext('2d');
    this.lctx = this.live.getContext('2d');
    this.scale = 1;
    this.cur = null;
    this.sel = null; // { ids:Set, box, el }
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    surfaces.add(this);
    this.resize();
  }

  contentBottom() { const b = bbox(this.strokes); return b ? b.y + b.h : 0; }

  setStrokes(strokes, { silent = true } = {}) {
    // Called when data changes elsewhere (sync). Keep selection out of it.
    if (this.cur) return; // never interrupt active writing
    this.clearSelection();
    this.strokes = clone(strokes || []);
    if (this.opts.grow) this.logicalH = Math.max(this.opts.minH, this.contentBottom() + 160, this.logicalH);
    this.resize();
    if (!silent) this.opts.onChange?.(this.strokes);
  }

  resize() {
    const w = this.host.clientWidth;
    if (!w) return;
    this.scale = w / this.logicalW;
    this.host.style.setProperty('--u', `${this.scale}px`);
    let hPx;
    if (this.opts.mode === 'aspect') {
      hPx = this.logicalH * this.scale;
      this.host.style.height = `${hPx}px`;
    } else {
      hPx = this.host.clientHeight;
      this.logicalH = hPx / this.scale;
    }
    // Keep canvases inside iPad Safari's memory limits, even when zoomed in.
    const MAX_PX = 9_000_000;
    const dpr = Math.max(0.75, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(MAX_PX / Math.max(1, w * hPx))));
    for (const c of [this.canvas, this.live]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(hPx * dpr));
      c.style.width = `${w}px`; c.style.height = `${hPx}px`;
    }
    this.dpr = dpr;
    this.redraw();
    this.opts.onResize?.(this);
    if (this.sel) this.placeSelBox();
  }

  redraw() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes) drawStroke(ctx, s, this.scale);
  }

  toLogical(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale];
  }

  bind() {
    // Overlays (month grid, day timeline) listen on the content underneath so
    // fingers and mouse clicks still reach the calendar; only the Pencil writes.
    const host = this.opts.eventTarget || this.host;
    if (this.opts.eventTarget) {
      this.host.classList.add('overlay');
      host.addEventListener('click', (e) => {
        if (this.justWrote) { e.stopPropagation(); e.preventDefault(); }
      }, true);
    }
    // Stop Safari from scrolling/selecting when the Pencil touches down, so the
    // pointer stream stays ours. Finger touches are left alone (they scroll).
    const stylusGuard = (e) => {
      for (const t of e.changedTouches) {
        if (t.touchType === 'stylus' || (Pen.fingerDraw && !this.opts.readonly)) { e.preventDefault(); return; }
      }
    };
    host.addEventListener('touchstart', stylusGuard, { passive: false });
    host.addEventListener('touchmove', stylusGuard, { passive: false });
    host.addEventListener('pointerdown', (e) => this.down(e));
    host.addEventListener('pointermove', (e) => this.move(e));
    host.addEventListener('pointerup', (e) => this.up(e));
    host.addEventListener('pointercancel', (e) => this.up(e, true));
    host.addEventListener('contextmenu', (e) => { if (this.cur) e.preventDefault(); });
    host.addEventListener('lostpointercapture', (e) => { if (this.cur && e.pointerId === this.cur.pid) this.up(e); });
  }

  canWrite(e) {
    if (this.opts.readonly) return false;
    if (e.pointerType === 'pen') return true;
    if (this.opts.penOnly) return false;
    if (e.pointerType === 'mouse') return e.button === 0;
    return Pen.fingerDraw; // touch: palm rejection by default
  }

  down(e) {
    if (!this.canWrite(e)) return;
    if (e.target.closest('.sel-box, .cl-box')) return; // selection handles and checkboxes handle themselves
    if (this.opts.eventTarget && e.target.closest('button, input, select, textarea, a, [contenteditable]') && Pen.tool !== 'select' && e.pointerType !== 'pen') return;
    e.preventDefault();
    e.stopPropagation();
    const eraserEnd = e.button === 5 || (e.buttons & 32) === 32;
    const tool = eraserEnd ? 'eraser' : Pen.tool;
    // Writing outside the current selection clears it
    if (this.sel && tool !== 'select') this.clearSelection();
    for (const s of surfaces) if (s !== this && s.sel) s.clearSelection();
    try { (this.opts.eventTarget || this.host).setPointerCapture(e.pointerId); } catch {}
    const [x, y] = this.toLogical(e);
    this.cur = { tool, pid: e.pointerId, before: clone(this.strokes) };
    if (tool === 'pen' || tool === 'hl') {
      this.cur.stroke = { id: sid(), tool, color: Pen.color, w: tool === 'hl' ? Math.max(8, Pen.w) : Pen.w, pts: [r1(x), r1(y), r1(e.pressure || 0.5)] };
    } else if (tool === 'eraser') {
      this.cur.erased = false;
      this.cur.ex = x; this.cur.ey = y;
      this.eraseAt(x, y);
    } else if (tool === 'select') {
      this.clearSelection();
      this.cur.poly = [x, y];
    }
    this.host.classList.add('writing');
  }

  move(e) {
    const c = this.cur;
    if (!c || e.pointerId !== c.pid) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = this.toLogical(ev);
      if (c.stroke) {
        const p = c.stroke.pts;
        const lx = p[p.length - 3], ly = p[p.length - 2];
        if (Math.hypot(x - lx, y - ly) < 0.6) continue;
        p.push(r1(x), r1(y), r1(ev.pressure || 0.5));
      } else if (c.tool === 'eraser') {
        // fill in the path between samples so fast rubs don't skip
        const step = Math.max(2, Pen.ew / 3);
        const d = Math.hypot(x - c.ex, y - c.ey);
        const n = Math.max(1, Math.ceil(d / step));
        for (let k = 1; k <= n; k++) this.eraseAt(c.ex + ((x - c.ex) * k) / n, c.ey + ((y - c.ey) * k) / n);
        c.ex = x; c.ey = y;
      } else if (c.poly) {
        c.poly.push(x, y);
      }
    }
    this.drawLive();
    if (c.stroke && (this.opts.grow || this.opts.growX)) this.maybeGrow(c.stroke.pts[c.stroke.pts.length - 2], c.stroke.pts[c.stroke.pts.length - 3]);
  }

  maybeGrow(y, x = 0) {
    let grew = false;
    if (this.opts.grow && y > this.logicalH - 80) { this.logicalH += this.opts.growX ? 600 : 300; grew = true; }
    if (this.opts.growX && x > this.logicalW - 120) {
      this.logicalW += 800;
      this.opts.onGrowX?.(this.logicalW); // the page gets wider; ink keeps its size
      grew = true;
    }
    if (grew) { this.resize(); this.drawLive(); }
  }

  drawLive() {
    const { lctx } = this;
    lctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    lctx.clearRect(0, 0, this.live.width, this.live.height);
    const c = this.cur;
    if (!c) return;
    if (c.stroke) drawStroke(lctx, c.stroke, this.scale);
    if (c.tool === 'eraser' && c.ex != null) {
      lctx.save();
      lctx.strokeStyle = 'rgba(58,28,34,.45)';
      lctx.lineWidth = 1;
      lctx.beginPath();
      lctx.arc(c.ex * this.scale, c.ey * this.scale, (Pen.ew / 2) * this.scale, 0, Math.PI * 2);
      lctx.stroke();
      lctx.restore();
    }
    if (c.poly && c.poly.length > 2) {
      lctx.save();
      lctx.setLineDash([6, 5]);
      lctx.strokeStyle = '#3D5DA8';
      lctx.lineWidth = 1.5;
      lctx.fillStyle = 'rgba(61,93,168,0.07)';
      lctx.beginPath();
      lctx.moveTo(c.poly[0] * this.scale, c.poly[1] * this.scale);
      for (let i = 2; i < c.poly.length; i += 2) lctx.lineTo(c.poly[i] * this.scale, c.poly[i + 1] * this.scale);
      lctx.closePath();
      lctx.fill(); lctx.stroke();
      lctx.restore();
    }
  }

  up(e, cancelled = false) {
    const c = this.cur;
    if (!c || e.pointerId !== c.pid) return;
    this.cur = null;
    this.host.classList.remove('writing');
    this.justWrote = true;
    setTimeout(() => { this.justWrote = false; }, 350);
    try { (this.opts.eventTarget || this.host).releasePointerCapture(e.pointerId); } catch {}
    this.lctx.clearRect(0, 0, this.live.width, this.live.height);
    if (c.stroke) {
      if (cancelled && c.stroke.pts.length < 6) return;
      this.strokes.push(c.stroke);
      drawStroke(this.ctx, c.stroke, this.scale);
      this.commit(c.before);
      this.opts.onStrokeEnd?.(this);
    } else if (c.tool === 'eraser') {
      if (c.erased) this.commit(c.before);
    } else if (c.poly) {
      this.selectPoly(c.poly);
    }
  }

  commit(before) {
    const after = clone(this.strokes);
    const self = this;
    History.push({
      undo() { self.applyHistory(before); },
      redo() { self.applyHistory(after); },
    });
    this.opts.onChange?.(this.strokes);
  }

  applyHistory(strokes) {
    this.clearSelection();
    this.strokes = clone(strokes);
    this.redraw();
    // If this surface was re-rendered away, ask the app to refresh the view.
    this.opts.onChange?.(this.strokes, { loud: !this.host.isConnected });
  }

  // Pixel eraser: removes only the ink under the eraser, splitting strokes.
  eraseAt(x, y) {
    const r = Pen.ew / 2;
    let changed = false;
    const out = [];
    for (const s of this.strokes) {
      const reach = r + s.w * 0.4;
      // quick reject by bounding box
      let near = false;
      for (let i = 0; i < s.pts.length; i += 3) {
        if (Math.abs(s.pts[i] - x) < reach + 30 && Math.abs(s.pts[i + 1] - y) < reach + 30) { near = true; break; }
      }
      if (!near) { out.push(s); continue; }
      // make the stroke dense enough that the eraser can cut between far-apart points
      const pts = [];
      const p = s.pts;
      for (let i = 0; i < p.length; i += 3) {
        if (i > 0) {
          const dx = p[i] - p[i - 3], dy = p[i + 1] - p[i - 2];
          const gap = Math.hypot(dx, dy);
          const n = Math.floor(gap / Math.max(1, r / 2));
          for (let k = 1; k < n; k++) pts.push(p[i - 3] + (dx * k) / n, p[i - 2] + (dy * k) / n, p[i + 2]);
        }
        pts.push(p[i], p[i + 1], p[i + 2]);
      }
      let run = [];
      const runs = [];
      let hit = false;
      for (let i = 0; i < pts.length; i += 3) {
        if (Math.hypot(pts[i] - x, pts[i + 1] - y) < reach) { hit = true; if (run.length) runs.push(run); run = []; }
        else run.push(r1(pts[i]), r1(pts[i + 1]), pts[i + 2]);
      }
      if (run.length) runs.push(run);
      if (!hit) { out.push(s); continue; }
      changed = true;
      for (const rn of runs) if (rn.length >= 6) out.push({ ...s, id: sid(), pts: rn });
    }
    if (changed) { this.strokes = out; this.cur.erased = true; this.redraw(); }
  }

  // ----- selection -----
  selectPoly(poly) {
    if (poly.length < 6) return;
    const ids = new Set();
    for (const s of this.strokes) {
      let inside = 0, n = 0;
      for (let i = 0; i < s.pts.length; i += 3) { n++; if (pointInPoly(s.pts[i], s.pts[i + 1], poly)) inside++; }
      if (n && inside / n >= 0.5) ids.add(s.id);
    }
    if (!ids.size) return;
    this.sel = { ids };
    this.buildSelBox();
    activeSelection = { surface: this };
    emitSel();
  }

  selectedStrokes() { return this.sel ? this.strokes.filter((s) => this.sel.ids.has(s.id)) : []; }

  buildSelBox() {
    const el = document.createElement('div');
    el.className = 'sel-box';
    el.innerHTML = '<span class="sel-handle" aria-label="Resize"></span>';
    this.host.append(el);
    this.sel.el = el;
    this.placeSelBox();
    // drag to move (pen, finger or mouse), handle to resize
    let drag = null;
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const box = bbox(this.selectedStrokes());
      drag = { x: e.clientX, y: e.clientY, before: clone(this.strokes), resize: e.target.classList.contains('sel-handle'), box, orig: clone(this.selectedStrokes()) };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / this.scale, dy = (e.clientY - drag.y) / this.scale;
      const orig = new Map(drag.orig.map((s) => [s.id, s]));
      if (drag.resize) {
        const k = Math.max(0.2, (drag.box.w + dx) / drag.box.w);
        this.strokes = this.strokes.map((s) => {
          const o = orig.get(s.id); if (!o) return s;
          const pts = o.pts.slice();
          for (let i = 0; i < pts.length; i += 3) { pts[i] = r1(drag.box.x + (pts[i] - drag.box.x) * k); pts[i + 1] = r1(drag.box.y + (pts[i + 1] - drag.box.y) * k); }
          return { ...s, pts, w: r1(o.w * Math.sqrt(k)) };
        });
      } else {
        this.strokes = this.strokes.map((s) => {
          const o = orig.get(s.id); if (!o) return s;
          const pts = o.pts.slice();
          for (let i = 0; i < pts.length; i += 3) { pts[i] = r1(pts[i] + dx); pts[i + 1] = r1(pts[i + 1] + dy); }
          return { ...s, pts };
        });
      }
      this.redraw();
      this.placeSelBox();
    });
    const end = () => { if (drag) { if (this.opts.grow) { this.logicalH = Math.max(this.logicalH, this.contentBottom() + 160); this.resize(); } this.commit(drag.before); drag = null; } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  placeSelBox() {
    const b = bbox(this.selectedStrokes());
    if (!b || !this.sel?.el) return;
    Object.assign(this.sel.el.style, {
      left: `${(b.x - 6) * this.scale}px`, top: `${(b.y - 6) * this.scale}px`,
      width: `${(b.w + 12) * this.scale}px`, height: `${(b.h + 12) * this.scale}px`,
    });
  }

  clearSelection() {
    if (!this.sel) return;
    this.sel.el?.remove();
    this.sel = null;
    if (activeSelection?.surface === this) { activeSelection = null; emitSel(); }
  }

  recolorSelection(color) {
    if (!this.sel) return;
    const before = clone(this.strokes);
    this.strokes = this.strokes.map((s) => (this.sel.ids.has(s.id) ? { ...s, color } : s));
    this.redraw();
    this.commit(before);
  }
  resizeSelection(k) {
    if (!this.sel) return;
    const before = clone(this.strokes);
    const b = bbox(this.selectedStrokes());
    this.strokes = this.strokes.map((s) => {
      if (!this.sel.ids.has(s.id)) return s;
      const pts = s.pts.slice();
      for (let i = 0; i < pts.length; i += 3) { pts[i] = r1(b.x + (pts[i] - b.x) * k); pts[i + 1] = r1(b.y + (pts[i + 1] - b.y) * k); }
      return { ...s, pts, w: r1(s.w * Math.sqrt(k)) };
    });
    this.redraw(); this.placeSelBox();
    this.commit(before);
  }
  deleteSelection() {
    if (!this.sel) return;
    const before = clone(this.strokes);
    const ids = this.sel.ids;
    this.clearSelection();
    this.strokes = this.strokes.filter((s) => !ids.has(s.id));
    this.redraw();
    this.commit(before);
  }
  takeSelection() { // remove and return the selected strokes (for "move to...")
    const picked = clone(this.selectedStrokes());
    this.deleteSelection();
    return picked;
  }

  clear() {
    const before = clone(this.strokes);
    this.strokes = [];
    this.redraw();
    this.commit(before);
  }

  destroy() {
    this.ro.disconnect();
    this.clearSelection();
    surfaces.delete(this);
  }
}

// Move strokes so their top-left sits at (pad, pad); used when a pad turns into an item.
export function cropStrokes(strokes, pad = 8) {
  const b = bbox(strokes);
  if (!b) return { strokes: [], h: 0, w: 0 };
  const dx = pad - b.x, dy = pad - b.y;
  return {
    strokes: strokes.map((s) => {
      const pts = s.pts.slice();
      for (let i = 0; i < pts.length; i += 3) { pts[i] = r1(pts[i] + dx); pts[i + 1] = r1(pts[i + 1] + dy); }
      return { ...s, pts };
    }),
    w: b.w + pad * 2,
    h: b.h + pad * 2,
  };
}

// Optional handwriting-to-text. Only runs when you ask for it.
// Uses Google's public handwriting recognizer (the one behind Google Input Tools).
export async function recognize(strokes) {
  const ink0 = strokes.filter((st) => st.tool !== 'hl' && st.pts.length >= 3);
  const b = bbox(ink0);
  if (!b) return '';
  // Page units are small (a word is ~30 units tall), so scale up before
  // rounding, or the letters lose their shape. Also add stroke timing: the
  // reader is much more accurate when it knows the order and speed of writing.
  const S = Math.max(1, Math.min(6, 80 / Math.max(10, b.h)));
  let t = 0;
  const ink = ink0.map((st) => {
    const xs = [], ys = [], ts = [];
    let px = null, py = null;
    for (let i = 0; i < st.pts.length; i += 3) {
      const x = Math.round((st.pts[i] - b.x) * S), y = Math.round((st.pts[i + 1] - b.y) * S);
      // keep points about 4px apart: long lines with too many points get cut off by the reader
      if (px !== null && Math.hypot(x - px, y - py) < 4 && i < st.pts.length - 3) continue;
      xs.push(x); ys.push(y); ts.push(t); t += 10;
      px = x; py = y;
    }
    t += 150; // pen lifted
    return [xs, ys, ts];
  });
  const res = await fetch('https://inputtools.google.com/request?ime=handwriting&app=sahitisplanner&dbg=0&cs=1&oe=UTF-8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      options: 'enable_pre_space',
      requests: [{ writing_guide: { writing_area_width: Math.round(b.w * S) + 20, writing_area_height: Math.round(b.h * S) + 20 }, ink, language: 'en', max_num_results: 5 }],
    }),
  });
  const data = await res.json();
  if (data[0] !== 'SUCCESS') throw new Error('Recognition failed');
  const cands = data[1]?.[0]?.[1] || [];
  return (cands[0] || '').replace(/\s+/g, ' ').trim();
}

// ---------- pinch to zoom (two fingers) ----------
// viewport: the scrolling box. host: the ink surface inside it.
// While pinching we scale with a fast CSS transform; when fingers lift we
// re-render at the new size so ink stays crisp. The Pencil keeps writing normally.
export function makeZoomable(viewport, host, { min = 1, max = 3, onZoom, factor = () => 1 } = {}) {
  let scale = 1;
  let pinch = null;
  viewport.classList.add('zoom-viewport');
  const fingers = (e) => [...e.touches].filter((t) => t.touchType !== 'stylus');
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const apply = (s, cx, cy) => {
    // cx, cy: pinch center in viewport coordinates
    const r = viewport.getBoundingClientRect();
    const px = (viewport.scrollLeft + cx - r.left) / scale;
    const py = (viewport.scrollTop + cy - r.top) / scale;
    scale = s;
    host.style.width = `${s * factor() * 100}%`;
    host.style.transform = '';
    // after the ResizeObserver re-renders, keep the pinch point under the fingers
    requestAnimationFrame(() => {
      viewport.scrollLeft = px * s - (cx - r.left);
      viewport.scrollTop = py * s - (cy - r.top);
    });
    viewport.classList.toggle('zoomed', s > 1.01);
    onZoom?.(s);
  };
  viewport.addEventListener('touchstart', (e) => {
    const f = fingers(e);
    if (f.length === 2) {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      const cx = (f[0].clientX + f[1].clientX) / 2, cy = (f[0].clientY + f[1].clientY) / 2;
      pinch = { d0: dist(f[0], f[1]), s0: scale, cx, cy, ox: cx - r.left, oy: cy - r.top, s: scale };
      host.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
    }
  }, { passive: false });
  viewport.addEventListener('touchmove', (e) => {
    if (!pinch) return;
    const f = fingers(e);
    if (f.length < 2) return;
    e.preventDefault();
    pinch.s = Math.min(max, Math.max(min, pinch.s0 * (dist(f[0], f[1]) / pinch.d0)));
    host.style.transform = `scale(${pinch.s / pinch.s0})`;
  }, { passive: false });
  const end = (e) => {
    if (!pinch) return;
    if (fingers(e).length >= 2) return;
    const p = pinch; pinch = null;
    apply(p.s, p.cx, p.cy);
  };
  viewport.addEventListener('touchend', end);
  viewport.addEventListener('touchcancel', end);
  // Safari's own page zoom gestures: keep them off the writing page
  viewport.addEventListener('gesturestart', (e) => e.preventDefault());
  // Trackpad / ctrl+wheel zoom on the computer
  viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    apply(Math.min(max, Math.max(min, scale * (1 - e.deltaY * 0.01))), e.clientX, e.clientY);
  }, { passive: false });
  return {
    get scale() { return scale; },
    refresh() { host.style.width = `${scale * factor() * 100}%`; },
    set(s) { const r = viewport.getBoundingClientRect(); apply(Math.min(max, Math.max(min, s)), r.left + r.width / 2, r.top + 40); },
  };
}
