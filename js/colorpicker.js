// Color mixer: hue / saturation / brightness sliders, R G B sliders, and a hex box.
import { h } from './ui.js';

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return [hh, mx ? d / mx : 0, mx];
}
function hsvToRgb(hh, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Returns an element. onChange(hex) fires live while sliding.
export function colorMixer(value, onChange) {
  let [r, g, b] = hexToRgb(value) || [47, 43, 39];
  let [hh, s, v] = rgbToHsv(r, g, b);

  const preview = h('div', { class: 'mix-preview' });
  const hex = h('input', { class: 'mix-hex', 'aria-label': 'Hex color', maxlength: 7, spellcheck: false, autocapitalize: 'characters' });
  const slider = (label, max, step = 1) => {
    const input = h('input', { type: 'range', min: 0, max, step, 'aria-label': label });
    const num = h('span', { class: 'mix-num' });
    const row = h('label', { class: 'mix-row' }, h('span', { class: 'mix-label' }, label), input, num);
    return { input, num, row };
  };
  const H = slider('Hue', 360), S = slider('Saturation', 100), V = slider('Brightness', 100);
  const R = slider('R', 255), G = slider('G', 255), B = slider('B', 255);

  const paint = () => {
    const cur = rgbToHex(r, g, b);
    preview.style.background = cur;
    if (document.activeElement !== hex) hex.value = cur;
    H.input.value = hh; S.input.value = s * 100; V.input.value = v * 100;
    R.input.value = r; G.input.value = g; B.input.value = b;
    H.num.textContent = Math.round(hh); S.num.textContent = Math.round(s * 100); V.num.textContent = Math.round(v * 100);
    R.num.textContent = Math.round(r); G.num.textContent = Math.round(g); B.num.textContent = Math.round(b);
    const pure = rgbToHex(...hsvToRgb(hh, 1, 1));
    const full = rgbToHex(...hsvToRgb(hh, s, 1));
    S.input.style.setProperty('--track', `linear-gradient(90deg, ${rgbToHex(...hsvToRgb(hh, 0, v))}, ${rgbToHex(...hsvToRgb(hh, 1, v))})`);
    V.input.style.setProperty('--track', `linear-gradient(90deg, #000, ${full})`);
    H.input.style.setProperty('--track', 'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)');
    R.input.style.setProperty('--track', `linear-gradient(90deg, ${rgbToHex(0, g, b)}, ${rgbToHex(255, g, b)})`);
    G.input.style.setProperty('--track', `linear-gradient(90deg, ${rgbToHex(r, 0, b)}, ${rgbToHex(r, 255, b)})`);
    B.input.style.setProperty('--track', `linear-gradient(90deg, ${rgbToHex(r, g, 0)}, ${rgbToHex(r, g, 255)})`);
    void pure;
  };
  const fromHsv = () => { [r, g, b] = hsvToRgb(hh, s, v).map(Math.round); paint(); onChange(rgbToHex(r, g, b)); };
  const fromRgb = () => { const nh = rgbToHsv(r, g, b); if (nh[1] > 0) hh = nh[0]; s = nh[1]; v = nh[2]; paint(); onChange(rgbToHex(r, g, b)); };
  H.input.oninput = () => { hh = +H.input.value; fromHsv(); };
  S.input.oninput = () => { s = +S.input.value / 100; fromHsv(); };
  V.input.oninput = () => { v = +V.input.value / 100; fromHsv(); };
  R.input.oninput = () => { r = +R.input.value; fromRgb(); };
  G.input.oninput = () => { g = +G.input.value; fromRgb(); };
  B.input.oninput = () => { b = +B.input.value; fromRgb(); };
  hex.oninput = () => {
    const v2 = hex.value.startsWith('#') ? hex.value : `#${hex.value}`;
    const rgb = hexToRgb(v2);
    if (rgb) { [r, g, b] = rgb; fromRgb(); }
  };
  paint();
  const tabs = h('div', { class: 'seg mix-tabs' });
  const hsvBox = h('div', { class: 'mix-sliders' }, H.row, S.row, V.row);
  const rgbBox = h('div', { class: 'mix-sliders', hidden: true }, R.row, G.row, B.row);
  const tab = (label, show) => h('button', { type: 'button', onclick: (e) => {
    hsvBox.hidden = show !== 'hsv'; rgbBox.hidden = show !== 'rgb';
    [...tabs.children].forEach((c) => c.classList.toggle('on', c === e.currentTarget));
  } }, label);
  tabs.append(tab('Hue', 'hsv'), tab('RGB', 'rgb'));
  tabs.firstChild.classList.add('on');
  return h('div', { class: 'mixer' }, h('div', { class: 'mix-top' }, preview, hex, tabs), hsvBox, rgbBox);
}
