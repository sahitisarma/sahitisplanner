// Turns a quick note ("Buy milk at Target, call the dentist tomorrow, and dinner
// Friday at seven") into suggestions: shopping items, errands, to-dos and events.
// Nothing is created until you review the suggestions.
import { key, addDays, parseKey, startOfWeek } from './dates.js';

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const SHOP_VERB = /^(?:buy|get|grab|order|restock|pick up|pickup)\b/i;
const ERRAND_VERB = /^(?:call|phone|text|email|pick up|drop off|drop|return|mail|ship|post|deposit|renew|pay|book|schedule|cancel|go to|stop by|visit|take)\b/i;
const ERRAND_WORDS = /\b(?:post office|bank|dry clean|pharmacy|dmv|car wash|oil change|returns?|prescription)\b/i;
const EVENT_WORDS = /\b(?:dinner|lunch|brunch|breakfast|coffee|drinks|meeting|meet|appointment|appt|party|class|lesson|session|date night|date|interview|concert|show|movie|game|practice|birthday|wedding|flight|trip|call with|zoom|standup|workout|yoga|gym)\b/i;

function cap(s) { s = s.trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

export function parseDate(text, today) {
  const t = text.toLowerCase();
  let m;
  if (/\b(today|tonight|this evening|this morning|this afternoon)\b/.test(t)) return { date: today, match: RegExp.lastMatch };
  if ((m = t.match(/\b(tomorrow|tmrw|tmr)\b/))) return { date: addDays(today, 1), match: m[0] };
  if ((m = t.match(/\bin (\d+|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/))) {
    const n = m[1] === 'a' ? 1 : (NUM[m[1]] || Number(m[1]));
    return { date: addDays(today, n * (m[2].startsWith('week') ? 7 : 1)), match: m[0] };
  }
  if ((m = t.match(/\b(this )?weekend\b/))) {
    const sat = addDays(startOfWeek(today), 6);
    return { date: sat < today ? addDays(sat, 7) : sat, match: m[0] };
  }
  if ((m = t.match(new RegExp(`\\b(next |this |on )?${DAY_RE}\\b`)))) {
    const abbr = m[2];
    const idx = DAYS.findIndex((d) => d.startsWith(abbr.slice(0, 3)));
    if (idx >= 0) {
      const now = parseKey(today).getDay();
      let delta = (idx - now + 7) % 7;
      if (m[1] && m[1].trim() === 'next') {
        // "next Friday" = Friday of next week (weeks start Sunday)
        const nextWeekStart = addDays(startOfWeek(today), 7);
        return { date: addDays(nextWeekStart, idx), match: m[0] };
      }
      if (delta === 0 && !(m[1] && m[1].trim() === 'this')) delta = 0;
      return { date: addDays(today, delta), match: m[0] };
    }
  }
  if ((m = t.match(new RegExp(`\\b(?:on )?(${MONTHS.join('|')})[a-z]*\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const mo = MONTHS.indexOf(m[1]);
    const y = parseKey(today).getFullYear();
    let d = key(new Date(y, mo, Number(m[2])));
    if (d < today) d = key(new Date(y + 1, mo, Number(m[2])));
    return { date: d, match: m[0] };
  }
  if ((m = t.match(/\b(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : parseKey(today).getFullYear();
    let d = key(new Date(y, Number(m[1]) - 1, Number(m[2])));
    if (!m[3] && d < today) d = key(new Date(y + 1, Number(m[1]) - 1, Number(m[2])));
    return { date: d, match: m[0] };
  }
  return null;
}

export function parseTime(text, { evening = false } = {}) {
  const t = text.toLowerCase();
  let m;
  if ((m = t.match(/\b(?:at |@ ?)?noon\b/))) return { time: '12:00', match: m[0] };
  if ((m = t.match(/\b(?:at )?midnight\b/))) return { time: '00:00', match: m[0] };
  if ((m = t.match(/\b(?:at |@ ?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/))) {
    let hr = Number(m[1]) % 12; if (m[3].startsWith('p')) hr += 12;
    return { time: `${String(hr).padStart(2, '0')}:${m[2] || '00'}`, match: m[0] };
  }
  if ((m = t.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\b/)) || (m = t.match(new RegExp(`\\b(?:at)\\s+(${Object.keys(NUM).join('|')})(?:\\s+(thirty|fifteen|forty-five))?\\b`)))) {
    let hr = NUM[m[1]] || Number(m[1]);
    const min = m[2] ? ({ thirty: '30', fifteen: '15', 'forty-five': '45' }[m[2]] || m[2]) : '00';
    if (hr <= 12) {
      if (hr === 12) hr = 12;
      else if (hr <= 6 || evening) hr += 12; // "at 3" means 3pm; "dinner at 7" means 7pm
    }
    return { time: `${String(hr).padStart(2, '0')}:${min}`, match: m[0] };
  }
  if ((m = t.match(/\b(in the morning|this morning)\b/))) return { time: '09:00', match: m[0], soft: true };
  if ((m = t.match(/\b(tonight|this evening|in the evening)\b/))) return { time: '19:00', match: m[0], soft: true };
  return null;
}

function splitClauses(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/\s*(?:[;\n]|,(?!\d)|\.(?=\s|$)|\band then\b|\bthen\b|\balso\b)\s*/i)
    .flatMap((c) => c.split(/\s+and\s+(?=(?:buy|get|grab|call|pick|drop|return|mail|email|text|book|schedule|pay|dinner|lunch|brunch|coffee|meet|go|stop|finish|send|write|clean|do)\b)/i))
    .map((c) => c.replace(/^(?:and|also|then|i need to|i have to|need to|remember to|don't forget to|dont forget to|i should|gotta|got to)\s+/i, '').trim())
    .filter((c) => c.length > 1);
}

export function organize(text, { today, stores = [] } = {}) {
  const out = [];
  let lastShop = null;
  for (const raw of splitClauses(text)) {
    let rest = raw;
    // store
    let storeName = null;
    const known = stores.find((s) => new RegExp(`\\b(?:at|from)\\s+${escapeRe(s)}\\b`, 'i').test(rest));
    if (known) { storeName = known; rest = rest.replace(new RegExp(`\\s*\\b(?:at|from)\\s+${escapeRe(known)}\\b`, 'i'), ''); }
    else {
      const sm = rest.match(/\b(?:at|from)\s+((?:[A-Z][\w'’&.-]*)(?:\s+[A-Z][\w'’&.-]*)*)/);
      if (sm && SHOP_VERB.test(rest)) { storeName = sm[1]; rest = rest.replace(sm[0], ''); }
    }
    const isEventish = EVENT_WORDS.test(rest);
    const d = parseDate(rest, today);
    if (d) rest = rest.replace(new RegExp(escapeRe(d.match), 'i'), ' ');
    const tm = parseTime(rest, { evening: /\b(dinner|drinks|party|tonight|concert|show|movie|date)\b/i.test(raw) });
    if (tm) rest = rest.replace(new RegExp(escapeRe(tm.match), 'i'), ' ');
    rest = rest.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim().replace(/[,.]$/, '');

    let type;
    if (SHOP_VERB.test(raw) && (storeName || !/^pick ?up\b/i.test(raw))) type = 'tobuy';
    else if (isEventish && (tm || d) && !/^(call|email|text)\b/i.test(raw)) type = 'event';
    else if (tm && !tm.soft && !ERRAND_VERB.test(raw)) type = 'event';
    else if (ERRAND_VERB.test(raw) || ERRAND_WORDS.test(raw)) type = 'errand';
    else if (lastShop && !d && !tm && raw.split(' ').length <= 4 && !/^[a-z]+ing\b/i.test(raw)) type = 'tobuy';
    else type = 'todo';

    let title = rest;
    if (type === 'tobuy') {
      title = title.replace(SHOP_VERB, '').trim();
      if (!storeName && lastShop) storeName = lastShop.store;
      // "Buy milk" + "eggs at Target" -> both at Target
      if (storeName && lastShop && !lastShop.store) lastShop.store = storeName;
    }
    title = title.replace(/\s+\b(by|on|at|for|before|due)$/i, '').trim();
    const titles = type === 'tobuy' ? title.split(/\s*(?:\band\b|&|\+)\s*/i).filter(Boolean) : [title];
    for (const t of titles) {
      const s = { type, title: cap(t || raw), date: d?.date || null, time: tm?.time || null, store: type === 'tobuy' ? storeName : null, raw };
      if (type === 'event' && !s.date) s.date = today;
      if (type !== 'tobuy' && /\bby\b/i.test(raw) && d) { s.due = d.date; }
      out.push(s);
      lastShop = type === 'tobuy' ? s : null;
    }
  }
  return out;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
