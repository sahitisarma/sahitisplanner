// Routes a section to its view.
import { h } from '../ui.js';
import { renderCalendar } from './calendar.js';
import { renderList, renderToBuy } from './lists.js';
import { renderNotes } from './notes.js';
import { renderVoice } from './voice.js';

export function renderSection(host, sec, opts = {}) {
  if (!sec) { host.append(h('p', { class: 'empty' }, 'This section no longer exists.')); return; }
  switch (sec.type) {
    case 'calendar': return renderCalendar(host, opts);
    case 'tobuy': return renderToBuy(host, sec, opts);
    case 'notes': return renderNotes(host, sec, opts);
    case 'voice': return renderVoice(host, sec, opts);
    default: return renderList(host, sec, opts);
  }
}
