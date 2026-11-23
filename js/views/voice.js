// Voice notes: record audio + transcript, link to a date/task/section, organize into sections.
import { h, toast, menu, pickDate, debounce, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import { fetchAudio } from '../sync.js';
import { bus } from '../bus.js';
import { micIcon } from '../dock.js';
import * as G from '../google.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function canTranscribe() { return !!SR; }

// Start recording. Returns { stop(): Promise<{blob, duration, transcript}>, cancel() }
export async function startRecording({ onText } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  const t0 = Date.now();
  let finalText = '', interim = '', recog = null;
  if (SR) {
    try {
      recog = new SR();
      recog.continuous = true; recog.interimResults = true; recog.lang = navigator.language || 'en-US';
      recog.onresult = (e) => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += `${r[0].transcript.trim()} `; else interim += r[0].transcript;
        }
        onText?.((finalText + interim).trim());
      };
      recog.onend = () => { if (rec.state === 'recording') { try { recog.start(); } catch {} } };
      recog.start();
    } catch { recog = null; }
  }
  const finish = () => new Promise((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve({ blob: new Blob(chunks, { type: rec.mimeType || mime || 'audio/mp4' }), duration: Math.round((Date.now() - t0) / 1000), transcript: (finalText + interim).trim() });
    };
    try { recog?.stop(); } catch {}
    rec.stop();
  });
  return {
    stop: finish,
    cancel: () => { try { recog?.abort(); } catch {} rec.onstop = () => stream.getTracks().forEach((t) => t.stop()); rec.stop(); },
  };
}

export async function saveRecording({ blob, duration, transcript }, link = null) {
  const id = store.uid();
  const audioKey = `audio:${id}`;
  await store.putBlob(audioKey, blob);
  const v = store.put('voice', { id, createdAt: Date.now(), duration, transcript: transcript || '', audioKey, mime: blob.type, link: link || { date: D.todayKey() } });
  if (!transcript) transcribe(v, blob); // no live transcript (common on iPad): make one from the audio
  return v;
}

// Turns a recording into text on your connection server. Returns the text or ''.
export async function transcribe(v, blob) {
  const session = G.session();
  if (!session) return '';
  try {
    blob = blob || (await store.getBlob(v.audioKey));
    if (!blob) return '';
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const res = await fetch(`${G.authServer()}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, audio: btoa(bin) }) });
    if (!res.ok) return '';
    const { text } = await res.json();
    if (text) store.put('voice', { id: v.id, transcript: text });
    return text || '';
  } catch { return ''; }
}

export function renderVoice(host, sec, { compact = false } = {}) {
  const list = store.all('voice').sort((a, b) => b.createdAt - a.createdAt);
  const rec = recorderWidget({ onSaved: () => bus.rerender() });
  host.append(h('div', { class: `voice ${compact ? 'compact' : ''}` },
    rec,
    list.length ? h('div', { class: 'voice-list' }, list.map(voiceCard)) : h('p', { class: 'empty' }, 'Recordings you make anywhere in the planner appear here.')));
}

// One recording at a time, kept outside the screen so a refresh of the page
// (sync, autosave) never loses the Stop button.
const active = { ctl: null, t0: 0, text: '', link: null, onSaved: null, views: new Set() };
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
setInterval(() => { if (active.ctl) active.views.forEach((v) => v.paint()); }, 500);

export function isRecording() { return !!active.ctl; }

export async function stopActive() {
  if (!active.ctl) return null;
  const ctl = active.ctl; active.ctl = null;
  active.views.forEach((v) => v.paint());
  const res = await ctl.stop();
  const v = await saveRecording(res, active.link);
  toast('Voice note saved');
  active.onSaved?.(v);
  active.text = '';
  active.views.forEach((x) => x.paint());
  return v;
}

export function recorderWidget({ onSaved, link } = {}) {
  const live = h('div', { class: 'live-text', 'aria-live': 'polite' });
  const timer = h('span', { class: 'rec-time' }, '0:00');
  const label = h('span', {}, 'Record');
  const btn = h('button', { class: 'rec-btn' }, micIcon(), label);
  let seen = false;
  const view = {
    paint() {
      if (el.isConnected) seen = true;
      else if (seen) { active.views.delete(view); return; }
      const on = !!active.ctl;
      btn.classList.toggle('on', on);
      label.textContent = on ? 'Stop' : 'Record';
      btn.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
      timer.textContent = on ? fmtDur(Math.round((Date.now() - active.t0) / 1000)) : '0:00';
      live.textContent = on ? (active.text || (SR ? 'Listening…' : '')) : '';
    },
  };
  btn.onclick = async () => {
    if (active.ctl) { await stopActive(); return; }
    try {
      active.text = '';
      active.ctl = await startRecording({ onText: (t) => { active.text = t; active.views.forEach((v) => v.paint()); } });
    } catch { toast('Microphone permission is needed to record.'); return; }
    active.t0 = Date.now(); active.link = link || null; active.onSaved = onSaved || null;
    active.views.forEach((v) => v.paint());
  };
  const el = h('div', { class: 'recorder' }, btn, timer, live);
  active.views.add(view);
  view.paint();
  return el;
}

function voiceCard(v) {
  const audio = h('audio', { controls: true, preload: 'none' });
  const load = async () => {
    let blob = await store.getBlob(v.audioKey);
    if (!blob) blob = await fetchAudio(v);
    if (blob) audio.src = URL.createObjectURL(blob);
    else audio.replaceWith(h('span', { class: 'hint' }, 'Audio is on another device. Connect Google to fetch it.'));
  };
  queueMicrotask(load);
  const save = debounce((t) => store.put('voice', { id: v.id, transcript: t }, { quiet: true }), 500);
  const linkLabel = v.link?.date ? D.relLabel(v.link.date) : v.link?.itemId ? (store.get('items', v.link.itemId)?.title || 'Task') : v.link?.section ? model.section(v.link.section)?.name : 'Link…';
  return h('div', { class: 'voice-card' },
    h('div', { class: 'voice-head' },
      h('span', { class: 'voice-when' }, `${D.fmtLong(D.key(new Date(v.createdAt)))} · ${D.fmtTime(new Date(v.createdAt))} · ${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}`),
      h('button', { class: 'chip', onclick: (e) => linkMenu(e.currentTarget, v) }, linkLabel),
      h('button', { class: 'chip accent', onclick: () => bus.capture?.(v.transcript, v) }, 'Organize'),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Delete recording', onclick: async () => { if (await confirmSheet('Delete recording?', 'The audio and transcript will be removed.', 'Delete')) store.remove('voice', v.id); } }, 'Delete')),
    audio,
    h('div', { class: 'tr-head' }, h('span', { class: 'tr-label' }, 'Transcript'),
      !v.transcript ? h('button', { class: 'link-add', onclick: async (e) => {
        e.currentTarget.textContent = 'Making transcript…';
        const t = await transcribe(v);
        if (!t) { e.currentTarget.textContent = 'Make transcript'; toast('Could not make a transcript. Connect Google in Settings first.'); }
      } }, 'Make transcript') : null),
    h('textarea', { class: 'transcript', 'data-fk': `tr:${v.id}`, rows: 2, placeholder: 'No transcript yet', oninput: (e) => save(e.target.value), onblur: (e) => save.flush(e.target.value) }, v.transcript || ''));
}

function linkMenu(anchor, v) {
  const tasks = store.all('items').filter((i) => !i.done && i.title).slice(0, 30);
  menu(anchor, [
    { label: 'Link to a date', icon: '◷', run: () => pickDate(anchor, v.link?.date, (d) => store.put('voice', { id: v.id, link: d ? { date: d } : null })) },
    { label: 'Link to a section', icon: '▤', run: () => menu(anchor, model.sections().map((s) => ({ label: s.name, run: () => store.put('voice', { id: v.id, link: { section: s.id } }) }))) },
    tasks.length && { label: 'Link to a task', icon: '☑', run: () => menu(anchor, tasks.map((t) => ({ label: t.title, run: () => store.put('voice', { id: v.id, link: { itemId: t.id } }) }))) },
    { label: 'Remove link', icon: '✕', run: () => store.put('voice', { id: v.id, link: null }) },
  ]);
}
