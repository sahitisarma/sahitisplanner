// Simulates Google + Cloudflare KV to test server/worker.js end to end.
import assert from 'node:assert';
import worker from '../server/worker.js';
const kv = new Map();
const env = {
  APP_ORIGIN: 'https://sahitisarma.github.io', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret',
  SP_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
};
let revoked = false, refreshCalls = 0;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    const p = new URLSearchParams(opts.body);
    assert.equal(p.get('client_secret'), 'secret');
    if (p.get('grant_type') === 'authorization_code') return Response.json({ access_token: 'AT1', refresh_token: 'RT', expires_in: 3599 });
    if (revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    refreshCalls++; return Response.json({ access_token: `AT_fresh_${refreshCalls}`, expires_in: 3599 });
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) { revoked = true; return new Response(''); }
  throw new Error('unexpected ' + url);
};
const W = 'https://auth.example.workers.dev';
const APP = 'https://sahitisarma.github.io/sahitisplanner/';
// 1. start
let r = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent(APP)}`), env);
assert.equal(r.status, 302);
const g = new URL(r.headers.get('Location'));
assert.equal(g.searchParams.get('access_type'), 'offline');
assert.equal(g.searchParams.get('redirect_uri'), `${W}/auth/callback`);
// a different site cannot use the server
r = await worker.fetch(new Request(`${W}/auth/start?return=${encodeURIComponent('https://evil.com/')}`), env);
assert.equal(r.status, 400);
// 2. callback
r = await worker.fetch(new Request(`${W}/auth/callback?code=abc&state=${g.searchParams.get('state')}`), env);
const back = new URL(r.headers.get('Location'));
assert.ok(back.href.startsWith(APP));
const hp = new URLSearchParams(back.hash.slice(1));
const session = hp.get('sp_session');
assert.equal(session.length, 64); assert.equal(hp.get('access_token'), 'AT1');
assert.ok(![...kv.values()].some((v) => v.includes(session)), 'session not stored in plain text');
// 3. token, many times (always connected)
const post = (path, body, origin = env.APP_ORIGIN) => worker.fetch(new Request(`${W}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
for (let i = 1; i <= 3; i++) { const t = await (await post('/token', { session })).json(); assert.equal(t.access_token, `AT_fresh_${i}`); }
assert.equal((await post('/token', { session }, 'https://evil.com')).status, 403);
assert.equal((await post('/token', { session: 'wrong' })).status, 401);
// 4. revoke
assert.equal((await (await post('/revoke', { session })).json()).ok, true);
assert.equal((await post('/token', { session })).status, 401);
console.log('worker ok');
