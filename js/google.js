// Google sign-in (OAuth redirect flow, works in a Home Screen web app) + API helper.
// No server needed. Google access tokens last about an hour; the planner renews
// them automatically when you open it or come back to it.
import * as model from './model.js';
import * as store from './store.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/drive.appdata',
  'openid', 'email',
].join(' ');

const TOKEN_KEY = 'sp-google-token';
const SESSION_KEY = 'sp-google-session';

export function clientId() { return (model.settings().googleClientId || '').trim(); }
// Always-connected mode: a tiny server (see /server) that keeps Google signed in.
export function authServer() { return (model.settings().authServer || '').trim().replace(/\/$/, ''); }
export function session() { return localStorage.getItem(SESSION_KEY) || ''; }
export function alwaysOn() { return !!(authServer() && session()); }
export function configured() { return !!(authServer() || clientId()); }
export function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

export function getToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() + 60_000 ? t : null;
  } catch { return null; }
}
export function wasConnected() { return !!localStorage.getItem('sp-google-email') || !!localStorage.getItem(TOKEN_KEY) || !!session(); }
export function email() { return localStorage.getItem('sp-google-email') || ''; }
export function isConnected() { return !!getToken() || alwaysOn(); }

// Get a valid access token. In always-connected mode this quietly asks the server.
let refreshing = null;
export async function ensureToken() {
  const t = getToken();
  if (t) return t;
  if (!alwaysOn()) throw new AuthError('signed_out');
  if (!refreshing) {
    refreshing = (async () => {
      const res = await fetch(`${authServer()}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: session() }),
      });
      if (res.status === 401) { localStorage.removeItem(SESSION_KEY); throw new AuthError('signed_out'); }
      if (!res.ok) throw new Error('Connection server is not responding');
      const data = await res.json();
      const tok = { access: data.access_token, exp: Date.now() + Number(data.expires_in || 3600) * 1000 };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
      return tok;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

// Read the token Google sends back in the URL after sign-in.
export function handleRedirect() {
  if (!location.hash.includes('access_token') && !location.hash.includes('error=') && !location.hash.includes('sp_session')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  // Back from the always-connected server
  if (p.get('sp_error')) return { error: p.get('sp_error') };
  if (p.get('sp_session')) {
    localStorage.setItem(SESSION_KEY, p.get('sp_session'));
    if (p.get('access_token')) localStorage.setItem(TOKEN_KEY, JSON.stringify({ access: p.get('access_token'), exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000 }));
    return { ok: true, alwaysOn: true };
  }
  const expected = sessionStorage.getItem('sp-oauth-state');
  if (p.get('state') !== expected) return { error: 'state_mismatch' };
  if (p.get('error')) return { error: p.get('error') };
  const tok = { access: p.get('access_token'), exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000 };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
  return { ok: true };
}

// Send the browser to Google. silent=true tries to renew without showing anything.
export async function connect({ silent = false } = {}) {
  await store.flushNow(); // everything is saved before we leave the page
  if (authServer()) {
    location.assign(`${authServer()}/auth/start?return=${encodeURIComponent(redirectUri())}`);
    return;
  }
  const id = clientId();
  if (!id) throw new Error('no_client_id');
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('sp-oauth-state', state);
  sessionStorage.setItem('sp-oauth-silent', silent ? '1' : '');
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
    state,
    prompt: silent ? 'none' : 'consent',
  });
  const hint = email();
  if (hint) params.set('login_hint', hint);
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export function disconnect() {
  if (alwaysOn()) {
    fetch(`${authServer()}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: session() }) }).catch(() => {});
  }
  localStorage.removeItem(SESSION_KEY);
  const t = getToken();
  if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${t.access}`, { method: 'POST' }).catch(() => {});
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('sp-google-email');
}

export class AuthError extends Error {}

// fetch wrapper with JSON + retry on 429/5xx
export async function api(url, { method = 'GET', body, query, raw = false, headers = {} } = {}) {
  let tok = await ensureToken();
  const u = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u, {
      method,
      headers: { Authorization: `Bearer ${tok.access}`, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (alwaysOn() && attempt === 0) { tok = await ensureToken(); continue; } // token expired mid-way: get a new one
      throw new AuthError('expired');
    }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
    if (res.status === 204) return null;
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) { const err = new Error(data?.error?.message || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  throw new Error('Google is busy. Will retry.');
}

export async function loadEmail() {
  try {
    const me = await api('https://openidconnect.googleapis.com/v1/userinfo');
    if (me?.email) localStorage.setItem('sp-google-email', me.email);
  } catch {}
}

// Google Calendar event ids must use base32hex characters (a-v, 0-9).
// We choose the id ourselves so a retried create can never make a duplicate.
export function newEventId() {
  const chars = '0123456789abcdefghijklmnopqrstuv';
  let s = 'sp';
  for (let i = 0; i < 22; i++) s += chars[Math.floor(Math.random() * 32)];
  return s;
}
