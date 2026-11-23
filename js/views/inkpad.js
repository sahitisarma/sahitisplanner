// Handwriting areas that belong to a page (a day, a month, a note).
// Saved automatically into the 'ink' collection, keyed by page.
import { InkSurface, makeZoomable } from '../ink.js';
import * as store from '../store.js';

const live = new Map(); // inkId -> Set<InkSurface>

// Track a surface so handwriting from another device updates it in place.
export function registerLive(inkId, surf, host) {
  if (!live.has(inkId)) live.set(inkId, new Set());
  live.get(inkId).add(surf);
  const obs = new MutationObserver(() => {
    if (!host.isConnected) { surf.destroy(); live.get(inkId)?.delete(surf); obs.disconnect(); }
  });
  setTimeout(() => obs.observe(document.body, { childList: true, subtree: true }), 0);
}

export function inkPad(host, inkId, opts = {}) {
  const rec = store.get('ink', inkId);
  const surf = new InkSurface(host, {
    ...opts,
    strokes: rec?.strokes || [],
    logicalH: Math.max(opts.logicalH || 120, rec?.h || 0),
    onChange: (strokes, info) => {
      store.put('ink', { id: inkId, strokes, h: Math.round(surf.logicalH) }, { quiet: !info?.loud });
      opts.onChange?.(strokes);
    },
  });
  if (!live.has(inkId)) live.set(inkId, new Set());
  live.get(inkId).add(surf);
  const obs = new MutationObserver(() => {
    if (!host.isConnected) { surf.destroy(); live.get(inkId)?.delete(surf); obs.disconnect(); }
  });
  setTimeout(() => obs.observe(document.body, { childList: true, subtree: true }), 0);
  return surf;
}

// When another device's handwriting arrives, update any open pad in place.
export function refreshInkPads() {
  for (const [id, set] of live) {
    const rec = store.get('ink', id);
    for (const s of set) {
      const same = JSON.stringify(s.strokes.map((x) => x.id)) === JSON.stringify((rec?.strokes || []).map((x) => x.id));
      if (!same) s.setStrokes(rec?.strokes || []);
    }
  }
}

// A writing page you can pinch to zoom (GoodNotes style).
// Returns the wrapper element; the page lives inside it.
export function zoomPage(inkId, { paper = 'lined', height = '70vh', ...opts } = {}) {
  const host = document.createElement('div');
  host.className = `zoom-page paper-${paper}`;
  const viewport = document.createElement('div');
  viewport.style.setProperty('--vh', height);
  viewport.append(host);
  const chip = document.createElement('button');
  chip.className = 'zoom-chip';
  chip.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = 'zoom-wrap';
  wrap.append(viewport, chip);
  queueMicrotask(() => {
    const surf = inkPad(host, inkId, opts);
    const z = makeZoomable(viewport, host, {
      onZoom: (sc) => { chip.hidden = sc <= 1.01; chip.textContent = `${Math.round(sc * 100)}%  ·  Reset`; },
    });
    chip.onclick = () => z.set(1);
    wrap.surface = surf;
  });
  return wrap;
}
