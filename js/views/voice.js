// Voice notes: record audio + transcript, link to a date/task/section, organize into sections.
import { h, toast, menu, pickDate, debounce, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import * as model from '../model.js';
import * as D from '../dates.js';
import { fetchAudio } from '../sync.js';
import { bus } from '../bus.js';
import { micIcon } from '../dock.js';

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
  return store.put('voice', { id, createdAt: Date.now(), duration, transcript: transcript || '', audioKey, mime: blob.type, link: link || { date: D.todayKey() } });
}

export function renderVoice(host, sec, { compact = false } = {}) {
  const list = store.all('voice').sort((a, b) => b.createdAt - a.createdAt);
  const rec = recorderWidget({ onSaved: () => bus.rerender() });
  host.append(h('div', { class: `voice ${compact ? 'compact' : ''}` },
    rec,
    !SR ? h('p', { class: 'hint' }, 'Live transcripts are not available in this browser. Recordings still save, and you can type a transcript.') : null,
    list.length ? h('div', { class: 'voice-list' }, list.map(voiceCard)) : h('p', { class: 'empty' }, 'Recordings you make anywhere in the planner appear here.')));
}

export function recorderWidget({ onSaved, link } = {}) {
  const live = h('div', { class: 'live-text' });
  const timer = h('span', { class: 'rec-time' }, '0:00');
  const btn = h('button', { class: 'rec-btn', 'aria-label': 'Start recording' }, micIcon(), h('span', {}, 'Record'));
  let ctl = null, t0 = 0, tick = null;
  btn.onclick = async () => {
    if (!ctl) {
      try {
        ctl = await startRecording({ onText: (t) => { live.textContent = t; } });
      } catch { toast('Microphone permission is needed to record.'); return; }
      t0 = Date.now();
      btn.classList.add('on'); btn.lastChild.textContent = 'Stop'; btn.setAttribute('aria-label', 'Stop recording');
      tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
    } else {
      clearInterval(tick);
      const res = await ctl.stop();
      ctl = null;
      btn.classList.remove('on'); btn.lastChild.textContent = 'Record';
      const v = await saveRecording(res, link);
      toast('Voice note saved');
      onSaved?.(v);
    }
  };
  return h('div', { class: 'recorder' }, btn, timer, live);
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
  const linkLabel = v.link?.date ? `◷ ${D.relLabel(v.link.date)}` : v.link?.itemId ? `☑ ${store.get('items', v.link.itemId)?.title || 'Task'}` : v.link?.section ? `▤ ${model.section(v.link.section)?.name}` : 'Link…';
  return h('div', { class: 'voice-card' },
    h('div', { class: 'voice-head' },
      h('span', { class: 'voice-when' }, `${D.fmtLong(D.key(new Date(v.createdAt)))} · ${D.fmtTime(new Date(v.createdAt))} · ${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}`),
      h('button', { class: 'chip', onclick: (e) => linkMenu(e.currentTarget, v) }, linkLabel),
      h('button', { class: 'chip accent', onclick: () => bus.capture?.(v.transcript, v) }, '✦ Organize'),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Delete recording', onclick: async () => { if (await confirmSheet('Delete recording?', 'The audio and transcript will be removed.', 'Delete')) store.remove('voice', v.id); } }, '✕')),
    audio,
    h('textarea', { class: 'transcript', 'data-fk': `tr:${v.id}`, rows: 2, placeholder: 'Transcript (you can edit or type it)', oninput: (e) => save(e.target.value), onblur: (e) => save.flush(e.target.value) }, v.transcript || ''));
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
